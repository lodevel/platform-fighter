import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const out=process.env.PF_CONTEXT_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/context-checkpoint-04';
const selected=process.env.PF_CONTEXT_CASES?.split(',');
await mkdir(out,{recursive:true});
const report={url,scope:'Actual MatchScene keyboard input and real fixed Matter wall/ceiling contacts and footstool resolver. Public initial fixture resets and public attributed launch only; no input resolver override. Source native fighter scalars at5px/unit, DK motion-list protection/cancel records and published11-frame tech/16-step footstool rules are independent expectations. Baseline art is unaccepted; wall25 commitment, ceiling x-speed basis, input lockout/frozen renewal, footstool mini3/repeat geometry remain explicit adapters.',errors:[],failedResponses:[],cases:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set();
const down=async key=>{await page.keyboard.down(key);held.add(key);};
const up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{for(const key of [...held])await up(key);};
const step=async(n=1)=>page.evaluate(n=>window.__dkContext.step(n),n);
const read=async()=>page.evaluate(()=>window.__dkContext.read());
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{const filename=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${filename}`});(c.captures??=[]).push({label,screenshot:filename,observation:await read(),artAcceptance:'baseline body unaccepted'});};
const run=async(name,fn)=>{if(selected&&!selected.includes(name))return;await release();await step(2);const c={name,checks:[]};report.cases.push(c);await fn(c);await page.screenshot({path:`${out}/${name}.png`});};
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const g=window.__game;for(const old of g.scene.getScenes(true))g.scene.stop(old.scene.key);
  g.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810041,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=g.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of s.baseStage.bodies.platformBodies)if(b!==floor){b.collisionFilter.mask=0;s.matter.world.remove(b);}
  let surface=null;
  const fRead=f=>({position:f.getPosition(),velocity:f.getVelocity(),grounded:f.isGrounded(),facing:f.getFacing(),freeze:f.getHitlagRemaining(),hitstun:f.getHitstunRemaining(),tumbling:f.isTumbling(),percent:f.getDamagePercent(),body:f.getPackedBodyState(),recipient:f.getFootstoolRecipientPresentationState(),mini:f.footstoolMini?{...f.footstoolMini}:null,jumpsUsed:f.getJumpsUsed(),jumpImpulse:f.getTuning().jumpImpulse,riseAccel:f.getTuning().riseAccel??0,buffer:f.techBufferRemaining,lockout:f.techLockoutRemaining,frame:f.simulationInputFrame,lastAttackEnd:f.donkeykongLastAttackEndFrame,attack:f.getActiveAttack()?{id:f.getActiveAttack().move.id,age:f.getActiveAttack().framesElapsed}:null,mayFootstool:f.getFootstoolParticipant(f===s.p1?1:2,{moveX:0,moveY:0,jump:false}).mayJump,receiving:f.getActiveHurtboxes().map(h=>({id:h.id,region:h.region,intangible:!!h.intangible})),pairs:[...f.contactPairs.values()].map(p=>({id:(p.bodyA===f.body?p.bodyB:p.bodyA).id,active:p.isActive,normal:p.collision?{x:p.collision.normal.x*(p.bodyA===f.body?1:-1),y:p.collision.normal.y*(p.bodyA===f.body?1:-1)}:null}))});
  const read=()=>({worldGravityDose:s.matter.world.engine.gravity.y*s.matter.world.engine.gravity.scale*s.physicsEngine.fixedTimestepMs**2,frame:s.physicsEngine.getFrame(),p1:fRead(s.p1),p2:fRead(s.p2),surface:surface?{id:surface.id,bounds:surface.bounds}:null,input:{shield:s.inputResolver.isActionHeld(1,'shield'),jump:s.inputResolver.isActionHeld(1,'jump')}});
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const clear=()=>{if(surface){surface.collisionFilter.mask=0;s.matter.world.remove(surface);surface=null;}};
  const reset=(facing=1)=>{clear();s.p1.resetForRound(floor.position.x-200,floor.bounds.min.y-500);s.p2.resetForRound(floor.position.x+400,floor.bounds.min.y-42);s.p1.setFacing(facing);s.p1.setInvincibility(0);s.p2.setInvincibility(0);step(2);return read();};
  const surfaceReset=({kind,side=1,facing=1,distance=75})=>{reset(facing);const p=s.p1.getPosition();surface=kind==='ceiling'?s.matter.add.rectangle(p.x,p.y-distance,1000,20,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}}):s.matter.add.rectangle(p.x+side*distance,p.y,20,1000,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}});s.baseStage.bodies.platformBodies.push(surface);return read();};
  const launch=({kind,side=1,base=85,hitlagMultiplier=1})=>{s.p1.applyHit({damage:1,hitlagMultiplier,facing:side,knockback:{x:kind==='ceiling'?0:1,y:kind==='ceiling'?-1:0,scaling:0,reference:{base,growth:0,angle:kind==='ceiling'?90:0}}});return read();};
  const footReset=({facing=1,phantom=false})=>{reset(facing);s.p2.resetForRound(floor.position.x,floor.bounds.min.y-400);s.p2.setInvincibility(0);s.matter.body.setVelocity(s.p2.body,{x:0,y:0});step(2);const target=s.p2.getFootstoolParticipant(2,{moveX:0,jump:false}),head=target.head;const p=s.p2.getPosition();s.matter.body.setPosition(s.p1.body,{x:head.x,y:head.top-42-3});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});s.p1.setFacing(facing);if(phantom)s.p2.attemptAttack('donkeykong.nair');return read();};
  window.__dkContext={s,read,step,reset,surfaceReset,launch,footReset,freeze:(n)=>{s.p1.armAttackerHitlag(n);return read();},damage:()=>{s.p1.applyHit({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:0,y:-1,scaling:0,reference:{base:30,growth:0,angle:90}}});return read();}};
 });
 const enter=async(spec,{heldShield=false,jump=false}={})=>{
  await page.evaluate(spec=>window.__dkContext.surfaceReset(spec),spec);
  if(heldShield){await down('h');await step();}
  const launch=await page.evaluate(spec=>window.__dkContext.launch(spec),spec);
  if(!heldShield)await down('h');if(jump)await down('w');
  const trace=[];for(let i=0;i<40;i++){const o=await step();trace.push(o);if(o.p1.body.surfaceTech)break;}
  return{launch,trace,entry:trace.at(-1)};
 };
 for(const kind of ['wall','ceiling'])for(const facing of [1,-1])for(const side of kind==='wall'?[1,-1]:[1])await run(`tech-${kind}-${facing}-${side}`,async c=>{
  Object.assign(c,await enter({kind,facing,side}));await release();const t=c.entry.p1.body.surfaceTech;
  c.checks.push(check('actual Matter contact selects dedicated DK source state',t?.kind===kind,t?.kind,kind),check('fresh frozen shield opens source11 window',c.trace[0].p1.buffer===11,c.trace[0].p1.buffer,11));
  if(!t)return;await capture(c,'entry');
  c.checks.push(check('entry age0 and source protection',t.framesElapsed===0&&t.protected,t),check('entry physics source scalar',kind==='wall'?Math.abs(c.entry.p1.velocity.x+side*2.5)<.01:Math.abs(c.entry.p1.velocity.y-c.entry.worldGravityDose)<.01,c.entry.p1.velocity));
  c.ages=[c.entry];for(let i=1;i<(kind==='wall'?25:26)+1;i++){c.ages.push(await step());if(i===(kind==='wall'?19:16))await capture(c,'last-protected');if(i===(kind==='wall'?20:17))await capture(c,'first-vulnerable');}
  const protect=kind==='wall'?20:17,duration=kind==='wall'?25:26;
  c.checks.push(check('native last protected age remains protected',c.ages[protect-1].p1.body.surfaceTech?.protected===true),check('native next age is vulnerable',c.ages[protect].p1.body.surfaceTech?.protected===false),check('source/authored commitment exits at exact duration',c.ages[duration-1].p1.body.surfaceTech!==null&&c.ages[duration].p1.body.surfaceTech===null),check('held shield never refreshes',c.trace.filter(r=>r.p1.freeze===0).every((r,i,a)=>i===0||r.p1.buffer<=a[i-1].p1.buffer)));
 });
 for(const facing of [1,-1])await run(`tech-wall-jump-${facing}`,async c=>{
  Object.assign(c,await enter({kind:'wall',side:1,facing},{jump:true}));await release();const t=c.entry.p1.body.surfaceTech;await capture(c,'entry');
  c.checks.push(check('held jump at actual wall impact selects wall-tech jump',t?.kind==='wall-jump'),check('native wall-tech jump is never protected',t?.protected===false),check('native entry scalar1.3/2.7 at5px',Math.abs(c.entry.p1.velocity.x+6.5)<.01&&Math.abs(c.entry.p1.velocity.y+13.5-c.entry.worldGravityDose)<.01,c.entry.p1.velocity));
  await step();await down('f');c.action=await step();await release();c.checks.push(check('ordinary attack actionable after one entry event',c.action.p1.attack!==null&&c.action.p1.body.surfaceTech===null,c.action.p1.attack));
 });
 await run('tech-held-before-launch-rejected',async c=>{Object.assign(c,await enter({kind:'wall',side:1,facing:1},{heldShield:true}));await release();c.checks.push(check('holding existing shield is not a fresh launch buffer',c.trace.every(o=>o.p1.body.surfaceTech===null)),check('actual wall collision occurred',c.trace.some(o=>o.p1.pairs.some(p=>p.id===o.surface.id&&p.active!==false))));});
 await run('tech-expired-buffer-rejected',async c=>{await page.evaluate(()=>window.__dkContext.surfaceReset({kind:'wall',side:1,facing:1,distance:250}));c.launch=await page.evaluate(()=>window.__dkContext.launch({kind:'wall',side:1}));await down('h');c.trace=[];for(let i=0;i<65;i++)c.trace.push(await step());await release();c.checks.push(check('source11 expires before distant real contact',c.trace.some(r=>r.p1.buffer===0&&r.p1.lockout>0)),check('expired fresh press cannot tech contact',c.trace.every(r=>r.p1.body.surfaceTech===null)),check('distant actual collision occurred',c.trace.some(o=>o.p1.pairs.some(p=>p.id===o.surface.id&&p.active!==false))));});
 await run('tech-freeze-damage-reset',async c=>{Object.assign(c,await enter({kind:'ceiling',facing:1}));await release();c.before=await read();await page.evaluate(()=>window.__dkContext.freeze(5));c.frozen=[];for(let i=0;i<5;i++)c.frozen.push(await step());c.checks.push(check('five hitlag steps preserve source action age',c.frozen.every(r=>r.p1.body.surfaceTech?.framesElapsed===c.before.p1.body.surfaceTech?.framesElapsed)));c.protectedContact=await page.evaluate(()=>window.__dkContext.damage());c.checks.push(check('protected contact correctly preserves contextual owner',c.protectedContact.p1.body.surfaceTech!==null));await step(17);c.damage=await page.evaluate(()=>window.__dkContext.damage());c.checks.push(check('vulnerable damage retires dedicated context owner',c.damage.p1.body.surfaceTech===null));c.reset=await page.evaluate(()=>window.__dkContext.reset());c.checks.push(check('round reset clears context state/buffer',c.reset.p1.body.surfaceTech===null&&c.reset.p1.buffer===0));});
 for(const facing of [1,-1])for(const mode of ['full','mini','phantom'])await run(`footstool-${mode}-${facing}`,async c=>{
  c.before=await page.evaluate(spec=>window.__dkContext.footReset(spec),{facing,phantom:mode==='phantom'});await down('w');c.entry=await step();await capture(c,'entry');if(mode!=='full')await up('w');c.next=await step();await capture(c,'next');await release();
  c.checks.push(check('real fresh keyboard jump/combined resolver starts DK performer',c.entry.p1.body.footstoolPerformer!==null,c.entry.p1.body.footstoolPerformer),check('footstool preserves ordinary jump resource',c.entry.p1.jumpsUsed===c.before.p1.jumpsUsed),check('native full impulse1.3 achieved',Math.abs(c.entry.p1.velocity.y-(-c.before.p1.jumpImpulse*1.3+c.before.p1.riseAccel+c.entry.worldGravityDose))<1e-6,c.entry.p1.velocity.y,-c.before.p1.jumpImpulse*1.3+c.before.p1.riseAccel+c.entry.worldGravityDose));
  if(mode==='mini')c.checks.push(check('release selects native mini.7',c.next.p1.body.footstoolPerformer?.mini===true&&Math.abs(c.next.p1.velocity.y-(-c.before.p1.jumpImpulse*.7+c.before.p1.riseAccel+c.next.worldGravityDose))<1e-6,c.next.p1.velocity.y,-c.before.p1.jumpImpulse*.7+c.before.p1.riseAccel+c.next.worldGravityDose));
  else if(mode==='phantom')c.checks.push(check('phantom target continues existing attack',c.entry.p2.attack!==null&&c.entry.p2.recipient===null,c.entry.p2),check('phantom release cannot mini',c.next.p1.body.footstoolPerformer?.mini===false&&c.next.p1.mini===null));
  else c.checks.push(check('ordinary air recipient uses separate StepPoseAir owner',c.entry.p2.recipient?.grounded===false));
  if(mode==='full'){c.recovery=[c.entry,c.next];for(let i=2;i<38;i++)c.recovery.push(await step());const index=c.recovery.findIndex(r=>r.p2.recipient===null);c.checks.push(check('air recipient clears at independently sourced36 recovery steps',index===36,index,36));}
 });
 await run('footstool-post-attack16-and-reset',async c=>{
  await page.evaluate(()=>{const t=window.__dkContext;t.reset();t.s.p1.attemptAttack('donkeykong.nair');t.s.p1.cancelAttack();});c.trace=[await read()];for(let i=0;i<17;i++)c.trace.push(await step());
  c.checks.push(check('post-attack first15 completed steps remain ineligible',c.trace.slice(0,16).every(r=>r.p1.mayFootstool===false)),check('source16 completed steps unlock',c.trace[16].p1.mayFootstool===true,c.trace.map(r=>({age:r.p1.frame-r.p1.lastAttackEnd,may:r.p1.mayFootstool}))),check('round reset does not invent post-attack wait',(await page.evaluate(()=>window.__dkContext.reset())).p1.mayFootstool===true));
 });
 const failed=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.failedChecks=failed;report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.result=failed.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:failed,errors:report.errors},null,2));
 if(report.result!=='PASS')process.exitCode=1;
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;console.error(e.stack);process.exitCode=1;}finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
