import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const url=process.env.PF_REWORK_URL??'http://localhost:4196/platform-fighter/';
const out=process.env.PF_PILOT_OUT??'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/firstcontact-pilot';
const art='docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art';
const hash=b=>createHash('sha256').update(b).digest('hex');
const metadataBytes=await readFile('assets/characters/donkeykong/frames.json');
const metadata=JSON.parse(metadataBytes);
const staticBytes=await readFile(`${art}/firstcontact-clean3-static-acceptance.json`);
const accepted=JSON.parse(staticBytes);
const sourcePacketBytes=await readFile('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/pilot-native-attack-capsules.json');
const sourcePacket=JSON.parse(sourcePacketBytes);
const samples=[
 {move:'donkeykong.jab',key:'review_pilot_jab1_contact',age:4,native:5,count:32},
 {move:'donkeykong.jab2',key:'review_pilot_jab2_contact',age:3,native:4,count:30},
 {move:'donkeykong.dtilt',key:'review_pilot_dtilt_contact',age:5,native:6,count:33},
];
const report={url,scope:'Three exact reviewed contact samples only. Physical keyboard routes, actual fixed MatchScene/Matter integration, live sensor damage-handler sampling including limbs outside the movement collider. Pulse sensors are explicit authored test fixtures; no combat resolver bypass. Other animation ages and whole inventory actions remain unaccepted. No native 3D hurtbox parity or hardware feel claim.',metadataSha256:hash(metadataBytes),staticAcceptanceSha256:hash(staticBytes),primaryAttackPacketSha256:hash(sourcePacketBytes),errors:[],failedResponses:[],cases:[]};
await mkdir(out,{recursive:true});
for(const sample of samples){
 sample.clip=metadata.animations[sample.key];
 sample.acceptance=accepted.samples.find(s=>s.pilotKey===sample.key);
 assert(sample.clip&&sample.acceptance,`Missing reviewed sample ${sample.key}`);
 const bytes=await readFile(`assets/characters/donkeykong/${sample.clip.strip}`);
 sample.imageSha256=hash(bytes);assert.equal(sample.imageSha256,sample.acceptance.sha256);
 sample.primary=sourcePacket.pilotContacts.find(p=>p.gameplayAge===sample.age&&p.nativeSampleForRateOnePilot===sample.native);
 assert(sample.primary);assert.equal(hash(await readFile(sample.primary.sourcePath)),sample.primary.sourceSha256);
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const held=new Set();
const down=async key=>{await page.keyboard.down(key);held.add(key);};
const up=async key=>{await page.keyboard.up(key);held.delete(key);};
const release=async()=>{for(const key of [...held])await up(key);};
const step=async(n=1)=>page.evaluate(n=>window.__dkPilot.step(n),n);
const read=async()=>page.evaluate(()=>window.__dkPilot.read());
const check=(label,pass,actual,expected)=>({label,pass,actual,expected});
const capture=async(c,label)=>{const filename=`${c.name}-${label}.png`;await page.screenshot({path:`${out}/${filename}`});(c.captures??=[]).push({label,screenshot:filename,observation:await read()});};
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
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
  window.__dkPilot={s,read,step,reset,pulse,placeVictim,contacts,freeze:n=>s.p1.armAttackerHitlag(n)};
 });
 const enter=async(sample,facing)=>{
  await release();await page.evaluate(facing=>window.__dkPilot.reset(facing),facing);
  if(sample.move==='donkeykong.dtilt'){
   // A simultaneous fresh down flick + F legitimately enters down smash.
   // Settle down held beyond the source input classification window first.
   await down('s');await step(8);
  }
  await down('f');let o=await step();await up('f');
  if(sample.move==='donkeykong.jab2'){
   for(let i=0;i<30&&(o.p1.attack?.id!=='donkeykong.jab'||o.p1.attack.age<7);i++)o=await step();
   assert(o.p1.attack?.id==='donkeykong.jab'&&o.p1.attack.age>=7,'Physical first jab reaches source chain window');
   await down('f');o=await step();await up('f');
  }
  for(let i=0;i<30&&(o.p1.attack?.id!==sample.move||o.p1.attack.age<sample.age);i++)o=await step();
  assert.equal(o.p1.attack?.id,sample.move);assert.equal(o.p1.attack.age,sample.age);
  await release();return o;
 };
 for(const sample of samples)for(const facing of [1,-1]){
  const c={name:`${sample.key}-${facing}`,sample:{...sample,clip:undefined},checks:[]};report.cases.push(c);
  c.contact=await enter(sample,facing);await capture(c,'exact-contact');
  const o=c.contact,sp=o.sprite,p=o.p1.position,clip=sample.clip;
  const expectedGeometry=clip.attackCollisionPoses[0].collisionHits;
  c.checks.push(check('physical keyboard action selects exact pilot sheet',sp?.key===`char.donkeykong.${sample.key}`,sp?.key),check('drawing frame0 and attack native sample are paired',Number(sp?.frame)===0&&o.p1.attack.sensor?.pose?.nativeSample===sample.native&&o.p1.attack.sensor.pose.gameplayAge===sample.age,o.p1.attack.sensor?.pose),check('actual receiving count matches reviewed per-drawing geometry',o.p1.receiving.length===sample.count,o.p1.receiving.length,sample.count),check('live attack capsules equal independently staged paired geometry',JSON.stringify(o.p1.attack.sensor.geometry)===JSON.stringify(expectedGeometry),o.p1.attack.sensor.geometry,expectedGeometry),check('all attack source numeric and interaction fields survive override',JSON.stringify(o.p1.attack.sensor.rules)===JSON.stringify(o.p1.attack.sourceRules)));
  const rootX=sp.x+((sp.flipX?clip.frameWidth-clip.root[0]:clip.root[0])-sp.originX*clip.frameWidth)*sp.scaleX;
  const rootY=sp.y+(clip.root[1]-sp.originY*clip.frameHeight)*sp.scaleY;
  const visibleFloor=rootY+sample.acceptance.floorPixelCentreWorldDelta;
  c.registration={rootX,rootY,visibleFloor,physicalFloor:o.floorY,sourceAlpha32LastPixelY:sample.acceptance.alpha32LastPixelY};
  c.checks.push(check('off-centre root stays on actor x in both facings',Math.abs(rootX-p.x)<1e-6,rootX,p.x),check('mirror origin complements and sprite registration preserves84px collider',Math.abs(sp.originX-(facing===1?1/3:2/3))<1e-9&&sp.flipX===(facing===-1)&&Math.abs(rootY-p.y-42)<1e-6,sp),check('actual Matter floor aligns reviewed alpha support within.55world',o.p1.grounded&&Math.abs(visibleFloor-o.floorY)<=.55,c.registration));
  await page.evaluate(()=>window.__dkPilot.freeze(4));c.frozen=[];
  for(let i=0;i<4;i++)c.frozen.push(await step());await capture(c,'frozen-contact');
  c.checks.push(check('four real hitlag steps preserve drawing receiving and paired attack age',c.frozen.every(r=>r.p1.attack?.age===sample.age&&r.sprite.key===sp.key&&JSON.stringify(r.p1.receiving)===JSON.stringify(o.p1.receiving)&&JSON.stringify(r.p1.attack.sensor.geometry)===JSON.stringify(o.p1.attack.sensor.geometry))));
  c.retired=await step();await capture(c,'next-age-retired');const a=c.retired.p1.attack;
  c.checks.push(check('one-age pilot retires on next unfrozen gameplay step',a?.age===sample.age+1&&c.retired.sprite.key!==sp.key&&!a.sensor?.pose,c.retired.sprite.key),check('retirement restores exact source collision capsules and numeric fields',JSON.stringify(a?.sensor?.geometry)===JSON.stringify(a?.sourceHits?.map(h=>({id:h.id,capsule:h.capsule})))&&JSON.stringify(a?.sensor?.rules)===JSON.stringify(a?.sourceRules),a?.sensor),check('retirement restores sensor flags',a?.sensor?.ownerAnchored===null&&a?.sensor?.postPhysicsOnly===null,a?.sensor));
 }
 const dtilt=samples[2];
 const probes=[{name:'shoulderL',x:68.36538461538461,y:11.519230769230766,intangible:true},{name:'armL',x:83.5576923076923,y:21.134615384615387,intangible:true},{name:'palmL',x:113.17307692307692,y:22.48076923076923,intangible:false},{name:'head',x:25.288461538461537,y:4.596153846153847,intangible:false}];
 for(const facing of [1,-1])for(const probe of probes){
  const c={name:`dtilt-region-${probe.name}-${facing}`,probe,facing,checks:[]};report.cases.push(c);
  c.before=await enter(dtilt,facing);
  // One real hitlag step holds the exact reviewed age5 while Matter samples
  // the newly created pulse. Otherwise applyInput would advance to age6 and
  // correctly retire this review-only receiving before the collision check.
  await page.evaluate(()=>window.__dkPilot.freeze(1));
  c.sensor=await page.evaluate(p=>window.__dkPilot.pulse(p),probe);
  // Real Matter world plus the existing live hurtbox sampling path performs
  // this contact. No synthetic collision event or resolver call is used.
  c.after=await step();await capture(c,'actual-sensor-contact');
  const unchanged=c.after.p1.percent===c.before.p1.percent;
  c.checks.push(check('real tiny sensor respects reviewed regional source protection',probe.intangible?unchanged:!unchanged,{before:c.before.p1.percent,after:c.after.p1.percent},probe.intangible?'unchanged':'damage'),check('intangible contact has no attacker hitlag; vulnerable contact confirms',probe.intangible?c.after.p2.freeze===0:c.after.p2.freeze>0,c.after.p2.freeze));
  if(['armL','palmL'].includes(probe.name))c.checks.push(check('extended receiving contact lies outside stage-motion collider',c.sensor.outsideMovementBody,c.sensor));
 }
 const strikePoints={'donkeykong.jab':{x:70.8984,y:14.4015},'donkeykong.jab2':{x:62.8167,y:-47.9228},'donkeykong.dtilt':{x:112.71,y:27.38}};
 for(const sample of samples)for(const facing of [1,-1])for(const kind of ['contact','miss']){
  const c={name:`paired-strike-${sample.key}-${facing}-${kind}`,checks:[],source:sample.primary};report.cases.push(c);
  c.pilot=await enter(sample,facing);await page.evaluate(()=>window.__dkPilot.freeze(1));
  const point=kind==='contact'?strikePoints[sample.move]:{x:250,y:-100};
  c.fixture={victimCentreFromActor:point,scope:'Reviewed posed strike centre plus baseline victim body; no earlier contact because victim remains far until exact sample. Miss is separated beyond all current strike capsules.'};
  c.before=await page.evaluate(point=>window.__dkPilot.placeVictim(point),point);c.after=await step();
  c.contacts=await page.evaluate(()=>window.__dkPilot.contacts);await capture(c,'actual-paired-strike');
  const hits=c.contacts.filter(r=>r.index===1&&r.context.moveId===sample.move&&r.result?.confirmed);
  if(kind==='miss')c.checks.push(check('separated baseline victim misses actual paired sensor',hits.length===0&&c.after.p2.percent===0,c.contacts));
  else{
   c.checks.push(check('actual source strike sensor confirms once through normal handler',hits.length===1&&c.after.p2.percent>0,c.contacts));
   const hit=hits[0],source=sample.primary.hitRegions.find(r=>r.id===hit?.context.collisionHitId);
   c.selectedPrimary=source;
   c.checks.push(check('contact damage and launch retain independently pinned selected source region',!!source&&hit.hit.damage===source.damage&&hit.hit.knockback.reference.base===source.BKB&&hit.hit.knockback.reference.growth===source.KBG&&hit.hit.knockback.reference.angle===source.angle,hit?.hit,source),check('contact hitlag and SDI retain independently pinned source flags',!!source&&hit.hit.hitlagMultiplier===source.hitlag&&hit.hit.sdiMultiplier===source.SDI,hit?.hit,source));
  }
 }
 report.failedChecks=report.cases.flatMap(c=>c.checks.filter(k=>!k.pass).map(k=>({case:c.name,...k})));
 report.checkCount=report.cases.reduce((n,c)=>n+c.checks.length,0);
 report.result=report.failedChecks.length||report.errors.length||report.failedResponses.length?'FAIL':'PASS_EXACT_THREE_SAMPLE_SCOPE';
 console.log(JSON.stringify({result:report.result,cases:report.cases.length,checks:report.checkCount,failedChecks:report.failedChecks,errors:report.errors},null,2));
 if(report.result==='FAIL')process.exitCode=1;
}catch(e){report.result='ERROR';report.failure=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await release().catch(()=>{});await writeFile(`${out}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
