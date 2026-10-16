// Normal browser RAF throughout a real saved-key Final. Only initial
// resource and positions are setup fixtures; no forced hit/capture/release.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i<0?d:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-15/user-bugs/link/final-release-raf');await mkdir(out,{recursive:true});
const report={url:arg('url','http://127.0.0.1:4173/platform-fighter/'),errors:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try {
 report.build=await openMatchHost(page,report.url);
 await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
  {index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]});
 const key=await page.evaluate(()=>{
  const s=window.__sim.match;for(let i=0;i<240;i++)window.__sim.step();const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  s.p1.resetForRound(floor.position.x,floor.bounds.min.y-s.p1.getTuning().height/2);s.p1.setFacing(1);
  s.p2.resetForRound(floor.position.x+120,floor.bounds.min.y-s.p2.getTuning().height/2);s.p2.setFacing(-1);
  for(let i=0;i<10;i++)window.__sim.step();const frame=s.physicsEngine.getFrame();
  for(const slot of s.playerSlots)s.consumeFinalEvents(s.finalSmashController.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
  s.consumeFinalEvents(s.finalSmashController.grantBall(0,frame),frame);window.__sim.draw();
  const binding=window.__sim.inputResolver.dispatcher.bindings.get(s.playerSlots[0].bindingsSlot).bindings.special.find(b=>b.kind==='keyboard');
  window.__releaseRows=[];window.__releaseStop=false;window.__releaseDone=new Promise(resolve=>{window.__releaseResolve=resolve;});
  let sawCapture=false,releasedAt=null;
  const observe=now=>{if(window.__releaseStop)return;const victim=s.p2,p=victim.getPosition(),point=window.__sim.project(p.x,p.y),canvas=document.querySelector('canvas'),pose=window.__sim.presentation(1),run=s.finalSmashController.getActive();
   window.__releaseRows.push({now,frame:window.__sim.frame,phase:run?.phase,age:run?.phaseAge,captures:run?.captures?.length??0,
    captured:victim.getFinalSmashControl()?.role==='captured',damage:victim.getDamagePercent(),position:{...p},velocity:{...victim.getVelocity()},
    projected:point,onViewport:point.x>=0&&point.y>=0&&point.x<=canvas.clientWidth&&point.y<=canvas.clientHeight,
    eliminated:s.stockTracker.isEliminated(1),pose:pose&&{key:pose.key,frame:pose.frame,visible:pose.visible,submitted:pose.submitted}});
   const row=window.__releaseRows.at(-1);if(row.captured)sawCapture=true;
   if(sawCapture&&!row.captured&&row.damage>20&&releasedAt===null)releasedAt=now;
   if(releasedAt!==null&&now-releasedAt>=1500){window.__releaseStop=true;window.__releaseResolve();return;}
   requestAnimationFrame(observe);};
  setTimeout(()=>{if(!window.__releaseStop){window.__releaseStop=true;window.__releaseResolve();}},30000);
  requestAnimationFrame(observe);window.__sim.manual(false);return String.fromCharCode(binding.keyCode);
 });
 await page.keyboard.down(key);
 await page.waitForFunction(()=>Boolean(window.__sim.match.finalSmashController.getActive()),null,{timeout:30000,polling:'raf'});
 await page.keyboard.up(key);
 // This promise is installed before release. During the timing window only
 // the page's own RAF observer runs: no forced draws, screenshots or polling.
 await page.evaluate(()=>window.__releaseDone);
 report.rows=await page.evaluate(()=>{window.__releaseStop=true;return window.__releaseRows;});
 report.diagnostics=await page.evaluate(()=>window.__sim.renderDiagnostics());
 let captured=false;const release=[];
 for(const row of report.rows){if(row.captured)captured=true;if(captured&&!row.captured&&row.damage>20)release.push(row);}
 const gap=report.rows.slice(1).map((row,i)=>({ms:row.now-report.rows[i].now,steps:row.frame-report.rows[i].frame}));
 const sorted=gap.map(g=>g.ms).sort((a,b)=>a-b);
 report.summary={observations:report.rows.length,capturedObserved:captured,releaseObservations:release.length,
  visibleReleaseOnViewport:release.filter(r=>r.onViewport&&r.pose?.visible).length,
  missingReleaseOnViewport:release.filter(r=>r.onViewport&&!r.eliminated&&!r.pose?.visible).length,
  firstRelease:release[0],lastRelease:release.at(-1),medianRafMs:sorted[Math.floor(sorted.length*.5)],p95RafMs:sorted[Math.floor(sorted.length*.95)],maxRafMs:sorted.at(-1),maxStepsBetweenDraws:Math.max(...gap.map(g=>g.steps))};
 console.log(JSON.stringify(report.summary));
 if(report.errors.length||!captured||report.summary.visibleReleaseOnViewport<3||report.summary.missingReleaseOnViewport)throw new Error('Natural RAF capture/released body visibility failed');
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
