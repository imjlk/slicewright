import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode,...args]=process.argv.slice(2);
if(!['test','approve'].includes(mode))throw new Error('Usage: node run.mjs test|approve [Playwright options]');
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('@playwright/test/package.json')),'cli.js');
const result=spawnSync(process.execPath,[cli,'test',...args],{
  cwd:dirname(fileURLToPath(import.meta.url)),stdio:'inherit',
  env:{...process.env,SLICEWRIGHT_EXAMPLE_APPROVE:mode==='approve'?'1':'0'},
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
