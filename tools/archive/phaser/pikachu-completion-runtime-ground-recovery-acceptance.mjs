import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
import {validateGroundRecovery} from './pikachu-completion-runtime-ground-recovery-verify.mjs';

if(!process.env.PF_BUILD_RECORD)throw Error('Set immutable PF_BUILD_RECORD');
const recordPath=process.env.PF_BUILD_RECORD,checkpoint=recordPath.replace(/-assets-staged\.json$/,'');
const build=JSON.parse(await readFile(recordPath,'utf8')),metadata=JSON.parse(await readFile(checkpoint+'-pikachu-frames.json','utf8'));
const auxiliaryPath=build.sourceLeafDirectory?build.sourceLeafDirectory+'/pikachuAuxiliaryBody.ts':checkpoint+'-pikachuAuxiliaryBody.ts';
const auxiliary=await tsImport(new URL('../'+auxiliaryPath,import.meta.url).pathname,import.meta.url);
const pinnedHashes=JSON.parse(await readFile(build.sourceHashes,'utf8'));
assert.equal(createHash('sha256').update(await readFile(auxiliaryPath)).digest('hex'),pinnedHashes['src/characters/pikachuAuxiliaryBody.ts']);
assert.equal(createHash('sha256').update(await readFile(checkpoint+'-pikachu-frames.json')).digest('hex'),build.pikachuFramesSha256);
const contracts=[
 {sheet:'getup',origin:'face-up',direction:0,duration:30,protectionEnd:23},
 {sheet:'getup_face_down',origin:'face-down',direction:0,duration:30,protectionEnd:23},
 {sheet:'getup_roll',origin:'face-up',direction:1,duration:36,protectionEnd:15},
 {sheet:'getup_roll_back',origin:'face-up',direction:-1,duration:36,protectionEnd:20},
 {sheet:'getup_roll_face_down',origin:'face-down',direction:1,duration:36,protectionEnd:20},
 {sheet:'getup_roll_back_face_down',origin:'face-down',direction:-1,duration:36,protectionEnd:20},
 {sheet:'tech',origin:'tech',direction:0,duration:27,protectionEnd:21},
 {sheet:'tech_forward',origin:'tech',direction:1,duration:41,protectionEnd:21},
 {sheet:'tech_back',origin:'tech',direction:-1,duration:41,protectionEnd:21},
].filter(c=>!process.env.PF_RECOVERY_SHEETS||process.env.PF_RECOVERY_SHEETS.split(',').includes(c.sheet));
for(const c of contracts){const s=auxiliary.pikachuAuxiliarySourceStatus(c.sheet);assert.equal(s.cancelFrame,c.duration);assert.equal(s.intangibilityStartFrame,1);assert.equal(s.intangibilityEndExclusive,c.protectionEnd);}
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-ground-recovery';
await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={build,errors:[],rows:[],auxiliaryPath,auxiliarySha256:createHash('sha256').update(await readFile(auxiliaryPath)).digest('hex'),scope:'Actual immutable MatchScene normal simulated InputResolver wakeups after a public hit launch and real missed-tech floor contact, or shield-buffered actual floor tech. Observed incoming knockdown origin chooses six wakeups; entry facing and real directional input choose three techs. One native frame per unfrozen fixed step is explicit beta. All age0..cancel−1 body/root/mirror/12caps/protection, blocked requests, pause/replay hitlag freeze and first-free actions; real Matter wall blocking has no absolute trajectory catchup. Native common posture selection/rates, bone geometry and hardware feel remain separate fidelity limits.'};
page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureGroundRecovery', async name => {
  const view=await page.evaluate(()=>{
    const s=window.__game.scene.getScene('MatchScene'),c=s.cameras.main,r=window.__game.canvas.getBoundingClientRect();
    return {camera:{x:c.x,y:c.y,zoom:c.zoom,worldView:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height}},
      canvas:{left:r.left,top:r.top,width:r.width,height:r.height,internalWidth:window.__game.canvas.width,internalHeight:window.__game.canvas.height}};
  });
  await page.screenshot({path:`${output}/${name}`});return view;
});
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 await page.evaluate(({opponentCharacterId})=>{
  const game=window.__game;for(const x of game.scene.getScenes(true))game.scene.stop(x.scene.key);game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1871,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:opponentCharacterId,paletteIndex:1,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.hitboxDebugLayer.setEnabled(true);let input={},opponentInput={};s.inputResolver.getMoveVector=slot=>({x:(slot===1?input:opponentInput).moveX??0,y:(slot===1?input:opponentInput).moveY??0});s.inputResolver.isActionHeld=(slot,k)=>(slot===1?input:opponentInput)[k]===true;
  const step=(next={},second={})=>{input=next;opponentInput=second;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};const a=s.p1,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  const removedPlatforms=[];for(const p of s.baseStage.bodies.platformBodies)if(p!==floor){removedPlatforms.push({label:p.label,bounds:p.bounds});p.collisionFilter.mask=0;s.matter.world.remove(p);}
  const read=()=>{const sp=s.playerSlots[0].sprite;return{recovery:a.getPikachuGroundRecoveryPresentationState(),reaction:a.getReactionPresentationState(),tumbling:a.isTumbling(),knockedDown:a.isKnockedDown(),hitlag:a.getHitlagRemaining(),hitstun:a.getHitstunRemaining(),position:a.getPosition(),velocity:a.getVelocity(),bodyBottom:a.getBodyBottomY(),grounded:a.isGrounded(),facing:a.getFacing(),canAttack:a.canAttack(),canUseItems:a.canUseItemsBeforeInput(),move:a.getActiveAttack()?.move.id??null,special:a.getPikachuSpecialState(),jumps:a.getJumpsUsed(),jumpsquat:a.getJumpsquatRemaining(),receiving:a.getActiveHurtboxes(),texture:sp.texture.key,textureFrame:Number(sp.frame.name),origin:[sp.originX,sp.originY],spritePosition:{x:sp.x,y:sp.y},scale:[sp.scaleX,sp.scaleY],rotation:sp.rotation,flipX:sp.flipX,flipY:sp.flipY,bodyMirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),percent:a.getDamagePercent(),stocks:s.stockTracker.getStocks(0),floorY:floor.bounds.min.y,camera:{scrollX:s.cameras.main.scrollX,scrollY:s.cameras.main.scrollY,zoom:s.cameras.main.zoom}};};
  window.__runGroundRecovery=async({contract:c,facing,wallProbe,contactProbe=null})=>{
   a.resetForRound(floor.position.x,floor.bounds.min.y-(c.origin==='tech'?130:25));s.p2.resetForRound(floor.position.x+400,floor.bounds.min.y-s.p2.getTuning().height/2);a.setDamagePercent(0);for(let n=0;n<12;n++)step();a.setFacing(facing);
   // A short downward airborne launch reaches the actual floor while hitstun
   // still owns input. A long upward launch permits ordinary air dodge before
   // touchdown, which is a different source interaction than buffered tech.
   const hit={damage:1,knockback:{x:8,y:c.origin==='tech'?2:-8,scaling:0},facing:c.origin==='face-down'?facing:-facing,hitlagMultiplier:1};a.applyHit(hit);const flight=[];let techArmed=false;
   for(let n=0;n<180;n++){
    const o=read();if(o.recovery||o.knockedDown)break;
    if(c.origin==='tech'&&o.tumbling&&o.velocity.y>0&&o.floorY-o.bodyBottom<12)techArmed=true;
    const intent=techArmed?{shield:true,moveX:c.direction*facing}:{};step(intent);flight.push({input:intent,observation:read()});
   }
   const entry=read();if(c.origin==='tech'){if(entry.recovery?.sheet!==c.sheet)throw Error(`real floor tech route failed ${c.sheet}/${facing}: ${JSON.stringify({entry,flight:flight.slice(-5)})}`);}
   else {if(!entry.knockedDown||entry.reaction?.origin!==c.origin)throw Error(`observed prone origin mismatch ${c.sheet}/${facing}`);step(c.direction?{moveX:c.direction*facing}:{jump:true});}
   if(read().recovery?.sheet!==c.sheet)throw Error('normal recovery input selected wrong source branch');
   if(contactProbe){
    const actorPosition=a.getPosition();s.p2.resetForRound(actorPosition.x+55*facing,floor.bounds.min.y-s.p2.getTuning().height/2);s.p2.setFacing(-facing);s.p2.setDamagePercent(0);
    for(let n=0;n<2;n++)step();const startAge=contactProbe==='protected'?5:contactProbe==='boundary'?c.protectionEnd-4:c.protectionEnd-1;
    while(a.getPikachuGroundRecoveryPresentationState()?.framesElapsed<startAge)step();
    const before=read();step({}, {attack:true});const trace=[],captures=[];
    for(let n=0;n<14;n++){
     const actor=read(),attack=s.p2.getActiveAttack();const hitWindow=attack?.move.hitWindows?.find(w=>w.startFrame<=attack.framesElapsed&&attack.framesElapsed<w.endFrame);
     const attacker={position:s.p2.getPosition(),facing:s.p2.getFacing(),move:attack?.move.id??null,age:attack?.framesElapsed??null,damage:attack?.move.damage??null,collisionHits:hitWindow?.collisionHits??attack?.move.collisionHits??[],sensor:attack?.hitboxBody?{position:{...attack.hitboxBody.position},bounds:attack.hitboxBody.bounds}:null};
     const observation={...actor,attacker};trace.push(observation);
     if(n===0||attacker.sensor&&captures.length===1||actor.percent>before.percent&&captures.length<3){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const screenshot=`${c.sheet}-${facing}-${contactProbe}-${n}.png`;const view=await window.__captureGroundRecovery(screenshot);captures.push({screenshot,observation,view});}
     if(actor.percent>before.percent)break;step();
    }
    return{contract:c,facing,contactProbe,hit,entry,flight,before,trace,captures};
   }
   let wall=null;const wallContacts=[];
   if(wallProbe){const start=read();wall=s.matter.add.rectangle(start.position.x+c.direction*facing*70,floor.bounds.min.y-140,20,280,{isStatic:true,label:'completion.runtime.recovery.wall',collisionFilter:{category:floor.collisionFilter.category,mask:floor.collisionFilter.mask}});}
   const trace=[],captures=[],seen=new Set();let pauseFreeze=null,hitlagFreeze=null;
   const capture=async(label)=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const screenshot=`${c.sheet}-${facing}-${wallProbe?'wall':'normal'}-${label}.png`;const view=await window.__captureGroundRecovery(screenshot);captures.push({screenshot,observation:read(),view});};
   for(let n=0;n<c.duration+12;n++){
    const o=read();trace.push(o);if(!o.recovery)break;const age=o.recovery.framesElapsed;
    if(wall){const lo=Math.min(...a.body.vertices.map(v=>v.x)),hi=Math.max(...a.body.vertices.map(v=>v.x));if(Math.min(hi,wall.bounds.max.x)-Math.max(lo,wall.bounds.min.x)>0)wallContacts.push({age,vertexPenetration:Math.min(hi,wall.bounds.max.x)-Math.max(lo,wall.bounds.min.x),position:o.position});}
    if(!seen.has(o.textureFrame)||[c.protectionEnd-2,c.protectionEnd-1,c.duration-1].includes(age)){const k=o.textureFrame+':'+age;if(!seen.has(k)){seen.add(o.textureFrame);seen.add(k);await capture(age);}}
    if(age===7&&!pauseFreeze){const before=read();for(let k=0;k<5;k++)s.update(0,s.physicsEngine.fixedTimestepMs);pauseFreeze={before,after:read()};}
    if(age===5&&!hitlagFreeze&&!wallProbe){const before=read();a.armAttackerHitlag(4);const frozen=[];for(let k=0;k<4;k++){step({attack:true,special:true,jump:true,shield:true,dodge:true,grab:true,moveX:-facing});frozen.push(read());}hitlagFreeze={source:'public armAttackerHitlag replay freeze; not native recovery hitlag',before,frozen};await capture('replay-freeze');}
    step([4,15,c.duration-2].includes(age)?{attack:true,special:true,jump:true,shield:true,dodge:true,grab:true,moveX:-facing}:{});
   }
   const ended=read();step();step({attack:true});const firstFresh=read();if(wall)s.matter.world.remove(wall);
   return{contract:c,facing,wallProbe,hit,entry,flight,trace,captures,pauseFreeze,hitlagFreeze,ended,firstFresh,removedPlatforms,wall:wall?{bounds:wall.bounds,contacts:wallContacts}:null};
  };
 },{opponentCharacterId:process.env.PF_RECOVERY_PROTECTION==='1'?'pikachu':'donkeykong'});
 if(process.env.PF_RECOVERY_PROTECTION==='1'){
  report.protectionRows=[];const {selectAttackCollisionHit}=await tsImport(new URL('../src/characters/attackCollisionShapes.ts',import.meta.url).pathname,import.meta.url);const {posedCapsule}=await tsImport(new URL('../src/characters/capsuleGeometry.ts',import.meta.url).pathname,import.meta.url);
  for(const facing of[1,-1])for(const contract of contracts.filter(c=>['getup','tech'].includes(c.sheet)))for(const contactProbe of(process.env.PF_RECOVERY_CONTACT_PROBES?.split(',')??['protected','vulnerable'])){
   const row=await page.evaluate(args=>window.__runGroundRecovery(args),{contract,facing,wallProbe:false,contactProbe});report.protectionRows.push(row);
   const sensors=row.trace.filter(o=>o.attacker.sensor);assert.ok(sensors.length>0,'real melee sensor exists');assert.ok(sensors.every(o=>o.attacker.move==='pikachu.jab'));
   const rawOverlap=sensors.some(o=>selectAttackCollisionHit(o.attacker.collisionHits,o.attacker.position,o.attacker.facing,o.receiving.map(h=>posedCapsule(h.capsule,o.position,o.recovery?.facing??o.facing)),o.grounded));assert.ok(rawOverlap,'raw native attack/receiving capsules actually overlap');
   if(contactProbe==='protected'){assert.ok(sensors.every(o=>o.receiving.every(h=>h.intangible===true)));assert.ok(row.trace.every(o=>o.percent===row.before.percent));}
   else if(contactProbe==='boundary'){
    assert.equal(sensors.length,2,'one real jab has two consecutive active steps across protection endpoint');
    assert.equal(sensors[0].recovery?.framesElapsed,contract.protectionEnd-2,'last protected source age');
    assert.ok(sensors[0].receiving.every(h=>h.intangible===true));assert.equal(sensors[0].percent,row.before.percent);
    assert.ok(sensors[1].percent>row.before.percent,'next real active step hits at first vulnerable source age');
    assert.equal(sensors[1].recovery,null);assert.ok(sensors[1].hitlag>0);
   }
   else {assert.ok(row.trace.at(-1).percent>row.before.percent,'real late melee damage lands');assert.equal(row.trace.at(-1).recovery,null,'real damage interrupts recovery');assert.ok(row.trace.at(-1).hitlag>0);}
   console.log(JSON.stringify({sheet:contract.sheet,facing,contactProbe,result:'PASS'}));
  }
 }
 if(process.env.PF_RECOVERY_PROTECTION!=='1')for(const facing of(process.env.PF_RECOVERY_FACINGS?.split(',').map(Number)??[1,-1]))for(const contract of contracts){
  const row=await page.evaluate(args=>window.__runGroundRecovery(args),{contract,facing,wallProbe:false});report.rows.push(row);console.log(JSON.stringify({sheet:contract.sheet,facing,observedSteps:row.trace.length,captures:row.captures.length}));
 }
 if(process.env.PF_RECOVERY_PROTECTION!=='1'&&process.env.PF_RECOVERY_WALLS!=='0')for(const facing of[1,-1])for(const contract of contracts.filter(c=>['getup_roll','getup_roll_back','tech_forward','tech_back'].includes(c.sheet))){const row=await page.evaluate(args=>window.__runGroundRecovery(args),{contract,facing,wallProbe:true});report.rows.push(row);console.log(JSON.stringify({sheet:contract.sheet,facing,wall:true,captures:row.captures.length}));}
 validateGroundRecovery(report,auxiliary,metadata);
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:'PASS',rows:report.rows.length,protectionRows:report.protectionRows?.length??0,captures:[...report.rows,...(report.protectionRows??[])].flatMap(r=>r.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(output+'/ground-recovery-match-observations.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
