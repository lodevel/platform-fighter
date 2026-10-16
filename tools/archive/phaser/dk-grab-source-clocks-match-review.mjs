/** Prepared bounded clock review. Launch only in a coordinator-granted window.
 * Real keyboard -> MatchScene -> Matter CATCH; never install grab state or call
 * resolveGrabConnect to make a fixture pass. Missing grab/recipient art remains
 * missing. Native common status/constraint parity is outside this review. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const hash=b=>createHash('sha256').update(b).digest('hex');
const root='docs/review/2026-09-25/donkeykong-character';
const mechanics=`${root}/completion-2026-10-08/mechanics`;
const sourcePlanPath=`${mechanics}/grab-throw-next-batch-source-plan.json`;
const sourcePlanSha='df1f58d4a41bfe67e7e9bceaa78550a19bde033ccfe89218a44d1fda58c4c424';
const prefix=process.env.PF_FROZEN_SOURCE_DIR;
const expectedBundle=process.env.PF_EXPECT_BUNDLE_SHA;
const url=process.env.PF_REWORK_URL??'http://127.0.0.1:4196/platform-fighter/';
const base=process.env.PF_GRAB_CLOCK_OUT??`${root}/audit-2026-10-08/runtime/grab-source-clocks`;
let out=base;for(let n=2;;n++){try{await mkdir(out,{recursive:false});break;}catch(e){if(e.code!=='EEXIST'){await mkdir(out,{recursive:true});break;}out=`${base}-attempt${n}`;}}
const filter=process.env.PF_GRAB_CLOCK_CASE_FILTER?new RegExp(process.env.PF_GRAB_CLOCK_CASE_FILTER):null;
const report={url,out,frozenSourcePrefix:prefix,scope:'Bounded DK release/pummel/cargo-entry clocks with actual keyboard and physical capture. Art/recipient attachment and native common status/rates are unqualified; injected public reset/hitlag/external-hit/landing fixtures are individually labeled. No grab state injection or resolver override.',cases:[],errors:[],failedResponses:[],sourcePins:[],limits:['Selected sample1=age0 and cancelFrame-1 adapters, not recovered native callback order.','Pummel selected freeze15 and cooldown21 are separate; count actual frozen callbacks instead of equating body7+15 with wall-clock21.','Pummel source clearAge2 is a pinned raw ATTACK-clear fact. Runtime scalar one-shot damage has no persistent ATTACK sensor; observing bodyage2 is not native clear-consumer proof.','Standing ground capture only; dash/pivot/air capture art and all per-pose recipient anchors are outside this tool.','Two-participant capture-revision reset proves stale source-clock cleanup, not arbitrary multi-target native status selection.']};
let browser,page,standingActiveAges=[7,8,9];
const held=new Set();
const down=async key=>{await page.keyboard.down(key);held.add(key);};
const up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{if(page)for(const key of [...held])await up(key);};
const read=()=>page.evaluate(()=>window.__dkGrabClocks.read());
const step=(n=1)=>page.evaluate(n=>window.__dkGrabClocks.step(n),n);
const check=(c,label,pass,actual,expected)=>c.checks.push({label,pass,actual,expected});
const observed=()=>page.evaluate(()=>window.__dkGrabClocks.observations());
async function run(name,recipient,facing,body){
 if(filter&&!filter.test(name))return;
 const c={name,recipient,facing,checks:[],samples:[]};report.cases.push(c);
 try{await release();await install(recipient);c.settled=await page.evaluate(f=>window.__dkGrabClocks.reset(f),facing);
  check(c,'settled real grounded pair',c.settled.p1.grounded&&c.settled.p2.grounded,c.settled,{grounded:true});
  await body(c);
 }catch(e){c.error=e.stack;check(c,'fixture and case completed',false,e.message);}
 finally{if(page){c.events=await observed();c.screenshot=`${c.name}.png`;await page.screenshot({path:`${out}/${c.screenshot}`});}}
}
async function install(recipient){
 await page.evaluate(recipient=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:813061,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:recipient,paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  if(!floor)throw new Error('Physical solid floor unavailable');
  for(const body of s.baseStage.bodies.platformBodies)if(body!==floor){body.collisionFilter.mask=0;s.matter.world.remove(body);}
  const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
  const ledger=[],keyboardEvents=[];let captureConnections=0;
  const sprite=f=>{const sp=s.playerSlots.find(slot=>slot.character===f||slot.player===f)?.sprite??s.playerSlots[f===s.p1?0:1]?.sprite;return sp?{key:sp.texture.key,frame:Number(sp.frame.name),x:sp.x,y:sp.y,flipX:sp.flipX}:null;};
  const fighter=f=>({id:f.id,bodyId:f.body.id,position:f.getPosition(),velocity:f.getVelocity(),grounded:f.isGrounded(),facing:f.getFacing(),percent:f.getDamagePercent(),freeze:f.getHitlagRemaining(),hitstun:f.getHitstunRemaining(),captured:f.isGrabbed(),capture:copy(f.getCapturePresentationState()),grab:copy(f.getGrabState()),grabPresentation:copy(f.getGrabPresentationState()),throw:copy(f.getThrowPresentationState()),body:copy(f.getPackedBodyState()),receiving:copy(f.getActiveHurtboxes()),canAttack:f.canAttack(),jumpsquat:f.getJumpsquatRemaining(),sprite:sprite(f)});
  const read=()=>({frame:s.physicsEngine.getFrame(),floorY:floor.bounds.min.y,p1:fighter(s.p1),p2:fighter(s.p2)});
  for(const [slot,f] of [[1,s.p1],[2,s.p2]]){
   for(const method of ['applyHit','addDamage','releaseFromGrab','armAttackerHitlag']){
    const original=f[method];f[method]=function(...args){const before=fighter(this),result=original.apply(this,args);ledger.push({kind:method,slot,frame:s.physicsEngine.getFrame(),args:copy(args),before,after:fighter(this)});return result;};
   }
   const original=f.applyInput;f.applyInput=function(...args){const before=fighter(this),result=original.apply(this,args);ledger.push({kind:'input',slot,frame:s.physicsEngine.getFrame(),input:copy(args[0]),before,after:fighter(this)});return result;};
  }
  const original=s.p1.resolveGrabConnect;s.p1.resolveGrabConnect=function(target){captureConnections++;ledger.push({kind:'physical-catch-callback',frame:s.physicsEngine.getFrame(),targetBodyId:target.body.id,targetGrounded:target.isGrounded(),sourceClock:copy(this.getGrabPresentationState())});return original.call(this,target);};
  const handler=e=>keyboardEvents.push({type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,location:e.location});
  if(window.__dkGrabClockKeyboardHandler){for(const type of ['keydown','keyup'])document.removeEventListener(type,window.__dkGrabClockKeyboardHandler,true);}
  window.__dkGrabClockKeyboardHandler=handler;for(const type of ['keydown','keyup'])document.addEventListener(type,handler,true);
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const reset=facing=>{s.p1.resetForRound(floor.position.x-100,floor.bounds.min.y-s.p1.getTuning().height/2);s.p2.resetForRound(floor.position.x-100+70*facing,floor.bounds.min.y-s.p2.getTuning().height/2);s.p1.setInvincibility(0);s.p2.setInvincibility(0);step(12);s.p1.setFacing(facing);s.p2.setFacing(-facing);ledger.length=0;keyboardEvents.length=0;captureConnections=0;return read();};
  const observations=()=>copy({ledger,keyboardEvents,captureConnections});
  const inputDiagnostic=()=>({binding:s.registry.get('inputBindingsStore').getAction(s.playerSlots[0].bindingsSlot,'grab'),action:copy(s.inputResolver.getAction(s.playerSlots[0].bindingsSlot,'grab')),move:copy(s.inputResolver.getMoveVector(s.playerSlots[0].bindingsSlot))});
  window.__dkGrabClocks={s,read,step,reset,observations,inputDiagnostic,freeze:n=>s.p1.armAttackerHitlag(n),resetTarget:()=>s.p2.resetForRound(floor.position.x+450,floor.bounds.min.y-s.p2.getTuning().height/2),resetBoth:()=>{s.p1.resetForRound(floor.position.x-100,floor.bounds.min.y-42);s.p2.resetForRound(floor.position.x+450,floor.bounds.min.y-s.p2.getTuning().height/2);},externalHit:()=>s.p1.applyHit({damage:1,knockback:{x:1,y:-1,scaling:0},facing:-1,hitlagMultiplier:0}),landingFixture:()=>{s.matter.body.setPosition(s.p1.body,{x:s.p1.getPosition().x,y:floor.bounds.min.y-42-1});s.matter.body.setVelocity(s.p1.body,{x:0,y:1});}};
 },recipient);
}
async function physicalCapture(c){
 await down('t');let o=await step();c.grabInput=await page.evaluate(()=>window.__dkGrabClocks.inputDiagnostic());await up('t');
 c.captureTrace=[o];for(let i=0;i<15&&!o.p2.captured;i++){o=await step();c.captureTrace.push(o);}
 const obs=await observed(),contact=obs.ledger.find(e=>e.kind==='physical-catch-callback');
 check(c,'real Matter standing CATCH callback, no forced connection',o.p2.captured&&o.p1.grab.name==='holding'&&obs.captureConnections===1,contact,{sourceActiveAges:standingActiveAges});
 check(c,'physical T traverses unchanged grab binding',obs.keyboardEvents.some(e=>e.type==='keydown'&&e.code==='KeyT'&&e.keyCode===84)&&c.grabInput.binding.some(b=>b.kind==='keyboard'&&b.keyCode===84)&&c.grabInput.action.justPressed,c.grabInput);
 check(c,'primary contact clock in standing source window',contact?.sourceClock?.variant==='standing'&&standingActiveAges.includes(contact.sourceClock.framesElapsed),contact?.sourceClock);
 assert.ok(o.p2.captured,'Physical CATCH failed; never substitute forced state');return o;
}
async function cargoEntry(c){
 await physicalCapture(c);await down(c.facing===1?'d':'a');let o=await step();await release();
 check(c,'normal forward input enters cargo without ABS damage',o.p1.grab.active?.cargo===true&&o.p1.body.cargoEntry?.framesElapsed===0&&o.p2.percent===0,o,{entryAge:0});
 assert.ok(o.p1.grab.active?.cargo);return o;
}
async function directionKeys(direction,facing){
 if(direction==='up')await down('w');else if(direction==='down')await down('s');else await down((direction==='forward')===(facing===1)?'d':'a');
}
function parseGameScript(text){
 const game=text.split(/\nunsafe extern "C" fn (?:effect|sound|expression)_/)[0];
 let nativeFrame=0;const releases=[];
 for(const m of game.matchAll(/(?:\b(frame|wait)\(agent\.lua_state_agent,\s*([\d.]+)\))|(macros::ATK_HIT_ABS\(agent,\s*\*FIGHTER_ATTACK_ABSOLUTE_KIND_THROW)/g)){
  if(m[1])nativeFrame=m[1]==='frame'?Number(m[2]):nativeFrame+Number(m[2]);else releases.push(nativeFrame);
 }
 const damage=Number(game.match(/macros::ATTACK_ABS\(agent,\s*\*FIGHTER_ATTACK_ABSOLUTE_KIND_THROW,\s*0,\s*([\d.]+)/)?.[1]);
 assert.equal(releases.length,1,'One primary THROW release');assert.ok(Number.isFinite(damage));
 return {releaseNative:releases[0],damage,reverses:game.includes('macros::REVERSE_LR(agent)')};
}
try{
 assert.match(expectedBundle??'',/^[a-f0-9]{64}$/,'PF_EXPECT_BUNDLE_SHA mandatory');assert.ok(prefix,'PF_FROZEN_SOURCE_DIR mandatory');
 const planBytes=await readFile(sourcePlanPath);assert.equal(hash(planBytes),sourcePlanSha);const plan=JSON.parse(planBytes);
 report.sourcePlan={path:sourcePlanPath,sha256:hash(planBytes)};
 const pin=async(path,sha)=>{const bytes=await readFile(path);assert.equal(hash(bytes),sha,`Primary pin ${path}`);if(!report.sourcePins.some(p=>p.path===path))report.sourcePins.push({path,sha256:hash(bytes)});return bytes;};
 const standing=plan.rows.find(r=>r.id==='donkeykong.grab-standing');
 const catchScript=(await pin(standing.scripts[0].source.path,standing.scripts[0].source.sha256)).toString();
 assert.ok(catchScript.includes('frame(agent.lua_state_agent, 8.0)')&&catchScript.includes('wait(agent.lua_state_agent, 3.0)')&&catchScript.includes('MA_MSC_CMD_GRAB_CLEAR_ALL'));
 const catchStart=standing.scripts[0].events.find(e=>e.kind==='catch-create').nativeFrame-1,catchEnd=standing.scripts[0].events.find(e=>e.kind==='catch-clear').nativeFrame-1;
 standingActiveAges=Array.from({length:catchEnd-catchStart},(_,i)=>catchStart+i);
 report.standingCaptureSource={source:standing.scripts[0].source,activeAges:standingActiveAges};
 const branches=[];
 for(const row of plan.rows.filter(r=>r.clocks?.native_release_frame!==undefined)){
  const source=row.scripts.find(s=>s.events.some(e=>e.kind.includes('release')))?.source??row.scripts[0].source;
  const parsed=parseGameScript((await pin(source.path,source.sha256)).toString());
  await pin(row.native_motion.yaml_source.path,row.native_motion.yaml_source.sha256);
  const total=row.native_motion.record.extra.cancel_frame-1;
  assert.equal(parsed.releaseNative,row.clocks.native_release_frame);assert.equal(total,row.clocks.selected_commitment_steps);
  const cargo=row.id.includes('.cargo-'),direction=row.id.includes('back-throw')?'back':row.id.includes('up-throw')?'up':row.id.includes('down-throw')?'down':'forward';
  branches.push({id:row.id,sheet:row.sheet,cargo,air:row.id.endsWith('-air'),direction,...parsed,releaseAge:parsed.releaseNative-1,total,recovery:total-(parsed.releaseNative-1),source});
 }
 assert.equal(branches.length,11);report.expectedBranches=branches;
 const pummel=plan.rows.find(r=>r.id==='donkeykong.pummel'),pummelSource=pummel.scripts[0].source,pummelText=(await pin(pummelSource.path,pummelSource.sha256)).toString();
 const pummelGame=pummelText.split(/\nunsafe extern "C" fn (?:effect|sound|expression)_/)[0];
 assert.ok(pummelGame.includes('frame(agent.lua_state_agent, 2.0)')&&pummelGame.includes('wait(agent.lua_state_agent, 1.0)')&&pummelGame.includes('AttackModule::clear_all(agent.module_accessor)'));
 const pummelDamage=Number(pummelText.match(/macros::ATTACK\(agent,\s*0,\s*0,\s*Hash40::new\("top"\),\s*([\d.]+)/)?.[1]);assert.equal(pummelDamage,1.6);
 const pummelEnd=pummel.native_motion.record.extra.cancel_frame-1;assert.equal(pummelEnd,7);
 assert.equal(pummel.clocks.selected_hitlag_steps,15);assert.equal(pummel.clocks.selected_repeat_total_steps_including_hitlag,21);
 report.pummelSource={source:pummelSource,damage:pummelDamage,contactAge:1,clearAge:2,end:pummelEnd,selectedFreeze:15,selectedCooldown:21,freezeProvenance:'Selected pinned frame-data/hitlag contract, independently counted public frozen input callbacks; not raw motion duration.'};
 const reconciliationPath=`${mechanics}/grab-pull-hold-native-source-reconciliation.json`,reconciliationBytes=await readFile(reconciliationPath);
 assert.equal(hash(reconciliationBytes),'6535f7d4895aeb39fcf96bc08fb5924bdbaeb5bb2ea420c43e2d5c8bf295058e');
 const reconciliation=JSON.parse(reconciliationBytes),tail=reconciliation.forwardEntryTailAddendum;
 for(const source of reconciliation.nativeConsumers)await pin(source.path,source.sha256);
 for(const resource of tail.sourceNativeMotion.resources)await pin(resource.path,resource.sha256);
 const cargoEnd=tail.sourceNativeMotion.resources[0].source_sample_1_through_final_extent;assert.equal(cargoEnd,24);
 assert.deepEqual(tail.additionalRequiredDrawingAges,[16,20,23]);
 report.cargoSource={path:reconciliationPath,sha256:hash(reconciliationBytes),tailSamples:tail.correspondingNativeSamples,tailAges:tail.additionalRequiredDrawingAges,resourceEntryEnd:cargoEnd,selectedEligibility:16,selectedFreshThrow:17,nativeTransitionLimit:'Request16/age15 versus status consumption step remains an explicit adapter.'};
 for(const name of ['Character.ts','DonkeyKong.ts','grabSchema.ts','grabState.ts','characterSerializer.ts','packedBodyPresentation.ts','donkeykongBodyProfile.ts']){
  const path=`${prefix}/src/characters/${name}`,bytes=await readFile(path);report.sourcePins.push({path,sha256:hash(bytes),role:'Frozen built consumer identity, never expected timing source'});
  if(name==='DonkeyKong.ts')assert.match(bytes.toString(),/throwClock:\s*'native-sample-one'/);
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);assert.ok(report.bundle);report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());assert.equal(report.bundleSha256,expectedBundle);
 for(const facing of [1,-1]){
  for(const branch of branches)for(const recipient of branch.cargo?['pikachu']:['pikachu','donkeykong']){
   await run(`abs-${branch.id}-${recipient}-${facing}`,recipient,facing,async c=>{
    if(branch.cargo){await cargoEntry(c);await step(24);}else await physicalCapture(c);
    if(branch.air){await down('w');let o=await step();await up('w');for(let i=0;i<8&&o.p1.grounded;i++)o=await step();check(c,'cargo air entry follows actual fresh ground jump',!o.p1.grounded,o.p1);assert.ok(!o.p1.grounded);}
    await directionKeys(branch.direction,facing);if(branch.cargo)await down('f');let o=await step();await release();
    check(c,'actual throw input enters source age0 and latches branch',o.p1.throw?.framesElapsed===0&&o.p1.throw.direction===branch.direction&&Boolean(o.p1.throw.cargo)===branch.cargo&&Boolean(o.p1.throw.airborne)===branch.air,o.p1.throw,branch);
    assert.equal(o.p1.throw?.framesElapsed,0);c.samples.push(o);
    if(branch.air){c.landingFixture={kind:'Matter root/velocity placement after genuinely airborne throw entry; no grab/throw state mutation',age:0};await page.evaluate(()=>window.__dkGrabClocks.landingFixture());}
    for(let age=1;age<=branch.total+2;age++){o=await step();c.samples.push(o);}
    const before=c.samples[branch.releaseAge-1],at=c.samples[branch.releaseAge],last=c.samples[branch.total-1],free=c.samples[branch.total];
    check(c,'held without ABS damage immediately before source release',before.p2.captured&&before.p2.percent===0,before.p2,{captured:true,percent:0});
    check(c,'source N-1 releases/damages once',!at.p2.captured&&at.p2.percent===branch.damage&&at.p1.throw?.phase==='recovery'&&at.p1.throw.framesElapsed===branch.releaseAge,at,{age:branch.releaseAge,damage:branch.damage});
    check(c,'R+1 preserves last recovery and total exit',at.p1.grab.cooldownRemaining===branch.recovery&&last.p1.throw?.framesElapsed===branch.total-1&&last.p1.grab.name==='cooldown'&&free.p1.grab.name==='idle'&&free.p1.throw===null,{at:at.p1.grab,last:last.p1,free:free.p1},{recovery:branch.recovery,total:branch.total});
    const events=await observed(),hits=events.ledger.filter(e=>e.kind==='applyHit'&&e.slot===2),releases=events.ledger.filter(e=>e.kind==='releaseFromGrab'&&e.slot===2&&e.args[0]==='throw');
    check(c,'one exact target ABS dispatch/detach, no recovery damage',hits.length===1&&hits[0].args[0].damage===branch.damage&&releases.length===1&&c.samples.slice(branch.releaseAge).every(s=>s.p2.percent===branch.damage),{hits,releases});
    check(c,'entry-facing release and retained branch through recovery',c.samples.slice(branch.releaseAge,branch.total).every(s=>s.p1.throw?.facing===facing&&Boolean(s.p1.throw.cargo)===branch.cargo&&Boolean(s.p1.throw.airborne)===branch.air)&&at.p1.facing===(branch.reverses?-facing:facing),at.p1,{entryFacing:facing,actorFacing:branch.reverses?-facing:facing,cargo:branch.cargo,air:branch.air});
    if(branch.reverses)check(c,'back launch uses original backward basis',hits[0]?.args[0]?.facing===-facing,hits[0]?.args[0]);
    if(branch.air)check(c,'actual landing cannot rewrite latched airborne recovery',c.samples.slice(1,branch.total).some(s=>s.p1.grounded)&&c.samples.slice(1,branch.total).every(s=>s.p1.throw?.airborne===true),c.samples.map(s=>({ground:s.p1.grounded,air:s.p1.throw?.airborne})));
   });
  }
  for(const recipient of ['pikachu','donkeykong'])await run(`pummel-held-${recipient}-${facing}`,recipient,facing,async c=>{
   await physicalCapture(c);await down('f');let o=await step();c.samples.push(o);
   check(c,'fresh physical F accepted only at bodyage0',o.p1.body.pummel?.framesElapsed===0&&o.p2.percent===0,o,{age:0});
   o=await step();c.samples.push(o);check(c,'primary contact1 adds damage once and arms both15',o.p1.body.pummel?.framesElapsed===1&&o.p2.percent===pummelDamage,o,{contactAge:1,damage:pummelDamage});
   const frozen=[];for(let i=0;i<15;i++){o=await step();frozen.push(o);c.samples.push(o);}
   check(c,'15 subsequent captor frozen callbacks retain exact body/receiving',frozen.every(s=>s.p1.body.pummel?.framesElapsed===1&&JSON.stringify(s.p1.receiving)===JSON.stringify(c.samples[1].p1.receiving)),frozen.map(s=>({age:s.p1.body.pummel?.framesElapsed,freeze:s.p1.freeze})));
   for(let i=0;i<10;i++){o=await step();c.samples.push(o);}
   const obs=await observed();for(const slot of [1,2])check(c,`slot${slot} actual15 frozen input callbacks`,obs.ledger.filter(e=>e.kind==='input'&&e.slot===slot&&e.before.freeze>0).length===15,obs.ledger.filter(e=>e.kind==='input'&&e.slot===slot&&e.before.freeze>0).map(e=>({before:e.before.freeze,after:e.after.freeze})),15);
   check(c,'independent source body age2, last6 and heldreturn7',c.samples.some(s=>s.p1.body.pummel?.framesElapsed===2)&&c.samples.some(s=>s.p1.body.pummel?.framesElapsed===6)&&c.samples.some(s=>s.p1.body.heldAfterPummel?.framesElapsed===0&&s.p1.body.pummel===null),c.samples.map(s=>s.p1.body));
   check(c,'held F never repeats or resets accepted event',o.p2.percent===pummelDamage&&o.p1.body.pummel===null&&obs.ledger.filter(e=>e.kind==='addDamage'&&e.slot===2&&e.args[1]==='pummel').length===1,o);
   check(c,'both hitlag arms independently carry selected15',obs.ledger.filter(e=>e.kind==='armAttackerHitlag'&&e.args[0]===15).length===2,obs.ledger.filter(e=>e.kind==='armAttackerHitlag'));
   await release();
  });
  await run(`pummel-cooldown1-fresh-pikachu-${facing}`,'pikachu',facing,async c=>{
   await physicalCapture(c);await down('f');await step();await up('f');let o=await step();
   for(let i=0;i<35&&!(o.p1.freeze===0&&o.p1.body.pummel?.framesElapsed===6&&o.p1.grab.active?.pummelCooldownRemaining===1);i++)o=await step();
   c.before=o;assert.equal(o.p1.grab.active?.pummelCooldownRemaining,1);assert.equal(o.p1.body.pummel?.framesElapsed,6);
   await down('f');c.accepted=await step();await up('f');c.contact=await step();
   check(c,'fresh edge at cooldown1 accepts body0 rather than ghost timer',c.accepted.p1.body.pummel?.framesElapsed===0&&c.accepted.p2.percent===pummelDamage,c.accepted);
   check(c,'second accepted contact damages exactly once atage1',c.contact.p1.body.pummel?.framesElapsed===1&&Math.abs(c.contact.p2.percent-pummelDamage*2)<1e-9,c.contact,{damage:pummelDamage*2});
  });
  await run(`cargo-neutral-tail-pikachu-${facing}`,'pikachu',facing,async c=>{
   let o=await cargoEntry(c);c.samples.push(o);for(let age=1;age<=24;age++){o=await step();c.samples.push(o);}
   for(const age of [16,20,23])check(c,`inherited throw_f tail sourceage${age}`,c.samples[age].p1.body.cargoEntry?.framesElapsed===age&&c.samples[age].p1.grab.active?.cargo===true,c.samples[age].p1,{age,native:age+1});
   check(c,'eligibility16 and bodyend24 distinct',c.samples[16].p1.grab.active?.cargoStartupRemaining===0&&c.samples[16].p1.body.cargoEntry!==null&&o.p1.body.cargoEntry===null&&o.p1.body.heldAfterPummel?.framesElapsed===0&&o.p2.captured,o.p1,{holdEntryAge:24});
  });
  for(const edge of [16,17])await run(`cargo-fresh-throw-edge${edge}-pikachu-${facing}`,'pikachu',facing,async c=>{
   await cargoEntry(c);await step(edge-1);c.before=await read();await down('f');c.edge=await step();await up('f');
   check(c,`independent fresh edge${edge} ${edge===16?'rejects':'accepts'} throw`,edge===16?c.edge.p1.grab.name==='holding'&&c.edge.p1.throw===null:c.edge.p1.grab.name==='throwing'&&c.edge.p1.throw?.framesElapsed===0,c.edge.p1,{edge});
   if(edge===16){c.neutral=await step();check(c,'rejected edge16 does not synthesize later throw',c.neutral.p1.throw===null,c.neutral.p1);}
   else check(c,'first fresh17 supersedes retained entry drawing',c.edge.p1.body.cargoEntry===null,c.edge.p1.body);
  });
  for(const event of ['freeze','reset','target-revision','capture-break'])await run(`pummel-${event}-pikachu-${facing}`,'pikachu',facing,async c=>{
   await physicalCapture(c);await down('f');c.entry=await step();await up('f');assert.equal(c.entry.p1.body.pummel?.framesElapsed,0);
   if(event==='freeze'){await page.evaluate(()=>window.__dkGrabClocks.freeze(4));for(let i=0;i<4;i++)c.samples.push(await step());c.after=await step();check(c,'public hitlag4 holds windup then contact1 occurs once',c.samples.every(s=>s.p1.body.pummel?.framesElapsed===0&&s.p2.percent===0)&&c.after.p1.body.pummel?.framesElapsed===1&&c.after.p2.percent===pummelDamage,{samples:c.samples,after:c.after});}
   else{c.interruptionFixture={kind:event==='capture-break'?'public incoming applyHit, no source/grab state override':event==='target-revision'?'public recipient resetForRound invalidates capture revision':'public both resetForRound'};await page.evaluate(event=>{const t=window.__dkGrabClocks;if(event==='capture-break')t.externalHit();else if(event==='target-revision')t.resetTarget();else t.resetBoth();},event);for(let i=0;i<5;i++)c.samples.push(await step());check(c,'invalidated source windup never damages or resumes',c.samples.every(s=>s.p1.body.pummel===null&&s.p2.percent===0),c.samples);}
  });
 }
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));
 report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);
 assert.ok(report.cases.length,'Filter selected no cases');
 report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS_BOUNDED_CLOCK_SCOPE';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failed:report.failedChecks}));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser?.close();}
