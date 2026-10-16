// Capture-free natural RAF control: no screenshots, polling or subsequent
// page evaluations until the actual accepted Inferno death flight has ended.
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
import {browserGPUConfiguration,inspectMatchGPU} from './browser-gpu.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/final/inferno-knockout-raf-control');await mkdir(out,{recursive:true});
const clips={};
for(const [fighter,sheet]of [['donkeykong','tumble'],['pikachu','tumble'],['link','f01damageflyn']]){
 const clip=JSON.parse(await readFile(new URL(`../assets/characters/${fighter}/frames.json`,import.meta.url),'utf8')).animations[sheet];
 clips[`char.${fighter}.${sheet}`]={width:clip.frameWidth,height:clip.frameHeight,trims:clip.trims};
}
const gpuMode=value('gpu','software'),gpuConfig=browserGPUConfiguration(gpuMode);
const browser=await chromium.launch(gpuConfig.launch);
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[],
 scope:'Actual hazardclock preparedthrough1889 genuinefixedticks; repeats genuinelycapturedneutral/crouch inputs via replayAPI. ReleasesnormalRAF afterpresenterflush withfreshwalltimestamp. No screenshot/poll/manualstep/draw/forcedhazard/damage/slowedphysics duringobservation. Viewportbounds use actualsubmittedtrimmedquad, notROOT alone.'};
page.on('pageerror',error=>report.errors.push(error.stack));
report.launch=gpuConfig.evidence;
try{
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 const expected=value('expected-bundle',null);if(expected)assert.ok(report.script.endsWith('/'+expected));
 report.gpu=await inspectMatchGPU(page,gpuMode);
 await launchMatch(page,{mode:'stocks',stockCount:3,stageId:'inferno',rngSeed:223017,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:false},
  players:['donkeykong','pikachu','link','donkeykong'].map((characterId,index)=>({index:index+1,characterId,paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}))});
 const capture=await page.evaluate(async clips=>{
  const sim=window.__sim.match,inputs=[0,0,0,1].map(moveY=>({moveX:0,moveY,jump:false}));
  for(let n=0;n<1889;n++)window.__sim.step(inputs);
  const before={frame:window.__sim.frame,stocks:window.__sim.view().hud.players.map(p=>p.stocks)};
  const recorded=sim.getInputCaptureBuffer().getFrame(1888).inputs;
  sim.setRecordedInputs(Array.from({length:400},(_,n)=>({frame:1889+n,inputs:recorded})));
  const rows=[];let started=0,seen=false;
  const drawing=draw=>{
   if(!draw)return null;
   const clip=clips[draw.key],rect=clip?.trims?.[draw.frame];
   if(!clip||!rect)throw new Error('Missing actual native trimmed frame for viewport diagnostic');
   const [,,w,h,dx,dy]=rect,ox=(draw.originX??.5)*clip.width,oy=(draw.originY??.5)*clip.height;
   const sx=(draw.displayWidth!==undefined?draw.displayWidth/clip.width:draw.scaleX??1)*(draw.flipX?-1:1);
   const sy=(draw.displayHeight!==undefined?draw.displayHeight/clip.height:draw.scaleY??1)*(draw.flipY?-1:1);
   const qx=(draw.flipX?ox-clip.width:-ox)+dx,qy=(draw.flipY?oy-clip.height:-oy)+dy;
   const r=draw.rotation??0,c=Math.cos(r),s=Math.sin(r);
   const corners=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>{
    const px=(qx+x)*sx,py=(qy+y)*sy;
    return window.__sim.project(draw.x+c*px-s*py,draw.y+s*px+c*py);
   });
   const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x));
   const minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
   const canvas=document.querySelector('canvas'),onViewport=maxX>=0&&minX<=canvas.clientWidth&&maxY>=0&&minY<=canvas.clientHeight;
   return{key:draw.key,frame:draw.frame,x:draw.x,y:draw.y,visible:draw.visible,submitted:draw.submitted,
    textureResident:draw.textureResident,rotation:draw.rotation,alpha:draw.alpha,onViewport,
    projectedBounds:{minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY}};
  };
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Capture-free natural Inferno flight exceeded15seconds')),15000);
   const observe=now=>{
    try{
     const view=window.__sim.view(),flights=view.knockoutFlights??[];
     rows.push({now,observedAt:performance.now(),elapsedMs:performance.now()-started,frame:window.__sim.frame,
      stocks:view.hud.players.map(p=>p.stocks),flights,
      draws:flights.length?[0,1,2].map(i=>drawing(window.__sim.presentation(i))):[],fault:window.__sim.fault});
     if(flights.length)seen=true;
     if(seen&&!flights.length){clearTimeout(timer);window.__sim.manual(true);sim.setRecordedInputs(null);resolve();}
     else requestAnimationFrame(observe);
    }catch(error){clearTimeout(timer);reject(error);}
   };
   // The host registers its next RAF before rendering. This callback therefore
   // follows its presenter flush; the observer follows the next host flush.
   // Discard the stale timestamp from synchronous setup before releasing time.
   requestAnimationFrame(()=>{started=performance.now();window.__sim.manual(false);requestAnimationFrame(observe);});
  });
  return{before,rows,identity:sim.buildIdentity,diagnostics:window.__sim.renderDiagnostics()};
 },clips);
 report.buildIdentity=capture.identity;report.before=capture.before;report.rows=capture.rows;report.diagnostics=capture.diagnostics;
 const active=report.rows.filter(row=>row.flights.length),gaps=report.rows.slice(1).map((row,i)=>row.observedAt-report.rows[i].observedAt);
 report.summary={observations:report.rows.length,flightObservations:active.length,
  flightWallMs:active.at(-1).observedAt-active[0].observedAt,maxObservedGapMs:Math.max(0,...gaps),
  firstFlightFrame:active[0].frame,lastFlightFrame:active.at(-1).frame,
  perFighter:[0,1,2].map(i=>{
   const visible=active.filter(row=>row.draws[i]?.visible&&row.draws[i].submitted&&row.draws[i].onViewport);
   const atLeast4px=visible.filter(row=>row.draws[i].projectedBounds.width>=4&&row.draws[i].projectedBounds.height>=4);
   return{playerIndex:i,characterId:active[0].flights[i].characterId,submittedOnViewport:visible.length,
    firstVisibleMs:visible[0]?.elapsedMs,lastVisibleMs:visible.at(-1)?.elapsedMs,
    visibleWallMs:visible.length?visible.at(-1).observedAt-visible[0].observedAt:0,
    atLeast4pxBothDimensions:atLeast4px.length,firstOutsideViewportMs:active.find(row=>!row.draws[i]?.onViewport)?.elapsedMs??null,
    missingAnyFlight:active.filter(row=>!row.draws[i]?.visible||!row.draws[i]?.submitted).length,
    missingOnViewport:active.filter(row=>row.draws[i]?.onViewport&&!row.draws[i]?.visible).length};
  })};
 assert.deepEqual(report.before.stocks,[3,3,3,3]);
 assert.ok(active.length>=3);assert.ok(report.summary.flightWallMs>=800);
 for(const fighter of report.summary.perFighter){assert.ok(fighter.submittedOnViewport>=3);assert.equal(fighter.missingAnyFlight,0);assert.equal(fighter.missingOnViewport,0);}
 assert.ok(active.every(row=>row.flights.length===3&&JSON.stringify(row.stocks)==='[2,2,2,3]'));
 assert.ok(report.rows.every(row=>row.fault===null));assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
