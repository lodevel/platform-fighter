import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-quick-turn';
if(!process.env.PF_BUILD_RECORD)throw Error('Set immutable PF_BUILD_RECORD');
const build=JSON.parse(await readFile(process.env.PF_BUILD_RECORD,'utf8'));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene InputResolver first vertical burst and decision-step27; both-facing source strict35-degree and .5-magnitude qualification, late-step rejection, independent second50-speed branch and69/83 endpoints. Logical simulated controls; native whole collision/status ordering remains separately unqualified.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureQuickTurn',n=>page.screenshot({path:`${output}/${n}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');report.build=build;assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:918,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let input={};
  s.inputResolver.getMoveVector=slot=>({x:slot===1?input.x??0:0,y:slot===1?input.y??0:0});
  s.inputResolver.isActionHeld=(slot,key)=>slot===1&&input[key]===true;
  const step=(next={})=>{input=next;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),a=s.p1,rows=[];
  const variants=[{id:'same',angle:0,magnitude:1,from:27,second:false},{id:'below-angle',angle:34.99,magnitude:1,from:27,second:false},{id:'above-angle',angle:35.01,magnitude:1,from:27,second:true},{id:'below-magnitude',angle:60,magnitude:.499,from:27,second:false},{id:'above-magnitude',angle:60,magnitude:.501,from:27,second:true},{id:'late-input',angle:60,magnitude:1,from:28,second:false}];
  const read=()=>({state:a.getPikachuSpecialState(),position:a.getPosition(),velocity:a.getVelocity(),facing:a.getFacing(),stocks:s.stockTracker.getStocks(0),texture:s.playerSlots[0].sprite.texture.key,textureFrame:Number(s.playerSlots[0].sprite.frame.name),receiving:a.getActiveHurtboxes()});
  for(const facing of[1,-1])for(const variant of variants){
   a.resetForRound(floor.position.x,floor.bounds.min.y-450);s.p2.resetForRound(floor.bounds.max.x-50,floor.bounds.min.y-25);for(let n=0;n<12;n++)step();a.setFacing(facing);
   step({y:-1,special:true});const trace=[read()],captures=[];
   const angle=variant.angle*Math.PI/180,stick={x:facing*Math.sin(angle)*variant.magnitude,y:-Math.cos(angle)*variant.magnitude};
   for(let frame=1;frame<=90;frame++){
    step(frame>=variant.from&&frame<=32?stick:{y:-1});const observation=read();trace.push(observation);
    if([27,28,33].includes(frame)){const screenshot=`turn-${facing}-${variant.id}-${frame}.png`;await window.__captureQuickTurn(screenshot);captures.push({screenshot,observation});}
    if(!observation.state)break;
   }
   rows.push({facing,variant,stick,trace,captures});
  }
  return rows;
 });
 for(const r of report.rows){
  const active=r.trace.filter(o=>o.state),decision=active.find(o=>o.state.frame===27);
  assert.equal(decision.state.second,r.variant.second,r.variant.id+' decision');
  assert.deepEqual(active.map(o=>o.state.frame),Array.from({length:r.variant.second?83:69},(_,i)=>i));
  if(r.variant.second){const warp=active.find(o=>o.state.frame===28);assert.ok(Math.abs(Math.hypot(warp.velocity.x,warp.velocity.y)-49.5)<1e-5);assert.equal(warp.facing,r.facing);}
  assert.equal(r.trace.at(-1).stocks,r.trace[0].stocks,'fixture must not hide stock loss');
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
