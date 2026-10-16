import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-airjump';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],scope:'Actual MatchScene normal jump input in unobstructed airborne fixture, neutral/forward/backward entries both facings. Contextual beta selection latches entry direction/facing; later drift does not swap. Exact paired reviewed body/receiving, paused renders, natural fall and actual Matter landing. Native common selector parity remains separate.'};
page.on('pageerror',e=>report.errors.push(e.message));
await page.exposeFunction('__captureAirjump',async name=>page.screenshot({path:`${output}/${name}`}));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4242/platform-fighter/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'),null,{timeout:60000});
  report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(src=>/\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
  report.rows=await page.evaluate(async()=>{
    const game=window.__game;for(const old of game.scene.getScenes(true))game.scene.stop(old.scene.key);
    game.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:647,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});
    const scene=game.scene.getScene('MatchScene');scene.physicsEngine.pause();scene.roundStartCountdown=0;
    let input={};scene.inputResolver.getMoveVector=slot=>({x:slot===1?input.moveX??0:0,y:0});scene.inputResolver.isActionHeld=(slot,action)=>slot===1&&input[action]===true;
    const step=next=>{input=next??{};scene.physicsEngine.resume();scene.update(0,scene.physicsEngine.fixedTimestepMs);scene.physicsEngine.pause();};
    const floor=scene.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
    for(const b of scene.baseStage.bodies.platformBodies.filter(b=>b!==floor))scene.matter.world.remove(b);
    const actor=scene.p1,x=(floor.bounds.min.x+floor.bounds.max.x)/2,rows=[];
    const read=()=>{const sprite=scene.playerSlots[0].sprite;return {jump:actor.getJumpPresentationState(),ordinary:actor.getOrdinaryPresentationState(),grounded:actor.isGrounded(),facing:actor.getFacing(),velocity:actor.getVelocity(),position:actor.getPosition(),receiving:actor.getActiveHurtboxes(),texture:sprite.texture.key,textureFrame:Number(sprite.frame.name),origin:[sprite.originX,sprite.originY]};};
    for(const facing of [1,-1])for(const direction of ['backward','forward','neutral']){
      actor.resetForRound(x,floor.bounds.min.y-25-350);actor.setFacing(facing);scene.p2.resetForRound(floor.bounds.max.x-80,floor.bounds.min.y-scene.p2.getTuning().height/2);step();
      const moveX=direction==='neutral'?0:facing*(direction==='backward'?-1:1);
      step({jump:true,moveX});const row={facing,direction,entry:read(),captures:[]};
      const drift=direction==='backward'?facing:-facing;
      for(const target of [0,10,24]){
        for(let n=0;n<30&&(actor.getJumpPresentationState()?.framesElapsed??-1)<target;n++)step({moveX:drift});
        const observation=read(),screenshot=`${direction}-${facing}-${target}.png`;
        await window.__captureAirjump(screenshot);row.captures.push({target,observation,screenshot});
        if(target===10){const before=read();for(let n=0;n<5;n++)scene.update(n*16,scene.physicsEngine.fixedTimestepMs);row.freeze={before,after:read()};}
      }
      row.timeline=[];
      for(let n=0;n<160;n++){step();const o=read();row.timeline.push({step:n,jump:o.jump,ordinary:o.ordinary,grounded:o.grounded,texture:o.texture,textureFrame:o.textureFrame});if(o.grounded){row.landed=o;break;}}
      rows.push(row);
    }
    return rows;
  });
  for(const row of report.rows){
    const sheet=row.direction==='backward'?'airjump_back':'airjump';
    assert.equal(row.entry.jump.kind,'air');assert.equal(row.entry.jump.framesElapsed,0);assert.equal(row.entry.jump.facing,row.facing);
    for(const {target,observation:o} of row.captures){
      assert.equal(o.jump.framesElapsed,target);assert.equal(o.jump.facing,row.facing);assert.equal(o.facing,row.facing);assert.equal(o.grounded,false);
      const win=metadata.animations[sheet].frameWindows.find(w=>w.startFrame<=target&&target<w.endFrame);
      assert.ok(win);assert.equal(o.texture,`char.pikachu.${sheet}`);assert.equal(o.textureFrame,win.artFrameIndex);assert.deepEqual(o.origin,[0.5,0.8125]);
      assert.deepEqual(o.receiving,poses.find(p=>p.sheet===sheet&&p.artFrameIndex===win.artFrameIndex).hurtboxes);
    }
    assert.deepEqual(row.freeze.after,row.freeze.before,'paused rendering keeps body and receiving clocks stable');
    assert.ok(row.timeline.some(o=>o.texture==='char.pikachu.fall'),'natural apex hands off to falling presentation');assert.equal(row.landed?.grounded,true,'actual Matter floor reached');
  }
  assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.flatMap(r=>r.captures).length,bundle:report.bundle,errors:report.errors}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
