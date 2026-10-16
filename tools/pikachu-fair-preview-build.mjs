/** Isolated immutable-snapshot builder; refuses unreviewed or changed art. */
import { build, preview } from 'vite';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const posed = process.argv.includes('--posed');
const entry = posed ? 'pikachu-fair-posed-preview.html' : 'pikachu-fair-preview.html';
const recordFile = posed ? 'fair-posed-motion-build.json' : 'fair-motion-build.json';
const { PIKACHU_FAIR_PREVIEW_FILES, PIKACHU_FAIR_PREVIEW_SCHEDULE } = await tsImport(
  path.join(root, 'src/previews/pikachuForwardAirPreviewPoses.ts'), import.meta.url);
const approval = JSON.parse(readFileSync(path.join(evidence, 'fair-motion/art-approval.json'), 'utf8'));
if (approval.status !== 'accepted_for_candidate_build') throw new Error('Fair art review remains incomplete');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let hurtboxApproval;
if (posed) {
  const candidateBytes = readFileSync(path.join(evidence,'fair-motion/hurtbox-preparation/candidates.json'));
  const candidates = JSON.parse(candidateBytes);
  hurtboxApproval = JSON.parse(readFileSync(path.join(evidence,'fair-motion/hurtbox-preparation/visual-review.json')));
  const { PIKACHU_FAIR_AUTHORED_HURTBOX_POSES } = await tsImport(path.join(root,'src/characters/pikachuFairHurtboxes.ts'),import.meta.url);
  if (hurtboxApproval.state !== 'accepted_for_isolated_authored_geometry_preview'
    || hurtboxApproval.candidateSha256 !== sha(candidateBytes)
    || JSON.stringify(candidates.rows) !== JSON.stringify(PIKACHU_FAIR_AUTHORED_HURTBOX_POSES))
    throw new Error('Missing/stale posed geometry review or mismatched runtime data');
}
const renderMetrics = {};
const art = {};
for (const [pose,file] of Object.entries(PIKACHU_FAIR_PREVIEW_FILES)) {
  const bytes = readFileSync(path.join(evidence, 'art', file));
  const hash = sha(bytes), row = approval.files[file];
  if (!row || row.status !== 'accepted_for_rough_preview' || row.sha256 !== hash
    || !row.artReview || !row.rootReview) throw new Error(`Missing/stale fair drawing review: ${file}`);
  const png = PNG.sync.read(bytes);
  const size = pose === 'neutral' ? [1024,1024] : [1536,1280];
  if (png.width !== size[0] || png.height !== size[1]) throw new Error(`Wrong registered fair canvas: ${file}`);
  let transparent=0, opaque=0, minX=png.width, minY=png.height, maxX=-1, maxY=-1;
  for (let y=0;y<png.height;y++) for (let x=0;x<png.width;x++) {
    const alpha=png.data[(y*png.width+x)*4+3];
    if (alpha===0) transparent++; if (alpha===255) opaque++;
    if (alpha>0) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  }
  if (!transparent || !opaque) throw new Error(`Missing alpha/foreground: ${file}`);
  renderMetrics[file]={width:png.width,height:png.height,nonzeroAlphaBounds:{minX,minY,maxX,maxY},
    transparentFraction:transparent/(png.width*png.height),root:pose==='neutral'?[512,880]:[768,880],worldScale:70/600};
  art[file]=hash;
}
const outDir=mkdtempSync('/tmp/platform-fighter-pikachu-fair-motion-20261007-');
const { readBuildIdentity } = await tsImport(path.join(root,'scripts/buildIdentity.ts'),import.meta.url);
const buildIdentity=readBuildIdentity(root);
await build({configFile:false,root,base:'/',publicDir:false,
  plugins:[{name:'pikachu-fair-preview-identity',enforce:'pre',transform(_code,id) {
    if (id.replace(/\\/g,'/').endsWith('/src/engine/buildIdentity.ts'))
      return {code:`export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`,map:null};
  }}],build:{outDir,emptyOutDir:true,target:'es2022',sourcemap:true,
    rollupOptions:{input:path.join(root,entry)}}});
const files={};
for (const relative of [entry,...readdirSync(path.join(outDir,'assets')).map(file=>`assets/${file}`)])
  files[relative]=sha(readFileSync(path.join(outDir,relative)));
writeFileSync(path.join(evidence,recordFile),JSON.stringify({scope:`isolated rough sixteen-pose fair; authored hit-stop/rehit clock, one-pixel probes, shared fixture body${posed?'; reviewed authored posed damage capsules':''}; no full-fighter/native collision qualification`,
  buildIdentity,outDir,art,poseSchedule:PIKACHU_FAIR_PREVIEW_SCHEDULE,approval,hurtboxApproval,renderMetrics,files},null,2)+'\n');
console.log(`Fair candidate built at ${outDir}; existing snapshots preserved.`);
if (process.argv.includes('--serve')) {
  const server=await preview({configFile:false,root,base:'/',publicDir:false,build:{outDir},
    preview:{host:'127.0.0.1',port:posed?4187:4186,strictPort:true}});
  server.printUrls();
}
