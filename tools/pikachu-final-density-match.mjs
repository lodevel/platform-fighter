// Controlled real-match Final acceptance. Setups grant resource/place actors;
// activation uses a real browser keyboard event through the saved binding.
// Run under flock .tmp/dk-heavy.lock. Never builds or modifies shared dist.
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {launchWindowsEdgeCdp} from './windows-edge-cdp.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-16/pikachu-final-density/runtime-before');
await mkdir(out,{recursive:true});
const report={url:arg('url','http://127.0.0.1:4173/platform-fighter/'),input:'REAL browser keyboard activation; resource/placement are injected setup',errors:[],rows:[]};
const edge=process.argv.includes('--edge')?await launchWindowsEdgeCdp({windowsPort:9243,bridgePort:9244}):null;
const browser=edge?await chromium.connectOverCDP(edge.endpoint):await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 report.loadedScript=await openMatchHost(page,report.url);
 report.scripts=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src));
 for(const pacing of (process.argv.includes('--skip-pacing')?[false]:[false,true]))for(const airborne of [false,true])for(const facing of [1,-1])for(const target of ['hit','miss']){
  const key=`${airborne?'air':'ground'}-${facing===1?'right':'left'}-${target}`;
  if(arg('case',key)!==key || (pacing && (airborne || facing!==1)))continue;
  await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
   finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
    {index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},
    {index:2,characterId:arg('victim','donkeykong'),paletteIndex:0,inputType:'keyboard_p2'}]});
  const setup=await page.evaluate(({airborne,facing,target})=>{
   const s=window.__sim.match;
   window.__pfFinalScene=s;
   window.__pfFinalStep=()=>{window.__sim.step();window.__sim.draw();
    const s=window.__sim.match,run=s.finalSmashController.getActive(),snap=s.finalChoreography.snapshot(),a=s.p1,d=s.p2;
    return{frame:s.physicsEngine.getFrame(),phase:run?.phase??null,age:run?.phaseAge??null,captures:run?.captures??[],
     owner:a.getPosition(),velocity:a.getVelocity(),grounded:a.isGrounded(),hitlag:a.getHitlagRemaining(),
     damage:d.getDamagePercent(),victim:d.getPosition(),victimControl:d.getFinalSmashControl(),
     ownerControl:a.getFinalSmashControl(),victimPresentation:d.getFinalVictimPresentationState(),
     ownerReceiving:a.getActiveHurtboxes(),victimReceiving:d.getActiveHurtboxes(),ownerPose:a.getFinalSmashPose?.()??null,victimPose:d.getFinalVictimBodyPose(),
     sprite:window.__sim.presentation(0),victimSprite:window.__sim.presentation(1),
     fx:window.__sim.view().presentationSprites,
     timeline:snap.timeline?.kind==='pikachu'?snap.timeline.state:null};};
   for(let i=0;i<240;i++)window.__pfFinalStep();
   const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
   const x=floor.position.x,top=floor.bounds.min.y;
   s.p1.resetForRound(x,top-s.p1.getTuning().height/2);s.p1.setFacing(facing);
   s.p2.resetForRound(x+(target==='hit'?120:-180)*facing,top-s.p2.getTuning().height/2);s.p2.setFacing(-facing);
   for(let i=0;i<10;i++)window.__pfFinalStep();
   if(airborne){s.p1.resetForRound(x,top-s.p1.getTuning().height/2-160);s.p1.setFacing(facing);}
   const frame=s.physicsEngine.getFrame();
   for(const slot of s.playerSlots)s.consumeFinalEvents(s.finalSmashController.resetParticipant(slot.playerIndex,
    slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
   const ownerIndex=s.playerSlots[0].playerIndex,bindingSlot=s.playerSlots[0].bindingsSlot;
   s.consumeFinalEvents(s.finalSmashController.grantBall(ownerIndex,frame),frame);
   const binding=window.__sim.inputResolver.dispatcher.bindings.get(bindingSlot).bindings.special.find(b=>b.kind==='keyboard');
   return{ownerIndex,bindingSlot,binding,grounded:s.p1.isGrounded(),actionable:s.p1.canActivateFinalSmash(),resource:s.finalSmashController.getAvailableResource(ownerIndex)};
  },{airborne,facing,target});
  const row={key,pacing,setup,trace:[],shots:[],visualReceipts:[],resourcesBefore:await page.evaluate(()=>window.__sim.renderDiagnostics())};report.rows.push(row);
  const bindingCode=setup.binding?.keyCode??setup.binding?.code;
  assert.ok(Number.isInteger(bindingCode),'keyboard special binding has numeric keyCode');
  const keyboardKey=String.fromCharCode(bindingCode);
  await page.keyboard.down(keyboardKey);
  row.trace.push(await page.evaluate(()=>window.__pfFinalStep()));
  await page.keyboard.up(keyboardKey);
  if(pacing){
   row.pacingSamples=await page.evaluate(async()=>{
    const samples=[];window.__sim.manual(false);let started=false,endedAt=null,last=performance.now();
    for(let n=0;n<2400;n++){
     const now=await new Promise(requestAnimationFrame),s=window.__sim.match,run=s.finalSmashController.getActive();
     const phase=run?.phase??null;if(phase)started=true;if(started&&!phase&&endedAt===null)endedAt=n;
     samples.push({delta:now-last,frame:s.physicsEngine.getFrame(),phase,age:run?.phaseAge??null,control:s.p1.getFinalSmashControl(),sprite:window.__sim.presentation(0),fault:window.__sim.fault});last=now;
     if(endedAt!==null&&n-endedAt>120)break;
    }
    window.__sim.manual(true);return samples;
   });
   row.resourcesAfter=await page.evaluate(()=>window.__sim.renderDiagnostics());
   const deltas=row.pacingSamples.slice(1).map(r=>r.delta).sort((a,b)=>a-b);
   row.pacingSummary={samples:deltas.length,median:deltas[Math.floor(deltas.length*.5)],p95:deltas[Math.floor(deltas.length*.95)],max:Math.max(...deltas),over50ms:deltas.filter(x=>x>50).length};
   assert.ok(row.pacingSamples.some(r=>r.phase===target),'natural RAF reaches '+target);
   assert.ok(row.pacingSamples.every(r=>r.fault===null),'natural RAF no fault');
   console.log(JSON.stringify({key,pacing:true,...row.pacingSummary}));continue;
  }
  const phases=new Set();let started=false,placed=false;
  for(let i=0;i<650;i++){
   const next=await page.evaluate(()=>window.__pfFinalStep());row.trace.push(next);
   if(airborne&&target==='hit'&&next.phase==='dash'&&!placed){
    // Arrange an airborne recipient at the actual end of startup, before the
    // next dash step; its ordinary gravity then remains part of the match.
    await page.evaluate(facing=>{const s=window.__pfFinalScene,p=s.p1.getPosition();
     s.matter.body.setPosition(s.p2.body,{x:p.x+120*facing,y:p.y});s.matter.body.setVelocity(s.p2.body,{x:0,y:0});},facing);
    placed=true;row.airTargetPlacedAtDashFrame=next.frame;
   }
   if(next.phase)started=true;
   if(next.phase&&!phases.has(next.phase)){
    phases.add(next.phase);
    const path=`${out}/${key}-${next.phase}.png`;const visual=await page.evaluate(()=>{window.__sim.draw();return{owner:window.__sim.presentation(0),recipient:window.__sim.presentation(1),fx:window.__sim.presentationSprites?.()??null};});await page.screenshot({path});row.shots.push(path);row.visualReceipts.push({frame:next.frame,phase:next.phase,path,...visual});
   }
   for(const cue of [{phase:'finish',age:10,name:'finish-burst'},{phase:'startup',age:35,name:'startup-glow'}])if(next.phase===cue.phase&&next.age>=cue.age&&!row[cue.name]){const visual=await page.evaluate(()=>{window.__sim.draw();return{owner:window.__sim.presentation(0),recipient:window.__sim.presentation(1),fx:window.__sim.presentationSprites?.()??null};});const path=`${out}/${key}-${cue.name}.png`;await page.screenshot({path});row.shots.push(path);row[cue.name]=path;row.visualReceipts.push({frame:next.frame,phase:cue.name,path,...visual});}
   if(started&&!next.phase&&!next.ownerControl)break;
  }
  row.phases=[...phases];row.maxDamage=Math.max(...row.trace.map(r=>r.damage));
  row.finished=started&&row.trace.at(-1).phase===null;
  row.maxCaptures=Math.max(...row.trace.map(r=>r.captures.length));
  row.textures=[...new Set(row.trace.map(r=>r.sprite?.key??null))];
  row.victimTextures=[...new Set(row.trace.map(r=>r.victimSprite?.key??null))];
  row.ownerFinalVisible=row.trace.filter(r=>r.ownerControl?.role==='owner').every(r=>r.sprite?.visible&&(r.sprite.key===`char.pikachu.${r.ownerControl.sheet}`||r.sprite.key.startsWith('char.pikachu.visual_final_')));
  row.capturedVisible=row.trace.filter(r=>r.captures.length).every(r=>r.victimSprite?.visible&&r.victimPose?.receiving.length);
  row.releasedVisible=row.trace.at(-1).victimSprite?.visible===true;
  row.fxReceiptKeys=[...new Set(row.visualReceipts.flatMap(v=>v.fx??[]).filter(v=>v.submitted&&v.textureResident).map(v=>v.key))];
  row.authoritySha256=createHash('sha256').update(JSON.stringify(row.trace.map(({sprite,victimSprite,fx,...authority})=>authority))).digest('hex');
  row.resourcesAfter=await page.evaluate(()=>window.__sim.renderDiagnostics());
  row.leasesReleased=row.trace.at(-1).ownerControl===null&&row.trace.at(-1).victimControl===null;
  console.log(JSON.stringify({key,phases:row.phases,damage:row.maxDamage,captures:row.maxCaptures,finished:row.finished}));
  await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 }
 assert.deepEqual(report.errors,[],'no page errors');
 if(process.argv.includes('--require-fx')){const all=report.rows.flatMap(row=>row.visualReceipts).flatMap(r=>r.fx??[]);assert.ok(all.length,'actual FX residency diagnostics are available');for(const effect of all){assert.ok(effect.textureResident&&effect.submitted&&effect.visible,'actual selected FX textured quad submitted: '+effect.key);assert.ok(effect.textureWidth>0&&effect.textureHeight>0&&effect.frameWidth>0&&effect.frameHeight>0,'decoded actual FX dimensions: '+effect.key);}const keys=new Set(all.map(effect=>effect.key));for(const sheet of ['hold','sphere_start','elec','explosion'])assert.ok(keys.has('char.pikachu.fx__pikachu_final_'+sheet),'actual resident submitted '+sheet+' page observed');}
 if(process.argv.includes('--require-hit'))for(const row of report.rows.filter(r=>!r.pacing)){
  assert.ok(row.finished,row.key+' completes');assert.ok(row.ownerFinalVisible,row.key+' actual Final owner texture is visible throughout');assert.ok(row.leasesReleased,row.key+' releases leases');assert.ok(row.releasedVisible,row.key+' ordinary rival visible after release');
  if(row.key.endsWith('-hit')){assert.ok(row.maxCaptures>0,row.key+' captures');assert.ok(row.capturedVisible,row.key+' every captive draw/receiving pose present');assert.ok(row.phases.includes('finish'),row.key+' finishes');assert.ok(row.maxDamage>=20,row.key+' damages');}
  else{assert.ok(row.phases.includes('miss'),row.key+' misses');assert.equal(row.maxCaptures,0);}
 }
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();if(edge)await writeFile(out+'/cleanup.json',JSON.stringify(await edge.close(),null,2)+'\n');}
