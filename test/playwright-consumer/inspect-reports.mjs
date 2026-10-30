import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';

const path=process.argv[2];
const report=JSON.parse(await readFile(path,'utf8'));
const specs=[];
function visit(suite){specs.push(...(suite.specs??[]));for(const child of suite.suites??[])visit(child);}
visit(report);
const verified=[];
// Browser file URLs on Windows cannot always open Playwright's long attachment paths.
// A short relocated copy also checks that the report is truly self-contained.
const preview=await mkdtemp(join(tmpdir(),'sw-report-'));
try {
for(const type of [chromium,firefox,webkit]){
  const browser=await type.launch(type.name()==='chromium'&&process.env.SLICEWRIGHT_CHROME_CHANNEL?{channel:process.env.SLICEWRIGHT_CHROME_CHANNEL}:{});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:850}});
    const requests=[];page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    let count=0;let withEnvironment=0;let negated=0;
    for(const spec of specs)for(const test of spec.tests.filter(test=>test.projectName===type.name()))for(const result of test.results){
      for(const attachment of result.attachments.filter(attachment=>attachment.name.endsWith('-html'))){
        const jsonAttachment=result.attachments.find(item=>item.name===attachment.name.replace(/-html$/,'-report'));
        ok(jsonAttachment);
        const saved=JSON.parse(await readFile(jsonAttachment.path,'utf8'));
        const portable=join(preview,`${type.name()}-${count}.html`);
        await copyFile(attachment.path,portable);
        await page.goto(pathToFileURL(portable).href);
        strictEqual(await page.locator('#status').innerText(),'Assertion failed');
        strictEqual(await page.locator('#status').getAttribute('data-ok'),'false');
        strictEqual(JSON.parse(await page.locator('#assertion').innerText()).error,saved.assertion.error);
        if(saved.actual.rendering){
          strictEqual(saved.actual.rendering.browser.name,type.name());
          strictEqual(saved.actual.rendering.browser.version,browser.version());
          ok(saved.actual.rendering.deviceScaleFactor>0);
          ok((await page.locator('#environment').innerText()).includes(type.name()));withEnvironment++;
        }
        if(saved.assertion.negated){negated++;}
        if(count===0)await page.screenshot({path:join(dirname(path),`failure-html-${type.name()}.png`),fullPage:true});
        count++;
      }
    }
    strictEqual(count,14);ok(withEnvironment>0);ok(negated>0);deepStrictEqual(requests,[]);
    verified.push({browser:type.name(),htmlReports:count,withEnvironment,negated});
  }finally{await browser.close();}
}
await writeFile(join(dirname(path),'html-verification.json'),JSON.stringify(verified,null,2));

} finally { await rm(preview,{recursive:true,force:true}); }
