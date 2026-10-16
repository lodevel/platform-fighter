/** Prepared final-only whole-world reconstruction runner. Do not execute before
 * the coordinated complete-candidate verification phase. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const url=process.env.PF_LINK_CANDIDATE_URL,bundle=process.env.PF_LINK_EXPECT_BUNDLE_SHA256,
  build=process.env.PF_LINK_EXPECT_BUILD_ID,output=process.env.PF_HISTORY_OUTPUT??'.tmp/match-history-final';
assert(process.env.PF_FINAL_VERIFICATION_READY==='1','Final verification has not been coordinated');
assert(url&&new URL(url).port!=='4199'&&/^[a-f0-9]{64}$/.test(bundle??'')&&
  /^platform-fighter-sha256-[a-f0-9]{64}$/.test(build??''),'Exact new candidate URL/bundle/build required');
const html=await (await fetch(url)).text(),script=html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
assert(script,'Production module script required');
const bytes=Buffer.from(await (await fetch(new URL(script[1],url))).arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'),bundle);
await mkdir(output,{recursive:true});
const report={schema:'match-history-final-acceptance/1',status:'FAILED_EXECUTED',candidate:{url,bundle,build},cases:[],errors:[],
  limits:['History reconstruction has O(history) cost; this is not an instant state rewind.',
    'CPU inputs are real production AI; physical keyboard/simulated-gamepad coverage belongs to the separate831 gate.',
    'Software WebGL functional execution does not qualify real GPU/CPU memory or frame performance.',
    'Targeted capture/Food/clank/Final checkpoint obligations remain independently required.']};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.addInitScript(()=>{
  window.__historyPad={id:'History simulated standard pad',index:0,connected:true,mapping:'standard',timestamp:1,
    axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__historyPad]});
});
page.on('pageerror',error=>report.errors.push(error.stack??error.message));
const sha=value=>createHash('sha256').update(value).digest('hex');
const step=async(count=1)=>page.evaluate(count=>{
  const game=window.__game;
  for(let i=0;i<count;i++){const scene=game.scene.getScene('MatchScene'),dt=scene.physicsEngine.fixedTimestepMs;
    window.__historyTime=(window.__historyTime??0)+dt;game.step(window.__historyTime,dt);}
},count);
const witness=()=>page.evaluate(()=>{const scene=window.__game.scene.getScene('MatchScene');return {
  state:scene.getMatchHistoryRestoreStatus(),evidence:scene.captureMatchHistoryEvidence(),
  stats:scene.matchStatsTracker.getAllStats(scene.physicsEngine.getFrame()),items:scene.itemSpawnEventLog.getEntries().length};});
try {
  await page.goto(url);await page.waitForFunction(()=>window.__game?.scene,null,{timeout:60000});
  await page.evaluate(()=>window.__game.loop.stop());
  for(const [index,fighters] of [['link','donkeykong'],['link','pikachu'],['donkeykong','pikachu']].entries()){
    const result={id:`history-${fighters.join('-')}`,checkpoints:[],continuations:[],pausedRestore:false};report.cases.push(result);
    const config={mode:'time',timeLimitSeconds:180,stockCount:3,stageId:'flat',rngSeed:710013+index,linkIntroPolicy:'source-entry-121',
      players:fighters.map((characterId,i)=>({index:i+1,characterId,paletteIndex:0,inputType:'ai',aiDifficulty:'medium',}))};
    await page.evaluate(config=>{const game=window.__game;for(const scene of game.scene.getScenes(true))game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene',{matchConfig:config});},config);
    // The genuine initial-only intro precedes gameplay frame0.
    for(let i=0;i<130;i++){if(!await page.evaluate(()=>window.__game.scene.getScene('MatchScene').getSourceIntroSnapshot()))break;await step();}
    const original=new Map();let checkpoint;
    for(let frame=1;frame<=4800;frame++){
      await step();
      if(frame===2400){
        checkpoint=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').captureMatchHistoryCheckpoint());
        assert.equal(checkpoint.buildIdentity,build);assert.equal(checkpoint.frame,2400);
        const state=await witness();assert(state.stats.some(row=>row.damageDealt>0),'Positive accepted combat required');
        assert(state.items>0,'Natural RNG item generation must be exercised');
        await writeFile(`${output}/${result.id}-checkpoint.json`,JSON.stringify(checkpoint));
        result.checkpoints.push({frame,historyFrames:checkpoint.replay.inputTimeline.entries.length,evidenceSha256:sha(checkpoint.worldEvidence)});
      }
      if(frame>=2400&&frame%300===0){const state=await witness();assert.equal(state.state.frame,frame);
        original.set(frame,state.evidence);await writeFile(`${output}/${result.id}-original-${frame}.json`,state.evidence);}
    }
    await page.evaluate(checkpoint=>window.__game.scene.getScene('MatchScene').restoreMatchHistoryCheckpoint(checkpoint),checkpoint);
    let restored=false;
    for(let tick=0;tick<5000;tick++){
      await step();const state=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').getMatchHistoryRestoreStatus());
      assert.notEqual(state.state,'failed');if(state.state==='ready'){restored=true;break;}
    }
    assert(restored,'Bounded reconstruction did not complete');
    assert.equal((await witness()).evidence,original.get(2400),'Actual world diverged at restored checkpoint');
    for(let frame=2401;frame<=4800;frame++){
      await step();if(frame%300===0){const state=await witness();assert.equal(state.state.frame,frame);
        assert.equal(state.evidence,original.get(frame),`Continuation diverged at ${frame}`);
        result.continuations.push({frame,evidenceSha256:sha(state.evidence)});}
    }
    // Actual Escape→PauseMenu creates the pause, rather than actor/status writes.
    await page.keyboard.press('Escape');await step();
    const frozen=await witness();
    const paused=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').captureMatchHistoryCheckpoint());
    assert(paused.clock.pausedForMenu,'Real PauseMenu lifecycle required');
    await step(60);assert.equal((await witness()).evidence,frozen.evidence,'Pause advanced the world');
    await page.evaluate(paused=>window.__game.scene.getScene('MatchScene').restoreMatchHistoryCheckpoint(paused),paused);
    restored=false;for(let tick=0;tick<5000;tick++){await step();const state=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').getMatchHistoryRestoreStatus());
      assert.notEqual(state.state,'failed');if(state.state==='ready'){restored=true;break;}}
    assert(restored);assert.equal((await witness()).evidence,frozen.evidence);
    await step(60);assert.equal((await witness()).evidence,frozen.evidence);result.pausedRestore=true;
    if(index===0){
      // The actual held START cache is outside resolved CharacterInput.
      // Resume through the real PauseMenu keyboard route while the simulated
      // connected pad holds START, then checkpoint an active endpoint.
      await page.evaluate(()=>{const pad=window.__historyPad;pad.timestamp++;
        Object.assign(pad.buttons[9],{pressed:true,touched:true,value:1});});
      await page.keyboard.press('Escape');await step();
      const active=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').captureMatchHistoryCheckpoint());
      assert.equal(active.clock.pausedForMenu,false);assert.equal(active.sceneInput.prevStartHeld,true);
      await page.evaluate(active=>window.__game.scene.getScene('MatchScene').restoreMatchHistoryCheckpoint(active),active);
      restored=false;for(let tick=0;tick<5000;tick++){await step();const state=await page.evaluate(()=>window.__game.scene.getScene('MatchScene').getMatchHistoryRestoreStatus());
        assert.notEqual(state.state,'failed');if(state.state==='ready'){restored=true;break;}}
      assert(restored);await step();
      const held=await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');return{frame:s.physicsEngine.getFrame(),paused:s.pausedForMenu};});
      assert.equal(held.paused,false,'A held START must not become a fresh edge after reconstruction');assert.equal(held.frame,active.frame+1);
      await page.evaluate(()=>{const pad=window.__historyPad;pad.timestamp++;Object.assign(pad.buttons[9],{pressed:false,touched:false,value:0});});await step();
      await page.evaluate(()=>{const pad=window.__historyPad;pad.timestamp++;Object.assign(pad.buttons[9],{pressed:true,touched:true,value:1});});await step();
      assert(await page.evaluate(()=>window.__game.scene.getScene('MatchScene').pausedForMenu),'A genuine subsequent START edge must still pause');
      await page.evaluate(()=>{const pad=window.__historyPad;pad.timestamp++;Object.assign(pad.buttons[9],{pressed:false,touched:false,value:0});});
      result.heldStartRestore=true;
    }
    assert.equal(report.errors.length,0,'Candidate browser errors');
  }
  report.status='PASSED_EXECUTED';
} finally {
  await writeFile(`${output}/index.json`,JSON.stringify(report,null,2));await browser.close();
}
