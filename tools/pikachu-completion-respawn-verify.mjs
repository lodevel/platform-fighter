import assert from 'node:assert/strict';
/** Re-evaluate immutable played records without changing sampled gameplay. */
export function verifyRespawnReport(report,metadata,selectPikachuAuxiliaryBody){
 for(const r of report.rows){assert.equal(r.ko.entry.stocks,r.ko.before-1);assert.equal(r.ko.entry.damage,0);assert.equal(r.ko.entry.presentation.framesElapsed,0);assert.equal(r.ko.entry.invincible,true);assert.ok(r.ko.entry.platform);assert.equal(r.ko.entry.facing,r.index===0?1:-1);
  if(r.kind==='default-airborne-spawn'){assert.equal(r.trace.at(-1).presentation,null);assert.equal(r.trace.at(-1).grounded,true);assert.equal(r.trace.at(-1).canAttack,false);assert.ok(r.trace.length<129);continue;}
  if(r.kind==='full-clock-static-body-fixture'){
   for(let age=0;age<129;age++){const o=r.trace[age];assert.equal(o.isStatic,true);const pose=selectPikachuAuxiliaryBody('entry',age);assert.equal(o.presentation?.framesElapsed,age);assert.equal(o.texture,'char.pikachu.entry');assert.equal(o.textureFrame,pose.artFrameIndex);assert.equal(o.receiving.length,12);assert.deepEqual(o.receiving,pose.hurtboxes);assert.equal(o.canAttack,true);const clip=metadata.animations.entry;assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.scale,[clip.scaleToWorld,clip.scaleToWorld]);assert.equal(o.rotation,0);assert.deepEqual(o.spritePosition,{x:o.position.x,y:o.position.y+25});assert.equal(o.mirror,o.facing);assert.ok(!o.grounded||o.alpha.clearance>=-.55,'supported Entry alpha32 does not penetrate floor');}
   assert.equal(r.trace[129].presentation,null);assert.deepEqual(r.pause.after,r.pause.before);for(const o of r.hitlag){assert.equal(o.presentation.framesElapsed,30);assert.deepEqual(o.position,r.trace[30].position);assert.equal(o.textureFrame,r.trace[30].textureFrame);}assert.equal(r.trace[89].invincible,true);assert.equal(r.trace[90].invincible,false);
  }else{assert.equal(r.after.presentation,null);if(r.action==='attack'){assert.ok(['pikachu.jab','pikachu.neutral-air'].includes(r.after.attack));}}
 }

assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);
}
