/** Isolated immutable-snapshot builder; refuses unreviewed or changed art. */
import { build, preview } from 'vite';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed=process.argv.includes('--packed');
const entry=packed?'pikachu-jab-packed-preview.html':'pikachu-jab-preview.html';
const portArgument=process.argv.find(arg=>arg.startsWith('--port='));
const previewPort=portArgument?Number(portArgument.slice(7)):(packed?4199:4198);
if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535)throw new Error('Invalid preview port');
const recordFile=packed?'jab-packed-preview-build.json':'jab-preview-build.json';
const { PIKACHU_JAB_PREVIEW_SCHEDULE } = await tsImport(path.join(root, 'src/previews/pikachuJabPreviewPoses.ts'), import.meta.url);
const schedule={jab:PIKACHU_JAB_PREVIEW_SCHEDULE};
const previewFiles = { neutral: 'reference-registered.png' };
for (const [action, rows] of Object.entries(schedule)) for (const row of rows) previewFiles[`${action}.${row.pose}`] = row.file;
const approval = JSON.parse(readFileSync(path.join(evidence, 'jab/art-approval.json'), 'utf8'));
if (approval.status !== 'accepted_for_candidate_build') throw new Error('Jab art review remains incomplete');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let packedApproval;
if(packed){
  const packRoot=path.join(root,'assets/characters/pikachu');
  packedApproval=JSON.parse(readFileSync(path.join(evidence,'jab/packed-preparation/visual-review.json')));
  if(packedApproval.state!=='accepted_for_packed_candidate_build'||packedApproval.metadataSha256!==sha(readFileSync(path.join(packRoot,'pose-batches/jab.json'))))throw new Error('Stale/unreviewed jab packed output');
  for(const name of ['idle','jab'])if(sha(readFileSync(path.join(packRoot,`animations/${name}.png`)))!==packedApproval.strips[name])throw new Error('Changed packed strip');
}
let hurtboxApproval;
{
  const candidateBytes = readFileSync(path.join(evidence,'jab/hurtbox-preparation/candidates.json'));
  const candidates = JSON.parse(candidateBytes);
  hurtboxApproval = JSON.parse(readFileSync(path.join(evidence,'jab/hurtbox-preparation/guide-review.json')));
  const { PIKACHU_JAB_AUTHORED_HURTBOX_POSES } = await tsImport(path.join(root,'src/characters/pikachuJabHurtboxes.ts'),import.meta.url);
  if (hurtboxApproval.state !== 'accepted_for_authored_geometry_candidate_only'
    || hurtboxApproval.candidateSha256 !== sha(candidateBytes)
    || JSON.stringify(candidates.rows) !== JSON.stringify(PIKACHU_JAB_AUTHORED_HURTBOX_POSES))
    throw new Error('Missing/stale posed geometry review or mismatched runtime data');
}
const renderMetrics = {};
const art = {};
for (const [pose,file] of Object.entries(previewFiles)) {
  const bytes = readFileSync(path.join(evidence, 'art', file));
  const hash = sha(bytes), row = approval.files[file];
  if (!row || row.status !== 'accepted_for_rough_preview' || row.sha256 !== hash
    || !row.artReview || !row.rootReview) throw new Error(`Missing/stale jab drawing review: ${file}`);
  const png = PNG.sync.read(bytes);
  const size = pose === 'neutral' ? [1024,1024] : [2048,1536];
  if (png.width !== size[0] || png.height !== size[1]) throw new Error(`Wrong registered jab canvas: ${file}`);
  let transparent=0, opaque=0, minX=png.width, minY=png.height, maxX=-1, maxY=-1;
  for (let y=0;y<png.height;y++) for (let x=0;x<png.width;x++) {
    const alpha=png.data[(y*png.width+x)*4+3];
    if (alpha===0) transparent++; if (alpha===255) opaque++;
    if (alpha>0) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  }
  if (!transparent || !opaque) throw new Error(`Missing alpha/foreground: ${file}`);
  renderMetrics[file]={width:png.width,height:png.height,nonzeroAlphaBounds:{minX,minY,maxX,maxY},
    transparentFraction:transparent/(png.width*png.height),root:pose==='neutral'?[512,880]:[1024,1152],worldScale:70/600};
  art[file]=hash;
}
const outDir=mkdtempSync('/tmp/platform-fighter-pikachu-jab-20261007-');
const { readBuildIdentity } = await tsImport(path.join(root,'scripts/buildIdentity.ts'),import.meta.url);
const buildIdentity=readBuildIdentity(root);
await build({configFile:false,root,base:'/',publicDir:false,
  plugins:[{name:'pikachu-jab-preview-identity',enforce:'pre',transform(_code,id) {
    if (id.replace(/\\/g,'/').endsWith('/src/engine/buildIdentity.ts'))
      return {code:`export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`,map:null};
  }}],build:{outDir,emptyOutDir:true,target:'es2022',sourcemap:true,
    rollupOptions:{input:path.join(root,entry)}}});
const files={};
for (const relative of [entry,...readdirSync(path.join(outDir,'assets')).map(file=>`assets/${file}`)])
  files[relative]=sha(readFileSync(path.join(outDir,relative)));
writeFileSync(path.join(evidence,recordFile),JSON.stringify({scope:'isolated rough9pose jab; three source head regions and108authored receiving capsules; grounded shared40x50body fixture and real saved Wolf factory; no full-fighter/held-repeat/native collision qualification',
  previewPort,packedArt:packed,packedApproval,servedPngCount:Object.keys(files).filter(file=>file.endsWith('.png')).length,buildIdentity,outDir,art,poseSchedule:schedule,approval,hurtboxApproval,renderMetrics,files},null,2)+'\n');
console.log(`Jab candidate built at ${outDir}; existing snapshots preserved.`);
if (process.argv.includes('--serve')) {
  const server=await preview({configFile:false,root,base:'/',publicDir:false,build:{outDir},
    preview:{host:'127.0.0.1',port:previewPort,strictPort:true}});
  server.printUrls();
}
