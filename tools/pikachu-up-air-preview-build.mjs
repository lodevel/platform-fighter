/** Isolated immutable-snapshot builder; refuses unreviewed or changed art. */
import { build, preview } from 'vite';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed = process.argv.includes('--packed');
const timeline = packed || process.argv.includes('--timeline');
const entry = packed ? 'pikachu-up-air-packed-preview.html' : timeline ? 'pikachu-up-air-timeline-preview.html' : 'pikachu-up-air-preview.html';
const recordFile = packed ? 'up-air-packed-preview-build.json' : timeline ? 'up-air-timeline-preview-build.json' : 'up-air-preview-build.json';
const { PIKACHU_UP_AIR_PREVIEW_FILES, PIKACHU_UP_AIR_PREVIEW_SCHEDULE } = await tsImport(
  path.join(root, 'src/previews/pikachuUpAirPreviewPoses.ts'), import.meta.url);
const approval = JSON.parse(readFileSync(path.join(evidence, 'up-air/art-approval.json'), 'utf8'));
if (approval.status !== 'accepted_for_candidate_build') throw new Error('Up-air art review remains incomplete');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let hurtboxApproval;
{
  const candidateBytes = readFileSync(path.join(evidence,'up-air/hurtbox-preparation/candidates.json'));
  const candidates = JSON.parse(candidateBytes);
  hurtboxApproval = JSON.parse(readFileSync(path.join(evidence,'up-air/hurtbox-preparation/visual-review.json')));
  const { PIKACHU_UP_AIR_AUTHORED_HURTBOX_POSES } = await tsImport(path.join(root,'src/characters/pikachuUpAirHurtboxes.ts'),import.meta.url);
  if (hurtboxApproval.state !== 'accepted_for_isolated_authored_geometry_preview'
    || hurtboxApproval.candidateSha256 !== sha(candidateBytes)
    || JSON.stringify(candidates.rows) !== JSON.stringify(PIKACHU_UP_AIR_AUTHORED_HURTBOX_POSES))
    throw new Error('Missing/stale posed geometry review or mismatched runtime data');
}
const contactBytes = readFileSync(path.join(evidence,'sources/posed-resources/up-air-contact-candidates.json'));
const contactApproval = JSON.parse(readFileSync(path.join(evidence,'sources/posed-resources/up-air-contact-review.json')));
if (contactApproval.state !== 'accepted_for_authored_2d_projector' || contactApproval.candidateSha256 !== sha(contactBytes)) throw new Error('Stale/missing contact review');
const { buildPikachuUpAirWithAuthoredHurtboxes } = await tsImport(path.join(root,'src/characters/pikachuUpAirHurtboxes.ts'),import.meta.url);
const reviewedMove = buildPikachuUpAirWithAuthoredHurtboxes();
for (const frame of JSON.parse(contactBytes).frames) {
  const hits = reviewedMove.hitWindows.find(window => window.startFrame === frame.gameFrame-1).collisionHits;
  for (const region of frame.regions) {
    const hit = hits.find(h => h.id === region.id);
    if (!hit || JSON.stringify(hit.capsule) !== JSON.stringify({start:region.start,end:region.end,radius:region.radius})
      || hit.damage !== region.damage || hit.knockback.reference.angle !== region.angle
      || hit.knockback.reference.base !== region.base || hit.knockback.reference.growth !== region.growth) throw new Error('Contact runtime differs from reviewed source projection');
  }
}
if (timeline && JSON.stringify(reviewedMove.animation.frameWindows) !== JSON.stringify(PIKACHU_UP_AIR_PREVIEW_SCHEDULE.map((row,artFrameIndex)=>({startFrame:row.startElapsed,endFrame:row.endElapsed,artFrameIndex})))) throw new Error('Runtime drawing timeline differs from reviewed holds');
let packedApproval;
if (packed) {
  const packRoot=path.join(root,'assets/characters/pikachu');
  const metadataBytes=readFileSync(path.join(packRoot,'registered-poses.json'));
  packedApproval=JSON.parse(readFileSync(path.join(evidence,'up-air/packed-preparation/visual-review.json')));
  if(packedApproval.state!=='accepted_for_packed_candidate_build'||packedApproval.metadataSha256!==sha(metadataBytes))throw new Error('Stale/unreviewed packed sprites');
  for(const name of ['idle','uair'])if(sha(readFileSync(path.join(packRoot,`animations/${name}.png`)))!==packedApproval.strips[name])throw new Error('Changed packed strip');
  const metadata=JSON.parse(metadataBytes);
  if(JSON.stringify(metadata.animations.uair.frameWindows)!==JSON.stringify(reviewedMove.animation.frameWindows))throw new Error('Packed strip clock disagrees with runtime');
}
const renderMetrics = {};
const art = {};
for (const [pose,file] of Object.entries(PIKACHU_UP_AIR_PREVIEW_FILES)) {
  const bytes = readFileSync(path.join(evidence, 'art', file));
  const hash = sha(bytes), row = approval.files[file];
  if (!row || row.status !== 'accepted_for_rough_preview' || row.sha256 !== hash
    || !row.artReview || !row.rootReview) throw new Error(`Missing/stale up-air drawing review: ${file}`);
  const png = PNG.sync.read(bytes);
  const size = pose === 'neutral' ? [1024,1024] : [2048,1536];
  if (png.width !== size[0] || png.height !== size[1]) throw new Error(`Wrong registered up-air canvas: ${file}`);
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
const outDir=mkdtempSync('/tmp/platform-fighter-pikachu-up-air-20261007-');
const { readBuildIdentity } = await tsImport(path.join(root,'scripts/buildIdentity.ts'),import.meta.url);
const buildIdentity=readBuildIdentity(root);
await build({configFile:false,root,base:'/',publicDir:false,
  plugins:[{name:'pikachu-up-air-preview-identity',enforce:'pre',transform(_code,id) {
    if (id.replace(/\\/g,'/').endsWith('/src/engine/buildIdentity.ts'))
      return {code:`export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`,map:null};
  }}],build:{outDir,emptyOutDir:true,target:'es2022',sourcemap:true,
    rollupOptions:{input:path.join(root,entry)}}});
const files={};
for (const relative of [entry,...readdirSync(path.join(outDir,'assets')).map(file=>`assets/${file}`)])
  files[relative]=sha(readFileSync(path.join(outDir,relative)));
writeFileSync(path.join(evidence,recordFile),JSON.stringify({scope:'isolated rough11pose upair; source early/late tail regions; authored posed receiving capsules and ordinary shared hitstop; zero-gravity aerial fixture; no full-fighter/native movement/collision qualification',
  packedArt:packed,packedApproval,servedPngCount:Object.keys(files).filter(file=>file.endsWith('.png')).length,explicitTimeline:timeline,buildIdentity,outDir,art,poseSchedule:PIKACHU_UP_AIR_PREVIEW_SCHEDULE,approval,hurtboxApproval,contactApproval,renderMetrics,files},null,2)+'\n');
console.log(`Up-air candidate built at ${outDir}; existing snapshots preserved.`);
if (process.argv.includes('--serve')) {
  const server=await preview({configFile:false,root,base:'/',publicDir:false,build:{outDir},
    preview:{host:'127.0.0.1',port:packed?4192:timeline?4191:4189,strictPort:true}});
  server.printUrls();
}
