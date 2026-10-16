// Capture-free real saved-key Link Final startup on the three-roster host.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
import {browserGPUConfiguration,inspectMatchGPU} from './browser-gpu.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/final/link-final-raf');await mkdir(out,{recursive:true});
const gpuMode=value('gpu','software'),gpuConfig=browserGPUConfiguration(gpuMode);
const browser=await chromium.launch(gpuConfig.launch);
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[],
 scope:'FirstrealLinkFinal activation forLink+DK+Pika. Resource/placement fixture; savedDOMspecial; normalRAF120ticks withnopredraw/manualstep/screenshots/pollingduringcapture. Passivephase/GLinstrumentationaddsobservationoverhead. GPUwarmingisactualhostpolicy, notforciblyevicted.'};
page.on('pageerror',error=>report.errors.push(error.stack));
report.launch=gpuConfig.evidence;
const quantiles=rows=>{const sorted=rows.toSorted((a,b)=>a-b);return{n:rows.length,p50:sorted[Math.floor(rows.length*.5)]??null,p95:sorted[Math.floor(rows.length*.95)]??null,max:sorted.at(-1)??null};};
try{
 await page.addInitScript(()=>{
  window.__finalProfileEnabled=false;window.__finalToolCallbacks=new WeakSet();window.__finalHostRows=[];window.__finalPhase=[];window.__finalGL={};
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>raf(now=>{const start=performance.now();try{return callback(now);}finally{
   if(window.__finalProfileEnabled&&!window.__finalToolCallbacks.has(callback))window.__finalHostRows.push({now,ms:performance.now()-start});
  }});
  for(const constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
   if(!constructor)continue;
   for(const name of ['texImage2D','texSubImage2D','texStorage2D','drawElements','drawArrays','compileShader','linkProgram','getProgramParameter']){
    if(!Object.hasOwn(constructor.prototype,name))continue;const original=constructor.prototype[name];
    constructor.prototype[name]=function(...args){if(!window.__finalProfileEnabled)return original.apply(this,args);
     const start=performance.now();try{return original.apply(this,args);}finally{
      const ms=performance.now()-start,row=window.__finalGL[name]??={calls:0,totalMs:0,maxMs:0};row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
     }};
   }
  }
 });
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 assert.ok(report.script.endsWith('/'+value('expected-bundle','game-B95Fcp5p.js')));
 report.gpu=await inspectMatchGPU(page,gpuMode);
 await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
   {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},
   {index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'},
   {index:3,characterId:'pikachu',paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}]});
 report.setup=await page.evaluate(()=>{
  const sim=window.__sim.match,neutral=[0,0,0].map(()=>({moveX:0,jump:false}));
  for(let n=0;n<240;n++)window.__sim.step(neutral);
  const floor=sim.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid');
  for(const [i,slot]of sim.playerSlots.entries())slot.character.resetForRound(floor.position.x-i*250,floor.bounds.min.y-slot.character.getTuning().height/2);
  sim.p1.setFacing(1);for(let n=0;n<10;n++)window.__sim.step(neutral);const frame=window.__sim.frame;
  for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
  sim.consumeFinalEvents(sim.finalSmashController.grantBall(0,frame),frame);
  for(const method of ['fixedStep','advance','view']){const original=sim[method].bind(sim);sim[method]=(...args)=>{
   const start=performance.now();try{return original(...args);}finally{if(window.__finalProfileEnabled)window.__finalPhase.push({phase:method,ms:performance.now()-start});}
  };}
  return{identity:sim.buildIdentity,frame,key:String.fromCharCode(window.__sim.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(b=>b.kind==='keyboard').keyCode),
   diagnostics:window.__sim.renderDiagnostics()};
 });
 await page.keyboard.down(report.setup.key);
 report.rows=await page.evaluate(async()=>{
  const sim=window.__sim.match,rows=[];let started=0,activationFrame=null;
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('NaturalLinkFinalstartup exceeded15seconds')),15000);
   function observe(now){
    try{
     const active=sim.finalSmashController.getActive(),draw=window.__sim.presentation(0),frame=window.__sim.frame;
     if(active?.owner.fighter==='link'&&activationFrame===null)activationFrame=active.startedFrame;
     const phase=window.__finalPhase.splice(0),host=window.__finalHostRows.splice(0),gl=window.__finalGL;window.__finalGL={};
     const advanceMs=phase.filter(p=>p.phase==='advance').reduce((n,p)=>n+p.ms,0),viewMs=phase.filter(p=>p.phase==='view').reduce((n,p)=>n+p.ms,0);
     rows.push({now,observedAt:performance.now(),elapsedMs:performance.now()-started,frame,
      age:activationFrame===null?null:frame-activationFrame,phase:active?.phase??null,phaseCalls:phase,host,gl,
      hostOutsideAdvanceAndViewMs:host.reduce((n,r)=>n+r.ms,0)-advanceMs-viewMs,
      owner:draw&&{key:draw.key,frame:draw.frame,visible:draw.visible,submitted:draw.submitted,alpha:draw.alpha,submittedAlpha:draw.submittedAlpha},fault:window.__sim.fault});
     if(activationFrame!==null&&frame>=activationFrame+120){clearTimeout(timer);window.__sim.manual(true);window.__finalProfileEnabled=false;resolve();}
     else requestAnimationFrame(observe);
    }catch(error){clearTimeout(timer);reject(error);}
   }
   function release(){started=performance.now();window.__finalProfileEnabled=true;window.__sim.manual(false);requestAnimationFrame(observe);}
   window.__finalToolCallbacks.add(observe);window.__finalToolCallbacks.add(release);requestAnimationFrame(release);
  });return rows;
 });
 await page.keyboard.up(report.setup.key);
 const active=report.rows.filter(row=>row.phase!==null),allPhases=report.rows.flatMap(row=>row.phaseCalls);
 report.summary={observations:report.rows.length,activeObservations:active.length,
  elapsedMs:report.rows.at(-1).elapsedMs,simTicks:report.rows.at(-1).age,
  preparedOwnerPage:report.setup.diagnostics.textures.preparedDuringLoading.some(row=>row.key==='char.link.d04final'),
  observedWallGaps:quantiles(report.rows.slice(1).map((row,i)=>row.observedAt-report.rows[i].observedAt)),
  hostCallbacks:quantiles(report.rows.flatMap(row=>row.host.map(h=>h.ms))),
  fixedSteps:quantiles(allPhases.filter(p=>p.phase==='fixedStep').map(p=>p.ms)),
  advances:quantiles(allPhases.filter(p=>p.phase==='advance').map(p=>p.ms)),
  views:quantiles(allPhases.filter(p=>p.phase==='view').map(p=>p.ms)),
  hostOutsideAdvanceAndView:quantiles(report.rows.map(row=>row.hostOutsideAdvanceAndViewMs)),
  maxGL:Object.fromEntries([...new Set(report.rows.flatMap(row=>Object.keys(row.gl)))].map(key=>[key,Math.max(...report.rows.map(row=>row.gl[key]?.maxMs??0))])),
  missing:active.filter(row=>!row.owner?.visible||!row.owner?.submitted||row.owner?.key!=='char.link.d04final').length};
 assert.ok(active.length>=3);assert.equal(report.summary.missing,0);assert.ok(report.rows.every(row=>row.fault===null));assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
