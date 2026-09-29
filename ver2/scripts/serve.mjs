import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { root } from './content.mjs';
import { build } from './build.mjs';

build();
const port = Number(process.env.PORT || 4321);
const dist = path.join(root,'dist');
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.pdf':'application/pdf','.xml':'application/xml','.txt':'text/plain','.bib':'application/x-bibtex; charset=utf-8'};
const server = createServer((req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'}).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  let file = path.resolve(dist,'.'+pathname);
  if (file !== dist && !file.startsWith(dist+path.sep)) {res.writeHead(403).end();return;}
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith('/')) {res.writeHead(301,{Location:pathname+'/'}).end();return;}
    file=path.join(file,'index.html');
  }
  const found=existsSync(file) && statSync(file).isFile();
  if (!found) file=path.join(dist,'404.html');
  res.writeHead(found?200:404,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:readFileSync(file));
});
server.listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
let debounce;
const watcher=watch(path.join(root,'src'),{recursive:true},()=>{
  clearTimeout(debounce);
  debounce=setTimeout(()=>{try{console.log('Rebuilt',build());}catch(error){console.error('Build failed:',error.message);}},150);
});
function close(){watcher.close();server.close(()=>process.exit(0));}
process.on('SIGINT',close);process.on('SIGTERM',close);
