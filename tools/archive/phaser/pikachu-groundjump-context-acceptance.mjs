import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-groundjump';
const record=JSON.parse(await readFile('.tmp/pikachu-groundjump-production-assets-staged.json','utf8'));
const metadata=JSON.parse(await readFile('.tmp/pikachu-groundjump-production-pikachu-frames.json','utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL('../.tmp/pikachu-groundjump-production-pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene normal ground full/short jump inputs. Pre-locomotion entry orientation persists during3-step squat; takeoff stick selects forward/backward. Both faces neutral→back and back→forward during squat, unchanged actual Matter arc, paired source body/receiving, pause/fall/landing. Real Wolf grab contact interrupts beta launch cue without status injection.'};page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureGroundjump',async name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4243/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,record.bundleSha256);
 report.observations=await page.evaluate(async()=>{
  const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:544,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;let inputs={};scene.inputResolver.getMoveVector=slot=>({x:inputs[slot]?.moveX??0,y:0});scene.inputResolver.isActionHeld=(slot,action)=>inputs[slot]?.[action]===true;const step=(one={},two={})=>{inputs={1:one,2:two};scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
  const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');for(const b of scene.baseStage.bodies.platformBodies.filter(b=>b!==floor)){b.collisionFilter.mask=0;scene.matter.world.remove(b);}const actor=scene.p1,x=(floor.bounds.min.x+floor.bounds.max.x)/2,rows=[],captures=[],grabTrials=[];
  const reset=(facing,wolfDistance=500)=>{actor.resetForRound(x,floor.bounds.min.y-25);actor.setDamagePercent(0);scene.p2.resetForRound(x-wolfDistance*facing,floor.bounds.min.y-scene.p2.getTuning().height/2);for(let n=0;n<12;n++)step();actor.setFacing(facing);scene.p2.setFacing(facing);if(!actor.isGrounded())throw Error('Ground fixture failed actual settle');};
  const read=()=>{const sprite=scene.playerSlots[0].sprite;return {jump:actor.getJumpPresentationState(),jumpsquat:actor.getJumpsquatRemaining(),ordinary:actor.getOrdinaryPresentationState(),capture:actor.getCapturePresentationState(),grounded:actor.isGrounded(),facing:actor.getFacing(),velocity:actor.getVelocity(),position:actor.getPosition(),receiving:actor.getActiveHurtboxes(),texture:sprite.texture.key,textureFrame:Number(sprite.frame.name),origin:[sprite.originX,sprite.originY],floorY:floor.bounds.min.y};};
  for(const facing of [1,-1])for(const shortHop of [false,true])for(const route of ['neutral-back','back-forward']){
   reset(facing);step({jump:true,moveX:route==='back-forward'?-facing:0});const takeoffX=route==='neutral-back'?-facing:facing;
   for(let n=0;n<3;n++)step({jump:!shortHop,moveX:takeoffX});const row={facing,shortHop,route,entry:read(),captures:[]};
   for(const target of [0,1,2,3,4,8,20]){
    for(let n=0;n<30&&(actor.getJumpPresentationState()?.framesElapsed??-1)<target;n++)step({jump:!shortHop});
    const observation=read(),screenshot=`${route}-${facing}-${shortHop?'short':'full'}-${target}.png`;await window.__captureGroundjump(screenshot);row.captures.push({target,observation,screenshot});
    if(target===1){const before=read();for(let n=0;n<4;n++)scene.update(0,scene.physicsEngine.fixedTimestepMs);row.freeze={before,after:read()};}
   }
   row.timeline=[];for(let n=0;n<140;n++){step();const o=read();row.timeline.push({step:n,grounded:o.grounded,texture:o.texture,jump:o.jump});if(o.grounded){row.landed=o;break;}}rows.push(row);
  }
  for(const facing of [1,-1])for(const shortHop of [false,true]){
   let accepted=null;
   for(const delay of [2,1,3,0,4])for(const distance of [48,52,44,56]){
    if(accepted)continue;reset(facing,distance);step({}, {grab:true});for(let n=0;n<delay;n++)step();step({jump:true});const timeline=[];let previous=read();
    for(let n=0;n<12;n++){step({jump:!shortHop});const o=read();timeline.push({step:n,observation:o,wolfGrab:scene.p2.getGrabState()});if(o.capture){const trial={facing,shortHop,delay,distance,previous,after:o,timeline};grabTrials.push(trial);if(previous.jump?.kind==='ground'&&previous.jump.framesElapsed<(shortHop?4:2)){const screenshot=`capture-${facing}-${shortHop?'short':'full'}.png`;await window.__captureGroundjump(screenshot);accepted={...trial,screenshot};}break;}previous=o;}
   }
   captures.push({facing,shortHop,accepted});
  }
  return {rows,captures,grabTrials};
 });
 for(const row of report.observations.rows){const backward=row.route==='neutral-back',sheet=backward?'jump_back':'jump';assert.equal(row.entry.jump.kind,'ground');assert.equal(row.entry.jump.facing,row.facing);assert.equal(row.entry.jump.moveX,backward?-row.facing:row.facing);assert.equal(row.entry.jump.shortHop,row.shortHop);
  for(const {target,observation:o} of row.captures){assert.equal(o.jump.framesElapsed,target);assert.equal(o.facing,row.facing);const hold=target<(backward?(row.shortHop?3:1):(row.shortHop?4:2)),selected=o.velocity.y>0?'fall':hold?'jumpsquat':sheet,local=selected==='fall'?o.ordinary.framesElapsed:hold?2:target;const win=metadata.animations[selected].frameWindows.find(w=>w.startFrame<=local&&local<w.endFrame);assert.ok(win);assert.equal(o.texture,`char.pikachu.${selected}`);assert.equal(o.textureFrame,win.artFrameIndex);assert.deepEqual(o.receiving,poses.find(p=>p.sheet===selected&&p.artFrameIndex===win.artFrameIndex).hurtboxes);assert.deepEqual(o.origin,[.5,.8125]);}
  assert.deepEqual(row.freeze.before,row.freeze.after);assert.ok(row.timeline.some(r=>r.texture==='char.pikachu.fall'));assert.equal(row.landed?.grounded,true);
 }
 for(const row of report.observations.captures){assert.ok(row.accepted,`actual grab must interrupt launch cue ${row.facing}/${row.shortHop}`);assert.equal(row.accepted.after.jump,null);assert.equal(row.accepted.previous.texture,'char.pikachu.jumpsquat');assert.ok(row.accepted.after.texture.includes('capture'),'dedicated capture route replaces launch cue');}
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,routes:report.observations.rows.length,captures:report.observations.captures.length,bundle:report.bundle}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
