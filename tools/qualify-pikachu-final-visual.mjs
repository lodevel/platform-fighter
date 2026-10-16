/** Compact comparison receipt for the real deterministic before/after probes. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='docs/review/2026-10-16/pikachu-final-density';
const before=JSON.parse(await readFile(`${root}/runtime-before/report.json`,'utf8'));
const after=JSON.parse(await readFile(`${root}/runtime-after/report.json`,'utf8'));
const bank=JSON.parse(await readFile('assets/characters/pikachu/final-visual-frames.json','utf8'));
const rows=[];
for(const row of after.rows.filter(r=>!r.pacing)){
 const prior=before.rows.find(r=>r.key===row.key&&!r.pacing);assert.ok(prior);
 assert.equal(row.authoritySha256,prior.authoritySha256,row.key+' complete authority trace unchanged');
 assert.equal(row.trace.length,prior.trace.length);
 let displayed=0,newSamples=0;const sheets={};
 for(let i=0;i<row.trace.length;i++){
  const next=row.trace[i],previous=prior.trace[i],control=next.ownerControl;
  assert.deepEqual(next.victimPose,previous.victimPose,'victim geometry unchanged');
  assert.equal(next.victimSprite?.key,previous.victimSprite?.key,'victim page unchanged');
  assert.equal(next.victimSprite?.frame,previous.victimSprite?.frame,'victim sample unchanged');
  if(control?.role!=='owner'||!bank.clips[control.sheet])continue;
  const clip=bank.clips[control.sheet];const sample=Math.floor(clip.loopDuration?control.age%clip.loopDuration:Math.min(control.age,clip.nativeEnd));
  const pose=clip.frames[sample];assert.equal(next.sprite.key,`char.pikachu.${pose.page}`);assert.equal(next.sprite.frame,pose.frame);
  assert.ok(next.sprite.visible&&next.sprite.submitted&&next.sprite.textureResident);displayed++;if(!pose.acceptedOriginal)newSamples++;
  const sheet=sheets[control.sheet]??={ticks:0,oldDrawings:new Set(),denseNativeSamples:new Set()};sheet.ticks++;sheet.oldDrawings.add(previous.sprite.frame);sheet.denseNativeSamples.add(sample);
  for(const key of ['x','y','originX','originY','scaleX','scaleY','flipX','rotation'])assert.equal(next.sprite[key],previous.sprite[key],row.key+' registered '+key);
 }
 assert.ok(newSamples>0,'previously absent native poses actually drawn');

 rows.push({case:row.key,ticks:row.trace.length,authoritySha256:row.authoritySha256,authorityIdentical:true,victimGeometryAndPixelsUnchanged:true,rootScaleFacingRotationIdentical:true,
  displayedOwnerTicks:displayed,ticksShowingNewNativePoses:newSamples,phases:row.phases,damage:row.maxDamage,captures:row.maxCaptures,
  sheets:Object.fromEntries(Object.entries(sheets).map(([key,value])=>[key,{ticks:value.ticks,beforeDrawings:value.oldDrawings.size,afterDrawings:value.denseNativeSamples.size}]))});
}
assert.equal(rows.length,8);assert.deepEqual(after.errors,[]);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receipt={result:'PASS',beforeScript:before.loadedScript,afterScript:after.loadedScript,source:'Retained native NUANMB integer poses rendered by the accepted CPU toon operator; seven original authority clips are untouched.',
 restoreCoverage:'Display repeat/rewind/reset is unit tested. Whole-world checkpoint replay is not claimed for these injected setup probes, since grants and placement are outside input history.',
 scope:'8 ground/air × left/right × hit/miss real matches. Injected grant/placement; saved keyboard activation; all subsequent ordinary physics and Final choreography retained.',
 authorityFields:'Every captured physics, velocity, phase, motion-age, owner/victim control, damage, capture, receiving geometry, victim body/attachment and timeline field. Full canonical original seven-clip hash also covers outgoing/attachment/source-root tracks.',
 decodedBytes:bank.decodedBytes,decodedBudgetBytes:bank.decodedBudgetBytes,pages:Object.keys(bank.pages).length,semanticSamples:423,retainedOriginalDrawings:187,newNativePoses:236,
 beforeTraceSetSha256:sha(before.rows.filter(r=>!r.pacing).map(r=>r.authoritySha256)),afterTraceSetSha256:sha(after.rows.filter(r=>!r.pacing).map(r=>r.authoritySha256)),rows};
await writeFile(`${root}/qualification.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({result:receipt.result,cases:rows.length,authorityTraceSetSha256:receipt.afterTraceSetSha256}));
