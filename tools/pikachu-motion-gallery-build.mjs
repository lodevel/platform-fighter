/** Assemble reviewed immutable move builds into one self-contained gallery. */
import { preview } from 'vite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pikachuProgressPlugin } from './pikachu-progress-data.mjs';

const root=path.resolve(import.meta.dirname,'..');
const evidence=path.join(root,'docs/review/2026-10-06/pikachu-character');
const outDir=mkdtempSync('/tmp/platform-fighter-pikachu-motion-gallery-');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[
  ['dash-attack-packed-preview-build.json','pikachu-dash-attack-packed-preview.html','dash-attack/packed-browser/acceptance.json'],
  ['jab-packed-preview-build.json','pikachu-jab-packed-preview.html','jab/packed-browser/acceptance.json'],
  ['back-air-packed-preview-build.json','pikachu-back-air-packed-preview.html','back-air/packed-browser/acceptance.json'],
  ['neutral-air-packed-preview-build.json','pikachu-neutral-air-packed-preview.html','neutral-air/packed-browser/acceptance.json'],
  ['down-air-packed-preview-build.json','pikachu-down-air-packed-preview.html','down-air/packed-browser/acceptance.json'],
  ['up-air-packed-preview-build.json','pikachu-up-air-packed-preview.html','up-air/packed-browser/acceptance.json'],
  ['vertical-tilt-packed-preview-build.json','pikachu-vertical-tilt-packed-preview.html','vertical-tilts/packed-browser/acceptance.json'],
  ['fair-posed-motion-build.json','pikachu-fair-posed-preview.html','fair-motion/posed-browser/acceptance.json'],
  ['motion-eight-pose-build.json','pikachu-motion-preview.html','motion-eight-pose/acceptance.json'],
];
const files={},sources=[];
for(const [recordName,entry,acceptanceName] of rows){
  const recordBytes=readFileSync(path.join(evidence,recordName));
  const build=JSON.parse(recordBytes);
  const acceptanceBytes=readFileSync(path.join(evidence,acceptanceName));
  const acceptance=JSON.parse(acceptanceBytes);
  if((acceptance.status??acceptance.result)!=='passed'||acceptance.build!==build.buildIdentity)
    throw new Error(`Missing/stale browser acceptance: ${recordName}`);
  for(const [relative,expected] of Object.entries(build.files)){
    const bytes=readFileSync(path.join(build.outDir,relative));
    if(hash(bytes)!==expected)throw new Error(`Changed immutable source: ${recordName}/${relative}`);
    const dest=relative===entry&&entry==='pikachu-motion-preview.html'?'pikachu-forward-tilt-preview.html':relative;
    if(files[dest]&&files[dest]!==expected)throw new Error(`Conflicting gallery file: ${dest}`);
    mkdirSync(path.dirname(path.join(outDir,dest)),{recursive:true});
    writeFileSync(path.join(outDir,dest),bytes);files[dest]=expected;
  }
  sources.push({recordName,recordSha256:hash(recordBytes),acceptanceName,acceptanceSha256:hash(acceptanceBytes),buildIdentity:build.buildIdentity,entry:entry==='pikachu-motion-preview.html'?'pikachu-forward-tilt-preview.html':entry});
}
const entry='pikachu-motion-preview.html',bytes=readFileSync(path.join(root,entry));
writeFileSync(path.join(outDir,entry),bytes);files[entry]=hash(bytes);
const progressEntry='pikachu-progress.js',progressBytes=readFileSync(path.join(root,progressEntry));
writeFileSync(path.join(outDir,progressEntry),progressBytes);files[progressEntry]=hash(progressBytes);
const recordPath=path.join(evidence,'motion-gallery-build.json');
if(existsSync(recordPath)){
  const previous=readFileSync(recordPath),history=path.join(evidence,'motion-gallery-build-history');
  mkdirSync(history,{recursive:true});
  writeFileSync(path.join(history,`${hash(previous)}.json`),previous);
}
writeFileSync(recordPath,JSON.stringify({scope:'Live character completion dashboard above nine reviewed isolated move snapshots; progress reads current canonical evidence every5seconds; compiled move bundles unchanged; full fighter incomplete',outDir,sources,files,liveProgress:{endpoint:'/pikachu-progress.json',pollMilliseconds:5000,source:'inventory.json per-row explicit progress flags; no status-text inference',artSource:'assets/characters/pikachu/frames.json',buildSource:'integration/implementation-status.json'}},null,2)+'\n');
console.log(`Motion gallery assembled at ${outDir}; previous builds preserved.`);
if(process.argv.includes('--serve')){
  const server=await preview({configFile:false,root,base:'/',publicDir:false,plugins:[pikachuProgressPlugin(root)],build:{outDir},preview:{host:'127.0.0.1',port:4195,strictPort:true}});
  server.printUrls();
}
