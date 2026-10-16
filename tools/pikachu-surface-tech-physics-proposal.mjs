// Actual production Pikachu/Matter with an explicitly installed JS prototype
// proposal. This is diagnostic evidence, never browser/runtime qualification.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
const require=createRequire(import.meta.url);
const Engine=require('../src/physics/matter/source/lib/core/Engine.js'),Events=require('../src/physics/matter/source/lib/core/Events.js'),Bodies=require('../src/physics/matter/source/lib/factory/Bodies.js'),Body=require('../src/physics/matter/source/lib/body/Body.js'),Composite=require('../src/physics/matter/source/lib/body/Composite.js');
const {Pikachu}=await tsImport(new URL('../src/characters/Pikachu.ts',import.meta.url).pathname,import.meta.url);
const {stepCharacterPhysics}=await tsImport(new URL('../src/characters/stepCharacterPhysics.ts',import.meta.url).pathname,import.meta.url);
const {beginPikachuSurfaceTech,advancePikachuSurfaceTech,pikachuSurfaceTechProtected,selectPikachuSurfaceTechBody,pikachuSurfaceTechSourceDisplacement,classifyPikachuSurfaceTechContact}=await tsImport(new URL('../src/characters/pikachuSurfaceTech.ts',import.meta.url).pathname,import.meta.url);
const {COLLISION_CATEGORIES}=await tsImport(new URL('../src/engine/collisionCategories.ts',import.meta.url).pathname,import.meta.url);
const neutral={moveX:0,moveY:0,jump:false};
const installed=process.env.PF_SURFACE_USE_INSTALLED==='1';
const output=process.env.PF_SURFACE_OUTPUT??`docs/review/2026-10-06/pikachu-character/integration/completion-gap-audit/surface-tech-${installed?'installed':'physics-proposal'}.json`;

function contact(actor){
 for(const pair of actor.contactPairs.values()){
  const other=pair.bodyA===actor.body?pair.bodyB:pair.bodyA;
  if(pair.isActive===false||pair.isSensor||actor.body.isSensor||other.isSensor||other.collisionFilter.mask===0||other.label!=='platform.solid'||!pair.collision)continue;
  const v=actor.body.vertices,minX=Math.min(...v.map(v=>v.x)),maxX=Math.max(...v.map(v=>v.x)),minY=Math.min(...v.map(v=>v.y)),maxY=Math.max(...v.map(v=>v.y));
  if(maxX<other.bounds.min.x-.1||minX>other.bounds.max.x+.1||maxY<other.bounds.min.y-.1||minY>other.bounds.max.y+.1)continue;
  const sign=pair.bodyA===actor.body?1:-1,normal={x:pair.collision.normal.x*sign,y:pair.collision.normal.y*sign},hit=classifyPikachuSurfaceTechContact(normal);
  if(hit)return{...hit,normal,surfaceId:other.id};
 }
 return null;
}

function installProposal(actor){
 let state=null,savedIgnoreGravity=null;
 const original=actor.applyInputStep.bind(actor),invincible=actor.isInvincible.bind(actor),receiving=actor.getActiveHurtboxes.bind(actor);
 const latch=input=>{actor.prevJumpHeld=input.jump;actor.prevAttackHeld=input.attack===true;actor.prevHeavyHeld=input.attackHeavy===true;actor.prevSpecialHeld=input.special===true;actor.prevShieldHeld=input.shield===true;actor.prevDodgeHeld=input.dodge===true;actor.prevGrabHeld=input.grab===true;actor.prevMoveX=input.moveX;actor.prevMoveY=input.moveY??0;actor.prevGrounded=actor.isGrounded();};
 const clear=()=>{if(savedIgnoreGravity!==null){actor.body.ignoreGravity=savedIgnoreGravity;savedIgnoreGravity=null;}state=null;};
 const cleanQueues=()=>{actor.jumpInputBufferFrames=0;actor.tapJumpBufferFrames=0;actor.offensiveActionBuffer=null;};
 actor.getPikachuSurfaceTechPresentationState=()=>state;
 actor.isInvincible=()=>state!==null&&pikachuSurfaceTechProtected(state)||invincible();
 actor.getActiveHurtboxes=()=>state?selectPikachuSurfaceTechBody(state).hurtboxes:receiving();
 actor.applyInputStep=input=>{
  if(state){
   if(actor.hitlagRemaining>0){original(input);return;}
   const next=actor.isGrounded()?null:advancePikachuSurfaceTech(state);
   if(next){const delta=pikachuSurfaceTechSourceDisplacement(state,next);state=next;cleanQueues();Body.setVelocity(actor.body,state.kind==='ceiling'?delta:{x:actor.body.velocity.x,y:Math.min(actor.body.velocity.y+actor.getTuning().fallAccel,actor.getTuning().maxFallSpeed)});latch(input);return;}
   clear();
  }
  const hit=actor.tumbling&&actor.hitlagRemaining===0&&!actor.isGrounded()?contact(actor):null;
  if(hit){
   // Run exactly the existing beta8-window/24-lockout update for arbitration.
   // Restore it if entry fails so the original method updates it only once.
   const previousBuffer=actor.techBufferRemaining,previousLockout=actor.techLockoutRemaining;
   actor.updateTechInputBuffer(input);
   if(actor.techBufferRemaining>0&&actor.techLockoutRemaining===0){
    actor.clearReferenceLaunch();actor.launchVelocity=null;actor.hitstunRemaining=0;actor.pendingKnockback=null;actor.referenceStunnedStep=false;actor.pendingHitstunGravityCorrection=0;actor.hitstunGravityVelocityY=0;
    actor.clearTumbleForStartedAction();actor.pikachuAuxiliaryAir=null;actor.jumpPresentation=null;actor.fastFallLatched=false;actor.jumpCutArmed=false;actor.airJumpRising=false;actor.shortHopRising=false;cleanQueues();
    state=beginPikachuSurfaceTech(hit.kind,actor.getFacing(),hit.outward);
    if(hit.kind==='ceiling'){savedIgnoreGravity=actor.body.ignoreGravity??false;actor.body.ignoreGravity=true;Body.setVelocity(actor.body,{x:0,y:0});}
    else Body.setVelocity(actor.body,{x:hit.outward*2.5,y:0});
    latch(input);return;
   }
   actor.techBufferRemaining=previousBuffer;actor.techLockoutRemaining=previousLockout;
  }
  original(input);
 };
 return{state:()=>state,clear};
}

function fixture(kind,side,facing,mode,variant='fresh'){
 const engine=Engine.create(),names={collisionstart:'collisionStart',collisionactive:'collisionActive',collisionend:'collisionEnd'};
 const scene={matter:{body:Body,add:{rectangle(x,y,w,h,options){const b=Bodies.rectangle(x,y,w,h,options);Composite.add(engine.world,b);return b;}},world:{on(name,fn){Events.on(engine,names[name]??name,fn);},off(name,fn){Events.off(engine,names[name]??name,fn);},remove(b){Composite.remove(engine.world,b);}}}};
 const actor=new Pikachu(scene,{spawnX:0,spawnY:0});actor.setFacing(facing);
 const surface=kind==='wall'?Bodies.rectangle(side*60,0,20,1000,{isStatic:true,label:'platform.solid',collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}):kind==='ceiling'?Bodies.rectangle(0,-65,1000,20,{isStatic:true,label:'platform.solid',collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}}):Bodies.rectangle(0,65,1000,20,{isStatic:true,label:'platform.solid',collisionFilter:{category:COLLISION_CATEGORIES.PLATFORM_SOLID}});
 Composite.add(engine.world,surface);const proposal=mode==='proposal'?installProposal(actor):null;
 const read=()=>({position:actor.getPosition(),velocity:actor.getVelocity(),tumbling:actor.isTumbling(),grounded:actor.isGrounded(),surface:mode==='installed'?actor.getPikachuSurfaceTechPresentationState?.()??null:proposal?.state()??null,invincible:actor.isInvincible(),hurtboxes:actor.getActiveHurtboxes(),buffer:actor.techBufferRemaining,lockout:actor.techLockoutRemaining,reaction:actor.getReactionPresentationState(),contact:contact(actor),ignoreGravity:actor.body.ignoreGravity??false});
 const step=input=>{actor.applyInput(input??neutral);stepCharacterPhysics({characters:[actor],bodies:Composite.allBodies(engine.world),gravity:engine.gravity,body:Body,deltaMs:1000/60,stepWorld:dt=>Engine.update(engine,dt)});return read();};
 if(variant==='held')step({...neutral,shield:true});
 actor.applyHit({damage:1,knockback:{x:kind==='wall'?8:0,y:kind==='ceiling'?-8:kind==='floor'?8:0,scaling:0},facing:side,hitlagMultiplier:1});
 const trace=[];let contactFrame=null,entry=null;
 for(let age=0;age<80;age++){
  let input=variant==='held'?{...neutral,shield:true}:neutral;
  if(variant==='expired'&&age===0)input={...neutral,shield:true};
  const live=contact(actor);
  if(live&&contactFrame===null){contactFrame=age;
   if(variant==='mask0')surface.collisionFilter.mask=0;
   if(variant==='sensor')surface.isSensor=true;
   if(variant==='stale')Body.setPosition(surface,{x:surface.position.x+2000,y:surface.position.y});
  }
  if(live&&variant!=='held')input={...neutral,shield:true};
  const o=step(input);trace.push(o);
  if(o.surface){entry=o;break;}
  if(contactFrame!==null&&age>=contactFrame+2)break;
  if(kind==='floor'&&actor.isGrounded()){trace.push(step({...neutral,shield:true}));break;}
 }
 if(entry){for(let age=1;age<entry.surface.duration+1;age++)trace.push(step({...neutral,attack:age>0&&age<entry.surface.duration}));}
 const owned=trace.filter(o=>o.surface);const transport=kind==='ceiling'&&owned.length?{sourceRequestedDownward:22.24249839782715,actualDownward:owned.at(-1).position.y-owned[0].position.y,blockedDownward:22.24249839782715-(owned.at(-1).position.y-owned[0].position.y),authoredCollisionTolerance:.1,noAbsoluteCatchUp:true}:null;const result={kind,side,facing,mode,variant,contactFrame,entry,trace,transport};proposal?.clear();actor.destroy();Engine.clear(engine);Composite.clear(engine.world,false);return result;
}

const report={installed,scope:'Real Phaser Matter + actual production Pikachu. Proposed private-method JS adapter is installed only on diagnostic actors. No Character source mutation, browser acceptance, native common parity or inventory promotion.',betaPolicy:'Wall25-step commitment and2.5px outward entry with ordinary gravity are authored. Ceiling27-step source cancel clock consumes native Trans root transport with gravity ignored/restored. Live cardinal solid contacts and existing beta8 shield/dodge window/24 lockout; source protection wall[1,21),ceiling[1,18).',sourceHashes:{},cases:[]};
for(const file of ['src/characters/Character.ts','src/characters/pikachuSurfaceTech.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
if(installed)report.scope='Actual installed production Character/Pikachu and pure surface-tech leaf in real Phaser Matter. No prototype adapter installed. This is focused physical regression, not browser/visual/native common acceptance.';
try{
 for(const mode of installed?['installed']:['baseline','proposal'])for(const kind of ['wall','ceiling'])for(const side of [1,-1])for(const facing of [1,-1])report.cases.push(fixture(kind,side,facing,mode));
 for(const kind of ['wall','ceiling'])for(const variant of ['held','expired','mask0','sensor','stale'])report.cases.push(fixture(kind,1,1,installed?'installed':'proposal',variant));
 for(const facing of [1,-1])report.cases.push(fixture('floor',1,facing,installed?'installed':'proposal'));
 for(const c of report.cases){
  if(c.mode==='baseline'||c.variant!=='fresh'||c.kind==='floor'){assert.equal(c.entry,null,`${c.mode}/${c.kind}/${c.variant} must not enter surface tech`);continue;}
  assert.ok(c.entry,`real ${c.kind} contact must tech`);assert.equal(c.entry.surface.kind,c.kind);assert.equal(c.entry.surface.framesElapsed,0);assert.equal(c.entry.grounded,false);assert.equal(c.entry.tumbling,false);
  const owned=c.trace.filter(o=>o.surface);assert.equal(owned.length,c.kind==='wall'?25:27);for(let age=0;age<owned.length;age++){assert.equal(owned[age].surface.framesElapsed,age);assert.equal(owned[age].hurtboxes.length,12);assert.equal(owned[age].invincible,age<(c.kind==='wall'?20:17));assert.equal(owned[age].ignoreGravity,c.kind==='ceiling');}
  if(c.kind==='ceiling')assert.ok(Math.abs(owned.at(-1).position.y-owned[0].position.y-22.24249839782715)<=.1,'actual live-ceiling solver may retain at most authored0.1px contact slop; never catch up blocked Trans');
  const free=c.trace.at(-1);assert.equal(free.surface,null);assert.equal(free.ignoreGravity,false);
 }
 report.result=installed?'PASS_INSTALLED_REAL_MATTER_MECHANICS_ONLY':'PASS_PROPOSED_REAL_MATTER_MECHANICS_ONLY';
}catch(e){report.result='FAIL';report.failure=e.stack;throw e;}finally{await writeFile(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({result:report.result,cases:report.cases.length}));
