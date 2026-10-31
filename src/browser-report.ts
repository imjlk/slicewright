import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import typia from 'typia';

import type {
  BrowserAssertionFailure,
  BrowserMeasurement,
  BrowserRenderingEnvironment,
  BrowserReport,
} from './browser.js';
import { checkedMeasurement, checkedRect, checkedRendering } from './browser-validation.js';
import { decodePng, encodePng } from './png.js';
import type { Rect } from './raster.js';

interface SnapshotMetadata {
  readonly rendering?: BrowserRenderingEnvironment;
  readonly measurement: BrowserMeasurement;
  readonly clip: Rect;
  readonly width: number;
  readonly height: number;
}

interface SavedReport extends BrowserReport {
  readonly assertion?: BrowserAssertionFailure;
  readonly actual: SnapshotMetadata;
  readonly reference?: SnapshotMetadata;
  readonly changedFrom?: SnapshotMetadata;
}

interface ReportImage {
  readonly name: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly snapshot?: SnapshotMetadata;
}

/**
 * Converts a downloaded artifact directory into a portable, read-only viewer.
 * The output must not exist. Paths recorded inside JSON are never followed.
 * @evidenceReview docs/spec.md#browser-html-reports #549a1e2 Validating JSON and fixed filenames, checking decoded dimensions, escaping embedded data and exclusively creating the output were reviewed against the section.
 * @evidence docs/spec.md#browser-html-reports Validates fixed local artifacts and embeds them in an offline viewer, exclusively creating the output without modifying source files.
 */
export async function writeBrowserReportHtml(
  directory: string,
  output: string,
): Promise<{ readonly path: string; readonly ok: boolean }> {
  const source = resolve(directory);
  await requireArtifactDirectory(source, directory);
  const report = typia.assert<SavedReport>(
    JSON.parse((await artifact(source, 'report.json')).toString('utf8')),
  );
  const images: ReportImage[] = [];
  for (const [name, snapshot] of [
    ['actual', report.actual],
    ['expected', report.reference],
    ['previous', report.changedFrom],
  ] as const) {
    if (snapshot === undefined) {
      continue;
    }
    checkedMeasurement(snapshot.measurement);
    checkedRendering(snapshot.rendering);
    checkedRect(snapshot.clip, 'Report clip', true);
    if (!Number.isSafeInteger(snapshot.width) || !Number.isSafeInteger(snapshot.height) ||
      snapshot.width <= 0 || snapshot.height <= 0 || snapshot.clip.width !== snapshot.width ||
      snapshot.clip.height !== snapshot.height) {
      throw new RangeError('Report dimensions must agree with its clip.');
    }
    images.push(await reportImage(source, name, snapshot.width, snapshot.height, snapshot));
  }
  for (const [name, snapshot] of [
    ['diff', report.reference],
    ['change', report.changedFrom],
  ] as const) {
    if (snapshot !== undefined) {
      images.push(await reportImage(source, name, Math.max(report.actual.width, snapshot.width),
        Math.max(report.actual.height, snapshot.height)));
    }
  }
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, viewerHtml({ report, images }), { flag: 'wx' });
  return { path, ok: report.ok && report.assertion === undefined };
}

/** Names what to pass instead when the directory is missing or holds no report. */
async function requireArtifactDirectory(source: string, given: string): Promise<void> {
  const hint =
    'pass the failure artifact directory that writeBrowserArtifacts or a failed Playwright assertion wrote (it holds report.json and actual.png).';
  const stats = await stat(source).catch(() => undefined);
  if (stats === undefined) {
    throw new TypeError(`${given} does not exist; ${hint}`);
  }
  if (!stats.isDirectory()) {
    throw new TypeError(`${given} is not a directory; ${hint}`);
  }
  if ((await lstat(join(source, 'report.json')).catch(() => undefined)) === undefined) {
    throw new TypeError(`${given} has no report.json; ${hint}`);
  }
}

async function artifact(directory: string, name: string): Promise<Buffer> {
  const path = join(directory, name);
  if (!(await lstat(path)).isFile()) {
    throw new TypeError(`Report artifact must be a regular file: ${name}`);
  }
  return readFile(path);
}

async function reportImage(
  directory: string, name: string, width: number, height: number, snapshot?: SnapshotMetadata,
): Promise<ReportImage> {
  const raster = decodePng(await artifact(directory, `${name}.png`));
  if (raster.width !== width || raster.height !== height) {
    throw new RangeError(`Report image dimensions disagree: ${name}`);
  }
  // Re-encode decoded pixels; do not embed arbitrary input PNG metadata.
  return {
    name,
    width,
    height,
    url: `data:image/png;base64,${Buffer.from(encodePng(raster)).toString('base64')}`,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

function viewerHtml(value: { report: SavedReport; images: readonly ReportImage[] }): string {
  const data = JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Slicewright · Browser report</title>
<style>
:root{font:15px/1.5 system-ui,sans-serif;color:#e9edf5;background:#101722;color-scheme:dark}*{box-sizing:border-box}body{margin:0}header{padding:24px 32px;border-bottom:1px solid #334155;background:#172233}h1{margin:0;font-size:26px}p{margin:8px 0;color:#b7c6da}main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:20px;padding:24px}section,aside{min-width:0}label,button{font:inherit}button{background:#26384f;color:inherit;border:1px solid #51647e;border-radius:6px;padding:7px 14px;cursor:pointer}button[aria-pressed=true]{background:#365ea2;border-color:#9ac2ff}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #73b7ff;outline-offset:3px}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.scroll{overflow:auto;border:1px solid #42516a;border-radius:8px;padding:16px;background:#202b3b}.stage{position:relative;isolation:isolate;background:repeating-conic-gradient(#adb5c0 0% 25%,#d4d8de 0% 50%) 0/16px 16px;overflow:hidden}.stage img{position:absolute;left:0;top:0;max-width:none}.bounds{position:absolute;border:1px solid #ffbd59;pointer-events:none}.bounds.text{border-color:#6fffdf}.bounds.content{border-color:#ff83c1}#regions{position:absolute;inset:0;overflow:hidden;pointer-events:none}h2{font-size:17px;margin:0 0 12px}article,details{padding:14px;background:#1b293b;border:1px solid #3b4c63;border-radius:8px;margin-bottom:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}summary{cursor:pointer}.badge{display:inline-block;padding:3px 10px;margin-top:12px;border-radius:20px;background:#344b67}#status[data-ok=false]{background:#783637}#status[data-ok=true]{background:#215b48}.legend{font-size:13px}.empty{padding:20px}footer{padding:0 24px 24px;color:#aabbd0}@media(max-width:850px){main{grid-template-columns:1fr}header{padding:20px}main{padding:16px}}
</style>
<header><h1>Slicewright <span style="font-weight:400">/ Browser report</span></h1><p>Captured pixels, measured regions, and assertion findings</p><span id="status" class="badge"></span></header>
<main><section aria-label="Images"><div id="tabs" class="controls" role="group" aria-label="Image"></div><div class="controls"><label><input id="overlay" type="checkbox" checked> Measured regions</label><label id="blend-label">Actual overlay <input id="blend" type="range" min="0" max="100" value="0" aria-label="Actual overlay opacity"></label></div><div class="scroll"><div class="stage" id="stage"><img id="image" alt=""><img id="actual-overlay" alt="Actual comparison overlay"><div id="regions"></div></div></div><p class="legend">Amber: target / content box · Pink: named content · Mint: text bounds. Rectangles are measurements, not inferred safe areas.</p><details><summary>Selected image metadata</summary><pre id="metadata"></pre></details></section><aside><article id="assertion-panel" hidden><strong>Assertion failed</strong><pre id="assertion"></pre></article><details id="policy-panel" hidden><summary>Pixel comparison policy</summary><pre id="policy"></pre></details><h2>Findings</h2><div id="findings"></div><details><summary>Full captured report</summary><pre id="report"></pre></details><details open><summary>Rendering environment</summary><pre id="environment"></pre></details><p>Runner platform may differ from a remote browser OS. Supplied labels are not independently verified; missing browser or font identity stays unrecorded.</p></aside></main>
<footer>Read-only · Embedded PNGs · No baseline approval or modification</footer>
<script id="data" type="application/json">${data}</script>
<script>
'use strict';
const data=JSON.parse(document.getElementById('data').textContent);
const byId=id=>document.getElementById(id);
const status=byId('status');status.dataset.ok=String(data.report.ok&&!data.report.assertion);status.textContent=data.report.assertion?'Assertion failed':data.report.ok?'Passed':'Findings detected';
if(data.report.assertion){byId('assertion-panel').hidden=false;byId('assertion').textContent=JSON.stringify(data.report.assertion,null,2);}
byId('report').textContent=JSON.stringify(data.report,null,2);
if(data.report.pixelPolicy){byId('policy-panel').hidden=false;byId('policy').textContent=JSON.stringify(data.report.pixelPolicy,null,2);}
const findings=byId('findings');
for(const finding of data.report.findings){const article=document.createElement('article');const title=document.createElement('strong');title.textContent=finding.severity+' · '+finding.code;const message=document.createElement('p');message.textContent=finding.message;article.append(title,message);if(finding.details){const pre=document.createElement('pre');pre.textContent=JSON.stringify(finding.details,null,2);article.append(pre);}findings.append(article);}
if(!data.report.findings.length){findings.textContent='No findings.';findings.className='empty';}
let selected=data.images[0];
const buttons=[];
function draw(){
 const image=byId('image');image.src=selected.url;image.alt=selected.name+' snapshot';
 const stage=byId('stage');stage.style.width=selected.width+'px';stage.style.height=selected.height+'px';
 const actual=byId('actual-overlay');actual.src=data.images[0].url;actual.style.opacity=String(Number(byId('blend').value)/100);
 const comparable=selected.name==='expected'||selected.name==='previous';actual.hidden=!comparable;byId('blend-label').hidden=!comparable;
 byId('environment').textContent=JSON.stringify(selected.snapshot?.rendering??{status:'Unrecorded'},null,2);
 byId('metadata').textContent=JSON.stringify({image:selected.name,width:selected.width,height:selected.height,...selected.snapshot},null,2);
 buttons.forEach(([button,item])=>button.setAttribute('aria-pressed',String(item===selected)));
 const regions=byId('regions');regions.replaceChildren();if(!byId('overlay').checked||!selected.snapshot)return;
 const {measurement,clip}=selected.snapshot;
 function box(rect,label,kind=''){const element=document.createElement('div');element.className='bounds '+kind;element.dataset.label=label;element.style.left=(rect.x-clip.x)+'px';element.style.top=(rect.y-clip.y)+'px';element.style.width=rect.width+'px';element.style.height=rect.height+'px';regions.append(element);}
 box(measurement.bounds,'target');if(measurement.contentBox)box(measurement.contentBox,'content box');
 for(const [name,content] of Object.entries(measurement.content||{})){box(content.bounds,name,'content');for(const rect of content.textBounds||[])box(rect,name+' text','text');}
}
for(const item of data.images){const button=document.createElement('button');button.type='button';button.textContent=item.name;button.addEventListener('click',()=>{selected=item;draw();});buttons.push([button,item]);byId('tabs').append(button);}
byId('overlay').addEventListener('change',draw);byId('blend').addEventListener('input',draw);draw();
</script></html>`;
}
