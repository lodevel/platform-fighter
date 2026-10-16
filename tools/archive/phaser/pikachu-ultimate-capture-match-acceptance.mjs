import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/ultimate-capture';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],rows:[],scope:'Actual dedicated Pikachu ordinary grab sensor in MatchScene; entry-percent budget, logical cardinal mashing, frozen-step sampling,29 natural-release lock and60 grab-only immunity. Inputs are simulated resolver controls, not hardware/native clatter arbitration. Release arc and body/contextual choreography remain separately qualified.'};
page.on('pageerror',e=>report.errors.push(e.message));await page.exposeFunction('__captureUltimate',async n=>page.screenshot({path:`${output}/${n}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4238/platform-fighter/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:971,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:1,inputType:'keyboard_p2'}]}});
  const s=game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;let aInput={},bInput={};
  s.inputResolver.getMoveVector=slot=>{const i=slot===1?aInput:bInput;return{x:i.moveX??0,y:i.moveY??0};};s.inputResolver.isActionHeld=(slot,key)=>(slot===1?aInput:bInput)[key]===true;
  const step=(a={},b={})=>{aInput=a;bInput=b;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
  const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),a=s.p1,b=s.p2,rows=[];
  const observe=()=>({captured:b.isGrabbed(),budget:a.getCaptureBudgetState(),aRelease:a.getGrabReleasePresentationState(),bRelease:b.getGrabReleasePresentationState(),immunity:b.getPostReleaseGrabImmunityRemaining(),aCanAttack:a.canAttack(),bCanAttack:b.canAttack(),aHitlag:a.getHitlagRemaining(),bHitlag:b.getHitlagRemaining(),aPosition:a.getPosition(),bPosition:b.getPosition(),bPercent:b.getDamagePercent(),aBody:{texture:s.playerSlots[0].sprite.texture.key,frame:Number(s.playerSlots[0].sprite.frame.name),receiving:a.getActiveHurtboxes()},bBody:{texture:s.playerSlots[1].sprite.texture.key,frame:Number(s.playerSlots[1].sprite.frame.name),receiving:b.getActiveHurtboxes()}});
  for(const facing of [1,-1])for(const mode of ['natural','cardinal-mash']){
   a.resetForRound(floor.position.x,floor.bounds.min.y-25);b.resetForRound(floor.position.x+45*facing,floor.bounds.min.y-25);a.setDamagePercent(0);b.setDamagePercent(mode==='natural'?22.2:0);
   for(let n=0;n<12;n++)step();a.setFacing(facing);b.setFacing(-facing);step({grab:true});for(let n=0;n<12&&!b.isGrabbed();n++)step();if(!b.isGrabbed())throw Error('Real source standing sensor capture missed');
   const entry=observe(),captures=[],hold=[];const capture=async label=>{const screenshot=`${mode}-${facing}-${label}.png`,observation=observe();await window.__captureUltimate(screenshot);captures.push({screenshot,observation});};await capture('held-entry');
   let frozen=null;
   if(mode==='natural'){
    b.addDamage(40);for(let n=0;n<5;n++)step();const before=observe();a.armAttackerHitlag(4);b.armAttackerHitlag(4);const trace=[];for(let n=0;n<4;n++){step({}, {jump:true});trace.push(observe());}step({}, {jump:true});frozen={before,trace,after:observe()};
   }
   const directions=[{moveX:1},{moveY:1},{moveX:-1},{moveY:-1}];let n=0;
   while(b.isGrabbed()&&n<220){hold.push(observe());step({},mode==='cardinal-mash'?directions[n%4]:{});n++;}
   const released=observe();await capture('release0');const releaseTrace=[released];
   for(let age=1;age<=29;age++){step();releaseTrace.push(observe());if(age===28)await capture('release28');}
   const immunityTrace=[{age:29,...observe()}];
   // A genuine two-frame source sensor opens on immunity ages59 and60.
   for(let age=30;age<=61;age++){step(age===53?{grab:true}:{});immunityTrace.push({age,...observe()});if(b.isGrabbed())break;}
   rows.push({facing,mode,entry,frozen,hold,released,releaseTrace,immunityTrace,captures});
  }
  return rows;
 });
 for(const r of report.rows){
  assert.equal(r.entry.budget.initialFrames,r.mode==='natural'?127:90);assert.equal(r.entry.budget.framesElapsed,0);assert.equal(r.released.captured,false);assert.equal(r.released.immunity,60);assert.equal(r.released.aRelease.framesElapsed,0);assert.equal(r.released.bRelease.framesElapsed,0);
  assert.equal(r.hold.at(-1).budget.framesElapsed,r.mode==='natural'?126:18);
  if(r.frozen){assert.ok(r.frozen.trace.every(x=>x.budget.framesElapsed===r.frozen.before.budget.framesElapsed));assert.equal(r.frozen.after.budget.reduction,0);assert.equal(r.frozen.after.budget.initialFrames,127);assert.equal(r.frozen.after.bPercent,62.2);}
  for(let age=0;age<29;age++){const x=r.releaseTrace[age];assert.equal(x.aRelease.framesElapsed,age);assert.equal(x.bRelease.framesElapsed,age);assert.equal(x.aCanAttack,false);assert.equal(x.bCanAttack,false);}
  assert.equal(r.releaseTrace[29].aRelease,null);assert.equal(r.releaseTrace[29].bRelease,null);
  const before=r.immunityTrace.find(x=>x.age===59),after=r.immunityTrace.find(x=>x.age===60);assert.ok(before&&!before.captured);assert.equal(before.immunity,1);assert.ok(after?.captured,'real second source catch at immunity expiry60');
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,rows:report.rows.length}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/ultimate-capture-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
