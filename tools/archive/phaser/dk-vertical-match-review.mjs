import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const checkpoint=process.env.PF_VERTICAL_CHECKPOINT??'.tmp/dk-mechanics-checkpoint-08-ceiling-corrected';
const out=process.env.PF_VERTICAL_OUT??'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/vertical-checkpoint-08-landing-exit-corrected';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const gravity=.085*5,miniImpulse=(Math.sqrt(2*.085*17.3)+.085/2)*5,airImpulse=(Math.sqrt(2*.085*35.5)+.085/2)*5;
const report={url,scope:'Actual keyboard W/S/F/H through MatchScene and fixed Matter. Source mini/air height-derived impulses and total gravity/fall caps are independent expectations. Full hop is an authored four-step curve constrained by sourced93.5px initial rise and170px total height, not recovered native opening acceleration. Explicit stage removal, initial body resets/velocities, public hitlag and initial contact fixtures are recorded separately from keyboard input. Existing body art is not qualified here.',cases:[],errors:[],sourceBindings:[]};
for(const path of ['src/characters/Character.ts','src/characters/donkeykongVerticalMovement.ts','src/characters/fighterMovementProfiles.ts']){
 const capturedPath=`${checkpoint}-source-leaves/${path}`;
 report.sourceBindings.push({path,capturedPath,sha256:sha(await readFile(capturedPath))});
}
const source='docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/ordinary-vertical-source-contract.json';
report.sourceContract={path:source,sha256:sha(await readFile(source))};
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
const held=new Set(),down=async k=>{if(!held.has(k)){await page.keyboard.down(k);held.add(k);}},up=async k=>{if(held.has(k)){await page.keyboard.up(k);held.delete(k);}};
const release=async()=>{for(const k of [...held])await up(k);};
const step=async(n=1)=>page.evaluate(n=>window.__dkVertical.step(n),n);
const check=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
const capture=async(c,label)=>{await page.evaluate(()=>{const t=window.__dkVertical,p=t.a.getPosition(),camera=t.s.cameras.main;camera.setScroll(p.x-camera.width/2,p.y-camera.height/2);});const path=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${path}`});(c.captures??=[]).push(path);};
const run=async(name,fn)=>{await release();const c={name,checks:[]};report.cases.push(c);await fn(c);await capture(c,'final');};
async function takeoff(c,{facing=1,mini=false}={}){
 c.reset=await page.evaluate(f=>window.__dkVertical.reset(f),facing);c.start=c.reset.position;
 await down('w');c.startup=[await step()];if(mini)await up('w');
 for(let i=0;i<20&&!c.startup.at(-1).jump;i++)c.startup.push(await step());
 c.takeoff=c.startup.at(-1);assert.equal(c.takeoff.jump?.kind,'ground');assert.equal(c.takeoff.jump.shortHop,mini);
 c.preTakeoff=c.startup.at(-2)??c.reset;c.start=c.preTakeoff.position;
 c.heightOrigin='Observed last pre-takeoff Matter root after jumpsquat, rather than earlier reset root; no correction applied to observed airborne trajectory.';
 return c.takeoff;
}
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);report.bundleSha256=sha(await(await page.request.get(report.bundle)).body());
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810081,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:1,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene'),a=s.p1;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const body of s.baseStage.bodies.platformBodies)if(body!==floor){body.collisionFilter.mask=0;s.matter.world.remove(body);}
  let ceiling=null;
  const read=()=>({contacts:[...a.contactPairs.values()].map(p=>({id:(p.bodyA===a.body?p.bodyB:p.bodyA).id,active:p.isActive})),frame:s.physicsEngine.getFrame(),position:a.getPosition(),velocity:a.getVelocity(),grounded:a.isGrounded(),facing:a.getFacing(),freeze:a.getHitlagRemaining(),jump:a.getJumpPresentationState(),jumpsUsed:a.getJumpsUsed(),squat:a.getJumpsquatRemaining(),vertical:a.getDonkeyKongVerticalMotionState(),landingRecoveryRemaining:a.getAnimationActionState().landingRecoveryRemaining,attack:a.getActiveAttack()?{id:a.getActiveAttack().move.id,age:a.getActiveAttack().framesElapsed}:null,dodge:a.getDodgeState(),activeGravityScale:a.getActiveAttack()?.move.gravityScale??null,damage:a.getDamagePercent(),body:a.getPackedBodyState(),recipient:s.p2.getFootstoolRecipientPresentationState()});
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const reset=facing=>{if(ceiling){ceiling.collisionFilter.mask=0;s.matter.world.remove(ceiling);const index=s.baseStage.bodies.platformBodies.indexOf(ceiling);if(index>=0)s.baseStage.bodies.platformBodies.splice(index,1);ceiling=null;}a.resetForRound(floor.position.x-200,floor.bounds.min.y-a.getTuning().height/2);s.p2.resetForRound(floor.bounds.max.x-20,floor.bounds.min.y-s.p2.getTuning().height/2);a.setDamagePercent(0);a.setInvincibility(0);step(12);a.setFacing(facing);return read();};
  const air=({height=650,vy=0}={})=>{s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:floor.bounds.min.y-height});s.matter.body.setVelocity(a.body,{x:0,y:0});step(2);s.matter.body.setVelocity(a.body,{x:0,y:vy});return read();};
  const footPlace=({facing=1,phantom=false,keepPerformer=false}={})=>{
   if(!keepPerformer){reset(facing);air({height:650});}
   s.p2.resetForRound(floor.position.x+200,floor.bounds.min.y-400);s.p2.setInvincibility(0);s.p2.setDamagePercent(0);step(2);
   const target=s.p2.getFootstoolParticipant(2,{moveX:0,jump:false});
   s.matter.body.setPosition(a.body,{x:target.head.x,y:target.head.top-a.getTuning().height/2-3});s.matter.body.setVelocity(a.body,{x:0,y:0});a.setFacing(facing);
   if(phantom)s.p2.attemptAttack('donkeykong.nair');return read();
  };
  const addCeiling=()=>{const p=a.getPosition();ceiling=s.matter.add.rectangle(p.x,p.y-70,500,20,{isStatic:true,label:'platform.solid',collisionFilter:{...floor.collisionFilter}});s.baseStage.bodies.platformBodies.push(ceiling);return{id:ceiling.id,bounds:ceiling.bounds};};
  window.__dkVertical={s,a,read,step,reset,air,footPlace,addCeiling,freeze:n=>a.armAttackerHitlag(n)};
 });
 for(const facing of [1,-1])for(const mini of [false,true])await run(`${mini?'mini':'full'}-hop-${facing}`,async c=>{
  const entry=await takeoff(c,{facing,mini});c.trace=[entry];await up('w');
  for(let i=0;i<100&&!(i>5&&c.trace.at(-1).grounded);i++)c.trace.push(await step());
  const peak=Math.min(...c.trace.map(o=>o.position.y)),height=c.start.y-peak;
  check(c,'physical default W route chooses requested grounded hop',entry.jump.shortHop===mini,entry.jump,mini);
  if(mini){
   check(c,'mini first actual Matter velocity consumes source0F once',Math.abs(entry.velocity.y-(-miniImpulse+gravity))<1e-6,entry.velocity.y,-miniImpulse+gravity);
   check(c,'mini actual discrete apex fits source17.3native within half gravity step',Math.abs(height-17.3*5)<gravity/2,height,17.3*5);
  }else{
   const rise4=c.start.y-c.trace[3].position.y;
   check(c,'authored opening obeys independently sourced first4 total rise',Math.abs(rise4-18.7*5)<.001,rise4,18.7*5);
   check(c,'authored fullhop actual discrete apex fits source34native',Math.abs(height-34*5)<.001,height,34*5);
   check(c,'opening owner retires exactly after four unfrozen steps',c.trace.slice(0,3).every((o,i)=>o.vertical.nextOpeningStep===i+1)&&c.trace[3].vertical.nextOpeningStep===null,c.trace.slice(0,5).map(o=>o.vertical));
  }
  const ordinary=c.trace.slice(mini?0:3).filter(o=>o.velocity.y<7.7&&!o.grounded);
  check(c,'ordinary actual velocity deltas apply total sourcegravity once',ordinary.slice(1).every((o,i)=>Math.abs(o.velocity.y-ordinary[i].velocity.y-gravity)<1e-6),ordinary.map(o=>o.velocity.y),gravity);
  c.firstLanding=c.trace.at(-1);c.postLandingTrace=[await step()];
  for(let i=0;i<10&&c.postLandingTrace.at(-1).landingRecoveryRemaining>0;i++)c.postLandingTrace.push(await step());
  c.postLanding=c.postLandingTrace.at(-1);
  check(c,'actual landing commitment exit restores ground jump resources and retires opening',c.postLanding.grounded&&c.postLanding.landingRecoveryRemaining===0&&c.postLanding.vertical.nextOpeningStep===null&&c.postLanding.jumpsUsed===0,c.postLanding);
  c.height=height;await capture(c,'landed');
 });
 for(const facing of [1,-1])await run(`air-jump-${facing}`,async c=>{
  await page.evaluate(f=>window.__dkVertical.reset(f),facing);c.before=await page.evaluate(()=>window.__dkVertical.air());await down('w');c.entry=await step();await up('w');
  c.trace=[c.entry];for(let i=0;i<65;i++)c.trace.push(await step());const height=c.before.position.y-Math.min(...c.trace.map(o=>o.position.y));
  check(c,'physical midair W uses source0F air impulse once',c.entry.jump?.kind==='air'&&Math.abs(c.entry.velocity.y-(-airImpulse+gravity))<1e-6,c.entry,-airImpulse+gravity);
  check(c,'airjump avoids authored fullhop opening',c.entry.vertical.nextOpeningStep===null,c.entry.vertical);
  check(c,'actual airjump apex fits35.5native within discretegravity tolerance',Math.abs(height-35.5*5)<gravity/2,height,35.5*5);c.height=height;
 });
 for(const facing of [1,-1])await run(`ordinary-fall-fastfall-${facing}`,async c=>{
  await page.evaluate(f=>window.__dkVertical.reset(f),facing);c.before=await page.evaluate(()=>window.__dkVertical.air({height:800,vy:2}));c.gravity=await step();
  check(c,'actual ordinary descending Matter step adds.425 once',Math.abs(c.gravity.velocity.y-2.425)<1e-6,c.gravity.velocity.y,2.425);
  c.fall=await step(25);check(c,'ordinary terminal source1.63*5',Math.abs(c.fall.velocity.y-8.15)<1e-6,c.fall.velocity.y,8.15);
  await down('s');c.fast=await step();await up('s');c.latched=await step();
  check(c,'physical fresh down starts sourcefastfall immediately',Math.abs(c.fast.velocity.y-13.04)<1e-6,c.fast.velocity.y,13.04);
  check(c,'fastfall persists after physical down release',Math.abs(c.latched.velocity.y-13.04)<1e-6,c.latched.velocity.y,13.04);
 });
 for(const velocityY of [0,-4,6])await run(`headbutt-entry-gravity-${velocityY}`,async c=>{
  await page.evaluate(()=>window.__dkVertical.reset(1));c.before=await page.evaluate(vy=>window.__dkVertical.air({vy}),velocityY);
  await down('d');await down('g');c.entry=await step();await release();c.next=await step();
  const expected=velocityY*.5+gravity*.5;
  check(c,'actual keyboard air Headbutt consumes half raw entryY and onehalf sourcegravity dose',c.entry.activeGravityScale===.5&&Math.abs(c.entry.velocity.y-expected)<1e-6,c.entry,expected);
  check(c,'following Headbutt step retains independent halfgravity owner',Math.abs(c.next.velocity.y-c.entry.velocity.y-gravity*.5)<1e-6,c.next.velocity.y-c.entry.velocity.y,gravity*.5);
  check(c,'Headbutt owns vertical energy and clears old opening',c.entry.vertical.nextOpeningStep===null,c.entry.vertical);
 });
 await run('neutral-air-dodge-excess-fall-relaxation',async c=>{
  await page.evaluate(()=>window.__dkVertical.reset(1));c.before=await page.evaluate(()=>window.__dkVertical.air({vy:13.04}));await down('h');c.entry=await step();await up('h');c.next=await step();
  check(c,'physical neutral air dodge uses source.075 excessbrake without extra gravity',c.entry.dodge.active?.kind==='air'&&!c.entry.dodge.active.directional&&Math.abs(c.entry.velocity.y-(13.04-.075))<1e-6,c.entry,12.965);
  check(c,'second actual dodge step continues excessbrake',Math.abs(c.next.velocity.y-(13.04-2*.075))<1e-6,c.next.velocity.y,12.89);
 });
 await run('full-opening-solid-ceiling',async c=>{
  await takeoff(c);await up('w');c.ceiling=await page.evaluate(()=>window.__dkVertical.addCeiling());c.trace=[];for(let i=0;i<6;i++)c.trace.push(await step());
  const contactIndex=c.trace.findIndex(o=>o.contacts.some(p=>p.id===c.ceiling.id&&p.active!==false));
  check(c,'actual Matter solid ceiling contact occurs during prescribed opening',contactIndex>=0&&contactIndex<3,c.trace.map(o=>o.contacts),c.ceiling.id);
  if(contactIndex>=0){const contact=c.trace[contactIndex];check(c,'blocking ceiling retires remaining prescribed upward opening',contact.vertical.nextOpeningStep===null,contact.vertical);check(c,'later steps cannot re-prescribe old opening',c.trace.slice(contactIndex+1).every(o=>o.vertical.nextOpeningStep===null&&o.velocity.y>=0),c.trace.slice(contactIndex+1));}
 });
 await run('full-opening-hitlag-resume',async c=>{
  await takeoff(c);await up('w');c.before=await page.evaluate(()=>window.__dkVertical.read());await page.evaluate(()=>window.__dkVertical.freeze(3));c.freeze=[];for(let i=0;i<3;i++)c.freeze.push(await step());c.resumed=await step();
  check(c,'three frozen steps preserve actual root and opening age',c.freeze.every(o=>o.position.y===c.before.position.y&&o.vertical.nextOpeningStep===c.before.vertical.nextOpeningStep),c.freeze,c.before);
  check(c,'next unfrozen step consumes exactly next opening cell',c.resumed.vertical.nextOpeningStep===c.before.vertical.nextOpeningStep+1,c.resumed.vertical,c.before.vertical.nextOpeningStep+1);
 });
 for(const action of ['aerial','dodge','special'])await run(`full-opening-${action}-ownership`,async c=>{
  await takeoff(c);if(action==='dodge')await up('w');await down(action==='aerial'?'f':action==='dodge'?'h':'g');c.entry=await step();await release();c.trace=[c.entry];for(let i=0;i<65;i++)c.trace.push(await step());
  if(action==='aerial'){
   check(c,'physical held up plus fresh F chooses ordinary up aerial after takeoff',c.entry.attack?.id==='donkeykong.uair',c.entry.attack);
   check(c,'ordinary aerial retains current calibrated jump energy',c.entry.vertical.nextOpeningStep===2,c.entry.vertical);
  }else{
   check(c,'physical replacement energy owner retires opening',c.entry.vertical.nextOpeningStep===null,c.entry.vertical);
   check(c,'old opening never resumes after replacement recovery',c.trace.every(o=>o.vertical.nextOpeningStep===null),c.trace.map(o=>o.vertical.nextOpeningStep));
  }
 });
 for(const facing of [1,-1])for(const mode of ['full','mini','phantom'])await run(`footstool-${mode}-${facing}`,async c=>{
  c.before=await page.evaluate(spec=>window.__dkVertical.footPlace(spec),{facing,phantom:mode==='phantom'});await down('w');c.entry=await step();
  if(mode!=='full')await up('w');c.next=await step();
  const basis=14.305555555555552;
  check(c,'physical fresh W commits performer with separate beta basis and sourced1.3',c.entry.body.footstoolPerformer!==null&&Math.abs(c.entry.velocity.y-(-basis*1.3+gravity))<1e-6,c.entry,-basis*1.3+gravity);
  check(c,'footstool preserves ordinary jump resources',c.entry.jumpsUsed===c.before.jumpsUsed,c.entry.jumpsUsed,c.before.jumpsUsed);
  check(c,'performer commit consumes independent8step cooldown and repeat counter',c.entry.vertical.footstool.cooldownRemaining===8&&c.entry.vertical.footstool.repeatCount===1,c.entry.vertical.footstool);
  if(mode==='mini')check(c,'physical early release selects source.7 without newfullhop opening',c.next.body.footstoolPerformer?.mini===true&&Math.abs(c.next.velocity.y-(-basis*.7+gravity))<1e-6&&c.next.vertical.nextOpeningStep===null,c.next,-basis*.7+gravity);
  else if(mode==='phantom')check(c,'phantom retains recipient attack and does not selectmini',c.entry.recipient===null&&c.next.body.footstoolPerformer?.mini===false,c.next);
  else check(c,'airrecipient uses distinct public receiving status',c.entry.recipient?.grounded===false,c.entry.recipient);
 });
 await run('footstool-repeat-cooldown-freeze',async c=>{
  await page.evaluate(()=>window.__dkVertical.footPlace());await down('w');c.entry=await step();await step(3);await up('w');c.before=await page.evaluate(()=>window.__dkVertical.read());
  await page.evaluate(()=>window.__dkVertical.freeze(3));c.freeze=[];for(let i=0;i<3;i++)c.freeze.push(await step());
  check(c,'actual hitlag freezes performer repeat and cooldown',c.freeze.every(o=>o.vertical.footstool.cooldownRemaining===c.before.vertical.footstool.cooldownRemaining&&o.vertical.footstool.repeatCount===1),c.freeze.map(o=>o.vertical.footstool),c.before.vertical.footstool);
  await step(25);c.placed=await page.evaluate(()=>window.__dkVertical.footPlace({keepPerformer:true}));await down('w');c.repeated=await step();
  const expected=-14.305555555555552*1.3*.75+gravity;
  check(c,'second physical footstool in same flight consumes.75velocity reduction',c.repeated.vertical.footstool.repeatCount===2&&Math.abs(c.repeated.velocity.y-expected)<1e-6,c.repeated,expected);
  check(c,'second commit renews independent8step cooldown',c.repeated.vertical.footstool.cooldownRemaining===8,c.repeated.vertical.footstool);
  c.fixture='Second target reset and head-relative performer reposition retain performer airborne repeat count; this proves selected consumer, not natural spacing/feel.';
 });
 await run('opening-round-reset',async c=>{await takeoff(c);await release();c.after=await page.evaluate(()=>window.__dkVertical.reset(-1));check(c,'actual round reset clears opening and ordinaryphase flags',c.after.vertical.nextOpeningStep===null&&c.after.jump===null&&c.after.jumpsUsed===0,c.after);});
 report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.result=report.failedChecks.length||report.errors.length?'FAIL':'PASS_ORDINARY_VERTICAL_CONSUMER_SCOPE';if(report.result==='FAIL')process.exitCode=1;
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failed:report.failedChecks},null,2));
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
