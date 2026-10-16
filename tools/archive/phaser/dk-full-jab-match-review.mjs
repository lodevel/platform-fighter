import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const baseOut=process.env.PF_FULL_JAB_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/full-jab-checkpoint-09';
const caseFilter=process.env.PF_FULL_JAB_CASE_FILTER?new RegExp(process.env.PF_FULL_JAB_CASE_FILTER):null;
const enabled=name=>!caseFilter||caseFilter.test(name);
let out=baseOut;for(let attempt=2;;attempt++){try{await access(`${out}/observations.json`);out=`${baseOut}-attempt${attempt}`;}catch{break;}}
const hash=b=>createHash('sha256').update(b).digest('hex');
const metadataBytes=await readFile('assets/characters/donkeykong/frames.json'),metadata=JSON.parse(metadataBytes),clip=metadata.animations.jab;
assert.deepEqual(clip.pairedActionTimeline,{endFrame:24});
const frozenPrefix=process.env.PF_FROZEN_SOURCE_DIR??'.tmp/dk-mechanics-checkpoint-09-source-leaves';
const sourceLeafBytes=await readFile(`${frozenPrefix}/src/characters/DonkeyKong.ts`);
const probeBytes=await readFile('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/full-jab-receiving-core-probes.json');
const probes=JSON.parse(probeBytes).probes;
const sourcePath='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art/firstclips-jab-native6-attack-source.json';
const sourceBytes=await readFile(sourcePath),source=JSON.parse(sourceBytes);
assert.equal(hash(await readFile(source.sourceCommand)),source.sourceCommandSha256);
if(process.env.PF_EXPECT_DK_METADATA_SHA)assert.equal(hash(metadataBytes),process.env.PF_EXPECT_DK_METADATA_SHA);
const report={url,out,scope:'Complete eight-cell jab only: physical keyboard and actual fixed MatchScene/Matter. Target-label receiving fixtures and actual strike contacts use the normal damage handler; no resolver bypass. Dtilt partial protection remains an exact-pilot regression only. Discrete poses and custom phase transport are authored, not native continuous motion/hurt_data parity.',metadataSha256:hash(metadataBytes),atlasSha256:hash(await readFile(`assets/characters/donkeykong/${clip.strip}`)),frozenSourcePrefix:frozenPrefix,frozenDonkeyKongSourceSha256:hash(sourceLeafBytes),independentPrimaryCommandSha256:source.sourceCommandSha256,receivingProbePacketSha256:hash(probeBytes),cases:[],errors:[],failedResponses:[]};
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const cdp=await page.context().newCDPSession(page);
const numpadGrab=async(type)=>cdp.send('Input.dispatchKeyEvent',{type,key:'4',code:'Numpad4',windowsVirtualKeyCode:100,nativeVirtualKeyCode:100,isKeypad:true,location:3});
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set(),down=async key=>{await page.keyboard.down(key);held.add(key);},up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{for(const key of [...held])await up(key);};
const step=async(n=1)=>page.evaluate(n=>window.__dkFullJab.step(n),n),read=async()=>page.evaluate(()=>window.__dkFullJab.read());
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{const name=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${name}`});(c.captures??=[]).push({label,screenshot:name,observation:await read()});};
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);
 report.bundleSha256=hash(await(await page.request.get(report.bundle)).body());
 if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:810051,itemFrequency:'off',players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const body of s.baseStage.bodies.platformBodies)if(body!==floor){body.collisionFilter.mask=0;s.matter.world.remove(body);}
  const pulses=[];
  const contacts=[];
  const copy=x=>x===undefined?null:JSON.parse(JSON.stringify(x));
  const geometry=hit=>({id:hit.id,capsule:copy(hit.capsule)});
  const rules=hit=>{const {capsule,...other}=hit;return copy(other);};
  // Observe the existing handler callback; preserve every dispatch and result.
  const callback=s.hitboxDamageHandler.callback;
  s.hitboxDamageHandler.callback=(index,hit,context)=>{const result=callback(index,hit,context);contacts.push({index,hit:copy(hit),context:copy({...context,attackInstance:undefined}),result:copy(result)});return result;};
  const fighter=f=>{
   const a=f.getActiveAttack(),b=a?.hitboxBody,p=b?.plugin;
   return{position:f.getPosition(),velocity:f.getVelocity(),grounded:f.isGrounded(),facing:f.getFacing(),percent:f.getDamagePercent(),freeze:f.getHitlagRemaining(),receiving:copy(f.getActiveHurtboxes()),bodyState:copy(f.getPackedBodyState()),attack:a?{id:a.move.id,age:a.framesElapsed,facing:a.facing,moveHitbox:copy(a.move.hitbox),sourceHits:copy(a.move.collisionHits),sourceRules:(a.move.collisionHits??[]).map(rules),sensor:b?{id:b.id,position:copy(b.position),bounds:copy(b.bounds),geometry:(p.collisionHits??[]).map(geometry),rules:(p.collisionHits??[]).map(rules),hitbox:copy(p.hitbox),pose:copy(p.donkeykongCollisionPose),ownerAnchored:copy(p.ownerAnchoredContact),postPhysicsOnly:copy(p.postPhysicsContactOnly)}:null}:null};
  };
  const read=()=>{const sprite=s.playerSlots[0].sprite;return{frame:s.physicsEngine.getFrame(),floorY:floor.bounds.min.y,p1:fighter(s.p1),p2:fighter(s.p2),sprite:sprite?{key:sprite.texture.key,frame:sprite.frame.name,width:sprite.frame.width,height:sprite.frame.height,x:sprite.x,y:sprite.y,originX:sprite.originX,originY:sprite.originY,scaleX:sprite.scaleX,scaleY:sprite.scaleY,flipX:sprite.flipX}:null};};
  const step=(n=1)=>{for(let i=0;i<n;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}return read();};
  const reset=facing=>{for(const p of pulses)s.matter.world.remove(p);pulses.length=0;contacts.length=0;s.p1.resetForRound(floor.position.x-100,floor.bounds.min.y-42);s.p2.resetForRound(floor.position.x+500,floor.bounds.min.y-42);s.p1.setFacing(facing);s.p2.setFacing(-facing);s.p1.setInvincibility(0);s.p2.setInvincibility(0);step(12);return read();};
  const pulse=({x,y,radius=.1})=>{
   const pos=s.p1.getPosition(),facing=s.p1.getFacing();
   const world={x:pos.x+x*facing,y:pos.y+y};
   const source={id:0,capsule:{start:{x:0,y:0},end:{x:0,y:0},radius}};
   const p=s.matter.add.rectangle(world.x,world.y,radius*2,radius*2,{label:'hitbox.attack',isSensor:true,ignoreGravity:true,frictionAir:0,collisionFilter:{category:8,mask:4},plugin:{ownerId:'donkeykong',ownerBodyId:s.p2.body.id,moveId:'donkeykong.pilot-receiving-pulse',attackKind:'ground',damage:1,hitlagMultiplier:1,setoff:'off',knockback:{x:0,y:-1,scaling:0},facing:1,hitbox:{offsetX:0,offsetY:0,width:radius*2,height:radius*2},collisionHits:[source]}});
   pulses.push(p);return{world,sensorId:p.id,outsideMovementBody:world.x<s.p1.body.bounds.min.x||world.x>s.p1.body.bounds.max.x||world.y<s.p1.body.bounds.min.y||world.y>s.p1.body.bounds.max.y};
  };
  const placeVictim=({x,y})=>{const p=s.p1.getPosition();s.p2.resetForRound(p.x+x*s.p1.getFacing(),p.y+y);s.p2.setInvincibility(0);s.p2.setDamagePercent(0);s.matter.body.setVelocity(s.p2.body,{x:0,y:0});contacts.length=0;return read();};
  window.__dkFullJab={s,read,step,reset,pulse,placeVictim,contacts,freeze:n=>s.p1.armAttackerHitlag(n)};
 });

 await page.evaluate(()=>{
  const originalRead=window.__dkFullJab.read;
  window.__dkFullJab.read=()=>{const o=originalRead(),sp=window.__dkFullJab.s.playerSlots[0].sprite;
   if(sp){const frame=sp.frame,image=sp.texture.getSourceImage(),canvas=document.createElement('canvas');canvas.width=frame.cutWidth;canvas.height=frame.cutHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight,0,0,frame.cutWidth,frame.cutHeight);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let last=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(bytes[(y*canvas.width+x)*4+3]>=32)last=y;o.sprite.alpha32LastPixelY=last;}return o;};
  const originalStep=window.__dkFullJab.step;window.__dkFullJab.step=(n=1)=>{originalStep(n);return window.__dkFullJab.read();};
  const keyboardEvents=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>keyboardEvents.push({type,key:e.key,code:e.code,keyCode:e.keyCode,which:e.which,location:e.location,numLock:e.getModifierState('NumLock')}),true);
  window.__dkFullJab.keyboardEvents=keyboardEvents;
  window.__dkFullJab.inputDiagnostic=()=>{const s=window.__dkFullJab.s,slot=s.playerSlots[1];return{grabBinding:s.registry.get('inputBindingsStore').getAction(slot.bindingsSlot,'grab'),logicalGrab:s.inputResolver.getAction(slot.bindingsSlot,'grab'),moveVector:s.inputResolver.getMoveVector(slot.bindingsSlot),grab:s.p2.getGrabState(),shield:s.p1.getShieldState(),charge:s.p1.getChargeProgress(),shieldArc:s.shieldBubbles.get(1)?.arc?{visible:s.shieldBubbles.get(1).arc.visible}:null,chargeVisual:s.chargeIndicators.get(1)?{ring:s.chargeIndicators.get(1).ring.visible,bar:s.chargeIndicators.get(1).barFill.visible}:null};};
  window.__dkFullJab.placeCaptor=facing=>{const s=window.__dkFullJab.s,p=s.p1.getPosition();
   // Preserve the already settled neutral grounded state. resetForRound here
   // would make the first fresh physical grab an invalid airborne entry.
   s.matter.body.setPosition(s.p2.body,{x:p.x-85*facing,y:p.y});s.matter.body.setVelocity(s.p2.body,{x:0,y:0});
   s.p2.setFacing(facing);s.p2.setInvincibility(0);return{grounded:s.p2.isGrounded(),grab:s.p2.getGrabState(),attack:s.p2.getActiveAttack(),position:s.p2.getPosition()};};
 });
 const enter=async(age,facing,keepHeld=false)=>{await release();await page.evaluate(f=>window.__dkFullJab.reset(f),facing);await down('f');let o=await step();if(!keepHeld)await up('f');assert.equal(o.p1.attack?.id,'donkeykong.jab');for(let i=0;i<30&&o.p1.attack.age<age;i++)o=await step();assert.equal(o.p1.attack?.age,age);return o;};
 const expectedFrame=age=>clip.frameWindows.find(w=>w.startFrame<=age&&age<w.endFrame).artFrameIndex;
 for(const facing of [1,-1]){
  const c={name:`full-jab-timeline-${facing}`,checks:[],samples:[]};if(!enabled(c.name))continue;report.cases.push(c);let o=await enter(0,facing);
  for(let age=0;age<24;age++){
   assert.equal(o.p1.attack?.age,age);const frame=expectedFrame(age),h=clip.hurtboxPoses.find(p=>p.artFrameIndex===frame),a=clip.attackCollisionPoses.find(p=>p.artFrameIndex===frame),sp=o.sprite;
   const rootX=sp.x+((sp.flipX?clip.frameWidth-clip.root[0]:clip.root[0])-sp.originX*clip.frameWidth)*sp.scaleX,rootY=sp.y+(clip.root[1]-sp.originY*clip.frameHeight)*sp.scaleY;
   const floor=rootY+(sp.alpha32LastPixelY+.5-clip.root[1])*sp.scaleY;
   c.samples.push({age,frame,nativeSample:h.nativeSample,observation:o,rootX,rootY,alphaFloor:floor});
   c.checks.push(check(`age${age}: canonical drawing/receiving/source pose are paired`,sp.key==='char.donkeykong.jab'&&Number(sp.frame)===frame&&JSON.stringify(o.p1.receiving)===JSON.stringify(h.hurtboxes)&&(!a.collisionHits.length||o.p1.attack.sensor?.pose?.artFrameIndex===frame&&o.p1.attack.sensor.pose.nativeSample===h.nativeSample),{sprite:sp,pose:o.p1.attack.sensor?.pose,receivingCount:o.p1.receiving.length},{frame,native:h.nativeSample}));
   c.checks.push(check(`age${age}: actor root/floor and mirror registration`,Math.abs(rootX-o.p1.position.x)<1e-6&&Math.abs(rootY-o.p1.position.y-42)<1e-6&&Math.abs(floor-o.floorY)<=.55&&sp.flipX===(facing===-1),{rootX,rootY,floor,physicalFloor:o.floorY}));
   c.checks.push(check(`age${age}: source attack exists only at4/5`,(age===4||age===5)?JSON.stringify(o.p1.attack.sensor?.geometry)===JSON.stringify(a.collisionHits)&&JSON.stringify(o.p1.attack.sensor?.rules)===JSON.stringify(o.p1.attack.sourceRules):o.p1.attack.sensor===null,o.p1.attack.sensor));
   if(clip.frameWindows.some(w=>w.startFrame===age))await capture(c,`age${age}`);o=await step();
  }
  c.after=o;c.checks.push(check('first free step24 retires the full jab drawing and sensor',o.p1.attack===null&&o.sprite.key!=='char.donkeykong.jab',o));
 }
 for(const facing of [1,-1])for(const age of [4,5])for(const kind of ['contact','miss']){
  const c={name:`strike-${age}-${facing}-${kind}`,checks:[]};if(!enabled(c.name))continue;report.cases.push(c);await enter(age,facing);await page.evaluate(()=>window.__dkFullJab.freeze(1));
  const point=kind==='contact'?{x:25,y:-15.5}:{x:260,y:-110};c.before=await page.evaluate(p=>window.__dkFullJab.placeVictim(p),point);c.after=await step();c.contacts=await page.evaluate(()=>window.__dkFullJab.contacts);await capture(c,'actual-strike');
  const hits=c.contacts.filter(h=>h.index===1&&h.context.moveId==='donkeykong.jab'&&h.result?.confirmed);
  c.checks.push(check('actual Matter strike contact or separated miss',kind==='contact'?hits.length===1&&c.after.p2.percent>0:hits.length===0&&c.after.p2.percent===0,c.contacts));
  if(kind==='contact'){const hit=hits[0],native=source.collisionHits.find(p=>p.id===hit?.context.collisionHitId)?.sourceRegion;c.checks.push(check('selected contact retains independently pinned primary source damage launch and flags',!!native&&hit.hit.damage===native.damage&&hit.hit.knockback.reference.base===native.BKB&&hit.hit.knockback.reference.growth===native.KBG&&hit.hit.knockback.reference.angle===native.angle&&hit.hit.hitlagMultiplier===native.hitlag&&hit.hit.sdiMultiplier===native.SDI,hit?.hit,native));}
 }
 for(const facing of [1,-1])for(const p of probes){
  const c={name:`receiving-${p.age}-${p.region}-${facing}`,checks:[],fixture:p};if(!enabled(c.name))continue;report.cases.push(c);c.before=await enter(p.age,facing);await page.evaluate(()=>window.__dkFullJab.freeze(1));c.sensor=await page.evaluate(p=>window.__dkFullJab.pulse(p),p.actorRelativeWorld);c.after=await step();c.contacts=await page.evaluate(()=>window.__dkFullJab.contacts);await capture(c,'actual-receiving');
  c.checks.push(check('actual anatomical tiny sensor damages and interrupts jab',c.after.p1.percent>c.before.p1.percent&&c.after.p1.attack===null,c.after));
  if(['handl','handr'].includes(p.region))c.checks.push(check('extended hand receiving is sampled beyond movement collider',c.sensor.outsideMovementBody,c.sensor));
 }
 const dtiltProbes=[{name:'shoulderL',x:68.36538461538461,y:11.519230769230766,intangible:true},{name:'armL',x:83.5576923076923,y:21.134615384615387,intangible:true},{name:'palmL',x:113.17307692307692,y:22.48076923076923,intangible:false},{name:'head',x:25.288461538461537,y:4.596153846153847,intangible:false}];
 for(const facing of [1,-1])for(const p of dtiltProbes){
  const c={name:`preserved-partial-protection-${p.name}-${facing}`,checks:[],scope:'Exact existing dtilt age5 pilot only, not its whole motion.'};if(!enabled(c.name))continue;report.cases.push(c);await release();await page.evaluate(f=>window.__dkFullJab.reset(f),facing);await down('s');await step(8);await down('f');let o=await step();await up('f');for(let i=0;i<10&&o.p1.attack?.age<5;i++)o=await step();assert.equal(o.p1.attack?.id,'donkeykong.dtilt');assert.equal(o.p1.attack.age,5);c.before=o;await release();await page.evaluate(()=>window.__dkFullJab.freeze(1));c.sensor=await page.evaluate(p=>window.__dkFullJab.pulse(p),p);c.after=await step();await capture(c,'actual-protected-sensor');c.checks.push(check('partial source protection still distinguishes arm from palm/head',p.intangible?c.after.p1.percent===c.before.p1.percent:c.after.p1.percent>c.before.p1.percent,c.after.p1.percent));
 }
 for(const facing of [1,-1])for(const age of [4,5]){
  const c={name:`freeze-${age}-${facing}`,checks:[]};if(!enabled(c.name))continue;report.cases.push(c);c.before=await enter(age,facing);await page.evaluate(()=>window.__dkFullJab.freeze(4));c.steps=[];for(let i=0;i<4;i++)c.steps.push(await step());await capture(c,'frozen');c.after=await step();c.checks.push(check('hitlag holds same source pose receiving and actual attack geometry',c.steps.every(o=>o.p1.attack?.age===age&&o.sprite.frame===c.before.sprite.frame&&JSON.stringify(o.p1.receiving)===JSON.stringify(c.before.p1.receiving)&&JSON.stringify(o.p1.attack.sensor?.geometry)===JSON.stringify(c.before.p1.attack.sensor?.geometry)),c.steps));c.checks.push(check('first unfrozen step selects next source sample or clears attack at6',c.after.p1.attack?.age===age+1&&Number(c.after.sprite.frame)===expectedFrame(age+1)&&(age===4?c.after.p1.attack.sensor?.pose?.nativeSample===6:c.after.p1.attack.sensor===null),c.after));
 }
 for(const facing of [1,-1]){
  const hold={name:`physical-held-F-${facing}`,checks:[]};if(enabled(hold.name)){report.cases.push(hold);await enter(0,facing,true);hold.trace=[];for(let i=0;i<30;i++)hold.trace.push(await step());await release();hold.checks.push(check('held F supplies no second edge or automatic jab2',hold.trace.every(o=>!o.p1.attack||o.p1.attack.id==='donkeykong.jab'),hold.trace.map(o=>o.p1.attack)));}
  const chain={name:`physical-fresh-F-followup-${facing}`,checks:[]};if(enabled(chain.name)){report.cases.push(chain);await enter(7,facing);await down('f');chain.after=await step();await up('f');chain.checks.push(check('fresh F at independent source combo age7 beginsjab2',chain.after.p1.attack?.id==='donkeykong.jab2',chain.after.p1.attack));await capture(chain,'jab2-entry');}
  const cap={name:`physical-opponent-capture-cleanup-${facing}`,checks:[]};if(enabled(cap.name)){
   report.cases.push(cap);await enter(12,facing);cap.entry=await page.evaluate(f=>{const entry=window.__dkFullJab.placeCaptor(f);window.__dkFullJab.keyboardEvents.length=0;return entry;},facing);
   assert.equal(cap.entry.grounded,true,'Captor must remain physically settled before fresh grab');assert.equal(cap.entry.grab.name,'idle');assert.equal(cap.entry.attack,null);
   cap.eventRoute={kind:'Chromium native physical keyboard event via CDP',code:'Numpad4',key:'4',windowsVirtualKeyCode:100,nativeVirtualKeyCode:100,isKeypad:true,reason:'Playwright Numpad4 with NumLock off emitted ArrowLeft; explicit native keypad key100 matches the unchanged live P2grab binding. No resolver or grab override.'};
   await numpadGrab('rawKeyDown');cap.trace=[];cap.inputs=[];for(let i=0;i<12;i++){cap.trace.push(await step());cap.inputs.push(await page.evaluate(()=>window.__dkFullJab.inputDiagnostic()));}await numpadGrab('keyUp');
   cap.keyboardEvents=await page.evaluate(()=>window.__dkFullJab.keyboardEvents);cap.after=await read();
   cap.checks.push(check('native physical keypad event preserves mapped keyCode100',cap.keyboardEvents.some(e=>e.type==='keydown'&&e.code==='Numpad4'&&e.keyCode===100),cap.keyboardEvents));
   cap.checks.push(check('unchanged P2grab binding resolves a fresh grab without left movement',cap.inputs[0].grabBinding.some(b=>b.kind==='keyboard'&&b.keyCode===100)&&cap.inputs[0].logicalGrab.justPressed&&cap.inputs[0].moveVector.x===0,cap.inputs));
   cap.checks.push(check('real opponent grab retires jab sensor/canonical selection',cap.trace.some(o=>o.p1.attack===null&&o.sprite.key!=='char.donkeykong.jab')&&await page.evaluate(()=>window.__dkFullJab.s.p1.isGrabbed()),cap.after));await capture(cap,'captured');
  }
  const reset={name:`reset-cleanup-${facing}`,checks:[]};if(enabled(reset.name)){report.cases.push(reset);await enter(5,facing);reset.after=await page.evaluate(f=>window.__dkFullJab.reset(f),facing);reset.checks.push(check('round reset retires the paired drawing and sensor',reset.after.p1.attack===null&&reset.after.sprite.key!=='char.donkeykong.jab',reset.after));}
 }
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS_COMPLETE_JAB_SCOPED_CONSUMERS';console.log(JSON.stringify({out,result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:report.failedChecks,errors:report.errors},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await numpadGrab('keyUp').catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
