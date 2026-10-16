import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {tsImport} from 'tsx/esm/api';
const output=process.env.PF_REGISTRY_OUTPUT??'docs/review/2026-10-06/pikachu-character/integration/taunts-initial';
const metadata=JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA??'assets/characters/pikachu/frames.json','utf8'));
const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(process.env.PF_PIKACHU_STATE_LEAF??new URL('../src/characters/pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const report={errors:[],rows:[],scope:'Simulated Playwright browser B plus W/S/default neutral keyboard events through normal production input routing through production binding resolver; both facings, all three taunts, exact sparse body/12-caps receiving, held-input nonrestart and legal cancel49. Explicit beta native-step presentation, not native common posture/selector parity.'};
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.goto(process.env.PF_REGISTRY_URL??'http://127.0.0.1:4236/platform-fighter/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game?.scene.isActive('PasswordGateScene'));
 report.bundle=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
 await page.evaluate(()=>{const g=window.__game;for(const s of g.scene.getScenes(true))g.scene.stop(s.scene.key);g.scene.start('MatchScene',{matchConfig:{mode:'stocks',stockCount:5,stageId:'flat',rngSeed:387,itemFrequency:'off',players:[{index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},{index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]}});const s=g.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;window.__tauntStep=()=>{s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};window.__tauntObserve=()=>{const a=s.p1,v=s.playerSlots[0].sprite;return{state:a.getTauntPresentationState(),attack:a.getActiveAttack()?.move.id??null,grounded:a.isGrounded(),receiving:a.getActiveHurtboxes(),texture:v.texture.key,frame:Number(v.frame.name),facing:a.getFacing(),position:a.getPosition()};};});
 for(const facing of [1,-1])for(const kind of ['up','side','down']){
  await page.evaluate(f=>{const s=window.__game.scene.getScene('MatchScene'),floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');s.p1.resetForRound(floor.position.x,floor.bounds.min.y-25);s.p2.resetForRound(floor.bounds.max.x-40,floor.bounds.min.y-25);for(let n=0;n<12;n++)window.__tauntStep();s.p1.setFacing(f);},facing);
  const direction=kind==='up'?'w':kind==='down'?'s':null;
  if(direction)await page.keyboard.down(direction);await page.keyboard.down('b');
  await page.evaluate(()=>window.__tauntStep());
  let initial=await page.evaluate(()=>window.__tauntObserve());assert.equal(initial.state?.kind,kind);assert.equal(initial.state.framesElapsed,0);
  if(direction)await page.keyboard.up(direction);
  const captures=[],timeline=[];const wanted=metadata.animations[`taunt_${kind}`].frameWindows.map(w=>w.startFrame);
  for(let age=0;age<({up:78,side:71,down:75}[kind]);age++){
   const observation=await page.evaluate(()=>window.__tauntObserve());timeline.push(observation);
   assert.equal(observation.state?.framesElapsed,age);assert.equal(observation.state?.cancellable,age>=49);
   const window=metadata.animations[`taunt_${kind}`].frameWindows.find(w=>w.startFrame<=age&&age<w.endFrame);
   const expected=poses.find(p=>p.sheet===`taunt_${kind}`&&p.artFrameIndex===window.artFrameIndex);
   assert.equal(observation.texture,`char.pikachu.taunt_${kind}`);assert.equal(observation.frame,window.artFrameIndex);
   assert.deepEqual(observation.receiving,expected.hurtboxes);assert.equal(observation.facing,facing);
   if(wanted.includes(age)){const screenshot=`taunt-${kind}-${facing}-${age}.png`;await page.screenshot({path:`${output}/${screenshot}`});captures.push({screenshot,observation});}
   await page.evaluate(()=>window.__tauntStep());
  }
  const end=await page.evaluate(()=>window.__tauntObserve());assert.equal(end.state,null);
  await page.evaluate(()=>window.__tauntStep());assert.equal((await page.evaluate(()=>window.__tauntObserve())).state,null,'held B must not restart');
  await page.keyboard.up('b');await page.evaluate(()=>window.__tauntStep());
  // Input advances the action clock before selection: pre-input47 -> protected48. A separate fresh entry pre-input48 -> legal49.
  await page.keyboard.down('b');await page.evaluate(()=>window.__tauntStep());await page.keyboard.up('b');
  await page.evaluate(()=>{for(let n=0;n<47;n++)window.__tauntStep();});
  await page.keyboard.down('f');await page.evaluate(()=>window.__tauntStep());const beforeCancel=await page.evaluate(()=>window.__tauntObserve());
  assert.equal(beforeCancel.attack,null);assert.equal(beforeCancel.state.framesElapsed,48);await page.keyboard.up('f');await page.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene'),p=s.p1.getPosition();s.p1.resetForRound(p.x,p.y);for(let n=0;n<12;n++)window.__tauntStep();});
  await page.keyboard.down('b');await page.evaluate(()=>window.__tauntStep());await page.keyboard.up('b');await page.evaluate(()=>{for(let n=0;n<48;n++)window.__tauntStep();});
  const legalEntry=await page.evaluate(()=>window.__tauntObserve());assert.equal(legalEntry.state.framesElapsed,48);
  await page.keyboard.down('f');await page.evaluate(()=>window.__tauntStep());const canceled=await page.evaluate(()=>window.__tauntObserve());
  assert.equal(canceled.attack,'pikachu.jab');assert.equal(canceled.state,null);await page.keyboard.up('f');
  report.rows.push({kind,facing,initial,timeline,captures,naturalEnd:end,cancelProbe:{beforeCancel,legalEntry,canceled}});
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log(JSON.stringify({result:report.result,cases:report.rows.length,captures:report.rows.reduce((n,r)=>n+r.captures.length,0)}));
}catch(e){report.result='FAIL';report.assertionFailure=e.stack;throw e;}
finally{await writeFile(`${output}/taunt-match-observations.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
