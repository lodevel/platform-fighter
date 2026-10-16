// Actual production host + saved keyboard binding. Resources and placement are
// explicit setup; no collision, hit, capture or art state is fabricated.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-15/link-final/runtime');await mkdir(out,{recursive:true});
const report={url:arg('url','http://127.0.0.1:4173/platform-fighter/'),input:'Real DOM saved special key; explicit resource/placement fixtures; target repositioned at native59 before source shoot60',errors:[],rows:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try{
 report.loadedScript=await openMatchHost(page,report.url);
 for(const airborne of[false,true])for(const facing of[1,-1])for(const hit of[true,false]){
  const key=`${airborne?'air':'ground'}-${facing===1?'right':'left'}-${hit?'hit':'miss'}`;
  await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
   finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[{index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]});
  const setup=await page.evaluate(({airborne,facing,sampled})=>{
   const s=window.__sim.match;
   window.__linkFinalStep=()=>{const start=performance.now();window.__sim.step();if(!sampled)window.__sim.draw();const drawMs=performance.now()-start,run=s.finalSmashController.getActive(),a=s.p1,d=s.p2;
    return{frame:s.physicsEngine.getFrame(),phase:run?.phase??null,age:run?.phaseAge??null,control:a.getFinalSmashControl(),position:a.getPosition(),
     damage:d.getDamagePercent(),hitlag:d.getHitlagRemaining(),victimControl:d.getFinalSmashControl(),sprite:window.__sim.presentation(0),victimSprite:window.__sim.presentation(1),
     arrows:s.linkArticles.ancientArrows().map(a=>({...a.state})),fx:window.__sim.view().presentationSprites,drawMs,drawPerformed:!sampled,
     renderer:sampled?null:(()=>{const d=window.__sim.renderDiagnostics?.();return d&&{rgbaBytes:d.textures.rgbaBytes,resident:d.textures.resident.length,memory:d.renderer.memory,render:d.renderer.render,contextLost:d.contextLost};})()};};
   for(let i=0;i<240;i++)window.__linkFinalStep();
   const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),x=floor.position.x,top=floor.bounds.min.y;
   s.p1.resetForRound(x,top-36);s.p1.setFacing(facing);s.p2.resetForRound(x-180*facing,top-42);
   for(let i=0;i<10;i++)window.__linkFinalStep();
   if(airborne){s.p1.resetForRound(x,top-36-160);s.p1.setFacing(facing);}
   const frame=s.physicsEngine.getFrame();
   for(const slot of s.playerSlots)s.consumeFinalEvents(s.finalSmashController.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
   s.consumeFinalEvents(s.finalSmashController.grantBall(0,frame),frame);
   const binding=window.__sim.inputResolver.dispatcher.bindings.get(s.playerSlots[0].bindingsSlot).bindings.special.find(b=>b.kind==='keyboard');
   return{binding,resource:s.finalSmashController.getAvailableResource(0),airborne,facing};
  },{airborne,facing,sampled:process.argv.includes('--sampled-draw')});
  const row={key,setup,trace:[],shots:[],visualSamples:[]};report.rows.push(row);const keyboardKey=String.fromCharCode(setup.binding.keyCode);
  await page.keyboard.down(keyboardKey);row.trace.push(await page.evaluate(()=>window.__linkFinalStep()));await page.keyboard.up(keyboardKey);
  let started=false,placed=false;const shots=new Set(),sampledAges=new Set();
  for(let n=0;n<350;n++){
   const state=await page.evaluate(()=>window.__linkFinalStep());row.trace.push(state);if(state.phase)started=true;
   if(process.argv.includes('--sampled-draw')&&state.control?.role==='owner')for(const age of [0,8,16,24,32,40,48,56,59,60,64,72,80,88,100,112,124,130])if(state.age>=age&&!sampledAges.has(age)){
    sampledAges.add(age);const receipt=await page.evaluate(()=>{const t=performance.now();window.__sim.draw();return{sprite:window.__sim.presentation(0),victimSprite:window.__sim.presentation(1),drawOnlyMs:performance.now()-t,diagnostics:window.__sim.renderDiagnostics?.()};});
    row.visualSamples.push({nativeAge:state.age,frame:state.frame,...receipt});break;
   }
   if(state.age>=59&&!placed){await page.evaluate(({hit,facing})=>{const s=window.__sim.match,p=s.p1.getPosition();s.matter.body.setPosition(s.p2.body,{x:p.x+(hit?500:-180)*facing,y:p.y-12});s.matter.body.setVelocity(s.p2.body,{x:0,y:0});},{hit,facing});placed=true;row.placedAtFrame=state.frame;}
   const stamp=state.arrows[0]?.phase??(state.age===59?'draw':null);
   if(stamp&&!shots.has(stamp)){shots.add(stamp);await page.evaluate(()=>window.__sim.draw());const path=`${out}/${key}-${stamp}.png`;await page.screenshot({path});row.shots.push(path);}
   if(started&&!state.phase&&!state.arrows.length)break;
  }
  await page.evaluate(()=>window.__sim.draw());row.returnedSprite=await page.evaluate(()=>window.__sim.presentation(0));
  const active=row.trace.filter(s=>s.control?.role==='owner');row.ownerTextures=[...new Set(active.map(s=>s.sprite?.key))];
  row.ownerSelectedArtComplete=active.every(s=>s.sprite?.textureResident&&s.sprite.key===`char.link.${airborne?'d04finalair':'d04final'}`);
  row.drawQualification=process.argv.includes('--sampled-draw')?'Actual textured draws at up to18native startup/draw/shoot/return checkpoints; every selected frame separately recorded':'Actual draw every simulation step';
  row.ownerFinalVisible=process.argv.includes('--sampled-draw')?row.visualSamples.length>=10&&row.visualSamples.every(s=>s.sprite?.visible&&s.sprite.submitted)&&row.ownerSelectedArtComplete:active.every(s=>s.sprite?.visible&&s.sprite.key===`char.link.${airborne?'d04finalair':'d04final'}`);
  row.actualOwnerAlphaOpaque=process.argv.includes('--sampled-draw')?row.visualSamples.every(s=>s.sprite?.submittedAlpha===1):active.every(s=>s.sprite?.submittedAlpha===1);
  row.maxDamage=Math.max(...row.trace.map(s=>s.damage));row.maxBlastHitlag=Math.max(0,...row.trace.filter(s=>s.arrows.some(a=>a.phase==='fighter-blast')).map(s=>s.hitlag));
  row.arrowPhases=[...new Set(row.trace.flatMap(s=>s.arrows.map(a=>a.phase)))];row.finished=started&&row.trace.at(-1).phase===null;row.leasesReleased=row.trace.at(-1).control===null&&row.trace.at(-1).victimControl===null;
  row.ownerFrameSequence=active.map(s=>s.sprite?.frame);row.distinctOwnerFrames=new Set(row.ownerFrameSequence).size;
  const times=active.map(s=>s.drawMs).sort((a,b)=>a-b),summary={first:active[0]?.drawMs,median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)};
  if(process.argv.includes('--sampled-draw')){row.simulationStepAndViewMs=summary;const draws=row.visualSamples.map(s=>s.drawOnlyMs).sort((a,b)=>a-b);row.actualSubmittedDrawMs={median:draws[Math.floor(draws.length*.5)],p95:draws[Math.floor(draws.length*.95)],max:draws.at(-1)};}else row.stepAndDrawMs=summary;
  console.log(JSON.stringify({key,damage:row.maxDamage,phases:row.arrowPhases,owner:row.ownerTextures,finished:row.finished}));await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 }
 assert.deepEqual(report.errors,[]);
 if(process.argv.includes('--require-hit'))for(const row of report.rows){assert.ok(row.finished&&row.leasesReleased,row.key+' finishes/releases');assert.ok(row.ownerFinalVisible,row.key+' actual native owner art');assert.ok(row.actualOwnerAlphaOpaque,row.key+' actual submitted owner alpha remains1');if(row.key.endsWith('-hit')){assert.ok(row.maxDamage>=35,row.key+' real blast damage');assert.ok(row.arrowPhases.includes('fighter-blast'));assert.equal(row.maxBlastHitlag,0,'native disableHitlag respected');}else assert.equal(row.maxDamage,0,row.key+' miss does no damage');}
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
