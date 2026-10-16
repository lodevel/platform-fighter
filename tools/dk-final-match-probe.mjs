// Actual Three.js match acceptance. Resource and initial positions are setup;
// activation is a browser keyboard event through the saved local binding.
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch,MATCH_URL} from './browser-match-host.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=arg('out','docs/review/2026-10-15/dk-final/runtime');
const ownerArt=JSON.parse(await readFile(new URL('../docs/review/2026-10-15/dk-final/owner-art-staging/art-clips.json',import.meta.url),'utf8'));
await mkdir(out,{recursive:true});
const report={url:arg('url',MATCH_URL),input:'real browser keyboard special; resource and target placement are controlled setup',errors:[],rows:[]};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',error=>report.errors.push(error.message));
try{
 report.loadedScript=await openMatchHost(page,report.url);
 const victims=process.argv.includes('--quick')?['donkeykong']:['donkeykong','pikachu','link'];
 for(const victim of victims)for(const airborne of [false,true])for(const facing of [1,-1])for(const target of victim==='donkeykong'?['hit','miss']:['hit']){
  const key=`${victim}-${airborne?'air':'ground'}-${facing===1?'right':'left'}-${target}`;
  await launchMatch(page,{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1511,itemFrequency:'off',linkIntroPolicy:'none',
   finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
    {index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},
    {index:2,characterId:victim,paletteIndex:0,inputType:'keyboard_p2'}]});
  const setup=await page.evaluate(({airborne,facing,target})=>{
   const sim=window.__sim.match;
   const read=()=>{
    const run=sim.finalSmashController.getActive(),control=sim.p1.getFinalSmashControl(),pose=sim.p2.getFinalVictimBodyPose();
    return{frame:sim.physicsEngine.getFrame(),phase:run?.phase??null,age:run?.phaseAge??null,captures:run?.captures??[],
     owner:sim.p1.getPosition(),victim:sim.p2.getPosition(),damage:sim.p2.getDamagePercent(),
     ownerControl:control,victimControl:sim.p2.getFinalSmashControl(),
     victimSelection:sim.p2.getFinalVictimPresentationSelection(),receivingCount:pose?.receiving.length??0,
     sprite:window.__sim.presentation(0),victimSprite:window.__sim.presentation(1),fit:sim.getFinalVictimFitSnapshot()};
   };
   const accepted=[];
   const hit=sim.finalHit.bind(sim);
   sim.finalHit=(...args)=>{
    const captured=sim.p2.getFinalSmashControl()?.role==='captured',noDead=sim.p2.isFinalSmashNoDead(),result=hit(...args);
    if(result)accepted.push({role:args[3],strike:args[1],captured,noDead});
    return result;
   };
   let arranged=false;
   window.__dkFinalStep=()=>{
    const run=sim.finalSmashController.getActive();
    if(target==='hit'&&run?.phase==='start'&&run.phaseAge===27&&!arranged){
     const root=sim.p1.getSourceRootPosition();
     sim.matter.body.setPosition(sim.p2.body,{x:root.x+100*facing,y:root.y-sim.p2.getTuning().height/2});
     sim.matter.body.setVelocity(sim.p2.body,{x:0,y:0});arranged=true;
    }
    window.__sim.step();return read();
   };
   window.__dkFinalAccepted=accepted;
   for(let i=0;i<240;i++)window.__sim.step();
   const floor=sim.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),x=floor.position.x,top=floor.bounds.min.y;
   sim.p1.resetForRound(x,top-sim.p1.getTuning().height/2);sim.p1.setFacing(facing);
   sim.p2.resetForRound(x+(target==='hit'?100:-250)*facing,top-sim.p2.getTuning().height/2);sim.p2.setFacing(-facing);
   for(let i=0;i<10;i++)window.__sim.step();
   if(airborne){sim.p1.resetForRound(x,top-sim.p1.getTuning().height/2-160);sim.p1.setFacing(facing);}
   const frame=sim.physicsEngine.getFrame();
   for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,
    slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
   sim.consumeFinalEvents(sim.finalSmashController.grantBall(0,frame),frame);
   const bindingSlot=sim.playerSlots[0].bindingsSlot;
   return{binding:window.__sim.inputResolver.dispatcher.bindings.get(bindingSlot).bindings.special.find(b=>b.kind==='keyboard'),
    grounded:sim.p1.isGrounded(),actionable:sim.p1.canActivateFinalSmash(),bindingSlot,buildIdentity:sim.buildIdentity};
  },{airborne,facing,target});
  const row={key,setup,trace:[],shots:[]};report.rows.push(row);
  const code=setup.binding?.keyCode??setup.binding?.code;
  assert.ok(Number.isInteger(code),key+' saved special binding is a keyboard key');
  await page.keyboard.down(String.fromCharCode(code));
  row.trace.push(await page.evaluate(()=>window.__dkFinalStep()));
  await page.keyboard.up(String.fromCharCode(code));
  const phases=new Set(),shots=new Set();let started=false;
  for(let i=0;i<350;i++){
   const state=await page.evaluate(()=>window.__dkFinalStep());row.trace.push(state);
   if(state.phase){started=true;phases.add(state.phase);}
   const shot=state.phase==='start'&&state.age===28?'detection':state.phase==='success'&&state.age===5?'barrage':state.phase==='end'&&state.age===6?'uppercut':null;
   if(shot&&!shots.has(shot)){
    shots.add(shot);await page.evaluate(()=>window.__sim.draw());
    const path=`${out}/${key}-${shot}.png`;await page.screenshot({path});row.shots.push(path);
   }
   if(started&&!state.phase)break;
  }
  row.phases=[...phases];row.accepted=await page.evaluate(()=>window.__dkFinalAccepted);
  row.maxDamage=Math.max(...row.trace.map(s=>s.damage));row.maxCaptures=Math.max(...row.trace.map(s=>s.captures.length));
  row.finished=started&&row.trace.at(-1).phase===null;
  row.leasesReleased=row.trace.at(-1).ownerControl===null&&row.trace.at(-1).victimControl===null;
  row.ownerTextures=[...new Set(row.trace.map(s=>s.sprite?.key??null))];
  row.victimTextures=[...new Set(row.trace.map(s=>s.victimSprite?.key??null))];
  row.capturedVisible=row.trace.filter(s=>s.captures.length).every(s=>s.victimSprite?.visible&&s.receivingCount>0);
  row.ownerDrawingChecks=0;row.pocketFitChecks=0;row.maxPocketFitError=0;
  for(const state of row.trace){
   const control=state.ownerControl;
   if(control?.role==='owner'){
    const clip=ownerArt[control.sheet];assert.ok(clip,key+' exact installed owner clip');
    const expectedFrame=clip.nativeSampleIndices.findLastIndex(sample=>sample<=control.age);
    assert.equal(state.sprite?.key,`char.donkeykong.${control.sheet}`,key+' actual selected owner texture');
    assert.equal(state.sprite?.frame,expectedFrame,key+' actual selected native drawing');
    assert.equal(state.sprite?.originX,control.facing===-1?1-clip.root[0]/clip.frameWidth:clip.root[0]/clip.frameWidth,key+' root X');
    assert.equal(state.sprite?.originY,clip.root[1]/clip.frameHeight,key+' root Y');
    assert.equal(state.sprite?.scaleX,clip.scaleToWorld,key+' native/world scale');
    row.ownerDrawingChecks++;
   }
   if(state.captures.length&&(state.phase==='success'||state.phase==='end'))for(const fit of state.fit){
    assert.ok(fit.victimAnchor&&fit.ownerPocket,key+' actual selected anchor and pocket');
    const error=Math.hypot(fit.victimAnchor.x-fit.ownerPocket.x,fit.victimAnchor.y-fit.ownerPocket.y);
    row.maxPocketFitError=Math.max(row.maxPocketFitError,error);row.pocketFitChecks++;
    assert.ok(error<1e-8,key+' same-tick selected anatomical anchor fits pocket');
   }
  }
  assert.ok(row.finished,key+' completes');assert.ok(row.leasesReleased,key+' releases leases');
  if(target==='hit'){
   assert.ok(row.maxCaptures>0,key+' captures');assert.ok(row.capturedVisible,key+' has captive art and receiving');
   assert.deepEqual(row.phases,['start','success','end'],key+' source phases');
   assert.equal(row.accepted.filter(h=>h.role==='dk-early').length,18,key+' early punches');
   assert.equal(row.accepted.filter(h=>h.role==='dk-late').length,13,key+' late punches');
   assert.deepEqual(row.accepted.filter(h=>h.role==='dk-finisher'),[{role:'dk-finisher',strike:'finisher',captured:false,noDead:false}],key+' released uppercut');
   for(const suffix of ['start','attack','end'])assert.ok(row.ownerTextures.some(key=>key?.includes(`final_${airborne?'air_':''}${suffix}`)),row.key+' displays actual '+suffix+' art');
  }else{assert.equal(row.maxDamage,0,key+' misses');assert.equal(row.maxCaptures,0,key+' has no captured victims');}
  console.log(JSON.stringify({key,phases:row.phases,damage:row.maxDamage,captures:row.maxCaptures,accepted:row.accepted.length,finished:row.finished}));
  await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 }
 assert.deepEqual(report.errors,[],'no page errors');report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
