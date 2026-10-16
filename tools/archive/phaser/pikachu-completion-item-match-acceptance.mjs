import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
import path from 'node:path';

const cleanRender=process.env.PF_ITEM_CLEAN_RENDER==='1';
const cleanCarryOnly=process.env.PF_ITEM_CLEAN_CARRY_ONLY==='1';
assert.ok(!cleanCarryOnly||cleanRender,'Carry-cell supplement requires clean-render mode');
assert.ok(!cleanRender||!process.env.PF_ITEM_RESUME_REPORT,'Clean supplement uses fresh independent resets, never debug-report retention');
const prefix=process.env.PF_STAGED_PREFIX;
assert.ok(prefix&&process.env.PF_REGISTRY_URL,'Set immutable PF_STAGED_PREFIX and PF_REGISTRY_URL');
const build=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const hashes=JSON.parse(await readFile(build.sourceHashes,'utf8'));
assert.ok(build.sourceLeafDirectory,'Item proof needs immutable same-directory source graph');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(await readFile(`${prefix}-pikachu-frames.json`)),build.pikachuFramesSha256);
for(const name of ['pikachuAuxiliaryBody','pikachuItemAttachment','pikachuStateHurtboxes'])
 assert.equal(digest(await readFile(`${build.sourceLeafDirectory}/${name}.ts`)),hashes[`src/characters/${name}.ts`]);
const load=name=>tsImport(new URL(`../${build.sourceLeafDirectory}/${name}.ts`,import.meta.url).pathname,import.meta.url);
const {selectPikachuAuxiliaryBody}=await load('pikachuAuxiliaryBody');
const {getPikachuItemAttachment}=await load('pikachuItemAttachment');
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES}=await load('pikachuStateHurtboxes');
const required=['item_carry','item_pickup_stand','item_pickup_walk','item_throw_f','item_throw_b','item_throw_hi','item_throw_lw','item_throw_air_f','item_throw_air_b','item_throw_air_hi','item_throw_air_lw','item_throw_drop'];
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-items';
await mkdir(output,{recursive:true});
const characterSource=await readFile('src/characters/Character.ts');
assert.equal(digest(characterSource),hashes['src/characters/Character.ts']);
await writeFile(`${output}/immutable-keyboard-contract-Character.ts`,characterSource);
const tapJumpBufferFrames=Number(characterSource.toString().match(/export const TAP_JUMP_BUFFER_FRAMES = (\d+);/)?.[1]);
assert.equal(tapJumpBufferFrames,4,'Pinned shared W/up+jump ambiguity contract');
const report={result:'PREPARING',build,cases:[],errors:[],failedResponses:[],keyboardJumpContract:{key:'W',bindings:['jump','moveUp'],tapJumpBufferFrames,sourceSha256:digest(characterSource),scope:'Shared beta up+jump ambiguity waits4subsequentsteps before jumpsquat; direct logical jump and native selector parity are separate.'},scope:'Actual immutable MatchScene six existing authored item kits, spawn/pickup/release and item renderer. Primary batch uses explicitly SIMULATED InputResolver controls while actual Character inputs, source-body selection and Matter movement run normally. A separate real keyboard pickup/jump supplement verifies normal browser controls. Initial placement/item spawn/facing are fixtures; actual carry/release traces do not write body clocks or sockets. Pickup8/1 and throw6 steps are uncommitted authored beta cues; native source samples/Have/12caps are independent oracles. Native item-node orientation and native common commitments remain unknown.'};
const completedCases=new Set();
if(process.env.PF_ITEM_RESUME_REPORT){
 const source=process.env.PF_ITEM_RESUME_REPORT,bytes=await readFile(source),previous=JSON.parse(bytes);
 assert.equal(previous.result,'FAIL');assert.equal(previous.bundleSha256,build.bundleSha256);
 assert.equal(previous.build.pikachuFramesSha256,build.pikachuFramesSha256);
 assert.equal(previous.build.sourceHashes,build.sourceHashes);
 assert.deepEqual(previous.errors,[]);assert.deepEqual(previous.failedResponses,[]);
 // Each independently reset case is appended before its assertions. Keep
 // only completed cases; the final, failed case must run again in full.
 const retained=previous.cases.slice(0,-1);assert.ok(retained.length);
 for(const c of retained){
  assert.ok(!completedCases.has(c.id));completedCases.add(c.id);report.cases.push(c);
  for(const capture of c.captures)await copyFile(path.join(path.dirname(source),capture.screenshot),path.join(output,capture.screenshot));
 }
 report.resumedFrom={report:source,sha256:digest(bytes),bundleSha256:previous.bundleSha256,
  completedCaseIds:[...completedCases],omittedFailedCase:previous.cases.at(-1)?.id,
  failure:previous.assertionFailure,scope:'Exact immutable build, metadata and source graph; independent reset cases retain their original observations/captures. Failed case and remaining cases execute again.'};
}
const addCase=c=>{
 if(cleanCarryOnly&&c.kind!=='carry-loop')return false;
 if(cleanRender&&!(['ordinary','carry-loop','throw'].includes(c.kind)||c.kind==='pickup'&&c.typeIndex===0||c.kind==='keyboard'&&!c.walking))return false;
 if(completedCases.has(c.id))return false;report.cases.push(c);return true;
};
report.visualOverlay=cleanRender?'NONE_CLEAN_RENDER':'RECEIVING_DEBUG';
report.cleanRenderScope=cleanCarryOnly?'Supplement: natural carry native26 body drawing both facings, same full-loop source/body/socket assertions; does not qualify inventory without primary96 and other clean images.':cleanRender?'Supplement: all17 runtime-selected item drawing cells both facings, all11 ordinary body routes both facings, real keyboard takeoff carrying all6kits both facings. Carry106 remains source-only. Same behavior/source/socket assertions retained; fewer screenshots; no inventory qualification without primary96report.':null;
const missing=required.filter(sheet=>!metadata.animations[sheet]||!selectPikachuAuxiliaryBody(sheet,sheet==='item_pickup_walk'?2:sheet.endsWith('_b')?14:sheet.endsWith('_hi')?15:sheet.endsWith('_lw')?8:sheet==='item_throw_drop'?7:sheet.startsWith('item_throw')?12:0));
if(missing.length){report.result='BLOCKED_MISSING_IMMUTABLE_ITEM_BODIES';report.missing=missing;await writeFile(`${output}/preflight.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,missing}));process.exit(2);}

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
const step=async(input={},n=1)=>page.evaluate(({input,n})=>window.__itemStep(input,n),{input,n});
const read=()=>page.evaluate(()=>window.__itemRead());
const capture=async(c,label)=>{
 if(cleanCarryOnly&&label!==18)return;
 if(cleanRender&&(c.kind==='carry-loop'&&![0,18,45,71].includes(label)||c.kind==='ordinary'&&label!==c.steps-1||c.kind==='throw'&&label!=='release'||c.kind==='keyboard'&&label!=='takeoff'))return;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const screenshot=`${c.id}-${label}.png`,observation=await read();
 await page.screenshot({path:`${output}/${screenshot}`});
 const view=await page.evaluate(()=>{const g=window.__game,v=g.scene.getScene('MatchScene').cameras.main,b=g.canvas.getBoundingClientRect();return{camera:{worldView:{x:v.worldView.x,y:v.worldView.y,width:v.worldView.width,height:v.worldView.height},x:v.x,y:v.y,width:v.width,height:v.height,zoom:v.zoom},canvas:{left:b.left,top:b.top,width:b.width,height:b.height,internalWidth:g.canvas.width,internalHeight:g.canvas.height}};});
 c.captures.push({screenshot,observation,...view});
};
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-8,`${label}: ${actual} vs ${expected}`);
function checkBody(o,{held=true}={}){
 const a=o.actor,sheet=a.texture.replace(/^char\.pikachu\./,''),clip=metadata.animations[sheet];
 assert.ok(clip,`${sheet} accepted sheet`);assert.ok(o.stocks.every(s=>s.stocks===5),'stock guard');
 assert.equal(a.rotation,0);assert.equal(a.flip.y,false);assert.deepEqual(a.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);
 assert.deepEqual(a.scale,[clip.scaleToWorld,clip.scaleToWorld]);assert.deepEqual(a.spritePosition,{x:a.position.x,y:a.position.y+25});
 const basis=a.pose?.facing??a.item?.facing??a.facing;
 assert.equal(a.mirror,basis);
 const aux=a.item&&selectPikachuAuxiliaryBody(a.item.sheet,a.item.nativeAge);
 const row=aux??PIKACHU_STATE_AUTHORED_HURTBOX_POSES.find(r=>r.sheet===sheet&&r.artFrameIndex===a.textureFrame);
 assert.ok(row,`${sheet}/${a.textureFrame} independent source receiving`);
 assert.equal(row.artFrameIndex,a.textureFrame);assert.equal(a.receiving.length,12);
 const relative=basis*a.facing;
 const caps=row.hurtboxes.map(h=>({...h,offsetX:h.offsetX*relative,...(h.capsule?{capsule:{start:{x:h.capsule.start.x*relative,y:h.capsule.start.y},end:{x:h.capsule.end.x*relative,y:h.capsule.end.y},radius:h.capsule.radius}}:{})}));
 assert.deepEqual(a.receiving,caps);
 const socket=getPikachuItemAttachment(sheet,row.nativeSample);assert.ok(socket,`${sheet}/${row.nativeSample} source Have`);
 const expected={x:a.position.x+socket.x*basis,y:a.position.y+socket.y};
 near(a.socket.x,expected.x,'source socketX');near(a.socket.y,expected.y,'source socketY');
 if(held){assert.equal(o.item.snapshot.state,'held');near(o.item.snapshot.position.x,expected.x,'held entityX');near(o.item.snapshot.position.y,expected.y,'held entityY');near(o.item.visual.x,expected.x,'held drawingX');near(o.item.visual.y,expected.y,'held drawingY');}
 return {sheet,nativeSample:row.nativeSample,expected};
}
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=digest(await(await page.request.get(report.bundle)).body());assert.equal(report.bundleSha256,build.bundleSha256);
 await page.evaluate(()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:8651,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;s.hitboxDebugLayer.setEnabled(true);
  const a=s.p1,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of s.baseStage.bodies.platformBodies)if(b!==floor){b.collisionFilter.mask=0;s.matter.world.remove(b);}
  const originalMove=s.inputResolver.getMoveVector.bind(s.inputResolver),originalHeld=s.inputResolver.isActionHeld.bind(s.inputResolver);
  let input={},simulated=true,item=null;
  s.inputResolver.getMoveVector=slot=>simulated?{x:slot===1?input.moveX??0:0,y:slot===1?input.moveY??0:0}:originalMove(slot);
  s.inputResolver.isActionHeld=(slot,key)=>simulated?slot===1&&input[key]===true:originalHeld(slot,key);
  const read=()=>{const sp=s.playerSlots[0].sprite,v=item&&s.itemVisuals.get(item.id),t=item&&s.thrownItems.find(t=>t.entity.id===item.id);return{actor:{position:a.getPosition(),velocity:a.getVelocity(),facing:a.getFacing(),grounded:a.isGrounded(),jumpsUsed:a.getJumpsUsed(),item:a.getPikachuItemPresentationState(),pose:s.playerSlots[0].spriteAnimSm.current(),socket:a.getHeldItemWorldPosition(),receiving:a.getActiveHurtboxes(),texture:sp.texture.key,textureFrame:Number(sp.frame.name),mirror:Math.sign(sp.scaleX)*(sp.flipX?-1:1),flip:{x:sp.flipX,y:sp.flipY},origin:[sp.originX,sp.originY],scale:[sp.scaleX,sp.scaleY],rotation:sp.rotation,spritePosition:{x:sp.x,y:sp.y},attack:a.getActiveAttack()?.move.id??null,jump:a.getJumpPresentationState(),jumpsquat:a.getJumpsquatRemaining(),hitlag:a.getHitlagRemaining()},item:item?{type:item.definition.type,snapshot:item.getSnapshot(),visual:v?{x:v.x,y:v.y}:null,throwSpec:item.definition.throwBehavior}:null,thrown:t?{x:t.x,y:t.y,vx:t.vx,vy:t.vy}:null,stocks:s.playerSlots.map(p=>({index:p.playerIndex,stocks:s.stockTracker.getStocks(p.playerIndex)})),floorY:floor.bounds.min.y,controls:simulated?'SIMULATED_INPUT_RESOLVER':'REAL_KEYBOARD'};};
  const step=(i={},n=1)=>{input=i;let o;for(let j=0;j<n;j++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();o=read();}return o;};
  window.__itemRead=read;window.__itemStep=step;
  window.__itemTrace=n=>Array.from({length:n},()=>step());
  window.__itemUntilLandingReset=()=>{const rows=[];for(let n=0;n<120;n++){const o=step();rows.push(o);if(o.actor.grounded&&o.actor.item?.sheet==='item_carry')return rows;}throw Error('held-item real-keyboard jump did not land/reset within120fixedsteps');};
  window.__itemControls=flag=>{simulated=flag;input={};return read();};
  window.__itemReset=({facing,typeIndex})=>{simulated=true;input={};s.getInventory(s.playerSlots[0].playerIndex)?.drop(0,a.getPosition());for(const old of s.getItemRegistry().getActive()){old.markDespawned(s.physicsEngine.getCurrentFrame?.()??0);s.itemVisuals.get(old.id)?.destroy();}s.thrownItems=[];item=null;a.resetForRound(floor.position.x,floor.bounds.min.y-25);s.p2.resetForRound(floor.bounds.max.x-50,floor.bounds.min.y-25);step({},12);a.setFacing(facing);s.itemSpawnTypeIndex=typeIndex;const tr=s.baseStage.transform,scale=s.stage.scale,p=a.getPosition();let spawn=true;s.itemSpawnManager.step=frame=>spawn?(spawn=false,[{frame,anchorIndex:0,anchor:{x:(p.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale},spawnPosition:{x:(p.x-tr.offsetX)/scale,y:(floor.bounds.min.y-tr.offsetY)/scale}}]):[];step();item=s.getItemRegistry().getActive().at(-1);if(!item)throw Error('normal registry spawn absent');item.markGrounded(0,{x:a.getPosition().x,y:floor.bounds.min.y});return read();};
  window.__itemAirFixture=({height=500,velocityY=0}={})=>{s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:floor.bounds.min.y-height});s.matter.body.setVelocity(a.body,{x:0,y:velocityY});return step();};
  window.__itemLandingFixture=()=>{s.matter.body.setPosition(a.body,{x:a.getPosition().x,y:floor.bounds.min.y-30});s.matter.body.setVelocity(a.body,{x:0,y:4});return read();};
  window.__itemFreeze=()=>{const before=read();for(let n=0;n<5;n++)s.update(0,s.physicsEngine.fixedTimestepMs);return{before,after:read()};};
  window.__itemHitlag=()=>{a.armAttackerHitlag(3);return read();};
 });
 if(cleanRender)await page.evaluate(()=>window.__game.scene.getScene('MatchScene').hitboxDebugLayer.setEnabled(false));
 const reset=async c=>{await step();return page.evaluate(c=>window.__itemReset(c),c);};
 const pickup=async(c,walking=false)=>{c.before=await reset(c);c.entry=await step({attack:true,moveX:walking?c.facing*.5:0});assert.equal(c.entry.item.snapshot.state,'held');assert.equal(c.entry.actor.attack,null,'pickup consumes attack edge');return c.entry;};
 for(let typeIndex=0;typeIndex<5;typeIndex++)for(const facing of [1,-1])for(const walking of [false,true]){
  const c={id:`pickup-${typeIndex}-${facing}-${walking?'walk':'stand'}`,kind:'pickup',typeIndex,facing,walking,trace:[],captures:[]};if(!addCase(c))continue;await pickup(c,walking);c.trace.push(c.entry);await capture(c,'entry');const duration=walking?1:8;
  for(let age=1;age<duration;age++){c.trace.push(await step());if([2,7].includes(age))await capture(c,age);}
  c.exit=await step();await capture(c,'exit');
  for(let age=0;age<duration;age++){const o=c.trace[age];assert.equal(o.actor.item.sheet,walking?'item_pickup_walk':'item_pickup_stand');assert.equal(o.actor.item.eventAge,age);assert.equal(o.actor.item.nativeAge,walking?2:age);checkBody(o);}
  assert.equal(c.exit.actor.item?.sheet,'item_carry');checkBody(c.exit);
 }
 for(const facing of [1,-1]){
  const c={id:`carry-loop-${facing}`,kind:'carry-loop',typeIndex:0,facing,trace:[],captures:[]};if(!addCase(c))continue;await pickup(c);await step({},8);c.entry=await read();
  for(let n=0;n<213;n++){const o=await step();c.trace.push(o);assert.equal(o.actor.item.sheet,'item_carry');assert.equal(o.actor.item.eventAge,null);const pose=selectPikachuAuxiliaryBody('item_carry',o.actor.item.nativeAge);assert.ok(pose.nativeSample<106,'source-only endpoint excluded');checkBody(o);if([0,18,45,71,97,105,106,211,212].includes(n))await capture(c,n);}
  c.pause=await page.evaluate(()=>window.__itemFreeze());assert.deepEqual(c.pause.before,c.pause.after);
  await page.evaluate(()=>window.__itemHitlag());c.hitlag=[];for(let n=0;n<3;n++)c.hitlag.push(await step());for(const o of c.hitlag)assert.equal(o.actor.item.nativeAge,c.pause.before.actor.item.nativeAge);
  c.resume=await step();assert.equal(c.resume.actor.item.nativeAge,c.pause.before.actor.item.nativeAge+1);
 }
 // Existing beta walk threshold is .3 and dash-flick threshold is .75.
 // These are actual stick/control cases; they do not establish bindings for
 // the source-only WalkSlow/WalkFast resource variants.
 const routes=[{name:'walk-threshold',input:{moveX:.35},steps:12},{name:'walk',input:{moveX:.5},steps:12},{name:'dash-threshold',input:{moveX:.75},steps:12},{name:'run',input:{moveX:1},steps:35},{name:'dash-turn',setup:{moveX:1},setupSteps:2,input:{moveX:-1},steps:34},{name:'run-turn',setup:{moveX:1},setupSteps:35,input:{moveX:-1},steps:22},{name:'run-brake',setup:{moveX:1},setupSteps:35,input:{},steps:31},{name:'crouch',input:{moveY:1},steps:10},{name:'crawl',input:{moveX:.5,moveY:1},steps:34},{name:'crawl-back',input:{moveX:-.5,moveY:1},steps:46},{name:'jump',input:{jump:true},steps:10}];
 for(const facing of [1,-1])for(const route of routes){
  const c={id:`ordinary-${route.name}-${facing}`,kind:'ordinary',typeIndex:0,facing,route:route.name,steps:route.steps,trace:[],captures:[]};if(!addCase(c))continue;await pickup(c);await step({},8);if(route.setup)await step({...route.setup,moveX:route.setup.moveX*facing},route.setupSteps);
  for(let age=0;age<route.steps;age++){const o=await step({...route.input,moveX:(route.input.moveX??0)*facing});c.trace.push(o);checkBody(o);if(o.actor.texture!=='char.pikachu.item_carry')assert.equal(o.actor.item,null,'ordinary action owns body');if([0,4,10,19,29,route.steps-1].includes(age))await capture(c,age);}
  assert.ok(c.trace.some(o=>o.actor.texture!=='char.pikachu.item_carry'));
 }
 for(const facing of [1,-1]){
  const c={id:`pickup-fresh-jump-${facing}`,kind:'pickup-interrupt',typeIndex:0,facing,trace:[],captures:[]};if(!addCase(c))continue;await pickup(c);c.jump=await step({jump:true});assert.ok(c.jump.actor.jumpsquat>0,'uncommitted pickup accepts next-step fresh jump');assert.equal(c.jump.actor.item,null);checkBody(c.jump);await capture(c,'jump');
 }
 for(const grounded of [true,false])for(const facing of [1,-1])for(const direction of ['forward','back','up','down',...(grounded?['drop']:[])]){
  const c={id:`throw-${grounded?'ground':'air'}-${direction}-${facing}`,kind:'throw',typeIndex:0,facing,grounded,direction,trace:[],captures:[]};if(!addCase(c))continue;await pickup(c);await step({},8);if(!grounded)await page.evaluate(()=>window.__itemAirFixture());c.before=await read();
  c.entry=await step({grab:true,moveX:direction==='forward'?facing:direction==='back'?-facing:0,moveY:direction==='up'?-1:direction==='down'?1:0});c.trace.push(c.entry);await capture(c,'release');
  const suffix=direction==='forward'?'f':direction==='back'?'b':direction==='up'?'hi':direction==='down'?'lw':'drop',sheet=direction==='drop'?'item_throw_drop':`item_throw_${grounded?'':'air_'}${suffix}`,native=direction==='forward'?12:direction==='back'?14:direction==='up'?15:direction==='down'?8:7;
  assert.equal(c.entry.actor.item?.sheet,sheet,`${c.id}: actual requested direction must select distinct source context`);assert.equal(c.entry.actor.item.nativeAge,native);assert.ok(c.entry.thrown,'normal release creates thrown runtime');
  const point=checkBody(c.entry,{held:false}).expected,vel={x:c.entry.thrown.vx,y:c.entry.thrown.vy-.45};c.release={x:c.entry.thrown.x-vel.x,y:c.entry.thrown.y-vel.y};near(c.release.x,point.x,'post-physics source releaseX');near(c.release.y,point.y,'post-physics source releaseY');
  const spec=c.entry.item.throwSpec[direction];assert.equal(c.entry.actor.item.facing,c.before.actor.facing,'release keeps pre-input entry facing');near(vel.x,spec.velocityX*c.before.actor.facing,'unchanged authored throwVX in entry basis');near(vel.y,spec.velocityY,'unchanged authored throwVY');
  for(let age=1;age<6;age++){const o=await step();c.trace.push(o);assert.equal(o.actor.item?.sheet,sheet);assert.equal(o.actor.item.eventAge,age);assert.equal(o.actor.item.nativeAge,native);checkBody(o,{held:false});if(age===5)await capture(c,age);}
  c.exit=await step();assert.equal(c.exit.actor.item,null);await capture(c,'free');
 }
 for(const facing of [1,-1]){
  const c={id:`throw-jump-interrupt-${facing}`,kind:'throw-interrupt',typeIndex:0,facing,trace:[],captures:[]};if(addCase(c)){await pickup(c);await step({},8);c.entry=await step({grab:true,moveY:-1});c.interrupt=await step({jump:true});assert.equal(c.interrupt.actor.item,null);assert.ok(c.interrupt.actor.jumpsquat>0);await capture(c,'jump');}
  const d={id:`throw-air-landing-${facing}`,kind:'throw-landing',typeIndex:0,facing,trace:[],captures:[],fixtureScope:'Before release only, public Matter placement places held fighter30pxabove real floor descending4. Actual solver landing retires the airborne uncommitted cue.'};if(addCase(d)){await pickup(d);await step({},8);await page.evaluate(()=>window.__itemAirFixture({height:40,velocityY:0}));await page.evaluate(()=>window.__itemLandingFixture());d.before=await read();d.entry=await step({grab:true,moveY:-1});assert.equal(d.entry.actor.item?.sheet,'item_throw_air_hi');for(let n=0;n<4;n++)d.trace.push(await step());assert.ok(d.trace.some(o=>o.actor.grounded&&o.actor.item===null));await capture(d,'landed');}
 }
 for(let typeIndex=0;typeIndex<5;typeIndex++)for(const facing of [1,-1])for(const walking of [false,true]){
  const c={id:`keyboard-pickup-${typeIndex}-${facing}-${walking?'walk':'stand'}`,kind:'keyboard',typeIndex,facing,walking,trace:[],captures:[]};if(!addCase(c))continue;c.before=await reset(c);await page.evaluate(()=>window.__itemControls(false));const horizontal=facing===1?'d':'a';if(walking)await page.keyboard.down(horizontal);await page.keyboard.down('f');c.entry=await step();await page.keyboard.up('f');if(walking)await page.keyboard.up(horizontal);assert.equal(c.entry.controls,'REAL_KEYBOARD');assert.equal(c.entry.item.snapshot.state,'held');assert.equal(c.entry.actor.item?.sheet,walking?'item_pickup_walk':'item_pickup_stand');assert.equal(c.entry.actor.attack,null);checkBody(c.entry);await capture(c,'pickup');await page.keyboard.down('w');c.jumpTrace=[await step()];
  assert.equal(c.jumpTrace[0].actor.jumpsquat,0,'W/up+jump enters the shared ambiguity buffer');
  for(let n=0;n<tapJumpBufferFrames;n++)c.jumpTrace.push(await step());
  await page.keyboard.up('w');c.jump=c.jumpTrace.at(-1);
  for(const o of c.jumpTrace.slice(0,-1)){assert.equal(o.actor.jumpsquat,0);checkBody(o);}
  assert.ok(c.jump.actor.jumpsquat>0,'actual W jump resolves after the pinned4-step ambiguity window');assert.equal(c.jump.actor.item,null);checkBody(c.jump);await capture(c,'jump');
  c.takeoffTrace=await page.evaluate(()=>window.__itemTrace(8));c.takeoff=c.takeoffTrace.at(-1);
  assert.equal(c.takeoff.actor.grounded,false);assert.equal(c.takeoff.actor.jump?.kind,'ground');assert.match(c.takeoff.actor.texture,/^char\.pikachu\.jump(?:_back)?$/);assert.equal(c.takeoff.actor.item,null);
  for(const o of c.takeoffTrace)checkBody(o);await capture(c,'takeoff');
  c.landingTrace=await page.evaluate(()=>window.__itemUntilLandingReset());c.landing=c.landingTrace.at(-1);
  for(const o of c.landingTrace)checkBody(o);assert.equal(c.landing.actor.grounded,true);assert.equal(c.landing.actor.jumpsUsed,0);assert.equal(c.landing.actor.item?.sheet,'item_carry');await capture(c,'landed');
  await page.evaluate(()=>window.__itemControls(true));
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.cases.length,captures:report.cases.flatMap(c=>c.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
