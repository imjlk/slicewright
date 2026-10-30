import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port=Number(process.env.SLICEWRIGHT_EXAMPLE_PORT??4179);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Set SLICEWRIGHT_EXAMPLE_PORT to a valid port.');
const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname;
  const file=path==='/'?'index.html':path.slice(1);
  if(!['index.html','panel.mjs'].includes(file)){response.writeHead(404).end();return;}
  readFile(new URL(file,import.meta.url)).then(bytes=>{
    response.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'}).end(bytes);
  },()=>response.writeHead(500).end());
});
server.listen(port,'127.0.0.1',()=>console.log(`Review the panel at http://127.0.0.1:${port}/?renderer=dom&locale=ko&scale=2`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
