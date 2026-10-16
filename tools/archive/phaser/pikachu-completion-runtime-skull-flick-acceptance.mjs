import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-skull-flick';
const build=JSON.parse(await readFile(process.env.PF_BUILD_RECORD??'.tmp/pikachu-thunder-overlay-production-assets-staged.json','utf8'));
const metadata=JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA??'.tmp/pikachu-thunder-overlay-production-pikachu-frames.json','utf8'));
const {PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(process.env.PF_PIKACHU_PHASE_LEAF??new URL('../.tmp/pikachu-thunder-overlay-production-pikachuSpecialPhaseHurtboxes.ts',import.meta.url).pathname,import.meta.url);
const ceilingFixture=process.env.PF_SKULL_CEILING==='1';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],build,scope:'Actual MatchScene simulated resolver Skull ordinary half-stick versus decisive flick from neutral; both facing ground/air entries, no held button, real receiver contact and normal22-step rebound. Published seed20, zero unheld release delay and damage measured independently. Native common AIR_STOP/weak-ready and source frame order remain unqualified.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureCompletionSkull',name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4238/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');assert.equal(report.bundleSha256,build.bundleSha256);
 report.ceilingFixture=ceilingFixture;
 report.rows=await page.evaluate(async({ceilingFixture})=>{
  const game=window.__game;for(const active of game.scene.getScenes(true))game.scene.stop(active.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:913,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;let input={};
  scene.inputResolver.getMoveVector=slot=>({x:slot===1?input.moveX??0:0,y:0});scene.inputResolver.isActionHeld=(slot,action)=>slot===1&&input[action]===true;
  const step=(next={})=>{input=next;scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
  const floor=scene.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid'),actor=scene.p1,target=scene.p2,rows=[];
  const read=()=>{const s=scene.playerSlots[0].sprite;return{state:actor.getPikachuSpecialState(),position:actor.getPosition(),velocity:actor.getVelocity(),grounded:actor.isGrounded(),targetDamage:target.getDamagePercent(),targetPosition:target.getPosition(),receiving:actor.getActiveHurtboxes(),texture:s.texture.key,textureFrame:Number(s.frame.name),origin:[s.originX,s.originY],rotation:s.rotation,mirror:Math.sign(s.scaleX)*(s.flipX?-1:1),contact:actor.getActiveAttack()?.hitboxBody?{position:actor.getActiveAttack().hitboxBody.position,rows:actor.getActiveAttack().hitboxBody.plugin.collisionHits}:null,stocks:scene.stockTracker.getStocks(1)};};
  for(const facing of[1,-1])for(const air of(ceilingFixture?[false]:[false,true]))for(const flick of(ceilingFixture?[false]:[false,true])){
   const originX=facing===1?floor.bounds.min.x+220:floor.bounds.max.x-220;
   actor.resetForRound(originX,floor.bounds.min.y-(air?650:25));target.resetForRound(facing===1?floor.bounds.max.x-40:floor.bounds.min.x+40,floor.bounds.min.y-25);
   actor.setDamagePercent(0);target.setDamagePercent(0);for(let n=0;n<12;n++)step();actor.setFacing(facing);const entry=read();step({moveX:facing*(flick?1:.5),special:true});
   const trace=[],captures=[],seen=new Set();let placement=null,ceiling=null,ceilingVisual=null;
   for(let n=0;n<100;n++){
    const o=read();trace.push(o);if(!o.state)break;
    const key=`${o.texture}-${o.textureFrame}`;
    if(!seen.has(key)){seen.add(key);const screenshot=`skull-${facing}-${air?'air':'ground'}-${flick?'flick':'ordinary'}-${o.texture.split('.').at(-1)}-${o.textureFrame}.png`;await window.__captureCompletionSkull(screenshot);captures.push({screenshot,observation:o});}
    if(!placement&&o.state.normalizedFrame===16){
     if(ceilingFixture){
      // A real solid ceiling constrains the rebound and permits grounded END
      // before its22-step exit. No action/situation/pose clock is changed.
      ceiling=scene.matter.add.rectangle(o.position.x,o.position.y-37,180,20,{isStatic:true,label:'platform.solid'});
      ceilingVisual=scene.add.rectangle(o.position.x,o.position.y-37,180,20,0x3388aa).setDepth(5);
     }
     const speed=(1.6+1.6*(flick?20:0)/80)*5;
     placement={x:o.position.x+facing*(speed+15),y:o.position.y+3.7500009536743164};target.resetForRound(placement.x,placement.y);target.setDamagePercent(0);
    }
    step();
   }
   rows.push({facing,air,flick,ceilingFixture,entry,placement,trace,captures});
   if(ceiling)scene.matter.world.remove(ceiling);ceilingVisual?.destroy();
  }
  return rows;
 },{ceilingFixture});
 for(const row of report.rows){
  assert.equal(row.entry.grounded,!row.air);const active=row.trace.filter(o=>o.state);assert.equal(active[0].state.charge,row.flick?20:0);
  assert.ok(active.every(o=>o.state.charge===(row.flick?20:0)));assert.ok(active.every(o=>o.state.releaseDelay===0),'unheld flick must skip manual-charge release delay');
  const first=active.find(o=>!o.state.holding);assert.equal(first.state.frame,13);assert.equal(first.state.normalizedFrame,13);assert.ok(active.some(o=>o.state.hit));
  const hit=active.filter(o=>o.state.hit);assert.equal(hit[0].state.normalizedFrame,17,'first active contact');
  assert.deepEqual([...new Set(hit.map(o=>o.state.frame-o.state.branchFrame))],Array.from({length:22},(_,n)=>n));
  const expected=(6.2+15.2*(row.flick?20:0)/80)*1.05;assert.ok(Math.abs(row.trace.at(-1).targetDamage-expected)<1e-5);
  assert.equal(row.trace.at(-1).state,null);assert.equal(row.trace.at(-1).stocks,active[0].stocks);
  if(ceilingFixture)assert.ok(active.some(o=>o.state.hit&&o.grounded&&o.texture==='char.pikachu.side_special_hit'),'physical ceiling permits dedicated grounded hit drawing');
  for(const o of active){assert.equal(o.mirror,row.facing);assert.equal(o.receiving.length,12);
   const sheet=o.texture.split('.').at(-1),clip=metadata.animations[sheet];assert.ok(clip);assert.ok(o.textureFrame<clip.frameCount);
   if(sheet!=='side_special'){assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.receiving,poses.find(p=>p.sheet===sheet&&p.artFrameIndex===o.textureFrame).hurtboxes);}
  }
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length}));
}catch(error){report.result='FAIL';report.assertionFailure=error.stack;throw error;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
