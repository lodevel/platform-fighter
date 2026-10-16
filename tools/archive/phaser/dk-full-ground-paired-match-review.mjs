/** Future paired jab2/dtilt verification. Syntax preparation alone is not
 * runtime proof; invoke only against the coordinator's immutable checkpoint. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const kind=process.env.PF_FULL_PAIRED_KIND??'jab2';
assert.ok(['jab2','dtilt'].includes(kind),'PF_FULL_PAIRED_KIND must be jab2 or dtilt');
const cfg=kind==='jab2'?{kind,end:31,active:[3,4,5],clear:6,motion:'Attack12',first:3,probes:16}
 :{kind,end:24,active:[5,6],clear:7,motion:'AttackLw3',first:5,probes:28};
const moveId=`donkeykong.${kind}`,atlasKey=`char.donkeykong.${kind}`;
const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const baseOut=process.env.PF_FULL_PAIRED_OUT??`docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/full-${kind}-checkpoint-11`;
const caseFilter=process.env.PF_FULL_PAIRED_CASE_FILTER?new RegExp(process.env.PF_FULL_PAIRED_CASE_FILTER):null;
const enabled=name=>!caseFilter||caseFilter.test(name);
let out=baseOut;for(let attempt=2;;attempt++){try{await access(`${out}/observations.json`);out=`${baseOut}-attempt${attempt}`;}catch{break;}}
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const root='docs/review/2026-09-25/donkeykong-character';
const art=`${root}/audit-2026-10-08/art`,runtime=`${root}/audit-2026-10-08/runtime`,mechanics=`${root}/completion-2026-10-08/mechanics`;
const report={url,out,kind,scope:`Complete paired ${kind} only: physical keyboard and fixed MatchScene/Matter. Independent target-label receiving probes and primary per-ID attack packets, source protection [4,7) for dtilt shoulderL/armL only. Discrete poses/target geometry are authored; no native hurt_data or3D parity.`,cases:[],errors:[],failedResponses:[],sourcePackets:[]};
await mkdir(out,{recursive:true});
let browser,page,cdp;
const held=new Set(),down=async key=>{await page.keyboard.down(key);held.add(key);},up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{if(!page)return;for(const key of [...held])await up(key);};
const numpadGrab=async type=>{if(cdp)await cdp.send('Input.dispatchKeyEvent',{type,key:'4',code:'Numpad4',windowsVirtualKeyCode:100,nativeVirtualKeyCode:100,isKeypad:true,location:3});};
const step=async(n=1)=>page.evaluate(n=>window.__dkFullGroundPaired.step(n),n),read=async()=>page.evaluate(()=>window.__dkFullGroundPaired.read());
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{const name=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${name}`});(c.captures??=[]).push({label,screenshot:name,observation:await read()});};
try{
 const metadataBytes=await readFile('assets/characters/donkeykong/frames.json'),metadata=JSON.parse(metadataBytes),clip=metadata.animations[kind];
 assert.deepEqual(clip.pairedActionTimeline,{endFrame:cfg.end});
 const frozenPrefix=process.env.PF_FROZEN_SOURCE_DIR??'.tmp/dk-full-ground-paired-checkpoint-11-source-leaves';
 const sourceLeafBytes=await readFile(`${frozenPrefix}/src/characters/DonkeyKong.ts`);
 const probeBytes=await readFile(`${runtime}/full-${kind}-receiving-core-probes.json`),probePacket=JSON.parse(probeBytes),probes=probePacket.probes;
 assert.equal(probes.length,cfg.probes,'Independent receiving packet coverage');
 const proposalBytes=await readFile(probePacket.sourceProposal),proposal=JSON.parse(proposalBytes);
 assert.equal(hash(proposalBytes),probePacket.sourceProposalSha256);
 assert.deepEqual(clip.frameWindows,proposal.poseRows.map(p=>({startFrame:p.windowStart,endFrame:p.windowEndExclusive,artFrameIndex:p.artFrameIndex})),
  'Shipping unequal windows must match independently reviewed source-age proposal');
 const posePins=[];
 for(const row of proposal.poseRows){
  const bytes=await readFile(row.receivingCandidate),candidate=JSON.parse(bytes);
  assert.equal(hash(bytes),row.receivingCandidateSha256);
  const expected=candidate.hurtboxPoses.find(p=>p.nativeSample===row.nativeSample),actual=clip.hurtboxPoses.find(p=>p.artFrameIndex===row.artFrameIndex);
  assert.ok(expected&&actual);assert.equal(actual.nativeSample,row.nativeSample);
  assert.deepEqual(actual.hurtboxes,expected.hurtboxes,'Shipping receiving must retain independent reviewed anatomical candidate');
  assert.equal(hash(await readFile(row.attackSourcePacket)),row.attackSourcePacketSha256);
  posePins.push({age:row.gameplayAge,nativeSample:row.nativeSample,receivingCandidate:row.receivingCandidate,receivingCandidateSha256:row.receivingCandidateSha256,attackSourcePacket:row.attackSourcePacket,attackSourcePacketSha256:row.attackSourcePacketSha256});
 }
 const probePins=new Map();
 for(const p of probes){
  assert.equal(p.nativeSample,p.age+1);assert.ok(['protected','vulnerable'].includes(p.expected));
  const expectedProtected=kind==='dtilt'&&p.age>=4&&p.age<7&&['shoulderl','arml'].includes(p.region.toLowerCase());
  assert.equal(p.expected,expectedProtected?'protected':'vulnerable','Fixture protection must agree with independent primary source window');
  assert.deepEqual([...p.sourceSelectedProtectedRegions].sort(),kind==='dtilt'&&p.age>=4&&p.age<7?['arml','shoulderl']:[]);
  for(const [field,shaField] of [['targetOwnershipProposal','targetOwnershipProposalSha256'],['labelImage','labelImageSha256'],['targetImage','targetImageSha256'],['packedDrawingImage','packedDrawingImageSha256'],['receivingCandidate','receivingCandidateSha256']]){
   if(!probePins.has(p[field])){const value=hash(await readFile(p[field]));assert.equal(value,p[shaField],`Independent ${field} pin`);probePins.set(p[field],value);}
   else assert.equal(probePins.get(p[field]),p[shaField]);
  }
 }
 const pilotPath=`${mechanics}/pilot-native-attack-capsules.json`,pilotBytes=await readFile(pilotPath),pilot=JSON.parse(pilotBytes).pilotContacts.find(p=>p.motion===cfg.motion);
 assert.ok(pilot);assert.equal(hash(await readFile(pilot.sourcePath)),pilot.sourceSha256);
 const command=await readFile(pilot.sourcePath,'utf8');
 if(kind==='dtilt'){
  assert.ok(command.includes('frame(agent.lua_state_agent, 5.0)'));
  for(const bone of ['arml','shoulderl'])assert.ok(command.includes(`HIT_NODE(agent, Hash40::new("${bone}"), *HIT_STATUS_XLU)`));
  assert.ok(command.includes('frame(agent.lua_state_agent, 8.0)'));
  assert.ok(command.includes('HitModule::set_status_all(agent.module_accessor, HitStatus(*HIT_STATUS_NORMAL), 0)'));
 }
 const sourceByAge=new Map();
 for(const age of cfg.active){
  let packet,path,bytes;
  if(age===cfg.first){
   path=`${art}/${kind}-native${age+1}-clean3-paired-attack-candidate.json`;bytes=await readFile(path);const candidate=JSON.parse(bytes);
   assert.equal(candidate.gameplayAge,age);assert.equal(candidate.nativeSample,age+1);
   assert.equal(hash(await readFile(candidate.sourceProjectionReceipt)),candidate.sourceProjectionReceiptSha256);
   assert.equal(hash(await readFile(candidate.sourceGuide)),candidate.sourceGuideSha256);
   packet={sourceCommand:pilot.sourcePath,sourceCommandSha256:pilot.sourceSha256,nativeSample:age+1,gameplayAge:age,collisionHits:candidate.attackCollisionPoses[0].collisionHits.map(h=>({...h,sourceRegion:pilot.hitRegions.find(r=>r.id===h.id)}))};
  }else{
   path=`${art}/firstclips-${kind}-native${age+1}-attack-source.json`;bytes=await readFile(path);packet=JSON.parse(bytes);
   assert.equal(packet.gameplayAge,age);assert.equal(packet.nativeSample,age+1);assert.equal(packet.active,true);
   assert.equal(hash(await readFile(packet.sourceGuide)),packet.sourceGuideSha256);
  }
  assert.equal(hash(await readFile(packet.sourceCommand)),packet.sourceCommandSha256);
  assert.deepEqual(packet.collisionHits.map(h=>h.id),[0,1,2]);
  assert.ok(packet.collisionHits.every(h=>h.sourceRegion));sourceByAge.set(age,packet);
  report.sourcePackets.push({age,nativeSample:age+1,path,sha256:hash(bytes),sourceCommand:packet.sourceCommand,sourceCommandSha256:packet.sourceCommandSha256});
 }
 if(process.env.PF_EXPECT_DK_METADATA_SHA)assert.equal(hash(metadataBytes),process.env.PF_EXPECT_DK_METADATA_SHA);
 Object.assign(report,{metadataSha256:hash(metadataBytes),atlasSha256:hash(await readFile(`assets/characters/donkeykong/${clip.strip}`)),frozenSourcePrefix:frozenPrefix,frozenDonkeyKongSourceSha256:hash(sourceLeafBytes),independentPrimaryCommandSha256:pilot.sourceSha256,pilotPacketSha256:hash(pilotBytes),receivingProbePacketSha256:hash(probeBytes),independentPoseProposalSha256:hash(proposalBytes),reviewedPosePins:posePins,receivingSourcePins:[...probePins].map(([path,sha256])=>({path,sha256}))});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:1000}});cdp=await page.context().newCDPSession(page);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
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
  window.__dkFullGroundPaired={s,read,step,reset,pulse,placeVictim,contacts,freeze:n=>s.p1.armAttackerHitlag(n)};
 });

 await page.evaluate(()=>{
  const originalRead=window.__dkFullGroundPaired.read;
  window.__dkFullGroundPaired.read=()=>{const o=originalRead(),sp=window.__dkFullGroundPaired.s.playerSlots[0].sprite;
   if(sp){const frame=sp.frame,image=sp.texture.getSourceImage(),canvas=document.createElement('canvas');canvas.width=frame.cutWidth;canvas.height=frame.cutHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight,0,0,frame.cutWidth,frame.cutHeight);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let last=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(bytes[(y*canvas.width+x)*4+3]>=32)last=y;o.sprite.alpha32LastPixelY=last;}return o;};
  const originalStep=window.__dkFullGroundPaired.step;window.__dkFullGroundPaired.step=(n=1)=>{originalStep(n);return window.__dkFullGroundPaired.read();};
  const keyboardEvents=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>keyboardEvents.push({type,key:e.key,code:e.code,keyCode:e.keyCode,which:e.which,location:e.location,numLock:e.getModifierState('NumLock')}),true);
  window.__dkFullGroundPaired.keyboardEvents=keyboardEvents;
  window.__dkFullGroundPaired.inputDiagnostic=()=>{const s=window.__dkFullGroundPaired.s,slot=s.playerSlots[1];return{grabBinding:s.registry.get('inputBindingsStore').getAction(slot.bindingsSlot,'grab'),logicalGrab:s.inputResolver.getAction(slot.bindingsSlot,'grab'),moveVector:s.inputResolver.getMoveVector(slot.bindingsSlot),grab:s.p2.getGrabState(),shield:s.p1.getShieldState(),charge:s.p1.getChargeProgress(),shieldArc:s.shieldBubbles.get(1)?.arc?{visible:s.shieldBubbles.get(1).arc.visible}:null,chargeVisual:s.chargeIndicators.get(1)?{ring:s.chargeIndicators.get(1).ring.visible,bar:s.chargeIndicators.get(1).barFill.visible}:null};};
  window.__dkFullGroundPaired.placeCaptor=facing=>{const s=window.__dkFullGroundPaired.s,p=s.p1.getPosition();
   // Preserve the already settled neutral grounded state. resetForRound here
   // would make the first fresh physical grab an invalid airborne entry.
   s.matter.body.setPosition(s.p2.body,{x:p.x-85*facing,y:p.y});s.matter.body.setVelocity(s.p2.body,{x:0,y:0});
   s.p2.setFacing(facing);s.p2.setInvincibility(0);return{grounded:s.p2.isGrounded(),grab:s.p2.getGrabState(),attack:s.p2.getActiveAttack(),position:s.p2.getPosition()};};
 });

 const enter=async(age,facing,keepHeld=false)=>{
  await release();await page.evaluate(f=>window.__dkFullGroundPaired.reset(f),facing);
  let o;
  if(kind==='jab2'){
   await down('f');o=await step();await up('f');assert.equal(o.p1.attack?.id,'donkeykong.jab');
   for(let i=0;i<15&&o.p1.attack?.age<7;i++)o=await step();assert.equal(o.p1.attack?.age,7);
   await down('f');o=await step();if(!keepHeld)await up('f');
  }else{
   await down('s');await step(8);await down('f');o=await step();if(!keepHeld)await up('f');await up('s');
  }
  assert.equal(o.p1.attack?.id,moveId);assert.equal(o.p1.attack.age,0,'Physical entry must expose source-age0, not skip first paired window');
  for(let i=0;i<cfg.end+3&&o.p1.attack?.age<age;i++)o=await step();assert.equal(o.p1.attack?.age,age);return o;
 };
 const expectedFrame=age=>{const w=clip.frameWindows.find(w=>w.startFrame<=age&&age<w.endFrame);assert.ok(w,`Missing drawing age${age}`);return w.artFrameIndex;};
 const expectedReceiving=(pose,age)=>pose.hurtboxes.map(h=>{
  const nativeProtected=kind==='dtilt'&&age>=4&&age<7&&['shoulderl','arml'].includes(h.region?.toLowerCase());
  // Runtime source protection overlays the reviewed body anatomy. It cannot
  // extend arm protection into palm/head or beyond the native reset boundary.
  if(nativeProtected)return {...h,intangible:true};
  if(kind==='dtilt'&&['shoulderl','arml'].includes(h.region?.toLowerCase())&&h.intangible)return {...h,intangible:false};
  return h;
 });
 for(const facing of [1,-1]){
  const c={name:`full-${kind}-timeline-${facing}`,checks:[],samples:[]};if(!enabled(c.name))continue;report.cases.push(c);let o=await enter(0,facing);
  for(let age=0;age<cfg.end;age++){
   assert.equal(o.p1.attack?.age,age);const frame=expectedFrame(age),h=clip.hurtboxPoses.find(p=>p.artFrameIndex===frame),a=clip.attackCollisionPoses.find(p=>p.artFrameIndex===frame),sp=o.sprite;
   assert.ok(h&&a&&sp);const rootX=sp.x+((sp.flipX?clip.frameWidth-clip.root[0]:clip.root[0])-sp.originX*clip.frameWidth)*sp.scaleX,rootY=sp.y+(clip.root[1]-sp.originY*clip.frameHeight)*sp.scaleY;
   const floor=rootY+(sp.alpha32LastPixelY+.5-clip.root[1])*sp.scaleY;
   c.samples.push({age,frame,nativeSample:h.nativeSample,observation:o,rootX,rootY,alphaFloor:floor});
   c.checks.push(check(`age${age}: canonical drawing/receiving/source pose paired`,sp.key===atlasKey&&Number(sp.frame)===frame&&same(o.p1.receiving,expectedReceiving(h,age))&&(!a.collisionHits.length||o.p1.attack.sensor?.pose?.artFrameIndex===frame&&o.p1.attack.sensor.pose.nativeSample===h.nativeSample),{sprite:sp,pose:o.p1.attack.sensor?.pose,receivingCount:o.p1.receiving.length},{frame,native:h.nativeSample}));
   c.checks.push(check(`age${age}: actor root/floor and mirror registration`,Math.abs(rootX-o.p1.position.x)<1e-6&&Math.abs(rootY-o.p1.position.y-42)<1e-6&&Math.abs(floor-o.floorY)<=.55&&sp.flipX===(facing===-1),{rootX,rootY,floor,physicalFloor:o.floorY}));
   const active=cfg.active.includes(age),packet=sourceByAge.get(age);
   c.checks.push(check(`age${age}: source attack only at${cfg.active.join('/')}`,active?same(o.p1.attack.sensor?.geometry,a.collisionHits)&&same(o.p1.attack.sensor?.rules,o.p1.attack.sourceRules)&&same(a.collisionHits,packet.collisionHits.map(({id,capsule})=>({id,capsule}))):o.p1.attack.sensor===null,{sensor:o.p1.attack.sensor,sourcePacket:packet?.nativeSample}));
   if(clip.frameWindows.some(w=>w.startFrame===age))await capture(c,`age${age}`);o=await step();
  }
  c.after=o;c.checks.push(check(`first free step${cfg.end} retires canonical drawing and sensor`,o.p1.attack===null&&o.sprite.key!==atlasKey,o));
 }
 for(const facing of [1,-1])for(const age of cfg.active)for(const contactKind of ['contact','miss']){
  const c={name:`strike-${age}-${facing}-${contactKind}`,checks:[]};if(!enabled(c.name))continue;report.cases.push(c);await enter(age,facing);await page.evaluate(()=>window.__dkFullGroundPaired.freeze(1));
  const packet=sourceByAge.get(age),anchor=packet.collisionHits.find(h=>h.id===(kind==='jab2'?1:0)).capsule.start;
  const point=contactKind==='contact'?anchor:{x:260,y:-110};c.before=await page.evaluate(p=>window.__dkFullGroundPaired.placeVictim(p),point);c.after=await step();c.contacts=await page.evaluate(()=>window.__dkFullGroundPaired.contacts);await capture(c,'actual-strike');
  const hits=c.contacts.filter(h=>h.index===1&&h.context.moveId===moveId&&h.result?.confirmed);
  c.checks.push(check('actual Matter strike contact or separated miss',contactKind==='contact'?hits.length===1&&c.after.p2.percent>0:hits.length===0&&c.after.p2.percent===0,c.contacts));
  if(contactKind==='contact'){
   const hit=hits[0],native=packet.collisionHits.find(p=>p.id===hit?.context.collisionHitId)?.sourceRegion;
   const ref=hit?.hit?.knockback?.reference;
   c.checks.push(check('selected contact retains independent primary damage launch flags',!!native&&hit.hit.damage===native.damage&&ref?.base===native.BKB&&ref.growth===native.KBG&&ref.angle===native.angle&&hit.hit.hitlagMultiplier===native.hitlag&&hit.hit.sdiMultiplier===native.SDI&&hit.hit.shieldDamage===native.shieldDamage&&(hit.hit.direct??true)===native.direct&&hit.hit.nativeCollisionAttribute===native.collisionAttribute&&hit.hit.nativeForceReaction===false&&(ref.setWeight??false)===native.setWeight,hit?.hit,native));
   if(kind==='dtilt')c.checks.push(check('native low tilt trip and additive reaction fields preserved',hit?.hit?.tripChance===.4&&ref?.additionalHitstunFrames===5,hit?.hit,{tripChance:.4,additionalHitstunFrames:5}));
  }
 }
 for(const facing of [1,-1])for(const p of probes){
  const c={name:`receiving-${p.age}-${p.region}-${facing}`,checks:[],fixture:p};if(!enabled(c.name))continue;report.cases.push(c);c.before=await enter(p.age,facing);await page.evaluate(()=>window.__dkFullGroundPaired.freeze(1));c.sensor=await page.evaluate(p=>window.__dkFullGroundPaired.pulse(p),p.actorRelativeWorld);c.after=await step();c.contacts=await page.evaluate(()=>window.__dkFullGroundPaired.contacts);await capture(c,'actual-receiving');
  const hits=c.contacts.filter(h=>h.index===0&&h.context.moveId==='donkeykong.pilot-receiving-pulse'&&h.result?.confirmed);
  const protectedExpected=p.expected==='protected';
  c.checks.push(check('independent source/target probe protection or flesh damage',protectedExpected?c.after.p1.percent===c.before.p1.percent&&c.after.p1.attack?.id===moveId&&c.after.p1.attack.age===p.age&&hits.length===0:c.after.p1.percent>c.before.p1.percent&&c.after.p1.attack===null&&hits.length===1,{after:c.after,contacts:c.contacts},{expected:p.expected,sourceSelectedProtectedRegions:p.sourceSelectedProtectedRegions}));
  if(p.outsideMovementBodyWithInset)c.checks.push(check('labelled core probe lies beyond movement collider',c.sensor.outsideMovementBody,c.sensor));
 }
 const freezeAges=kind==='dtilt'?[4,...cfg.active]:cfg.active;
 for(const facing of [1,-1])for(const age of freezeAges){
  const c={name:`freeze-${age}-${facing}`,checks:[]};if(!enabled(c.name))continue;report.cases.push(c);c.before=await enter(age,facing);await page.evaluate(()=>window.__dkFullGroundPaired.freeze(4));c.steps=[];for(let i=0;i<4;i++)c.steps.push(await step());await capture(c,'frozen');c.after=await step();
  c.checks.push(check('hitlag holds source pose receiving protection and actual attack geometry',c.steps.every(o=>o.p1.attack?.age===age&&o.sprite.frame===c.before.sprite.frame&&same(o.p1.receiving,c.before.p1.receiving)&&same(o.p1.attack.sensor?.geometry,c.before.p1.attack.sensor?.geometry)),c.steps));
  const nextActive=cfg.active.includes(age+1),nextFrame=expectedFrame(age+1);
  c.checks.push(check('first unfrozen step advances source sample or clears attack',c.after.p1.attack?.age===age+1&&Number(c.after.sprite.frame)===nextFrame&&(nextActive?c.after.p1.attack.sensor?.pose?.nativeSample===age+2:c.after.p1.attack.sensor===null),c.after));
 }
 for(const facing of [1,-1]){
  const hold={name:`physical-held-F-${facing}`,checks:[]};if(enabled(hold.name)){
   report.cases.push(hold);await enter(0,facing,true);hold.trace=[];for(let i=0;i<cfg.end+6;i++)hold.trace.push(await step());await release();
   hold.checks.push(check('held F supplies no new edge or automatic repeat',hold.trace.every((o,i)=>i+1<cfg.end?o.p1.attack?.id===moveId&&o.p1.attack.age===i+1:o.p1.attack===null),hold.trace.map(o=>o.p1.attack),{oneEntryAtAge:0,lastCommittedAge:cfg.end-1,firstFreeAge:cfg.end,noRepeatedEntry:true}));
  }
  const cap={name:`physical-opponent-capture-cleanup-${facing}`,checks:[]};if(enabled(cap.name)){
   report.cases.push(cap);await enter(12,facing);cap.entry=await page.evaluate(f=>{const entry=window.__dkFullGroundPaired.placeCaptor(f);window.__dkFullGroundPaired.keyboardEvents.length=0;return entry;},facing);
   assert.equal(cap.entry.grounded,true,'Captor must remain physically settled before fresh grab');assert.equal(cap.entry.grab.name,'idle');assert.equal(cap.entry.attack,null);
   cap.eventRoute={kind:'Chromium native physical keyboard event via CDP',code:'Numpad4',key:'4',windowsVirtualKeyCode:100,nativeVirtualKeyCode:100,isKeypad:true,reason:'Native keypad100 preserves unchanged P2grab binding; no resolver/capture override.'};
   await numpadGrab('rawKeyDown');cap.trace=[];cap.inputs=[];for(let i=0;i<12;i++){cap.trace.push(await step());cap.inputs.push(await page.evaluate(()=>window.__dkFullGroundPaired.inputDiagnostic()));}await numpadGrab('keyUp');
   cap.keyboardEvents=await page.evaluate(()=>window.__dkFullGroundPaired.keyboardEvents);cap.after=await read();
   cap.checks.push(check('native physical keypad event preserves mapped keyCode100',cap.keyboardEvents.some(e=>e.type==='keydown'&&e.code==='Numpad4'&&e.keyCode===100),cap.keyboardEvents));
   cap.checks.push(check('unchanged P2grab binding resolves fresh grab without movement',cap.inputs[0].grabBinding.some(b=>b.kind==='keyboard'&&b.keyCode===100)&&cap.inputs[0].logicalGrab.justPressed&&cap.inputs[0].moveVector.x===0,cap.inputs));
   cap.checks.push(check('real opponent grab retires attack sensor/canonical selection',cap.trace.some(o=>o.p1.attack===null&&o.sprite.key!==atlasKey)&&await page.evaluate(()=>window.__dkFullGroundPaired.s.p1.isGrabbed()),cap.after));await capture(cap,'captured');
  }
  const reset={name:`reset-cleanup-${facing}`,checks:[]};if(enabled(reset.name)){report.cases.push(reset);await enter(cfg.active.at(-1),facing);reset.after=await page.evaluate(f=>window.__dkFullGroundPaired.reset(f),facing);reset.checks.push(check('round reset retires paired drawing and sensor',reset.after.p1.attack===null&&reset.after.sprite.key!==atlasKey,reset.after));}
 }
 assert.ok(report.cases.length>0,'Case filter selected no runtime verification');
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':`PASS_COMPLETE_${kind.toUpperCase()}_SCOPED_CONSUMERS`;console.log(JSON.stringify({out,result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:report.failedChecks,errors:report.errors},null,2));if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await numpadGrab('keyUp').catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser?.close();}
