import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
const checkpoint=process.env.PF_CHECKPOINT??'.tmp/pikachu-airjump-tumble-production';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-helpless';
const build=JSON.parse(await readFile(`${checkpoint}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${checkpoint}-pikachu-frames.json`,'utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL(`../${checkpoint}-pikachuStateHurtboxes.ts`,import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],build,scope:'Actual Quick Attack source completion enters special fall without injected status, normal simulated resolver drift/action attempts, both facings, source8-step loop/12 receiving, real floor24-step lock and first free attack. Native common special-fall motion-rate and kinetic parity remains separate.'};
page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureCompletionHelpless',name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4242/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const active of game.scene.getScenes(true))game.scene.stop(active.scene.key);game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:915,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;let input={};scene.inputResolver.getMoveVector=slot=>({x:slot===1?input.moveX??0:0,y:slot===1?input.moveY??0:0});scene.inputResolver.isActionHeld=(slot,action)=>slot===1&&input[action]===true;
  scene.inputResolver.getSmash=slot=>({buttonHeld:slot===1&&input.attackHeavy===true,stickJustPressed:false,x:0,y:0});
  const step=(next={})=>{input=next;scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
  const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),others=scene.baseStage.bodies.platformBodies.filter(b=>b!==floor),columns=[];
  for(let x=floor.bounds.min.x+250;x<floor.bounds.max.x-250;x+=20)if(others.every(b=>x+25<b.bounds.min.x||x-25>b.bounds.max.x))columns.push(x);
  const x=columns[Math.floor(columns.length/2)],actor=scene.p1,rows=[];if(!Number.isFinite(x))throw new Error('clear floor column required');
  const read=()=>{const s=scene.playerSlots[0].sprite;return{helpless:actor.isHelpless(),grounded:actor.isGrounded(),ordinary:actor.getOrdinaryPresentationState(),landing:actor.getLandingPresentationState(),special:actor.getPikachuSpecialState(),attack:actor.getActiveAttack()?.move.id??null,jumps:actor.getJumpsUsed(),position:actor.getPosition(),velocity:actor.getVelocity(),texture:s.texture.key,textureFrame:Number(s.frame.name),origin:[s.originX,s.originY],mirror:Math.sign(s.scaleX)*(s.flipX?-1:1),receiving:actor.getActiveHurtboxes(),stocks:scene.stockTracker.getStocks(1)};};
  for(const facing of[1,-1]){
   actor.resetForRound(x,floor.bounds.min.y-525);scene.p2.resetForRound(floor.bounds.max.x-50,floor.bounds.min.y-25);actor.setFacing(facing);step();step({special:true,moveY:-1});
   const recovery=[];for(let n=0;n<100&&!actor.isHelpless();n++){recovery.push(read());step({moveY:-1});}if(!actor.isHelpless())throw new Error('normal recovery did not enter special fall');
   const trace=[],captures=[];let hasLanding=false;
   for(let n=0;n<150;n++){
    const o=read();trace.push(o);const phase=o.helpless?'fall_special':o.landing?.kind==='special'?'landing_special':null;
    const age=phase==='fall_special'?o.ordinary?.framesElapsed:o.landing?.framesElapsed;
    if(phase&&[0,4,8,12,20,23].includes(age)){const screenshot=`${phase}-${facing}-${age}.png`;await window.__captureCompletionHelpless(screenshot);captures.push({screenshot,phase,age,observation:o});}
    if(o.landing)hasLanding=true;if(hasLanding&&!o.landing&&!o.helpless)break;
    step(o.helpless?{moveX:facing*.3,attack:true,attackHeavy:true,special:true,jump:true}:{});
   }
   step({attack:true});const firstFreeAttack=read();rows.push({facing,recovery,trace,captures,firstFreeAttack});
  }
  return rows;
 });
 for(const row of report.rows){
  const helpless=row.trace.filter(o=>o.helpless&&!o.grounded);assert.ok(helpless.length>=13);assert.equal(helpless[0].ordinary.framesElapsed,0);
  assert.ok(helpless.every(o=>o.attack===null&&o.special===null),'offensive inputs cannot cancel helpless');assert.ok(helpless.every(o=>o.jumps===helpless[0].jumps),'jump cannot cancel helpless');assert.ok(helpless.some(o=>o.velocity.x*row.facing>.1),'ordinary air drift remains available');
  for(const o of helpless){const clip=metadata.animations.fall_special,local=o.ordinary.framesElapsed%8,w=clip.frameWindows.find(w=>w.startFrame<=local&&local<w.endFrame);assert.equal(o.texture,'char.pikachu.fall_special');assert.equal(o.textureFrame,w.artFrameIndex);assert.equal(o.mirror,row.facing);assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.receiving,poses.find(p=>p.sheet==='fall_special'&&p.artFrameIndex===w.artFrameIndex).hurtboxes);}
  const landing=row.trace.filter(o=>o.landing);assert.deepEqual(landing.map(o=>o.landing.framesElapsed),Array.from({length:24},(_,n)=>n));assert.ok(landing.every(o=>o.landing.kind==='special'&&o.landing.totalFrames===24&&o.attack===null));assert.equal(row.firstFreeAttack.attack,'pikachu.jab');assert.equal(row.firstFreeAttack.stocks,row.trace[0].stocks);
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length,bundleSha256:report.bundleSha256}));
}catch(error){report.result='FAIL';report.assertionFailure=error.stack;throw error;}finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
