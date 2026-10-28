import { ok, strictEqual } from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkSnapshot, domTarget, regionTarget, writeBrowserArtifacts, writeBrowserReportHtml } from 'slicewright/browser';

export async function verifyPixelRegions(page, renderer, output, assertUI) {
  await rm(output, { recursive:true,force:true });
  await page.setContent(`<style>body{margin:0;height:1400px}.root{position:absolute;left:40px;top:400px;width:160px;height:90px;box-sizing:border-box}#dom{background:#f4e5c5;border:4px solid #443322}#field{position:absolute;left:20px;top:20px;width:60px;height:24px;background:rgb(80,90,100)}</style><div class="root" id="dom"><div id="field"></div></div><canvas class="root" id="canvas" width="160" height="90"></canvas>`);
  await page.evaluate(renderer => {
    const dom = document.getElementById('dom');const canvas = document.getElementById('canvas');
    dom.hidden = renderer !== 'dom';canvas.hidden = renderer !== 'canvas';
    const rect = element => { const r = element.getBoundingClientRect();return { x:r.x,y:r.y,width:r.width,height:r.height }; };
    window.pixelFixture = {
      paint(delta, borderDelta = 0) {
        document.getElementById('field').style.background = `rgb(${80 + delta},90,100)`;
        dom.style.borderColor = `rgb(${68 + borderDelta},51,34)`;
        const context = canvas.getContext('2d');
        context.fillStyle = `rgb(${68 + borderDelta},51,34)`;context.fillRect(0,0,160,90);
        context.fillStyle = '#f4e5c5';context.fillRect(4,4,152,82);
        context.fillStyle = `rgb(${80 + delta},90,100)`;context.fillRect(24,24,60,24);
      },
      measure() { const bounds = rect(canvas);return { bounds,content:{field:{bounds:{x:bounds.x+24,y:bounds.y+24,width:60,height:24}}} }; },
    };
    window.pixelFixture.paint(0);window.scrollTo(0,250);
  }, renderer);
  const target = renderer === 'dom'
    ? domTarget(page, { root: page.locator('#dom'), content: { field: page.locator('#field') } })
    : regionTarget(page, { measure: () => page.evaluate(() => window.pixelFixture.measure()) });
  const reference = await target.capture();
  const field = reference.measurement.content.field.bounds;
  const region = { name: 'status-fill', bounds: [{ x: field.x-reference.clip.x, y: field.y-reference.clip.y, width: field.width, height: field.height }], pixels: { mean:2,p99:2,max:2 } };
  const options = { reference, pixelRegions:[region] };
  await page.evaluate(() => window.pixelFixture.paint(2));
  const actual = await target.capture();
  strictEqual(checkSnapshot(actual, {reference}).ok, false);
  const accepted = checkSnapshot(actual, options);
  strictEqual(accepted.ok, true, JSON.stringify(accepted));
  strictEqual(accepted.pixelPolicy.regions[0].samples, 60*24);
  strictEqual(accepted.pixelPolicy.outside.difference.max, 0);
  if (assertUI) await assertUI(target, options);
  await writeBrowserArtifacts(join(output,'accepted'), {actual,reference,report:accepted});
  await writeBrowserReportHtml(join(output,'accepted'),join(output,'accepted','policy.html'));
  await page.evaluate(() => window.pixelFixture.paint(2, 1));
  const border = await target.capture();
  const outside = checkSnapshot(border, options);
  ok(outside.findings.some(finding => finding.code === 'browser.pixels-outside'));
  await writeBrowserArtifacts(join(output,'outside'), {actual:border,reference,report:outside});
  await page.evaluate(() => window.pixelFixture.paint(20));
  const changed = await target.capture();
  const rejected = checkSnapshot(changed, options);
  ok(rejected.findings.some(finding => finding.code === 'browser.pixel-region'));
  await writeBrowserArtifacts(join(output,'region'), {actual:changed,reference,report:rejected});
  await page.goto(pathToFileURL(join(output,'accepted','policy.html')).href);
  await page.locator('#policy-panel summary').click();
  ok((await page.locator('#policy').innerText()).includes('status-fill'));
  await page.screenshot({ path:join(output,'policy-view.png'),fullPage:true });
  return { renderer, accepted:true, outsideRejected:true, regionRejected:true };
}
