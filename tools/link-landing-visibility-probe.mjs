/** Actual saved DOM actions, with explicit isolated positioning between cases.
 * Tracks every simulation tick through the production drawing host. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const contexts=process.argv.includes('--contexts');
const url=arg('url','http://127.0.0.1:4173/platform-fighter/'),out=arg('out','.tmp/link-landing-visibility');
await mkdir(out,{recursive:true});
const report={url,input:'Actual saved DOM jump/attack/direction/shield/special bindings; deterministic neutral opponent. Explicit position/facing reset before each case; no landing/action/animation injection.',
 scope:'Both facings and palettes 0/3; ordinary, aerial, dodge, special landings onto actual stage platforms; repeat boomerang. Diagnostics track requested sheet, body state, decoded texture and submitted geometry each tick.',errors:[],cases:[]};
const harness=await readFile(new URL(import.meta.url));
report.harnessSha256=createHash('sha256').update(harness).digest('hex');
await writeFile(out+'/harness-at-run.mjs',harness);
if(contexts)report.scope='Both facings/palettes0/3; renamed authored versions of all5 aerials land through actual DOM attack input. Actual saved jump resolves explicit head/feet-alignment fixtures for front/back/air recipient and performer. Authored registration fixture is not editor/save UI coverage.';
const edge=process.argv.includes('--edge')?await launchWindowsEdgeCdp({windowsPort:9235,bridgePort:9236}):null;
const browser=edge?await chromium.connectOverCDP(edge.endpoint):await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
const save=()=>writeFile(out+'/report.json',JSON.stringify(report,null,1)+'\n');
try{
 report.browser=browser.version();report.script=await openMatchHost(page,url);
 report.graphics=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas?.getContext('webgl2')??canvas?.getContext('webgl');if(!gl)return null;const d=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),parallelShaderCompile:Boolean(gl.getExtension('KHR_parallel_shader_compile'))};});
 for(const facing of [1,-1]){
  const paletteIndex=facing===1?0:3;
  await launchMatch(page,{mode:'stocks',stockCount:99,stageId:'flat',rngSeed:161026,itemFrequency:'off',linkIntroPolicy:'none',players:[
   {index:1,characterId:'link',paletteIndex,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]});
  const bindings=await page.evaluate(()=>{
   const host=window.__sim,sim=host.match,neutral={moveX:0,moveY:0,jump:false,attack:false,attackHeavy:false,special:false,shield:false,dodge:false,grab:false,dropThrough:false};
   for(let i=0;i<180;i++)host.step([neutral,neutral]);
   window.__linkVisibility={reset(facing){const floor=sim.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
    const floating=sim.baseStage.bodies.platformBodies.filter(b=>b.plugin.passThrough).sort((a,b)=>b.position.y-a.position.y)[0];
    const x=floating?.position.x??floor.position.x;
    sim.p1.resetForRound(x,floor.bounds.min.y-sim.p1.getTuning().height/2);sim.p1.setFacing(facing);
    sim.p2.resetForRound(floor.position.x+450,floor.bounds.min.y-sim.p2.getTuning().height/2);sim.p2.setFacing(-1);
    for(let i=0;i<10;i++)host.step([neutral,neutral]);
    return {floor:floor.bounds,floating:floating?.bounds,position:sim.p1.getPosition(),grounded:sim.p1.isGrounded()};},
    step(){const v=host.step(),f=v.fighters[0],a=f.animation;host.draw();const p=host.presentation(0);return{
      frame:v.frame,position:f.position,root:sim.p1.getSourceRootPosition(),grounded:a.grounded,velocity:sim.p1.getVelocity(),eliminated:f.eliminated,
      active:a.activeAttack&&{id:a.activeAttack.move.id,sourcePoseId:a.activeAttack.move.sourcePoseId,age:a.activeAttack.framesElapsed},
      landing:a.landingPresentation,helpless:a.helpless,invincible:sim.p1.isInvincible(),footstool:a.footstoolRecipientPresentation,sourceFootstool:sim.p1.getSourceLinkFootstoolPresentationRoute?.()??null,
      packed:a.packedBody,sourceRoute:sim.p1.getSourceContextualPresentationRoute(),
      pose:p&&{key:p.key,frame:p.frame,artState:p.art?.state,visible:p.visible,submitted:p.submitted,textureResident:p.textureResident,alpha:p.submittedAlpha,x:p.x,y:p.y,scaleX:p.scaleX,scaleY:p.scaleY},
      failures:host.renderDiagnostics?.().textures.failures??[]};},
   };
   const keyName=code=>({32:'Space',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',16:'Shift',17:'Control'}[code]??(code>=96&&code<=105?'Numpad'+(code-96):String.fromCharCode(code)));
   return Object.fromEntries(sim.playerSlots.flatMap((slot,i)=>Object.entries(host.inputResolver.dispatcher.bindings.get(slot.bindingsSlot).bindings).map(([k,v])=>[(i?'p2:':'')+k,v.filter(b=>b.kind==='keyboard').map(b=>keyName(b.keyCode))])));
  });
  report.bindings=bindings;
  const toward=facing===1?'right':'left',away=facing===1?'left':'right';
  const scenarios=contexts?[
   ...[['nair',[]],['fair',[toward]],['bair',[away]],['uair',['up']],['dair',['down']]].map(([slot,dirs])=>[
    `authored-${slot}`,[[['jump'],8],[[],slot==='uair'?2:12],[[...dirs,'attack'],1],[[],80]]]),
   ['footstool-recipient-ground',[[['p2:jump'],1],[[],70]]],
   ['footstool-recipient-back',[[['p2:jump'],1],[[],70]]],
   ['footstool-recipient-air',[[['p2:jump'],1],[[],90]]],
   ['footstool-performer',[[['jump'],4],[[],70]]],
  ]:[
   ['short-hop',[[['jump'],1],[[],90]]],['full-jump',[[['jump'],20],[[],90]]],
   ['double-jump',[[['jump'],8],[[],1],[['jump'],8],[[],115]]],
   ...[['nair',[]],['fair',[toward]],['bair',[away]],['uair',['up']],['dair',['down']]].map(([name,dirs])=>[name,[[['jump'],8],[[],12],[[...dirs,'attack'],1],[[],100]]]),
   ['air-dodge',[[['jump'],8],[[],12],[['shield'],1],[[],100]]],
   ['directional-air-dodge',[[['jump'],8],[[],12],[['shield',toward],1],[[],100]]],
   ['air-spin',[[['jump'],8],[['up','special'],1],[[],150]]],

   ['repeat-boomerang',[[[toward,'special'],1],[[],46],[[toward,'special'],1],[[],100]]],
  ];
  for(const [name,segments]of scenarios){
   const row={name,facing,paletteIndex,setup:await page.evaluate(f=>window.__linkVisibility.reset(f),facing),trace:[],screenshots:[]};report.cases.push(row);
   if(name.startsWith('authored-'))row.authored=await page.evaluate(slot=>{const a=window.__sim.match.p1,old=a.getAttack(`link.${slot}`),move={...old,id:`visibility.saved.${slot}`};
    a.addAttack(move);a[{nair:'setAerialNeutral',fair:'setAerialForward',bair:'setAerialBack',uair:'setAerialUp',dair:'setAerialDown'}[slot]](move.id);
    return{id:move.id,sourcePoseId:move.sourcePoseId,fixture:'public authored attack registration and aerial dispatch override; no timeline or draw injection'};},name.slice(9));
   if(name.startsWith('footstool'))row.contactFixture=await page.evaluate(({name,facing})=>{const h=window.__sim,s=h.match,
    performer=name==='footstool-performer',a=performer?s.p2:s.p1,j=performer?s.p1:s.p2,
    floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),ground=!name.endsWith('air')&&!performer;
    a.resetForRound(floor.position.x,floor.bounds.min.y-a.getTuning().height/2-(ground?0:400));a.setFacing(facing);j.resetForRound(floor.position.x+400,floor.bounds.min.y-450);j.setFacing(facing);
    for(let i=0;i<2;i++)h.step();const participant=a.getFootstoolParticipant(performer?1:0,{moveX:0,jump:false});
    const x=participant.head.x+(name.endsWith('back')?-2*facing:0);
    s.matter.body.setPosition(j.body,{x,y:participant.head.top-j.getTuning().height/2-3});s.matter.body.setVelocity(j.body,{x:0,y:1});
    return{ground,performer,recipient:participant,jumper:j.getFootstoolParticipant(performer?0:1,{moveX:0,jump:false}),fixture:'explicit pre-input head/feet alignment; real fresh saved jump resolves contact'};},{name,facing});
   let sawMissing=false,sawLanding=false;const footstoolSheets=new Set();
   for(const [keys,n]of segments){for(const key of keys){if(!bindings[key]?.[0])throw new Error('No saved '+key+' binding');await page.keyboard.down(bindings[key][0]);}
    for(let tick=0;tick<n;tick++){const sample=await page.evaluate(()=>window.__linkVisibility.step());row.trace.push(sample);
     const missing=!sample.eliminated&&!sample.pose?.visible;
     const footSheet=sample.pose?.key?.includes('.a06step')?sample.pose.key:null;
     if((missing&&!sawMissing)||(sample.landing&&!sawLanding)||(footSheet&&!footstoolSheets.has(footSheet))){
      const path=`${out}/${name}-${facing===1?'right':'left'}-${missing?'missing':footSheet?footSheet.split('.').at(-1):'landing'}.png`;await page.screenshot({path});row.screenshots.push(path);sawMissing||=missing;sawLanding||=Boolean(sample.landing);if(footSheet)footstoolSheets.add(footSheet);
     }
    }
    for(const key of keys)await page.keyboard.up(bindings[key][0]);
   }
   if(contexts){const path=`${out}/${name}-${facing===1?'right':'left'}-recovered.png`;await page.screenshot({path});row.screenshots.push(path);}
   row.summary={ticks:row.trace.length,missing:row.trace.filter(s=>!s.eliminated&&!s.pose?.visible).length,
    requestedSheets:[...new Set(row.trace.map(s=>s.packed?.clock?.sheet))],landings:[...new Set(row.trace.filter(s=>s.landing).map(s=>JSON.stringify({kind:s.landing.kind,moveId:s.landing.moveId,sourcePoseId:s.landing.sourcePoseId})))],
    activeMoves:[...new Set(row.trace.filter(s=>s.active).map(s=>s.active.id))],drawnSheets:[...new Set(row.trace.map(s=>s.pose?.key))]};
   if(row.authored)assert.ok(row.trace.some(s=>s.landing?.sourcePoseId===row.authored.sourcePoseId&&s.landing?.moveId===row.authored.id),`${name} enters its actual saved aerial landing`);
   if(name.startsWith('footstool'))assert.ok(row.trace.some(s=>s.sourceFootstool),`${name} actual source footstool admission`);
   console.log(JSON.stringify({name,facing,...row.summary}));await save();
  }
 }
 if(contexts&&process.argv.includes('--expect-fixed')){for(const c of report.cases){
  const wanted=c.name==='footstool-recipient-ground'?['char.link.a06steppose']:c.name==='footstool-recipient-back'?['char.link.a06stepback']:c.name==='footstool-recipient-air'?['char.link.a06stepairpose','char.link.a06stepfall']:c.name==='footstool-performer'?['char.link.a06stepjump']:[];
  for(const key of wanted)assert.ok(c.summary.drawnSheets.includes(key),`${c.name}/${c.facing} draws ${key}`);
 }}
 report.missing=report.cases.flatMap(c=>c.trace.filter(s=>!s.eliminated&&!s.pose?.visible).map(s=>({name:c.name,facing:c.facing,paletteIndex:c.paletteIndex,...s})));
 report.passed=report.errors.length===0&&report.missing.length===0;
}finally{await save();await context.close();await browser.close();if(edge)report.cleanup=await edge.close();await save();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,missing:report.missing?.length,errors:report.errors}));
if(!report.passed)process.exitCode=1;
