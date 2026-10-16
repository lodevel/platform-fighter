import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';
const prefix=process.env.PF_STAGED_PREFIX??'.tmp/pikachu-state-consumers-production';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/completion-shield-break';
const record=JSON.parse(await readFile(`${prefix}-assets-staged.json`,'utf8'));
const metadata=JSON.parse(await readFile(`${prefix}-pikachu-frames.json`,'utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(new URL(`../${prefix}-pikachuStateHurtboxes.ts`,import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene/InputResolver Pikachu jab contact breaks a raised low-health shield. Health-only replay fixture is set before real contact; broken state and clocks are never injected. Bothfacings180 unfrozen steps, native120 dizzy drawing loop then34 recovery,12source receiving regions, alpha32pixel-center floor and actual forbidden/fresh actions. Native shield-break launch/dizzy/mash/rate algorithms are explicit unresolved fidelity; existing180-step beta lock is unchanged.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureBreak',async name=>page.screenshot({path:`${output}/${name}`}));
try {
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4246/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 assert.equal(report.bundleSha256,record.bundleSha256);
 report.rows=await page.evaluate(async()=>{
  const game=window.__game;for(const s of game.scene.getScenes(true))game.scene.stop(s.scene.key);
  game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:890,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'pikachu',paletteIndex:1,inputType:'keyboard_p2'}]}});
  const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;scene.hitboxDebugLayer.setEnabled(true);
  let input={};scene.inputResolver.getMoveVector=()=>({x:0,y:0});scene.inputResolver.isActionHeld=(slot,key)=>input[slot]?.[key]===true;
  const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
  for(const b of scene.baseStage.bodies.platformBodies.filter(b=>b!==floor)){b.collisionFilter.mask=0;scene.matter.world.remove(b);}
  const actor=scene.p1,alphaCache=new Map();
  const read=()=>{const sprite=scene.playerSlots[0].sprite,f=sprite.frame,key=`${sprite.texture.key}/${f.name}`;let bottom=alphaCache.get(key);
   if(bottom===undefined){const c=document.createElement('canvas');c.width=f.cutWidth;c.height=f.cutHeight;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(sprite.texture.getSourceImage(),f.cutX,f.cutY,f.cutWidth,f.cutHeight,0,0,f.cutWidth,f.cutHeight);const a=ctx.getImageData(0,0,f.cutWidth,f.cutHeight).data;bottom=-Infinity;for(let y=0;y<f.cutHeight;y++)for(let x=0;x<f.cutWidth;x++)if(a[(y*f.cutWidth+x)*4+3]>=32)bottom=Math.max(bottom,y+.5);alphaCache.set(key,bottom);}
   return{presentation:actor.getShieldPresentationState(),shield:actor.getShieldState(),percent:actor.getDamagePercent(),hitlag:actor.getHitlagRemaining(),position:actor.getPosition(),grounded:actor.isGrounded(),receiving:actor.getActiveHurtboxes(),texture:sprite.texture.key,textureFrame:Number(f.name),origin:[sprite.originX,sprite.originY],mirror:Math.sign(sprite.scaleX)*(sprite.flipX?-1:1),facing:actor.getFacing(),attack:actor.getActiveAttack()?.move.id??null,jumpsquat:actor.getJumpsquatRemaining(),attackerMove:scene.p2.getActiveAttack()?.move.id??null,alphaClearance:floor.bounds.min.y-(sprite.y+(bottom-sprite.originY*f.cutHeight)*sprite.scaleY)};
  };
  const step=(next={})=>{input=next;scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();return read();};
  const rows=[];
  for(const facing of [1,-1]){
   actor.resetForRound(floor.position.x,floor.bounds.min.y-25);scene.p2.resetForRound(floor.position.x+facing*55,floor.bounds.min.y-25);for(let n=0;n<12;n++)step();actor.setFacing(facing);scene.p2.setFacing(-facing);
   for(let n=0;n<4;n++)step({1:{shield:true}});actor.setShieldState({...actor.getShieldState(),health:1});
   const before=read();step({1:{shield:true},2:{attack:true}});
   for(let n=0;n<12&&!actor.isShieldBroken();n++)step({1:{shield:true}});
   if(!actor.isShieldBroken())throw new Error(`Actual jab did not break shield/${facing}`);
   const row={facing,before,trace:[],captures:[],forbidden:[]},seen=new Set();
   for(let n=0;n<230;n++){
    const o=read();row.trace.push(o);if(o.presentation?.kind!=='broken'){row.exit=o;break;}
    const age=o.presentation.framesElapsed,key=`${o.texture}/${o.textureFrame}`;
    if(!seen.has(key)){seen.add(key);const screenshot=`break-${facing}-${age}.png`;await window.__captureBreak(screenshot);row.captures.push({screenshot,observation:o});}
    if(age===60&&!row.freeze){const before=read();for(let i=0;i<5;i++)scene.update(0,scene.physicsEngine.fixedTimestepMs);row.freeze={before,after:read()};}
    const requested=[30,80,150].includes(age)?{1:{attack:true,special:true,jump:true}}:{};const after=step(requested);if(requested[1])row.forbidden.push({age,after});
   }
   row.firstFree=step({1:{attack:true}});rows.push(row);
  }return rows;
 });
 const floorFailures=[];
 for(const r of report.rows){const active=r.trace.filter(o=>o.presentation?.kind==='broken');assert.equal(active[0].presentation.framesElapsed,0);assert.equal(active[0].presentation.totalFrames,180);assert.equal(active[0].attackerMove,'pikachu.jab');assert.ok(active[0].hitlag>0);assert.deepEqual([...new Set(active.map(o=>o.presentation.framesElapsed))],Array.from({length:180},(_,i)=>i));assert.ok(active.filter(o=>o.hitlag>0).every(o=>o.presentation.framesElapsed===0));assert.deepEqual(r.freeze.before,r.freeze.after);
  for(const o of active){const age=o.presentation.framesElapsed,sheet=age>=146?'shield_break_end':'shield_break',clip=metadata.animations[sheet],local=age>=146?age-146:age%120,w=clip.frameWindows.find(w=>w.startFrame<=local&&local<w.endFrame);assert.ok(w,`${sheet}/${local}`);assert.equal(o.texture,`char.pikachu.${sheet}`);assert.equal(o.textureFrame,w.artFrameIndex);assert.deepEqual(o.receiving,poses.find(p=>p.sheet===sheet&&p.artFrameIndex===w.artFrameIndex).hurtboxes);assert.deepEqual(o.origin,[clip.root[0]/clip.frameWidth,clip.root[1]/clip.frameHeight]);assert.equal(o.mirror,r.facing);assert.equal(o.percent,0);assert.equal(o.grounded,true);if(o.alphaClearance<-.55)floorFailures.push({sheet,cell:o.textureFrame,age,facing:r.facing,clearance:o.alphaClearance});}
  for(const f of r.forbidden){assert.equal(f.after.attack,null);assert.equal(f.after.jumpsquat,0);assert.equal(f.after.presentation?.kind,'broken');}
  assert.notEqual(r.exit.presentation?.kind,'broken');assert.equal(r.firstFree.attack,'pikachu.jab');
 }
 assert.deepEqual(report.errors,[]);report.floorFailures=floorFailures;report.result=floorFailures.length?'RUNTIME_PASS_FLOOR_PENDING':'PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length,floorFailures:floorFailures.length}));
}catch(error){report.result='FAIL';report.assertionFailure=error.stack;throw error;}finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
