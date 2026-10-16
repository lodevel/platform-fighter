import {MATCH_URL,openMatchHost,launchMatch} from './browser-match-host.mjs';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const selectedCases=process.env.PF_PROBE_CASES?.split(',');
const out=process.env.PF_PROBE_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/mechanics';
const url=MATCH_URL;
await mkdir(out,{recursive:true});
const report={url,scope:'Real Three.js MatchSim host and fixed Matter physics. Explicit controlled contact fixtures call its existing combat resolver, so these prove consumer/state transport rather than attack sensor contact coverage. Baseline art is not visually accepted. No hardware-feel or native 3D parity claim.',errors:[],cases:[],pending:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 const bundle=await openMatchHost(page,url);report.bundle=bundle;report.bundleSha256=createHash('sha256').update(await(await page.request.get(bundle)).body()).digest('hex');
 const setup=async()=>{await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:8160108,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]});
 await page.evaluate(()=>{
  const s=window.__sim.match;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),y=floor.bounds.min.y;
  const input={1:{},2:{}};
  s.inputResolver.getMoveVector=p=>({x:input[p]?.moveX??0,y:input[p]?.moveY??0});s.inputResolver.isActionHeld=(p,k)=>input[p]?.[k]===true;
  const read=f=>({position:f.getPosition(),velocity:f.getVelocity(),grounded:f.isGrounded(),matterFriction:f.body.friction,authoredGroundFriction:f.sourcedGroundFrictionBackup??f.body.friction,facing:f.getFacing(),percent:f.getDamagePercent(),freeze:f.getHitlagRemaining(),hitstun:f.getHitstunRemaining(),buried:f.getBuriedPresentationState(),burialBudget:f.buriedState?{phase:f.buriedState.phase,initialFrames:f.buriedState.initialFrames,remaining:f.buriedState.initialFrames-f.buriedState.age-f.buriedState.mash.reduction,age:f.buriedState.age,escapeRemaining:f.buriedState.escapeRemaining,storedLaunch:!!f.buriedState.storedLaunch}:null,
    grab:JSON.parse(JSON.stringify(f.getGrabState())),captured:f.isGrabbed(),attack:f.getActiveAttack()?{id:f.getActiveAttack().move.id,age:f.getActiveAttack().framesElapsed,variant:f.getActiveAttack().move.sheetVariant}:null,shield:f.getShieldState(),sourcedPush:f.sourcedShieldPush?{...f.sourcedShieldPush}:null,receiving:f.getActiveHurtboxes().map(h=>({region:h.region??null,intangible:!!h.intangible,id:h.id}))});
  const observation={};const original=s.p2.applyHitDetailed.bind(s.p2);s.p2.applyHitDetailed=h=>{const result=original(h);observation.hit={...h};observation.result=JSON.parse(JSON.stringify(result));return result;};
  const tick=(p1={},p2={})=>{input[1]=p1;input[2]=p2;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();return{frame:s.physicsEngine.getFrame(),p1:read(s.p1),p2:read(s.p2)};};
  const reset=(distance=400)=>{input[1]={};input[2]={};s.p1.resetForRound(floor.position.x-distance/2,y-s.p1.getTuning().height/2);s.p2.resetForRound(floor.position.x+distance/2,y-s.p2.getTuning().height/2);s.p1.setFacing(1);s.p2.setFacing(-1);s.p1.setDamagePercent(0);s.p2.setDamagePercent(0);s.p1.setInvincibility(0);s.p2.setInvincibility(0);for(let i=0;i<12;i++)tick();return{p1:read(s.p1),p2:read(s.p2)};};
  const contact=(hit,kind='hit',moveId='donkeykong.side_special')=>{observation.hit=null;observation.result=null;const result=s.resolveCombatHit(1,hit,{kind,attackerOwnerId:'donkeykong',attackerPlayerIndex:s.playerSlots[0].playerIndex,moveId,projectile:false});return{resolver:result,effectiveHit:observation.hit,result:observation.result,p1:read(s.p1),p2:read(s.p2)};};
  window.__dkMechanics={s,input,y,floor,read,tick,reset,contact};
 });};
 const run=async(name,fn,args={})=>{if(selectedCases&&!selectedCases.includes(name))return null;await setup();const data=await page.evaluate(fn,args);report.cases.push({name,...data});await page.screenshot({path:`${out}/${name}.png`});return data;};
 const bury=(rank)=>({rank});
 for(const rank of[-2,-1,0,1,2])await run(`bury-rank-${rank}`,({rank})=>{
  const t=window.__dkMechanics,{s}=t;t.reset();const a=s.playerSlots[0].playerIndex,b=s.playerSlots[1].playerIndex;s.stockTracker.setStocks(a,5+Math.min(rank,0));s.stockTracker.setStocks(b,5-Math.max(rank,0));
  const hit={damage:1,hitlagMultiplier:0,statusEffect:'bury',facing:1,knockback:{x:0,y:-1,scaling:0,reference:{base:40,growth:0,angle:270}}};const received=t.contact(hit);
  // Published equation, independently hardcoded from wiki; not imported runtime helper.
  const h=rank<0?(-rank===1?.25:.375):0,r=rank>0?(rank===1?1.5:1.8):0,expected=Math.ceil(10+30*h+15*(3-r)+.5*received.p2.percent+1.5*40);
  const trace=[];for(let i=0;i<expected+15;i++){const row=t.tick();trace.push(row);if(!row.p2.buried)break;}
  const escape=trace.find(r=>r.p2.buried?.phase==='escaping');return{expected,received,trace,checks:[{label:'actual MatchScene stock difference transported',pass:received.effectiveHit.attackerMinusVictimStocks===rank},{label:'grounded attributed contact buries',pass:received.p2.buried?.phase==='buried'},{label:'independently expected initial source duration',pass:received.p2.burialBudget.initialFrames===expected},{label:'first escaping step equals independently expected duration',actual:trace.findIndex(r=>r.p2.buried?.phase==='escaping')+1,expected,pass:trace.findIndex(r=>r.p2.buried?.phase==='escaping')+1===expected&&escape?.p2.buried.framesElapsed===0&&escape.p2.burialBudget.escapeRemaining===12},{label:'recipient eventually free',pass:trace.at(-1)?.p2.buried===null}]};
 },bury(rank));
 await run('bury-freeze-mash-strong',()=>{
  const t=window.__dkMechanics,{s}=t;t.reset();for(const slot of s.playerSlots)s.stockTracker.setStocks(slot.playerIndex,5);const hit={damage:1,hitlagMultiplier:0,statusEffect:'bury',facing:1,knockback:{x:0,y:-1,scaling:0,reference:{base:40,growth:0,angle:270}}};t.contact(hit);
  const before=t.read(s.p2);s.p2.armAttackerHitlag(5);const frozen=Array.from({length:5},()=>t.tick({}, {attack:true}));const afterFreeze=t.read(s.p2);const mash=[];for(let i=0;i<8;i++)mash.push(t.tick({}, {attack:i%2===0}));
  const strong=t.contact({damage:1,hitlagMultiplier:0,facing:1,knockback:{x:1,y:-1,scaling:0,reference:{base:90,growth:0,angle:45}}},'hit','donkeykong.fixture-strong');const launch=t.tick();
  return{before,frozen,afterFreeze,mash,strong,launch,checks:[{label:'five real hitlag steps freeze burial age',pass:frozen.every(r=>r.p2.buried?.framesElapsed===before.buried.framesElapsed)},{label:'fresh alternating attacks reduce burial',pass:mash.at(-1).p2.burialBudget.remaining<afterFreeze.burialBudget.remaining-8},{label:'native90 KB contact releases immediately',pass:strong.p2.buried===null},{label:'stored strong launch advances after release without artificial freeze',pass:launch.p2.hitstun>0&&launch.p2.velocity.y<0}]};
 });
 await run('cargo-restrictions-budget-break',()=>{
  const t=window.__dkMechanics,{s}=t;t.reset(65);t.tick({grab:true});for(let i=0;i<7;i++)t.tick();if(!s.p2.isGrabbed())s.p1.resolveGrabConnect(s.p2);
  for(let i=0;i<17;i++)t.tick();const spentHold=s.p1.getGrabState().active.framesElapsed,priorMash=s.p1.ultimateCaptureBudget?.mash.reduction??0,capturedPercent=s.p2.getDamagePercent();
  t.tick({moveX:1});for(let i=0;i<16;i++)t.tick();const entry=t.read(s.p1),target=t.read(s.p2),initial=s.p1.ultimateCargoBudget?.initialFrames,expectedCargo=Math.max(0,((90+1.7*capturedPercent)*11/6)-spentHold-priorMash);
  const illegal=[];for(let i=0;i<8;i++)illegal.push(t.tick({special:true,shield:true,dodge:true,appeal:true,attackHeavy:true}));
  const mash=[];for(let i=0;i<40;i++){const row=t.tick({}, {attack:i%2===0});mash.push(row);if(!row.p2.captured)break;}
  return{entry,target,initial,expectedCargo,spentHold,priorMash,capturedPercent,illegal,mash,checks:[{label:'forward entry reaches cargo without percent damage',pass:entry.grab.active?.cargo===true&&target.percent===0},{label:'cargo budget equals independent source equation after17 spent holding steps',pass:Math.abs(initial-expectedCargo)<1e-8&&spentHold>=17},{label:'cargo cannot shield/dodge/special/taunt',pass:illegal.every(r=>r.p1.attack===null&&r.p1.shield.name!=='active'&&r.p1.grab.active?.cargo===true)},{label:'cargo release4 base damage respects items-off1v1 multiplier',expected:4*1.2,pass:mash.at(-1).p2.captured===false&&Math.abs(mash.at(-1).p2.percent-4*1.2)<1e-8}]};
 });
 await run('cargo-back-and-aerial-down-release',()=>{
  const t=window.__dkMechanics,{s}=t;
  const enter=()=>{t.reset(65);t.tick({grab:true});for(let i=0;i<7;i++)t.tick();if(!s.p2.isGrabbed())s.p1.resolveGrabConnect(s.p2);t.tick({moveX:1});for(let i=0;i<16;i++)t.tick();};
  enter();const oldFacing=s.p1.getFacing();const back=[t.tick({attack:true,moveX:-1})];for(let i=0;i<18;i++)back.push(t.tick());const backward=t.read(s.p1);
  enter();s.matter.body.setPosition(s.p1.body,{x:s.p1.getPosition().x,y:t.y-240});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});for(let i=0;i<3;i++)t.tick();const down=[t.tick({attack:true,moveY:1})];for(let i=0;i<19;i++)down.push(t.tick());
  return{oldFacing,back,backward,down,checks:[{label:'cargo back reverses actor after release',pass:backward.facing===-oldFacing},{label:'cargo down latches airborne branch',pass:down.some(r=>r.p1.grab.active?.throwAirborne===true)},{label:'cargo down source upward release boost occurs',pass:down.some(r=>r.p1.velocity.y<-7)}]};
 });
 await run('slap-unlimited-and-spin-steering',()=>{
  const t=window.__dkMechanics,{s}=t;t.reset();const slap=[],rewinds=[];let previous=-1;
  for(let i=0;i<700;i++){const row=t.tick({moveY:1,special:i%2===0});slap.push(row.p1);if(row.p1.attack?.id==='donkeykong.down_special'&&row.p1.attack.age<previous)rewinds.push(i);previous=row.p1.attack?.age??-1;}
  t.reset();const spin=[];for(let i=0;i<72;i++)spin.push(t.tick(i===0?{special:true,moveY:-1}:{moveX:1}).p1);
  const oldFriction=s.p1.sourcedGroundFrictionBackup??s.p1.body.friction;t.reset();s.p1.body.friction=0;const frictionZeroSpin=[];for(let i=0;i<72;i++)frictionZeroSpin.push(t.tick(i===0?{special:true,moveY:-1}:{moveX:1}).p1);t.reset();s.p1.body.friction=oldFriction;
  return{rewinds,slap,spin,diagnostic:{onlyCounterfactual:'actor Matter friction0; source authored profile unchanged',oldFriction,frictionZeroSpin},checks:[{label:'Hand Slap can repeat more than prior arbitrary8 cap',pass:rewinds.length>=9},{label:'ground spin remains grounded with dedicated steering',pass:spin.slice(0,60).every(r=>r.grounded)},{label:'ground spin speed respects sourced5.5 cap',pass:spin.slice(2,60).every(r=>Math.abs(r.velocity.x)<=5.501)},{label:'ground spin gains positive controlled travel',pass:spin.some(r=>r.velocity.x>2)}]};
 });
 await run('shield-push-survive-parry-break',()=>{
  const t=window.__dkMechanics,{s}=t;const hit={damage:3,hitlagMultiplier:0,shieldSetoffMultiplier:.58,facing:1,knockback:{x:1,y:-1,scaling:0}};
  t.reset();t.tick({}, {shield:true});const surviving=t.contact(hit,'hit','donkeykong.fixture-shield'),trace=[];for(let i=0;i<8;i++)trace.push(t.tick({}, {shield:true}));
  const d=surviving.effectiveHit.damage,expectedDef=Math.min(1.3,(d*.8+3)*.09)*.58*5,expectedAtk=(d*.04+.025)*5;
  t.reset();t.tick({}, {shield:true});s.p2.shieldState={...s.p2.shieldState,health:1};const broken=t.contact(hit,'hit','donkeykong.fixture-break');
  t.reset();for(let i=0;i<12;i++)t.tick({}, {shield:true});t.tick();const parry=t.contact(hit,'hit','donkeykong.fixture-parry');
  return{surviving,expectedDef,expectedAtk,trace,broken,parry,checks:[{label:'source0.58 scales defender push rather than stun/percent',pass:Math.abs(surviving.p2.sourcedPush.speed-expectedDef)<1e-8&&surviving.p2.percent===0},{label:'source attacker recoil uses independent damage baseline',pass:Math.abs(surviving.p1.sourcedPush.speed+expectedAtk)<1e-8},{label:'real fixed physics shows decaying defender push',pass:trace.some(r=>r.p2.velocity.x>0)},{label:'shield break has no sourced push energy',pass:broken.p2.shield.name==='broken'&&broken.p1.sourcedPush===null&&broken.p2.sourcedPush===null},{label:'release parry has no sourced ordinary block push',pass:parry.result.outcome==='parried'&&parry.p1.sourcedPush===null&&parry.p2.sourcedPush===null}]};
 });
 await run('ground-spin-traction-restoration',()=>{
  const t=window.__dkMechanics,{s}=t;
  t.reset();const ordinary=s.p1.sourcedGroundFrictionBackup??s.p1.body.friction;t.tick({special:true,moveY:-1});const during=t.read(s.p1);
  s.p1.applyHit({damage:1,hitlagMultiplier:0,facing:-1,knockback:{x:0,y:-1,scaling:0}});const interrupted=t.read(s.p1);
  t.reset();t.tick({special:true,moveY:-1});s.matter.body.setPosition(s.p1.body,{x:s.p1.getPosition().x,y:t.y-300});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});t.tick();t.tick();const airborne=t.read(s.p1);
  t.reset();t.tick({special:true,moveY:-1});s.p1.resetForRound(s.p1.getPosition().x,t.y-s.p1.getTuning().height/2);const respawnReset=t.read(s.p1);
  t.reset();t.tick({special:true,moveY:-1});const end=[];for(let i=0;i<120;i++){const row=t.tick();end.push(row.p1);if(!row.p1.attack)break;}
  return{ordinary,during,interrupted,airborne,respawnReset,end,checks:[
   {label:'sourced ground spin suppresses only duplicate Matter friction',pass:ordinary>0&&during.matterFriction===0},
   {label:'damage interruption restores ordinary friction immediately',pass:interrupted.matterFriction===ordinary},
   {label:'losing grounded support restores ordinary friction',pass:!airborne.grounded&&airborne.matterFriction===ordinary},
   {label:'stock/round reset restores ordinary friction',pass:respawnReset.matterFriction===ordinary},
   {label:'spin completion restores ordinary source traction without changing authored friction',pass:end.at(-1).attack===null&&end.at(-1).authoredGroundFriction===ordinary&&end.at(-1).matterFriction===0}
  ]};
 });
 await run('punch-native-cancel-branches',()=>{
  const t=window.__dkMechanics,{s}=t;
  const snapshot=()=>({charge:s.p1.chargingSpecial?JSON.parse(JSON.stringify(s.p1.chargingSpecial)):null,bank:s.p1.storedSpecialCharge?{...s.p1.storedSpecialCharge}:null,jumpsUsed:s.p1.jumpsUsed,airDodgeUsed:s.p1.airDodgeUsed,jumpsquat:s.p1.getJumpsquatRemaining(),dodge:s.p1.getDodgeState(),body:s.p1.getPackedBodyState(),actor:t.read(s.p1)});
  const wind=(air=false)=>{t.reset();if(air){s.matter.body.setPosition(s.p1.body,{x:s.p1.getPosition().x,y:t.y-500});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});for(let i=0;i<2;i++)t.tick();s.p1.jumpsUsed=1;}t.tick({special:true});for(let i=0;i<11;i++)t.tick();return snapshot();};
  const cancel=(input,n,after={})=>{const trace=[];t.tick(input);trace.push(snapshot());for(let i=1;i<n;i++){t.tick(after);trace.push(snapshot());}return trace;};
  const heldBefore=wind(),held=cancel({shield:true},4,{shield:true});
  const tapBefore=wind(),tap=cancel({shield:true},4);
  const rollBefore=wind(),roll=cancel({moveX:-.75},4);
  const jumpBefore=wind(),jump=cancel({jump:true},4);
  const airJumpBefore=wind(true),airJump=cancel({jump:true},5);
  const exhaustedBefore=wind(true);s.p1.jumpsUsed=s.p1.getTuning().maxJumps;const exhausted=cancel({jump:true},5);
  const dodgeBefore=wind(true),dodge=cancel({shield:true,moveX:.75},4);
  wind(true);t.tick({shield:true});s.matter.body.setPosition(s.p1.body,{x:s.p1.getPosition().x,y:t.y-s.p1.getTuning().height/2});s.matter.body.setVelocity(s.p1.body,{x:0,y:0});t.tick();t.tick();const landing=snapshot();
  const freezeBefore=wind();s.p1.armAttackerHitlag(3);const frozen=[];for(let i=0;i<3;i++){t.tick({special:true});frozen.push(snapshot());}t.tick();const freezeAfter=snapshot();
  wind();s.p1.applyHit({damage:1,hitlagMultiplier:0,facing:-1,knockback:{x:0,y:-1,scaling:0,reference:{base:20,growth:0,angle:45}}});const damaged=snapshot();
  return{heldBefore,held,tapBefore,tap,rollBefore,roll,jumpBefore,jump,airJumpBefore,airJump,exhaustedBefore,exhausted,dodgeBefore,dodge,landing,freezeBefore,frozen,freezeAfter,damaged,checks:[
   {label:'held ground shield begins only after four cancel steps and exact bank survives',pass:held.slice(0,3).every(r=>r.charge?.donkeykongPunch?.state.phase==='cancel'&&r.actor.shield.name!=='active')&&held[3].charge===null&&held[3].actor.shield.name==='active'&&held[3].bank.framesHeld===heldBefore.charge.framesHeld},
   {label:'brief shield tap released during cancel banks into idle',pass:tap[3].charge===null&&tap[3].actor.shield.name==='idle'&&tap[3].bank.framesHeld===tapBefore.charge.framesHeld},
   {label:'opposite-stick roll cancel enters backward dodge after four steps',pass:roll[3].charge===null&&roll[3].dodge.active?.kind==='roll'&&roll[3].dodge.active.backward===true},
   {label:'ground jump cancel starts genuine three-step jumpsquat',pass:jump[3].charge===null&&jump[3].jumpsquat>0&&jump[3].bank.framesHeld===jumpBefore.charge.framesHeld},
   {label:'aerial jump cancel requires five steps and spends remaining jump',pass:airJump.slice(0,4).every(r=>r.charge!==null)&&airJump[4].charge===null&&airJump[4].jumpsUsed===airJumpBefore.jumpsUsed+1&&airJump[4].actor.velocity.y<0},
   {label:'resource-exhausted aerial jump does not cancel winding',pass:exhausted.every(r=>r.charge?.donkeykongPunch?.state.phase==='loop'&&r.jumpsUsed===s.p1.getTuning().maxJumps)},
   {label:'aerial guard cancels into real latched directional dodge after four steps',pass:dodge.slice(0,3).every(r=>r.charge!==null)&&dodge[3].charge===null&&dodge[3].airDodgeUsed&&dodge[3].dodge.active?.kind==='air'&&dodge[3].dodge.active.directional},
   {label:'landing during airborne cancel banks and discards dodge intent',pass:landing.charge===null&&landing.bank!==null&&landing.actor.grounded&&!landing.airDodgeUsed},
   {label:'real hitlag freezes charge and swallows second special press',pass:frozen.every(r=>r.charge?.framesHeld===freezeBefore.charge.framesHeld)&&freezeAfter.actor.attack===null&&freezeAfter.charge!==null},
   {label:'damage interrupts active winding without leaving bank or charge pose',pass:damaged.charge===null&&damaged.bank===null&&damaged.body.punch===null}
  ]};
 });
 await run('indirect-hand-slap-parry',()=>{
  const t=window.__dkMechanics,{s}=t;
  const trial=direct=>{t.reset();for(let i=0;i<12;i++)t.tick({}, {shield:true});t.tick();const hit={damage:14,direct,hitlagMultiplier:1,shieldSetoffMultiplier:.58,facing:1,knockback:{x:1,y:-1,scaling:0}};return t.contact(hit,'hit','donkeykong.down_special');};
  const direct=trial(true),indirect=trial(false),damage=indirect.effectiveHit.damage,base=Math.min(30,Math.floor((damage*.65+6)*.67));
  // Current release-parry rule: ordinary shield stop plus2 indirect victim,
  // plus11 direct victim, plus14 melee attacker in both branches.
  return{direct,indirect,independentExpected:{defender:base+2,attacker:base+14},checks:[
   {label:'indirect source flag is transported while remaining nonprojectile',pass:indirect.effectiveHit.direct===false&&indirect.effectiveHit.shieldKind!=='projectile'},
   {label:'indirect defender parry freeze matches independent pinned equation',pass:indirect.p2.freeze===base+2},
   {label:'indirect attacker receives source nonprojectile parry freeze',pass:indirect.p1.freeze===base+14},
   {label:'direct branch adds9 defender frames and same14 attacker frames',pass:direct.p2.freeze===indirect.p2.freeze+9&&direct.p1.freeze===indirect.p1.freeze}
  ]};
 });
 await run('whole-source-protection-versus-true-invincibility',()=>{
  const t=window.__dkMechanics,{s}=t;
  const hit={damage:3,hitlagMultiplier:1,facing:1,knockback:{x:1,y:-1,scaling:0}};
  t.reset();s.p2.applyTrip();for(let i=0;i<39;i++)t.tick();t.tick({}, {attack:true});const entry=t.read(s.p2),protectedContact=t.contact(hit,'hit','donkeykong.fixture-protection');
  const timeline=[];while(s.p2.getActiveAttack()&&s.p2.getActiveAttack().framesElapsed<7)timeline.push(t.tick());const expired=t.read(s.p2),expiredContact=t.contact(hit,'hit','donkeykong.fixture-protection-expired');
  t.reset();s.p2.setInvincibility(2,'invincible');const invincible=t.contact(hit,'hit','donkeykong.fixture-true-invincible');
  return{entry,protectedContact,timeline,expired,expiredContact,invincible,checks:[
   {label:'source trip protection is whole-body intangible ages0–6',pass:entry.attack?.id==='donkeykong.tripAttack'&&entry.receiving.every(h=>h.intangible)&&protectedContact.result.outcome==='intangible'&&protectedContact.resolver.confirmed===false&&protectedContact.p1.freeze===0&&protectedContact.p2.percent===0},
   {label:'source trip age7 is vulnerable without legacy startup+active overgrant',pass:expired.attack?.age===7&&expired.receiving.every(h=>!h.intangible)&&expiredContact.result.outcome==='landed'&&expiredContact.p2.percent>0},
   {label:'true source invincibility registers confirmed contact and attacker freeze',pass:invincible.result.outcome==='invulnerable'&&invincible.resolver.confirmed===true&&invincible.p1.freeze>0&&invincible.p2.percent===0}
  ]};
 });
 const protection=await page.evaluate(()=>{const t=window.__dkMechanics;t.reset();const s=t.s;t.tick({moveX:.5,attack:true});const rows=[];for(let i=0;i<20;i++)rows.push(t.tick().p1);return rows;});
 report.pending.push({name:'regional-protection-contact-qualification',observations:protection,reason:protection.some(r=>r.receiving.some(h=>h.region!==null))?'Dedicated anatomical receiving is installed; exact source-boundary sensor probes still required.':'Baseline art/receiving has no anatomical region identifiers. Partial arm/head protection cannot be qualified until paired reviewed capsules are installed; generic body must stay vulnerable.'});
 report.checks=report.cases.flatMap(c=>c.checks??[]);report.result=report.errors.length||report.checks.some(c=>!c.pass)?'FAIL':'PASS_CONSUMER_SCOPE_WITH_RECORDED_PENDING_ART';
 console.log(JSON.stringify({result:report.result,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),pending:report.pending.map(p=>p.name)}));
}catch(e){report.failure=e.stack;report.result='ERROR';process.exitCode=1;console.error(e.stack);}finally{await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
if(report.result==='FAIL')process.exitCode=1;
