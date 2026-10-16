// Presentation/pacing fixture: genuine accepted-hit API, then only normal RAF.
// This does not claim attack-input/collision acceptance coverage.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/final/launch-raf');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={cases:[],errors:[],
 scope:'Explicit accepted-hit fixture (100% damage,18% packet,base14,growth0,25deg); natural RAF only after application. No attack-input proof or physics-speed change.'};
page.on('pageerror',error=>report.errors.push(error.stack));
try{
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 for(const characterId of ['link','donkeykong','pikachu']){
  await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:223018,itemFrequency:'off',linkIntroPolicy:'none',
   finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:false},players:[
    {index:1,characterId,paletteIndex:0,inputType:'keyboard_p1'},
    {index:2,characterId:'pikachu',paletteIndex:1,inputType:'keyboard_p2'}]});
  const row=await page.evaluate(async()=>{
   const sim=window.__sim.match,actor=sim.playerSlots[0].character;
   const floor=sim.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid');
   actor.resetForRound(floor.position.x,floor.bounds.min.y-actor.getTuning().height/2-140);actor.setDamagePercent(100);
   const receipt=actor.applyHitDetailed({damage:18,knockback:{base:14,growth:0,angle:25,reference:{base:110,growth:20,angle:25}},facing:1,hitlagMultiplier:0});
   const rows=[],started=performance.now(),initialFrame=window.__sim.frame,identity=sim.buildIdentity;
   const initialPosition={...actor.getPosition()};
   const read=now=>{
    const position=actor.getPosition(),velocity=actor.getVelocity(),bounds=actor.body.bounds;
    const points=[bounds.min,bounds.max].map(p=>window.__sim.project(p.x,p.y));
    const onViewport=Math.max(...points.map(p=>p.x))>=0&&Math.min(...points.map(p=>p.x))<=innerWidth&&
      Math.max(...points.map(p=>p.y))>=0&&Math.min(...points.map(p=>p.y))<=innerHeight;
    const draw=window.__sim.presentation(0);
    return{now,observedAt:performance.now(),elapsedMs:performance.now()-started,frame:window.__sim.frame,position:{...position},velocity:{...velocity},
     sourceRoot:actor.getSourceRootPosition(),onViewport,projectedBody:points,
     stocks:sim.stockTracker.getStocks(0),respawning:sim.stockTracker.isRespawning(0),hitstun:actor.getHitstunRemaining(),
     generation:actor.getPositionResetGeneration(),draw:draw&&{key:draw.key,frame:draw.frame,x:draw.x,y:draw.y,
      visible:draw.visible,submitted:draw.submitted,textureResident:draw.textureResident},fault:window.__sim.fault};
   };
   // First post-hit GPU upload belongs to the real RAF too; do not warm the
   // launched pose with a diagnostic draw before starting the observation.
   window.__sim.manual(false);
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Natural RAF launch capture exceeded10seconds')),10000);
    const observe=now=>{rows.push(read(now));if(performance.now()-started>=1500){clearTimeout(timer);window.__sim.manual(true);resolve();}
     else requestAnimationFrame(observe);};requestAnimationFrame(observe);});
   return{characterId:actor.id,identity,receipt,initialFrame,initialPosition,rows};
  });
  const beforeKO=row.rows.filter(r=>r.stocks===5&&!r.respawning),inView=beforeKO.filter(r=>r.onViewport);
  row.summary={rafSamples:row.rows.length,elapsedMs:row.rows.at(-1).elapsedMs,frames:row.rows.at(-1).frame-row.initialFrame,
   beforeKO:beforeKO.length,onViewportBeforeKO:inView.length,
   missingBeforeKO:beforeKO.filter(r=>!r.draw?.visible||!r.draw?.submitted).length,
   missingOnViewport:inView.filter(r=>!r.draw?.visible||!r.draw?.submitted).length,
   firstOutsideViewportMs:row.rows.find(r=>!r.onViewport)?.elapsedMs??null,
   firstStockLossMs:row.rows.find(r=>r.stocks<5)?.elapsedMs??null,
   maxFrameGap:Math.max(0,...row.rows.slice(1).map((r,i)=>r.frame-row.rows[i].frame)),
   maxRafGapMs:Math.max(0,...row.rows.slice(1).map((r,i)=>r.now-row.rows[i].now)),
   maxFrameWorkMs:Math.max(...row.rows.map(r=>r.observedAt-r.now))};
  report.cases.push(row);
  assert.ok(row.summary.frames>=30,'normal RAF must advance the simulation');
  assert.ok(row.summary.onViewportBeforeKO>=3,'trajectory must include multiple visible browser frames');
  assert.equal(row.summary.missingBeforeKO,0,'accepted launch must retain native submitted art until actual stock loss');
  assert.equal(row.summary.missingOnViewport,0);assert.ok(row.rows.every(r=>r.fault===null));
  await page.screenshot({path:`${out}/${characterId}-after.png`});
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
