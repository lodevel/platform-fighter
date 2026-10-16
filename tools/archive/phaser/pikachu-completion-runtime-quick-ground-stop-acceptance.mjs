import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-quick-ground-stop';
if(!process.env.PF_BUILD_RECORD)throw Error('Set PF_BUILD_RECORD');
const build=JSON.parse(await readFile(process.env.PF_BUILD_RECORD,'utf8'));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual standard flat stage normal simulated InputResolver grounded Quick horizontal burst and END; prepared entry SUM, subsequent ground STOP adapter and first free recovery,100-step post-END stock/helpless outcome. No widened fixture floor or native common STOP parity claim.'};
page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureGroundStop',n=>page.screenshot({path:`${output}/${n}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');report.build=build;assert.equal(report.bundleSha256,build.bundleSha256);
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:924,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let input={};s.inputResolver.getMoveVector=slot=>({x:slot===1?input.x??0:0,y:slot===1?input.y??0:0});s.inputResolver.isActionHeld=(slot,key)=>slot===1&&input[key]===true;
  const step=(next={})=>{input=next;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),a=s.p1,rows=[];
  const read=()=>({state:a.getPikachuSpecialState(),position:a.getPosition(),velocity:a.getVelocity(),grounded:a.isGrounded(),helpless:a.isHelpless(),stocks:s.stockTracker.getStocks(s.playerSlots[0].playerIndex),texture:s.playerSlots[0].sprite.texture.key,textureFrame:Number(s.playerSlots[0].sprite.frame.name),receiving:a.getActiveHurtboxes()});
  for(const facing of[1,-1]){
   a.resetForRound(facing===1?floor.bounds.min.x+200:floor.bounds.max.x-200,floor.bounds.min.y-25);s.p2.resetForRound(facing===1?floor.bounds.min.x+50:floor.bounds.max.x-50,floor.bounds.min.y-25);for(let n=0;n<12;n++)step();a.setFacing(facing);step({y:-1,special:true});
   const trace=[],captures=[],prepared=[];const runtime=a.pikachuSpecialRuntime,original=runtime.host.setVelocity.bind(runtime.host);runtime.host.setVelocity=v=>{const state=runtime.snapshot();if(state?.frame>=18&&state.frame<=21)prepared.push({frame:state.frame,velocity:{...v}});return original(v);};
   let ended=false,post=0;
   for(let frame=0;frame<180;frame++){
    const observation=read();trace.push(observation);if([18,19,20,29,44,52].includes(frame)){const screenshot=`ground-stop-${facing}-${frame}.png`;await window.__captureGroundStop(screenshot);captures.push({screenshot,observation});}
    if(!observation.state)ended=true;if(ended&&post++>=100)break;step(ended?{}:{x:facing});
   }
   runtime.host.setVelocity=original;rows.push({facing,trace,captures,prepared,floor:{left:floor.bounds.min.x,right:floor.bounds.max.x,top:floor.bounds.min.y}});
  }
  return rows;
 });
 for(const r of report.rows){const at=f=>r.trace.find(o=>o.state?.frame===f);assert.ok(Math.abs(r.prepared.find(p=>p.frame===19).velocity.x-at(18).velocity.x)<1e-5,'preserve completed SUM at ground END entry');assert.ok(at(44).grounded,'ground recovery stays on actual floor');assert.ok(!r.trace.at(-1).helpless);assert.equal(r.trace.at(-1).stocks,r.trace[0].stocks,'actor must not lose a stock after grounded Quick');}
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
