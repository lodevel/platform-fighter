import assert from 'node:assert/strict';

/** Verify immutable observed runtime traces, not generated simulation data. */
export function verifyPikachuSurfaceTechTrace(report,metadata,selectPikachuSurfaceTechBody){
 for(const c of report.cases){
  for(const o of [...(c.flight??[]),...(c.trace??[])])assert.ok(o.stocks.every(s=>s.stocks===5),'stock guard');
  if(c.variant){assert.equal(c.entry.surface,null,`${c.kind}/${c.variant}`);continue;}
  assert.equal(c.entry.surface.kind,c.kind);assert.equal(c.entry.surface.framesElapsed,0);assert.equal(c.entry.surface.facing,c.contact.facing);
  if(c.protection){assert.ok(c.trace.some(o=>o.attacker?.sensor),'real melee sensor');if(c.protection==='protected'){assert.equal(c.after.percent,c.before.percent);assert.ok(c.trace.every(o=>o.receiving.every(h=>h.intangible===true)));}else {assert.ok(Math.abs((c.after.percent-c.before.percent)-2*1.05)<1e-8,'actual2.1damage delta within floating-point tolerance');assert.equal(c.after.surface,null);assert.equal(c.after.ignoreGravity,false);}continue;}
  const duration=c.kind==='wall'?25:27;assert.equal(c.trace.length,duration);
  for(let age=0;age<duration;age++){
   const o=c.trace[age],s=o.surface;assert.equal(s.framesElapsed,age);assert.equal(s.duration,duration);assert.equal(o.grounded,false);assert.equal(o.ignoreGravity,c.kind==='ceiling');assert.equal(o.invincible,age<(c.kind==='wall'?20:17));assert.equal(o.move,null);
   const body=selectPikachuSurfaceTechBody(s),clip=metadata.animations[s.sheet];assert.ok(body&&clip);assert.equal(o.texture,`char.pikachu.${s.sheet}`);assert.equal(o.textureFrame,body.artFrameIndex);assert.deepEqual(o.receiving,body.hurtboxes);assert.equal(o.receiving.length,12);assert.equal(o.mirror,s.facing);assert.equal(o.rotation,0);assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.spritePosition,{x:o.position.x,y:o.position.y+25});assert.deepEqual(o.scale,[clip.scaleToWorld,clip.scaleToWorld]);
  }
  if(c.kind==='ceiling'){c.transport={requested:22.24249839782715,actual:c.trace.at(-1).position.y-c.trace[0].position.y,authoredTolerance:.1,noAbsoluteCatchup:true};assert.ok(Math.abs(c.transport.actual-c.transport.requested)<=.1);}
  assert.deepEqual(c.pause.before,c.pause.after);assert.equal(c.firstFree.surface,null);assert.equal(c.firstFree.ignoreGravity,false);assert.equal(c.firstFree.jump?.kind,'air');assert.ok(c.firstFree.velocity.y<-10);
 }

 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);
 return{result:'PASS',actualCases:report.cases.length,actualCaptures:report.cases.flatMap(c=>c.captures).length,damageDeltaTolerance:1e-8,ceilingCollisionTolerance:.1};
}
