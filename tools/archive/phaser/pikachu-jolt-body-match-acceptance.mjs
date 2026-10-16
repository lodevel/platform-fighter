import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/jolt-bodies';
const metadata=JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA??'assets/characters/pikachu/frames.json','utf8'));
const {PIKACHU_UFD_STATS,PIKACHU_REFERENCE_PIXELS_PER_UNIT}=await tsImport(new URL('../src/characters/pikachuUfdStats.ts',import.meta.url).pathname,import.meta.url);
const sourceFallCap=PIKACHU_UFD_STATS.fallSpeed*PIKACHU_REFERENCE_PIXELS_PER_UNIT;
const {PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL('../src/characters/pikachuSpecialPhaseHurtboxes.ts',import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual InputResolver ground/high-air Jolt both facings; all51 gameplay steps, source .77 postrelease drawing windows and reviewed receiving, native74 postaction excluded. Detached article born18 and afteractor persistence observed; object contact/reflect mechanics separately qualified. Lowfloor airpose clearance remains unproved.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureJolt',name=>page.screenshot({path:`${output}/${name}`}));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4227/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 report.sourceFallCap=sourceFallCap;
 report.rows=await page.evaluate(async({metadata})=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:849,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;let input={};
  scene.inputResolver.getMoveVector=slot=>({x:0,y:0});scene.inputResolver.isActionHeld=(slot,a)=>slot===1&&input[a]===true;
  const step=(next={})=>{input=next;scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
  const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid'),actor=scene.p1,rows=[];
  const overhead=scene.baseStage.bodies.platformBodies.filter(b=>b!==floor),columns=[];
  for(let x=floor.bounds.min.x+200;x<floor.bounds.max.x-200;x+=20)if(overhead.every(b=>x+25<b.bounds.min.x||x-25>b.bounds.max.x))columns.push(x);
  const originX=columns.sort((a,b)=>Math.abs(a-floor.position.x)-Math.abs(b-floor.position.x))[0];
  if(originX===undefined)throw new Error('Pure air Jolt needs a clear stage column');
  const read=()=>{const sprite=scene.playerSlots[0].sprite,camera=scene.cameras.main;return{state:actor.getPikachuSpecialState(),visuals:actor.getPikachuSpecialVisuals(),grounded:actor.isGrounded(),position:actor.getPosition(),receiving:actor.getActiveHurtboxes(),texture:sprite.texture.key,textureFrame:Number(sprite.frame.name),origin:[sprite.originX,sprite.originY],bodyMirror:Math.sign(sprite.scaleX)*(sprite.flipX?-1:1),camera:{zoom:camera.zoom,scrollX:camera.scrollX,scrollY:camera.scrollY,x:camera.x,y:camera.y},floorY:floor.bounds.min.y};};
  for(const facing of[1,-1])for(const air of[false,true]){
   actor.resetForRound(originX,floor.bounds.min.y-(air?700:25));scene.p2.resetForRound(floor.position.x-facing*((floor.bounds.max.x-floor.bounds.min.x)/2-50),floor.bounds.min.y-25);actor.setDamagePercent(0);scene.p2.setDamagePercent(0);for(let n=0;n<12;n++)step();actor.setFacing(facing);
   const sheet=air?'neutral_special_air':'neutral_special';step({special:true});const trace=[],captures=[],seen=new Set();
   for(let n=0;n<65;n++){
    const o=read();trace.push(o);if(!o.state)break;
    if(metadata.animations[sheet].frameWindows.some(w=>w.startFrame===o.state.frame)&&!seen.has(o.state.frame)){seen.add(o.state.frame);const screenshot=`${sheet}-${facing}-${o.state.frame}.png`;await window.__captureJolt(screenshot);captures.push({observation:o,screenshot});}step();
   }rows.push({facing,air,sheet,trace,captures});
  }return rows;
 },{metadata});
 for(const row of report.rows){const active=row.trace.filter(o=>o.state);
  assert.deepEqual(active.map(o=>o.state.frame),Array.from({length:51},(_,n)=>n));assert.equal(row.captures.length,7);
  if(row.air)for(let i=1;i<active.length;i++)assert.ok(Math.abs(active[i].state.velocity.y-Math.min(active[i-1].state.velocity.y+PIKACHU_UFD_STATS.gravity*PIKACHU_REFERENCE_PIXELS_PER_UNIT,sourceFallCap))<1e-5,`Jolt source falling gravity step${i}`);
  for(const o of active){const clip=metadata.animations[row.sheet],window=clip.frameWindows.find(w=>w.startFrame<=o.state.frame&&o.state.frame<w.endFrame);
   assert.equal(o.state.kind,'thunderJolt');if(row.air)assert.ok(o.state.velocity.y<=sourceFallCap+1e-6,`Jolt source terminal cap at action${o.state.frame}`);assert.equal(o.grounded,!row.air);assert.equal(o.texture,`char.pikachu.${row.sheet}`);assert.equal(o.textureFrame,window.artFrameIndex);assert.ok(o.textureFrame<7);assert.equal(o.bodyMirror,row.facing);assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.deepEqual(o.receiving,poses.find(p=>p.sheet===row.sheet&&p.artFrameIndex===window.artFrameIndex).hurtboxes);
  }
  assert.equal(active.find(o=>o.visuals.some(v=>v.kind==='joltAir'||v.kind==='joltGround')).state.frame,18);
  assert.equal(row.trace.at(-1).state,null);assert.ok(row.trace.at(-1).visuals.some(v=>v.kind==='joltAir'||v.kind==='joltGround'),'article persists after actor commitment');
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length,errors:report.errors}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/jolt-body-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
