import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-jolt';
const build=JSON.parse(await readFile(process.env.PF_BUILD_RECORD??'.tmp/pikachu-thunder-overlay-production-assets-staged.json','utf8'));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual production MatchScene, simulated InputResolver Jolt press, independent detached article clocks, real Matter receiver contacts. No article clocks, damage, sensors or physics are injected. Fixture receiver placement is explicit. Native full corner traversal/absorber behavior is excluded.',build};
page.on('pageerror',error=>report.errors.push(error.message));
await page.exposeFunction('__captureCompletionJolt',name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4238/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 assert.equal(report.bundleSha256,build.bundleSha256,'immutable build identity');
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const active of game.scene.getScenes(true))game.scene.stop(active.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:894,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;
  let input={};scene.inputResolver.getMoveVector=slot=>({x:0,y:0});scene.inputResolver.isActionHeld=(slot,action)=>slot===1&&input[action]===true;
  const step=(next={})=>{input=next;scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
  const floor=scene.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid'),actor=scene.p1,target=scene.p2,rows=[];
  const read=()=>{const article=actor.getPikachuSpecialVisuals().find(entity=>entity.kind==='joltGround'||entity.kind==='joltAir');
   const entity=actor.pikachuSpecialRuntime?.entities.find(entity=>entity.id===article?.id);
   const sensor=entity?.sensor;return {article:article??null,articleFrame:entity?.frame??null,action:actor.getPikachuSpecialState(),actor:actor.getPosition(),target:target.getPosition(),targetGrounded:target.isGrounded(),targetDamage:target.getDamagePercent(),targetVelocity:target.getVelocity(),targetHitlag:target.hitlagFramesRemaining,receiving:target.getActiveHurtboxes(),sensor:sensor?{id:sensor.id,phase:sensor.plugin.pikachuPhase,position:sensor.position,collisionHits:sensor.plugin.collisionHits,ownerBodyId:sensor.plugin.ownerBodyId}:null};};
  for(const facing of[1,-1])for(const targetAir of[false,true])for(const phase of[0,1,2]){
   const originX=facing===1?floor.bounds.min.x+110:floor.bounds.max.x-110;
   const farX=facing===1?floor.bounds.max.x-40:floor.bounds.min.x+40;
   actor.resetForRound(originX,floor.bounds.min.y-25);target.resetForRound(farX,floor.bounds.min.y-25);
   actor.setDamagePercent(0);target.setDamagePercent(0);for(let n=0;n<12;n++)step();actor.setFacing(facing);step({special:true});
   const trace=[],captures=[];let placement=null;
   for(let n=0;n<150;n++){
    const observation=read();trace.push(observation);
    if(observation.targetDamage>0||(!observation.article&&n>20))break;
    const threshold=[3,34,67][phase];
    if(!placement&&observation.article?.kind==='joltGround'&&observation.article.age>=threshold){
     // A grounded receiver must touch the actual stage. For an aerial receiver
     // place its body at the article and preserve ordinary gravity/contact.
     const a=observation.article;
     if(targetAir||a.y>=floor.bounds.min.y-35){
      placement={x:a.x+facing*7,y:targetAir?a.y-30:floor.bounds.min.y-25,articleAge:a.age,articlePosition:{x:a.x,y:a.y}};
      if(targetAir)target.resetForRound(placement.x,placement.y);
      else{
       // Move an already-supported body along the same floor, retaining its
       // real platform contact. resetForRound intentionally clears support.
       scene.matter.body.setPosition(target.body,{x:placement.x,y:placement.y});
       scene.matter.body.setVelocity(target.body,{x:0,y:0});
      }
      target.setDamagePercent(0);placement.observation=read();trace.push(placement.observation);
      await window.__captureCompletionJolt(`jolt-${facing}-${targetAir?'air':'ground'}-phase${phase}-before.png`);
     }
    }
    step();
   }
   const final=read();await window.__captureCompletionJolt(`jolt-${facing}-${targetAir?'air':'ground'}-phase${phase}-after.png`);
   rows.push({facing,targetAir,phase,placement,trace,final});
  }
  for(const facing of[1,-1]){
   actor.resetForRound(facing===1?floor.bounds.min.x+110:floor.bounds.max.x-110,floor.bounds.min.y-25);target.resetForRound(facing===1?floor.bounds.max.x-40:floor.bounds.min.x+40,floor.bounds.min.y-25);actor.setDamagePercent(0);target.setDamagePercent(0);for(let n=0;n<12;n++)step();actor.setFacing(facing);step({special:true});const trace=[];
   for(let n=0;n<150;n++){const o=read();trace.push(o);if(n>20&&!o.article)break;step();}
   rows.push({facing,miss:true,trace,final:read()});
  }
  return rows;
 });
 for(const row of report.rows){
  if(row.miss){assert.equal(row.final.targetDamage,0);assert.ok(row.trace.some(o=>o.article?.age===95));assert.equal(row.final.article,null);continue;}
  assert.ok(row.placement,'placement within required phase');
  const expected=(row.targetAir?5:6)-row.phase;
  assert.ok(Math.abs(row.final.targetDamage-expected*1.05)<1e-6,`damage ${row.facing}/${row.targetAir}/${row.phase}: ${row.final.targetDamage}`);
  const contact=row.trace.findLast(o=>o.sensor);
  assert.equal(contact.sensor.phase,`ground-${row.phase}`);
  assert.equal(contact.targetGrounded,!row.targetAir,'real situation selects damage');
  if(row.phase===2){assert.ok(contact.article.age>=67&&contact.article.age<96);assert.equal(contact.action,null,'owner is already actionable during late article');}
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,bundleSha256:report.bundleSha256}));
}catch(error){report.result='FAIL';report.assertionFailure=error.stack;throw error;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
