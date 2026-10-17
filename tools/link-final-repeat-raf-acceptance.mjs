// Same-context first/second Link Final control. Application source/build stay unchanged.
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
import {browserGPUConfiguration,inspectMatchGPU} from './browser-gpu.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/final/hardware-link-repeat-raf');
await mkdir(out,{recursive:true});
const config=browserGPUConfiguration('hardware'),cdp=value('cdp',null),cpuProfile=process.argv.includes('--cpu-profile');
const inspectGPU=async page=>{const gpu=await inspectMatchGPU(page,cdp?'software':'hardware');
 gpu.parallelShaderCompile=await page.evaluate(()=>Boolean(document.querySelector('canvas')?.getContext('webgl2')?.getExtension('KHR_parallel_shader_compile')));
 if(cdp){assert.match(gpu.unmaskedRenderer??'',/D3D(?:11|12)/i);assert.match(gpu.unmaskedRenderer??'',/Intel|Iris|NVIDIA|GeForce/i);assert.doesNotMatch(gpu.unmaskedRenderer??'',/SwiftShader|llvmpipe|softpipe|lavapipe|Software/i);}return gpu;};
const report={createdAt:new Date().toISOString(),scriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),launch:cdp?{mode:'external-windows-edge-cdp',endpoint:cdp,ownership:'Dedicated context only; process lifecycle belongs to external bridge'}:config.evidence,errors:[],consoleErrors:[],activations:[],cpuProfileEnabled:cpuProfile,
 scope:'One browser/page/game WebGL context; unchanged Link+DK+Pikachu fixture; two actual saved DOM special activations. Page-side natural RAF observation through >=120 ticks and natural Final completion. No screenshots, forced draws, manual steps or evaluation polling during each observation. Initial/inter-activation placement/resource fixtures use manual steps. Passive wrappers and diagnostics add overhead. No forced texture/shader eviction; second follows first in same match.'};
const browser=cdp?await chromium.connectOverCDP(cdp):await chromium.launch(config.launch);
const context=await browser.newContext({viewport:{width:1280,height:800}});
const page=await context.newPage();
const profiler=cpuProfile?await context.newCDPSession(page):null;
report.browserVersion=browser.version();
report.userAgent=await page.evaluate(()=>navigator.userAgent);
page.on('pageerror',error=>report.errors.push(error.stack));
page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
const quantiles=rows=>{const sorted=rows.toSorted((a,b)=>a-b);return{n:rows.length,p50:sorted[Math.floor(rows.length*.5)]??null,p95:sorted[Math.floor(rows.length*.95)]??null,max:sorted.at(-1)??null};};
try{
 if(cdp){assert.match(report.userAgent,/Windows NT/);assert.match(report.userAgent,/Edg\/[\d.]+/);}
 await page.addInitScript(cpuProfile=>{
  const p=window.__repeat={enabled:false,toolCallbacks:new WeakSet(),hosts:[],phases:[],gl:{},ownerUploads:[],ownerDeletes:[],ownerTextureIds:[],longTasks:[],shaderEvents:[],shaderSources:{},usedProgramsByPhase:{},capturePhase:'loading',textureSequence:0};
  const ids=new WeakMap(),bound=new WeakMap(),programIds=new WeakMap(),shaderIds=new WeakMap();let programSequence=0,shaderSequence=0;
  const objectId=(object,kind)=>{if(!object||typeof object!=='object')return null;const bank=kind==='program'?programIds:shaderIds;if(!bank.has(object))bank.set(object,kind==='program'?++programSequence:++shaderSequence);return bank.get(object);};
  const id=texture=>{if(!texture)return null;if(!ids.has(texture))ids.set(texture,++p.textureSequence);return ids.get(texture);};
  const raf=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>raf(now=>{const start=performance.now();try{return callback(now);}finally{
   if(p.enabled&&!p.toolCallbacks.has(callback))p.hosts.push({now,start,end:performance.now(),ms:performance.now()-start});
  }});
  try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(p.enabled)p.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});}).observe({type:'longtask',buffered:false});}catch{}
  for(const constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
   if(!constructor)continue;
   const names=['bindTexture','deleteTexture','texImage2D','texSubImage2D','texStorage2D','drawElements','drawArrays','compileShader','linkProgram','getProgramParameter','getProgramInfoLog','getShaderInfoLog','createShader','createProgram','shaderSource','attachShader','useProgram','getShaderParameter'];
   if(cpuProfile)names.push('getActiveUniform','getUniformLocation','getAttribLocation','useProgram','getActiveAttrib','getShaderParameter','getShaderInfoLog','getProgramInfoLog','shaderSource','createShader','createProgram','getError','readPixels','finish','flush',...Object.getOwnPropertyNames(constructor.prototype).filter(name=>/^(?:vertexAttrib|uniform)/.test(name)));
   for(const name of new Set(names)){
    if(!Object.hasOwn(constructor.prototype,name))continue;const original=constructor.prototype[name];
    constructor.prototype[name]=function(...args){
     if(name==='bindTexture')bound.set(this,args[1]);
     const image=args.find(a=>a&&typeof a==='object'&&typeof a.width==='number'&&typeof a.height==='number');
     const width=image?.width??(name==='texStorage2D'?args[3]:name==='texSubImage2D'?args[4]:name==='texImage2D'?args[3]:null);
     const height=image?.height??(name==='texStorage2D'?args[4]:name==='texSubImage2D'?args[5]:name==='texImage2D'?args[4]:null);
     const ownerUpload=/^tex(Image|SubImage|Storage)2D$/.test(name)&&width===2192&&height===1520;
     const textureId=id(name==='deleteTexture'?args[0]:bound.get(this));
     const start=performance.now();let result;try{return result=original.apply(this,args);}finally{
      const end=performance.now(),ms=end-start;
      if(name==='useProgram'){const program=objectId(args[0],'program'),key=p.capturePhase+':'+program;if(!p.usedProgramsByPhase[key]){p.usedProgramsByPhase[key]=true;p.shaderEvents.push({name,start,end,ms,capturePhase:p.capturePhase,program,firstUseInPhase:true,frame:window.__sim?.frame??null});}}
      if(/^(?:compileShader|linkProgram|getProgramParameter|getProgramInfoLog|getShaderInfoLog|getShaderParameter|createShader|createProgram|shaderSource|attachShader)$/.test(name)){
       const program=/Program|attachShader/.test(name)?objectId(name==='createProgram'?result:args[0],'program'):null;
       const shader=/Shader|shaderSource/.test(name)?objectId(name==='createShader'?result:name==='attachShader'?args[1]:args[0],'shader'):null;
       if(name==='shaderSource')p.shaderSources[shader]=args[1];
       p.shaderEvents.push({name,start,end,ms,capturePhase:p.capturePhase,program,shader,...(/^(?:getProgramParameter|getShaderParameter)$/.test(name)?{parameter:args[1],value:result}:{}),...(name==='createShader'?{shaderType:args[0]}:{})});
      }
      if(ownerUpload){p.ownerUploads.push({name,start,end,ms,width,height,textureId});if(!p.ownerTextureIds.includes(textureId))p.ownerTextureIds.push(textureId);}
      if(name==='deleteTexture'&&p.ownerTextureIds.includes(textureId))p.ownerDeletes.push({textureId,at:end});
      if(p.enabled){const row=p.gl[name]??={calls:0,totalMs:0,maxMs:0};row.calls++;row.totalMs+=ms;row.maxMs=Math.max(row.maxMs,ms);if(cpuProfile&&ms>=5)(row.slowCalls??=[]).push({start,end,ms});}
     }
    };
   }
  }
 },cpuProfile);
 if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.setSamplingInterval',{interval:1000});await profiler.send('Performance.enable');}
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 assert.ok(report.script.endsWith('/'+value('expected-bundle','game-B95Fcp5p.js')));
 report.gpu=await inspectGPU(page);
 await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
   {index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},
   {index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'},
   {index:3,characterId:'pikachu',paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}]});
 report.loadingEvidence=await page.evaluate(()=>({readyObservedAt:performance.now(),shaderEvents:[...window.__repeat.shaderEvents],shaderSources:{...window.__repeat.shaderSources},diagnostics:window.__sim.renderDiagnostics()}));
 report.identity=await page.evaluate(()=>{
  const sim=window.__sim.match;
  for(const method of ['fixedStep','advance','view']){const original=sim[method].bind(sim);sim[method]=(...args)=>{
   const start=performance.now();try{return original(...args);}finally{if(window.__repeat.enabled)window.__repeat.phases.push({phase:method,ms:performance.now()-start});}
  };}
  return sim.buildIdentity;
 });
 assert.equal(report.identity,value('expected-identity','platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101'));
 for(let activation=1;activation<=2;activation++){
  const setup=await page.evaluate(activation=>{
   const sim=window.__sim.match,p=window.__repeat,neutral=[0,0,0].map(()=>({moveX:0,jump:false}));
   window.__sim.manual(true);p.capturePhase='fixture-'+activation;
   if(activation===1)for(let n=0;n<240;n++)window.__sim.step(neutral);
   if(sim.finalSmashController.getActive())throw new Error('Previous Final did not finish naturally');
   const floor=sim.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid');
   for(const [i,slot]of sim.playerSlots.entries())slot.character.resetForRound(floor.position.x-i*250,floor.bounds.min.y-slot.character.getTuning().height/2);
   sim.p1.setFacing(1);for(let n=0;n<10;n++)window.__sim.step(neutral);const frame=window.__sim.frame;
   for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
   sim.consumeFinalEvents(sim.finalSmashController.grantBall(0,frame),frame);
   p.hosts=[];p.phases=[];p.gl={};p.longTasks=[];
   return {activation,frame,key:String.fromCharCode(window.__sim.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(b=>b.kind==='keyboard').keyCode),
    fixture:sim.playerSlots.map(slot=>({fighter:window.__sim.config.players[slot.playerIndex].characterId,position:{...slot.character.getPosition()},velocity:{...slot.character.getVelocity()},facing:slot.character.getFacing(),damage:slot.character.getDamagePercent()})),
    diagnostics:window.__sim.renderDiagnostics(),ownerUploadsBefore:[...p.ownerUploads],ownerDeletesBefore:[...p.ownerDeletes],shaderEventsBefore:[...p.shaderEvents]};
  },activation);
  assert.equal(setup.diagnostics.contextLost,false);
  assert.equal(setup.diagnostics.textures.preparedDuringLoading.some(row=>row.key==='char.link.d04final'),false);
  const owner=setup.diagnostics.textures.resident.find(row=>row.key==='char.link.d04final');
  assert.deepEqual(owner,{key:'char.link.d04final',width:2192,height:1520,rgbaBytes:13327360,format:'rgba8',textureBytes:13327360});
  if(activation===1)assert.equal(setup.ownerUploadsBefore.length,0,'first Final owner page must not already be uploaded');
  else{assert.ok(setup.ownerUploadsBefore.length>0);assert.equal(setup.ownerDeletesBefore.length,0);assert.deepEqual(setup.fixture,report.activations[0].setup.fixture,'placement/velocity/facing/damage fixture must match');}
  if(profiler){setup.profileClock={page:await page.evaluate(()=>({now:performance.now(),timeOrigin:performance.timeOrigin})),cdp:await profiler.send('Performance.getMetrics')};await profiler.send('Profiler.start');}
  await page.keyboard.down(setup.key);
  const observation=await page.evaluate(async()=>{
   const sim=window.__sim.match,p=window.__repeat,rows=[];let started=0,activationFrame=null;
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{p.enabled=false;window.__sim.manual(true);reject(new Error('Natural repeat Final exceeded 20 seconds'));},20000);
    function observe(now){try{
     const active=sim.finalSmashController.getActive(),draw=window.__sim.presentation(0),frame=window.__sim.frame;
     if(active?.owner.fighter==='link'&&activationFrame===null)activationFrame=active.startedFrame;
     const observedAt=performance.now(),phase=p.phases.splice(0),host=p.hosts.splice(0),gl=p.gl;p.gl={};
     const advanceMs=phase.filter(row=>row.phase==='advance').reduce((n,row)=>n+row.ms,0),viewMs=phase.filter(row=>row.phase==='view').reduce((n,row)=>n+row.ms,0);
     rows.push({now,observedAt,elapsedMs:observedAt-started,frame,age:activationFrame===null?null:frame-activationFrame,phase:active?.phase??null,runId:active?.id??null,phaseCalls:phase,host,gl,
      hostOutsideAdvanceAndViewMs:host.reduce((n,row)=>n+row.ms,0)-advanceMs-viewMs,
      render:window.__sim.renderDiagnostics().renderer,
      owner:draw&&{key:draw.key,frame:draw.frame,visible:draw.visible,submitted:draw.submitted,alpha:draw.alpha,submittedAlpha:draw.submittedAlpha},fault:window.__sim.fault});
     if(activationFrame!==null&&frame>=activationFrame+120&&!active){clearTimeout(timer);p.enabled=false;window.__sim.manual(true);resolve();}
     else requestAnimationFrame(observe);
    }catch(error){clearTimeout(timer);p.enabled=false;window.__sim.manual(true);reject(error);}}
    function release(){started=performance.now();p.capturePhase='activation-'+(sim.finalSmashController.snapshot().sequence+1);p.enabled=true;window.__sim.manual(false);requestAnimationFrame(observe);}
    p.toolCallbacks.add(observe);p.toolCallbacks.add(release);requestAnimationFrame(release);
   });
   return {rows,started,ownerUploads:[...p.ownerUploads],ownerDeletes:[...p.ownerDeletes],longTasks:[...p.longTasks],shaderEvents:[...p.shaderEvents],shaderSources:{...p.shaderSources},diagnostics:window.__sim.renderDiagnostics()};
  });
  if(profiler){const {profile}=await profiler.send('Profiler.stop');observation.cpuProfileFile=`activation-${activation}.cpuprofile`;await writeFile(out+'/'+observation.cpuProfileFile,JSON.stringify(profile)+'\n');observation.cpuProfileMetadata={startTime:profile.startTime,endTime:profile.endTime,samples:profile.samples?.length??0};}
  await page.keyboard.up(setup.key);
  const rows=observation.rows,active=rows.filter(row=>row.phase!==null),startup=rows.filter(row=>row.age===null||row.age<=120),phases=startup.flatMap(row=>row.phaseCalls);
  const gaps=startup.slice(1).map((row,i)=>({ms:row.observedAt-startup[i].observedAt,rafTimestampMs:row.now-startup[i].now,fromAge:startup[i].age,toAge:row.age,fromFrame:startup[i].frame,toFrame:row.frame,priorHost:startup[i].host,nextHost:row.host,nextGL:row.gl}));
  const summary={observations:rows.length,activeObservations:active.length,elapsedMs:rows.at(-1).elapsedMs,lastAge:rows.at(-1).age,
   startupWallGaps:quantiles(gaps.map(row=>row.ms)),startupRAFGaps:quantiles(gaps.map(row=>row.rafTimestampMs)),largestStartupGaps:gaps.toSorted((a,b)=>b.ms-a.ms).slice(0,5),
   hostCallbacks:quantiles(startup.flatMap(row=>row.host.map(h=>h.ms))),fixedSteps:quantiles(phases.filter(row=>row.phase==='fixedStep').map(row=>row.ms)),advances:quantiles(phases.filter(row=>row.phase==='advance').map(row=>row.ms)),views:quantiles(phases.filter(row=>row.phase==='view').map(row=>row.ms)),
   maxGL:Object.fromEntries([...new Set(startup.flatMap(row=>Object.keys(row.gl)))].map(key=>[key,Math.max(...startup.map(row=>row.gl[key]?.maxMs??0))])),
   ownerUploadEventsDuring:observation.ownerUploads.slice(setup.ownerUploadsBefore.length),missing:active.filter(row=>!row.owner?.visible||!row.owner?.submitted||row.owner?.key!=='char.link.d04final').length};
  report.activations.push({setup,...observation,summary});
  assert.ok(active.length>=3);assert.equal(summary.missing,0);assert.ok(rows.every(row=>row.fault===null));assert.equal(observation.diagnostics.contextLost,false);
  if(activation===1)assert.ok(summary.ownerUploadEventsDuring.some(row=>row.name==='texSubImage2D'));
  else assert.equal(summary.ownerUploadEventsDuring.length,0,'second Final must reuse original native owner texture');
  assert.equal(observation.ownerDeletes.length,0);
 }
 const shaderEvents=report.activations.flatMap(activation=>activation.shaderEvents);
 report.shaderValidation={invalidLinkStatus:shaderEvents.filter(event=>event.name==='getProgramParameter'&&event.parameter===35714&&event.value===false),invalidCompileStatus:shaderEvents.filter(event=>event.name==='getShaderParameter'&&event.parameter===35713&&event.value===false),shaderConsoleErrors:report.consoleErrors.filter(message=>/THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS|shader.*(?:error|failed)|program.*link.*fail/i.test(message))};
 assert.deepEqual(report.shaderValidation.invalidLinkStatus,[]);assert.deepEqual(report.shaderValidation.invalidCompileStatus,[]);assert.deepEqual(report.shaderValidation.shaderConsoleErrors,[]);
 if(process.argv.includes('--expect-prepared-shapes')){
  const loading=report.loadingEvidence;
  const shapeShaders=Object.entries(loading.shaderSources).filter(([,source])=>source.includes('float starDistance(')).map(([id])=>Number(id));
  const shapePrograms=[...new Set(loading.shaderEvents.filter(event=>event.name==='attachShader'&&shapeShaders.includes(event.shader)).map(event=>event.program))];
  const loadingQueries=loading.shaderEvents.filter(event=>event.name==='getProgramInfoLog'&&shapePrograms.includes(event.program));
  const activationQueries=shaderEvents.filter(event=>event.name==='getProgramInfoLog'&&shapePrograms.includes(event.program)&&event.capturePhase.startsWith('activation-'));
  const activationShapeShaders=report.activations.flatMap(activation=>Object.entries(activation.shaderSources).filter(([,source])=>source.includes('float starDistance(')).map(([id])=>Number(id)));
  report.shaderPreparation={shapeShaders,shapePrograms,loadingQueries,activationQueries,
   activationShapePrograms:[...new Set(shaderEvents.filter(event=>event.name==='attachShader'&&activationShapeShaders.includes(event.shader)&&event.capturePhase.startsWith('activation-')).map(event=>event.program))]};
  assert.ok(shapePrograms.length>0,'shape program must be compiled before match ready');
  for(const program of shapePrograms)assert.ok(loadingQueries.some(event=>event.program===program),'each shape program must finish first-use validation during loading');
  assert.deepEqual(activationQueries,[],'prepared shape program must not repeat first-use validation during a Final');
  assert.deepEqual(report.shaderPreparation.activationShapePrograms,[],'Final must reuse the prepared shape shader variant');
 }
 report.gpuAfter=await inspectGPU(page);
 assert.deepEqual(report.errors,[]);
 report.comparison={firstMaxStartupWallGapMs:report.activations[0].summary.startupWallGaps.max,secondMaxStartupWallGapMs:report.activations[1].summary.startupWallGaps.max,secondMinusFirstMs:report.activations[1].summary.startupWallGaps.max-report.activations[0].summary.startupWallGaps.max,
  sameNativeOwnerTexture:report.activations[1].ownerUploads.every(row=>row.textureId===report.activations[0].ownerUploads[0].textureId),ownerDeleted:false};
 report.result='PASS';
 console.log(JSON.stringify({result:report.result,comparison:report.comparison,activations:report.activations.map(row=>row.summary)},null,2));
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await context.close();
 // connectOverCDP's browser.close disconnects its transport; it does not send Browser.close.
 // Its owned context was explicitly closed above. The bridge owns Edge process cleanup.
 await browser.close();}
