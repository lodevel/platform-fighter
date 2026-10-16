// Diagnostic phase timing on the unchanged production host. Accelerated loops
// deliberately block the page; only an individual call measures a frame hitch.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/final/phase-profile');await mkdir(out,{recursive:true});
const scenario=value('scenario','cpu'),targeted=scenario==='link-final-startup';
const frames=Number(value('frames',targeted?'90':'8100')),drawEvery=Number(value('draw-every',targeted?'1':'30'));
const batchSize=targeted?30:300;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[],drawEvery,scenario,batchSize,
 scope:'Accelerated diagnostic batches. sim/view/host-update timings separated; GPUdraw includes presenter.frame+oneview/HUDupdate. Batchwalltime is not a natural RAF frame duration. TargetedFinal uses explicitresource/placement fixture and real savedDOMspecial input.'};
page.on('pageerror',error=>report.errors.push(error.stack));
const save=()=>writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
try{
 await page.addInitScript(()=>{
  window.__glProfile={};
  for(const constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
   if(!constructor)continue;
   for(const name of ['texImage2D','texSubImage2D','texStorage2D','bufferData','bufferSubData','drawElements','drawArrays','compileShader','linkProgram','getProgramParameter']){
    if(!Object.hasOwn(constructor.prototype,name))continue;
    const original=constructor.prototype[name];
    constructor.prototype[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{
     const ms=performance.now()-start,profile=window.__glProfile;
     const row=profile[name]??={calls:0,totalMs:0,maxMs:0,slowest:[]};row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);
     if(ms>5){const image=args.at(-1);row.slowest.push({ms,width:image?.width,height:image?.height});row.slowest.sort((a,b)=>b.ms-a.ms);row.slowest.length=Math.min(row.slowest.length,3);}
    }};
   }
  }
 });
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 await launchMatch(page,targeted?{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
   {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},
   {index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}:
  {mode:'time',stockCount:99,timeLimitSeconds:3600,stageId:'flat',rngSeed:223015,itemFrequency:'high',
   linkIntroPolicy:'none',finalSmashRules:{schemaVersion:1,meterEnabled:true,smashBallEnabled:true},
   players:['link','donkeykong','pikachu','link'].map((characterId,index)=>({index:index+1,characterId,paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}))});
 report.buildIdentity=await page.evaluate(()=>window.__sim.match.buildIdentity);
 let specialKey=null;
 if(targeted){
  specialKey=await page.evaluate(()=>{
   const sim=window.__sim.match;for(let n=0;n<240;n++)window.__sim.step();
   const floor=sim.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid');
   sim.p1.resetForRound(floor.position.x,floor.bounds.min.y-sim.p1.getTuning().height/2);sim.p1.setFacing(1);
   sim.p2.resetForRound(floor.position.x-180,floor.bounds.min.y-sim.p2.getTuning().height/2);
   for(let n=0;n<10;n++)window.__sim.step();const frame=window.__sim.frame;
   for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
   sim.consumeFinalEvents(sim.finalSmashController.grantBall(0,frame),frame);
   return String.fromCharCode(window.__sim.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(b=>b.kind==='keyboard').keyCode);
  });
 }
 await page.evaluate(()=>{
  const sim=window.__sim.match,probe=window.__sim;
  window.__phaseSamples=[];const stack=[];
  for(const [target,key,phase]of [[sim,'step','simulation'],[sim,'view','view'],[probe,'step','hostStep'],[probe,'draw','drawIncludingViewAndGPU']]){
   const original=target[key].bind(target);target[key]=(...args)=>{
    const start=performance.now(),parent=stack.at(-1)??null;stack.push(phase);try{return original(...args);}finally{
     stack.pop();
     const active=sim.finalSmashController.getActive();window.__phaseSamples.push({phase,ms:performance.now()-start,
      parent,frame:sim.physicsEngine.getFrame(),final:active&&{fighter:active.owner.fighter,age:sim.physicsEngine.getFrame()-active.startedFrame,phase:active.phase,owner:active.owner}});
    }
   };
  }
 });
 if(specialKey)await page.keyboard.down(specialKey);
 for(let remaining=frames;remaining>0;remaining-=batchSize){
  const row=await page.evaluate(({count,drawEvery})=>{
   window.__phaseSamples=[];window.__glProfile={};const start=performance.now();
   for(let n=0;n<count;n++){window.__sim.step();if(n%drawEvery===0)window.__sim.draw();}
   const samples=window.__phaseSamples,groups={};
   for(const phase of ['simulation','view','hostStep','drawIncludingViewAndGPU']){
    const rows=samples.filter(row=>row.phase===phase),times=rows.map(row=>row.ms).sort((a,b)=>a-b);
    groups[phase]={calls:rows.length,totalMs:times.reduce((a,b)=>a+b,0),p50:times[Math.floor(times.length*.5)],
     p95:times[Math.floor(times.length*.95)],maxMs:times.at(-1),slowest:rows.sort((a,b)=>b.ms-a.ms).slice(0,3)};
   }
   return{frame:window.__sim.frame,wallMs:performance.now()-start,groups,
    hostUpdateEstimateMs:groups.hostStep.totalMs-groups.simulation.totalMs-samples.filter(row=>row.phase==='view'&&row.parent==='hostStep').reduce((n,row)=>n+row.ms,0),
    gl:window.__glProfile,ownerPresentation:window.__sim.presentation(0),diagnostics:window.__sim.renderDiagnostics()};
  },{count:Math.min(batchSize,remaining),drawEvery});
  report.rows.push(row);console.log(JSON.stringify({frame:row.frame,wallMs:row.wallMs,groups:row.groups,hostUpdateEstimateMs:row.hostUpdateEstimateMs}));await save();
 }
 if(specialKey)await page.keyboard.up(specialKey);
 if(targeted&&!report.rows.some(row=>row.ownerPresentation?.key==='char.link.d04final'))throw new Error('Targeted profile did not activate real Link Final owner art');
 report.result=report.errors.length?'FAIL':'COMPLETE';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await save();await browser.close();}
