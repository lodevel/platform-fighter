// Real production host, actual CPU decisions/items/Finals; no per-tick digest workload.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/freezes/stress');await mkdir(out,{recursive:true});
const frames=Number(value('frames','15000'));
assert.ok(Number.isSafeInteger(frames)&&frames>0);
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.stack));
const save=()=>writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
try{
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 await launchMatch(page,{mode:'time',stockCount:99,timeLimitSeconds:3600,stageId:'flat',rngSeed:223015,itemFrequency:'high',
  linkIntroPolicy:'none',finalSmashRules:{schemaVersion:1,meterEnabled:true,smashBallEnabled:true},
  players:['link','donkeykong','pikachu','link'].map((characterId,index)=>({index:index+1,characterId,paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}))});
 report.buildIdentity=await page.evaluate(()=>window.__sim.match.buildIdentity);
 report.loadingDiagnostics=await page.evaluate(()=>window.__sim.renderDiagnostics());
 const start=await page.evaluate(()=>{window.__sim.manual(false);return window.__sim.frame;});
 await page.waitForFunction(frame=>window.__sim.frame>frame+60,start,{timeout:30000});
 await page.evaluate(()=>window.__sim.manual(true));
 report.rafBeforeStress={start,end:await page.evaluate(()=>window.__sim.frame)};
 for(let remaining=frames;remaining>0;remaining-=300){
  const count=Math.min(300,remaining);
  const row=await Promise.race([page.evaluate(count=>{
   const sim=window.__sim.match,start=performance.now();
   for(let n=0;n<count;n++){window.__sim.step();if(n%10===0)window.__sim.draw();}
   return {frame:window.__sim.frame,ms:performance.now()-start,bodies:sim.physicsWorld.world.getAllBodies().length,
    items:sim.itemRegistry.getActive().length,projectiles:sim.projectiles.length,history:sim.inputCaptureBuffer.size(),
    finalSequence:sim.finalSmashController.snapshot().sequence,fault:window.__sim.fault,
    contextLost:window.__sim.renderDiagnostics().contextLost};
  },count),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('300-frame browser batch exceeded 60 seconds')),60000);timer.unref();})]);
  report.rows.push(row);console.log(JSON.stringify(row));
  assert.equal(row.fault,null);assert.equal(row.contextLost,false);assert.equal(row.history,row.frame);
  await save();
 }
 const last=await page.evaluate(()=>{window.__sim.manual(false);return window.__sim.frame;});
 await page.waitForFunction(frame=>window.__sim.frame>frame+60,last,{timeout:30000});
 report.rafAfterStress={start:last,end:await page.evaluate(()=>window.__sim.frame)};
 report.finalDiagnostics=await page.evaluate(()=>window.__sim.renderDiagnostics());
 report.faults=await page.evaluate(()=>window.__menu.faults);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.faults,[]);
 assert.ok(report.rows.at(-1).finalSequence>0,'stress must exercise actual Final activations');
 report.result='PASS';await page.screenshot({path:out+'/after-stress.png'});
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await save();await browser.close();}
