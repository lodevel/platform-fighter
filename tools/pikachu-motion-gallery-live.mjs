/** Rebuild the live gallery when temporary reviewed bundles are unavailable.
 * Current workspace previews retain their own scope; this never upgrades
 * canonical action acceptance or overwrites historical review identities. */
import {build,preview} from 'vite';
import {tsImport} from 'tsx/esm/api';
import path from 'node:path';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readPikachuProgress} from './pikachu-progress-data.mjs';
const root=path.resolve(import.meta.dirname,'..');
const outDir=path.resolve(root,process.env.PF_GALLERY_OUT_DIR??'.tmp/pikachu-live-gallery');
const appUrl=process.env.PF_APP_URL??'http://localhost:4238/platform-fighter/';
const appRecord=path.resolve(root,process.env.PF_APP_BUILD_RECORD??'.tmp/pikachu-launch-production-assets-staged.json');
const entries=['pikachu-motion-preview.html','pikachu-grab-preview.html','pikachu-special-preview.html','pikachu-smash-packed-preview.html','pikachu-jab-packed-preview.html','pikachu-back-air-packed-preview.html','pikachu-neutral-air-packed-preview.html','pikachu-down-air-packed-preview.html','pikachu-dash-attack-packed-preview.html','pikachu-up-air-packed-preview.html','pikachu-vertical-tilt-packed-preview.html','pikachu-fair-posed-preview.html','pikachu-forward-tilt-preview.html'];
const {readBuildIdentity}=await tsImport(path.join(root,'scripts/buildIdentity.ts'),import.meta.url);
const identity=readBuildIdentity(root);
await build({logLevel:'warn',configFile:false,root,base:'/',publicDir:false,plugins:[{name:'preview-identity',enforce:'pre',transform(_code,id){if(id.replaceAll('\\','/').endsWith('/src/engine/buildIdentity.ts'))return {code:`export const SIMULATION_BUILD_ID=${JSON.stringify(identity)};`,map:null};}}],build:{outDir,emptyOutDir:true,target:'es2022',rollupOptions:{maxParallelFileOps:16,input:entries.map(e=>path.join(root,e)),output:{manualChunks:{phaser:['phaser']}}}}});
await mkdir(outDir,{recursive:true});
// The specials viewer controls this exact application bundle in a same-origin
// frame. Copy it byte-for-byte, including its manifest assets and deploy base.
const gameBuild=JSON.parse(await readFile(appRecord,'utf8'));
const gameBytes=await readFile(path.join(gameBuild.outDir,'assets',gameBuild.bundle));
if(createHash('sha256').update(gameBytes).digest('hex')!==gameBuild.bundleSha256)
  throw new Error('The application preview bundle has changed; rebuild the app first.');
await cp(gameBuild.outDir,path.join(outDir,'platform-fighter'),{recursive:true});
await writeFile(path.join(outDir,'launch-scope.json'),JSON.stringify({scope:'Current workspace move previews and exact application specials bundle; this launch does not upgrade action acceptance.',identity,entries,gameBuild},null,2));
if(process.env.PF_GALLERY_BUILD_ONLY==='1'){console.log(JSON.stringify({result:'BUILT_ONLY',outDir,gameBuild}));process.exit(0);}
const server=await preview({configFile:false,root,base:'/',publicDir:false,build:{outDir},preview:{host:'0.0.0.0',port:4195,strictPort:true},plugins:[{name:'live-progress',configurePreviewServer(server){server.middlewares.use(async(req,res,next)=>{
 if(req.url?.split('?')[0]!=='/pikachu-progress.json')return next();
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 try {const progress=readPikachuProgress(root);const current=JSON.parse(await readFile(appRecord,'utf8'));progress.build={name:current.bundle,url:appUrl,sheets:current.pikachuStrips,cells:current.pikachuCells};res.end(JSON.stringify(progress));}
 catch{res.statusCode=503;res.end(JSON.stringify({error:'Progress is being updated.'}));}
});}}]});
server.printUrls();
