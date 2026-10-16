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
const entry=packed?'pikachu-back-air-packed-preview.html':'pikachu-back-air-preview.html';
const recordFile=packed?'back-air-packed-preview-build.json':'back-air-preview-build.json';
const previewPort=packed?4201:4196;
const { PIKACHU_BACK_AIR_PREVIEW_FILES, PIKACHU_BACK_AIR_PREVIEW_SCHEDULE, PIKACHU_BACK_AIR_LANDING_PREVIEW_SCHEDULE } = await tsImport(
  path.join(root, 'src/previews/pikachuBackAirPreviewPoses.ts'), import.meta.url);
const approval = JSON.parse(readFileSync(path.join(evidence, 'back-air/art-approval.json'), 'utf8'));
if (approval.status !== 'accepted_for_candidate_build') throw new Error('Back-air art review remains incomplete');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let packedApproval;
if (packed) {
  const packRoot=path.join(root,'assets/characters/pikachu');
  packedApproval=JSON.parse(readFileSync(path.join(evidence,'back-air/packed-preparation/visual-review.json')));
  const metadataBytes=readFileSync(path.join(packRoot,'pose-batches/back-air.json'));
  if (packedApproval.state!=='accepted_for_packed_candidate_build' || packedApproval.metadataSha256!==sha(metadataBytes))
    throw new Error('Stale/unreviewed back-air packed output');
  for (const name of ['idle','bair','bair_landing'])
    if (sha(readFileSync(path.join(packRoot,`animations/${name}.png`)))!==packedApproval.strips[name])
      throw new Error(`Changed packed strip: ${name}`);
  const metadata=JSON.parse(metadataBytes);
  for (const [name,schedule] of [['bair',PIKACHU_BACK_AIR_PREVIEW_SCHEDULE],['bair_landing',PIKACHU_BACK_AIR_LANDING_PREVIEW_SCHEDULE]]) {
    const expected=schedule.map((row,artFrameIndex)=>({startFrame:row.startElapsed,endFrame:row.endElapsed,artFrameIndex}));
    if (metadata.animations[name].frameCount!==schedule.length || JSON.stringify(metadata.animations[name].frameWindows)!==JSON.stringify(expected))
      throw new Error(`Packed drawing windows disagree with reviewed schedule: ${name}`);
  }
}
let hurtboxApproval;
{
  const candidateBytes = readFileSync(path.join(evidence,'back-air/hurtbox-preparation/candidates.json'));
  const candidates = JSON.parse(candidateBytes);
  hurtboxApproval = JSON.parse(readFileSync(path.join(evidence,'back-air/hurtbox-preparation/guide-review.json')));
  const { PIKACHU_BACK_AIR_AUTHORED_HURTBOX_POSES } = await tsImport(path.join(root,'src/characters/pikachuBackAirHurtboxes.ts'),import.meta.url);
  if (hurtboxApproval.state !== 'accepted_for_authored_geometry_candidate_only'
    || hurtboxApproval.candidateSha256 !== sha(candidateBytes)
    || JSON.stringify(candidates.rows) !== JSON.stringify(PIKACHU_BACK_AIR_AUTHORED_HURTBOX_POSES))
    throw new Error('Missing/stale posed geometry review or mismatched runtime data');
}
const contactBytes = readFileSync(path.join(evidence,'sources/posed-resources/back-air-contact-candidates.json'));
const contactApproval = JSON.parse(readFileSync(path.join(evidence,'sources/posed-resources/back-air-contact-review.json')));
if (contactApproval.state !== 'accepted_for_authored_2d_projector' || contactApproval.candidateSha256 !== sha(contactBytes)) throw new Error('Stale/missing contact review');
const { buildPikachuBackAirWithAuthoredHurtboxes } = await tsImport(path.join(root,'src/characters/pikachuBackAirHurtboxes.ts'),import.meta.url);
const reviewedMove = buildPikachuBackAirWithAuthoredHurtboxes();
if(reviewedMove.geometryFacing!=='fighter')throw new Error('Projected back-air basis must follow fighter facing');
for (const frame of JSON.parse(contactBytes).frames) {
  const hits = reviewedMove.hitWindows.find(window => window.startFrame === frame.gameFrame-1).collisionHits;
  for (const region of frame.regions) {
    const hit = hits.find(h => h.id === region.id);
    if (!hit || JSON.stringify(hit.capsule) !== JSON.stringify({start:region.start,end:region.end,radius:region.radius})
      || hit.damage !== region.damage || hit.knockback.reference.angle !== region.angle
      || hit.knockback.reference.base !== region.base || hit.knockback.reference.growth !== region.growth
      || (hit.knockback.reference.fixed??0)!==region.fixed || (hit.knockback.reference.setWeight??false)!==region.setWeight) throw new Error('Contact runtime differs from reviewed source projection');
  }
}
for(const [schedule,action] of [[PIKACHU_BACK_AIR_PREVIEW_SCHEDULE,reviewedMove],[PIKACHU_BACK_AIR_LANDING_PREVIEW_SCHEDULE,reviewedMove.landingAttack]]) {
  if(JSON.stringify(action.animation.frameWindows)!==JSON.stringify(schedule.map((row,artFrameIndex)=>({startFrame:row.startElapsed,endFrame:row.endElapsed,artFrameIndex}))))throw new Error('Drawing window transport differs from reviewed holds');
}
const renderMetrics = {};
const art = {};
for (const [pose,file] of Object.entries(PIKACHU_BACK_AIR_PREVIEW_FILES)) {
  const bytes = readFileSync(path.join(evidence, 'art', file));
  const hash = sha(bytes), row = approval.files[file];
  if (!row || row.status !== 'accepted_for_rough_preview' || row.sha256 !== hash
    || !row.artReview || !row.rootReview) throw new Error(`Missing/stale back-air drawing review: ${file}`);
  const png = PNG.sync.read(bytes);
  const size = pose === 'neutral' ? [1024,1024] : [2048,1536];
  if (png.width !== size[0] || png.height !== size[1]) throw new Error(`Wrong registered back-air canvas: ${file}`);
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
const outDir=mkdtempSync('/tmp/platform-fighter-pikachu-back-air-20261007-');
const { readBuildIdentity } = await tsImport(path.join(root,'scripts/buildIdentity.ts'),import.meta.url);
const buildIdentity=readBuildIdentity(root);
await build({configFile:false,root,base:'/',publicDir:false,
  plugins:[{name:'pikachu-back-air-preview-identity',enforce:'pre',transform(_code,id) {
    if (id.replace(/\\/g,'/').endsWith('/src/engine/buildIdentity.ts'))
      return {code:`export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`,map:null};
  }}],build:{outDir,emptyOutDir:true,target:'es2022',sourcemap:true,
    rollupOptions:{input:path.join(root,entry)}}});
const files={};
for (const relative of [entry,...readdirSync(path.join(outDir,'assets')).map(file=>`assets/${file}`)])
  files[relative]=sha(readFileSync(path.join(outDir,relative)));
writeFileSync(path.join(evidence,recordFile),JSON.stringify({scope:'isolated rough24pose backair/7pose landing; source five linker pairs/rear finisher + source landing circle; authored posed receiving capsules and ordinary shared hitstop; zero-gravity frame fixture and optional shared-gravity real floor descent; no full-fighter/native movement/collision qualification',
  previewPort,packedArt:packed,packedApproval,presentationAliases:packed?{airborne:'link.bair.anim',landing:'link.tilt.anim',neutral:'link.idle.anim',physicsAndSavedFactory:'donkeykong'}:null,
  servedPngCount:Object.keys(files).filter(file=>file.endsWith('.png')).length,buildIdentity,outDir,art,poseSchedule:PIKACHU_BACK_AIR_PREVIEW_SCHEDULE,landingPoseSchedule:PIKACHU_BACK_AIR_LANDING_PREVIEW_SCHEDULE,approval,hurtboxApproval,contactApproval,renderMetrics,files},null,2)+'\n');
console.log(`Back-air candidate built at ${outDir}; existing snapshots preserved.`);
if (process.argv.includes('--serve')) {
  const server=await preview({configFile:false,root,base:'/',publicDir:false,build:{outDir},
    preview:{host:'127.0.0.1',port:previewPort,strictPort:true}});
  server.printUrls();
}
