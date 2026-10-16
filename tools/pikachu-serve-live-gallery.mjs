import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readPikachuProgress} from './pikachu-progress-data.mjs';
const root=path.resolve(import.meta.dirname,'..');
const outDir=path.resolve(root,process.env.PF_GALLERY_DIR??'.tmp/pikachu-live-gallery');
const scope=JSON.parse(await readFile(path.join(outDir,'launch-scope.json'),'utf8'));
const appUrl=process.env.PF_APP_URL??'http://localhost:4195/platform-fighter/';
const bundle=await readFile(path.join(outDir,'platform-fighter/assets',scope.gameBuild.bundle));
if(createHash('sha256').update(bundle).digest('hex')!==scope.gameBuild.bundleSha256)throw Error('Copied application bundle changed');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.wasm':'application/wasm','.map':'application/json'};
// Serve compiled bytes directly. Vite's per-request case checks recursively
// scan asset directories, which can exhaust WSL memory beside art generation.
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/pikachu-progress.json'){
   const progress=readPikachuProgress(root);
   progress.build={name:scope.gameBuild.bundle,url:appUrl,sheets:scope.gameBuild.pikachuStrips,cells:scope.gameBuild.pikachuCells};
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(progress));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let file=path.resolve(outDir,'.'+(pathname==='/'?'/pikachu-motion-preview.html':pathname));
  if(!file.startsWith(outDir+path.sep)){res.writeHead(403);res.end();return;}
  let info=await stat(file);
  if(info.isDirectory()){file=path.join(file,'index.html');info=await stat(file);}
  if(!info.isFile()){res.writeHead(404);res.end();return;}
  const headers={'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache','Content-Length':info.size};
  res.writeHead(200,headers);
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file);
  stream.on('error',error=>{console.error('Preview read failed:',error.code);res.destroy();});
  stream.pipe(res);
 }catch(error){if(!res.headersSent)res.writeHead(error.code==='ENOENT'?404:503);res.end();}
});
server.listen(4195,'0.0.0.0',()=>console.log('Preview: http://localhost:4195/pikachu-motion-preview.html'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
