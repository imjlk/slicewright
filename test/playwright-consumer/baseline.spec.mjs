import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname } from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { domTarget, regionTarget, saveBrowserBaseline } from 'slicewright/browser';
import { expect, toMatchUIBaseline } from 'slicewright/playwright';
import { observed, probe, test } from './fixtures.mjs';

async function prepare(page, info, renderer = 'dom') {
  await page.setContent('<style>body{margin:0}#panel{display:block;width:80px;height:40px;background:rgb(0,70,90)}</style>' +
    (renderer === 'dom' ? '<div id="panel"></div>' : '<canvas id="panel" width="80" height="40"></canvas>'));
  await page.evaluate(() => {
    const panel = document.querySelector('#panel');
    const paint = red => {
      const color = `rgb(${red},70,90)`;
      if (panel instanceof HTMLCanvasElement) {
        const ctx = panel.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,80,40);
      } else panel.style.background=color;
    };
    paint(0);panel.addEventListener('click', () => paint(180));
  });
  const live = renderer === 'dom' ? domTarget(page, {root:page.locator('#panel')}) :
    regionTarget(page, {measure:async()=>({bounds:{x:0,y:0,width:80,height:40}})});
  const snapshot = await live.capture();
  const name = info.title.replace(/[^a-z0-9]+/gi, '-')+'.slicewright.json';
  const path = info.snapshotPath(name);
  const environment = `${process.platform}-${info.project.name}-960x900-dpr1`;
  await saveBrowserBaseline(path,snapshot,{approved:true,environment});
  return {live,snapshot,name,path,environment};
}

function snapshots(snapshot, drift=false, settle=false) {
  let captures=0;
  const unexpected=async()=>{throw new Error('A baseline assertion must only capture.');};
  return observed({measure:unexpected,click:unexpected,hover:unexpected,press:unexpected,release:unexpected,
    capture:async()=>{const actual=structuredClone(snapshot);captures++;if(drift||settle&&captures<3)actual.raster.data.fill(255);return actual;}});
}

async function files(directory) {
  const entries=await fs.readdir(directory,{withFileTypes:true});
  const result={};
  for(const entry of entries)if(entry.isFile())result[entry.name]=(await fs.readFile(`${directory}/${entry.name}`)).toString('base64');
  return result;
}

for(const renderer of ['dom','canvas'])test(`baseline live ${renderer}`,async({page},info)=>{
  const {live,snapshot,name,path,environment}=await prepare(page,info,renderer);
  const before=await files(dirname(path));
  const {target,state}=observed(live);
  const custom=baseExpect.extend({toMatchUIBaseline});
  await custom(target).toMatchUIBaseline(name,{environment,timeout:5000});
  await target.click();
  await expect(target).not.toMatchUIBaseline(name,{environment,timeout:5000});
  strictEqual(state.actions,1);
  const delayed=snapshots(snapshot,false,true);
  await expect.configure({timeout:1500})(delayed.target).toMatchUIBaseline(name,{environment,intervals:[20]});
  strictEqual(delayed.state.captures,3);strictEqual(delayed.state.actions,0);
  deepStrictEqual(await files(dirname(path)),before,'Regression checks cannot approve the observed state.');
});

test('baseline invalid input and load errors',async({page},info)=>{
  const {snapshot,name,path,environment}=await prepare(page,info);
  const {target,state}=snapshots(snapshot);
  const corrupt=name+'.corrupt.json';await fs.writeFile(info.snapshotPath(corrupt),'{}');
  const before=await files(dirname(path));
  for(const negative of [false,true]){
    const assertion=negative?expect(target).not:expect(target);
    await rejects(()=>assertion.toMatchUIBaseline(name+'.missing',{environment}),/baseline/i);
    await rejects(()=>assertion.toMatchUIBaseline(corrupt,{environment}),/baseline/i);
    await rejects(()=>assertion.toMatchUIBaseline(name,{environment:'incompatible'}),/environment/i);
    await rejects(()=>assertion.toMatchUIBaseline('',{environment}),/snapshot name/);
    await rejects(()=>assertion.toMatchUIBaseline(name,{environment:''}),/environment/i);
    await rejects(()=>assertion.toMatchUIBaseline(name,{environment,checks:{reference:snapshot}}),/reference/);
  }
  strictEqual(state.captures,0);strictEqual(state.actions,0);
  deepStrictEqual(await files(dirname(path)),before);
});

test('baseline load deadline prevents late captures',async({page},info)=>{
  const {snapshot,name,path,environment}=await prepare(page,info);
  const {target,state}=snapshots(snapshot);
  const original=fs.readFile;
  try{
    for(const negative of [false,true]){
      let release;let finished;
      const completion=new Promise(resolve=>{finished=resolve;});
      const pending=new Promise(resolve=>{release=resolve;});
      fs.readFile=async(...args)=>{
        if(args[0]!==path)return original(...args);
        await pending;
        try{return await original(...args);}finally{finished();}
      };syncBuiltinESMExports();
      const started=performance.now();
      try{
        await rejects(()=>(negative?expect(target).not:expect(target)).toMatchUIBaseline(name,{environment,timeout:250,intervals:[20]}),/Timeout 250ms/);
        ok(performance.now()-started<1500);
      }finally{release();await completion;}
      // Let the pending load finish validation and return to the timed-out poll.
      await new Promise(resolve=>setTimeout(resolve,100));
      strictEqual(state.captures,0);strictEqual(state.actions,0);
    }
  }finally{fs.readFile=original;syncBuiltinESMExports();}
  strictEqual(info.attachments.filter(a=>a.name.startsWith('slicewright-')).length,2);
});

for(const mode of ['mismatch','negation','soft matcher'])test(`fails: baseline ${mode}`,async({page},info)=>{
  const {snapshot,name,path,environment}=await prepare(page,info);
  const before=await files(dirname(path));
  const {target,state}=snapshots(snapshot,mode!=='negation');
  const started=performance.now();
  try{
    const options={environment,timeout:250,intervals:[20]};
    if(mode==='soft matcher'){
      await expect.soft(target).toMatchUIBaseline(name,options);
      await expect.soft(target).toMatchUIBaseline(name,options);
    }else await (mode==='negation'?expect(target).not:expect(target)).toMatchUIBaseline(name,options);
  }finally{
    deepStrictEqual(await files(dirname(path)),before);
    await probe(info,{...state,elapsed:performance.now()-started,timeout:250,
      continued:mode==='soft matcher',errors:info.errors.length});
  }
});
