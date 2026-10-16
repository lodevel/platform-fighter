import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.argv[3] ?? process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/runtime/lab-checkpoint-08-safe-air-fixture-corrected';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], scope: 'Actual pointer-selected DK Character Lab draft/save/Test Fight/return/reload. Public scene entry and match pause fixtures. Compares full attacks, grab, tuning and current DK vertical profile against the exact built baseline. Complete animation/action qualification remains separate.' };
const normalize=value=>JSON.parse(JSON.stringify(value));
page.on('pageerror', error => report.errors.push(error.message));
async function open(key, data) {
  await page.evaluate(() => { for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key); });
  await page.waitForTimeout(60);
  await page.evaluate(({ key, data }) => window.__game.scene.start(key, data), { key, data });
  await page.waitForFunction(key => window.__game.scene.isActive(key), key);
}
async function clickText(key, label) {
  const point = await page.evaluate(({ key, label }) => {
    const game = window.__game, scene = game.scene.getScene(key);
    const object = scene.children.list.find(child => child.input?.enabled && typeof child.text === 'string' && child.text.includes(label));
    if (!object) throw new Error(`Missing text: ${label}`);
    const b = object.getBounds(), canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + b.centerX * canvas.width / game.scale.gameSize.width,
      y: canvas.top + b.centerY * canvas.height / game.scale.gameSize.height };
  }, { key, label });
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}
async function actualKit() {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    return { id: s.p1.id, tuning: s.p1.getTuning(), vertical: s.p1.getDonkeyKongVerticalMotionState()?.profile, grab: s.p1.getGrabSpec(),
      moves: [...s.p1.attacks.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  });
}
try {
  await page.goto(process.argv[2] ?? process.env.PF_REGISTRY_URL ?? 'http://localhost:4196/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
  if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
  await open('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off',
    players: [{ index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
  const baseline = normalize(await actualKit());
  assert(Math.abs(baseline.vertical.totalGravity-.425)<1e-12);
  assert.equal(baseline.vertical.fullHopStepVelocitiesY.length,4);
  report.baseline=baseline;
  await open('CharacterEditorScene');
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const visible = await page.evaluate(() => !!window.__game.scene.getScene('CharacterEditorScene').children.getByName('shipped:donkeykong'));
    if (visible) break;
    const point = await page.evaluate(() => {
      const game=window.__game, object=game.scene.getScene('CharacterEditorScene').children.getByName('roster-page-next');
      const b=object.getBounds(),canvas=game.canvas.getBoundingClientRect();
      return {x:canvas.left+b.centerX*canvas.width/game.scale.gameSize.width,y:canvas.top+b.centerY*canvas.height/game.scale.gameSize.height};
    });
    await page.mouse.click(point.x,point.y);
    await page.waitForTimeout(150);
  }
  await clickText('CharacterEditorScene', 'DONKEY KONG');
  await page.screenshot({ path: `${output}/dk-selection-diagnostic.png` });
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec().id === 'donkeykong');
  assert.deepEqual(normalize(await page.evaluate(()=>window.__game.scene.getScene('CharacterEditorScene').editState.getSpec().movement.donkeykongOrdinaryVertical)),baseline.vertical);
  await clickText('CharacterEditorScene','MOVEMENT');
  const tunePoint=await page.evaluate(()=>{
    const g=window.__game,s=g.scene.getScene('CharacterEditorScene'),i=s.fieldLabels.findIndex(label=>label.visible&&label.text==='Ordinary total gravity');
    if(i<0)throw Error('Missing DK ordinary gravity editor field');
    const b=s.plusButtons[i].getBounds(),canvas=g.canvas.getBoundingClientRect();return{x:canvas.left+b.centerX*canvas.width/g.scale.gameSize.width,y:canvas.top+b.centerY*canvas.height/g.scale.gameSize.height};
  });
  await page.mouse.click(tunePoint.x,tunePoint.y);
  const draft = normalize(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec()));
  assert(Math.abs(draft.movement.donkeykongOrdinaryVertical.totalGravity-.430)<1e-12);
  const expectedKit={...baseline,tuning:{...baseline.tuning,donkeykongOrdinaryVertical:draft.movement.donkeykongOrdinaryVertical},vertical:draft.movement.donkeykongOrdinaryVertical};
  report.expectedKit=expectedKit;
  report.customEdit={method:'Actual pointer click on Ordinary total gravity plus button',before:.425,after:.430};
  report.draft=draft;
  report.representationNormalization='JSON converts numeric negative zero to zero. Applied symmetrically; every other field/value preserved.';
  const draftAttacks=Object.values(draft.moves).filter(move=>move.type!==undefined).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(draftAttacks,baseline.moves);
  assert.deepEqual(draft.moves.grab,baseline.grab);
  assert.ok(draft.moves.taunts);
  assert.deepEqual(draft.moves.nair, baseline.moves.find(move => move.id === 'donkeykong.nair'));
  for (const slot of ['jab2', 'upLight', 'downLight', 'uair', 'dair', 'bair', 'upSmash', 'downSmash', 'dashAttack', 'getupAttack', 'getupAttackFaceDown', 'tripAttack', 'ledgeAttack']) assert.ok(draft.moves[slot], slot);
  await clickText('CharacterEditorScene', 'SAVE TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'donkeykong-tune');
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':donkeykong-tune'))?.[1]);
  assert.ok(stored); assert.deepEqual(JSON.parse(stored).spec, draft);
  await page.screenshot({ path: `${output}/dk-live-kit-saved.png` });
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  const tested = normalize(await actualKit());report.testedKit=tested;assert.deepEqual(tested, expectedKit);
  report.checks.push({ name: 'pointer-edited DK gravity draft saves all current live attacks, grab and selected profile into Test Fight', moves: tested.moves.map(move => move.id), legacyNair: draft.moves.nair });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('PauseMenuScene'));
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
  const returned = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterEditorScene'); return { spec: s.editState.getSpec(), slot: s.savedSlotId }; });
  assert.deepEqual(normalize(returned.spec), draft); assert.equal(returned.slot, 'donkeykong-tune');
  report.checks.push({ name: 'Return to Lab preserves saved DK source and complete draft' });
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await open('CharacterEditorScene');
  await clickText('CharacterEditorScene', 'DONKEYKONG-TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'donkeykong-tune');
  assert.deepEqual(normalize(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec())), draft);
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  assert.deepEqual(normalize(await actualKit()), expectedKit);
  report.checks.push({name:'Page reload and pointer-selected saved tune reconstruct the complete canonical kit in a match'});
  const motion=await page.evaluate(()=>{
    const s=window.__game.scene.getScene('MatchScene'),a=s.p1;s.physicsEngine.pause();s.roundStartCountdown=0;s.cpuControllers.clear();
    const floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');
    a.resetForRound(floor.position.x,floor.bounds.min.y-350);a.setInvincibility(0);
    for(let i=0;i<2;i++){s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();}
    s.matter.body.setVelocity(a.body,{x:0,y:2});
    const before={position:a.getPosition(),velocity:a.getVelocity(),resetGeneration:a.getPositionResetGeneration(),grounded:a.isGrounded()};
    s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();
    return{before,position:a.getPosition(),velocity:a.getVelocity(),profile:a.getDonkeyKongVerticalMotionState().profile,resetGeneration:a.getPositionResetGeneration()};
  });
  report.motionProbe=motion;
  assert.equal(motion.before.grounded,false);assert.equal(motion.resetGeneration,motion.before.resetGeneration);
  assert(Math.abs(motion.profile.totalGravity-.430)<1e-12);assert(Math.abs(motion.velocity.y-2.430)<1e-6);
  report.checks.push({name:'Pointer-edited saved gravity actually controls the reconstructed match Matter step',expectedVelocityY:2.430,observed:motion});
  await page.screenshot({path:`${output}/dk-reloaded-custom-gravity-match.png`});
  assert.deepEqual(report.errors, []);
  report.result='PASS_CURRENT_DK_LAB_SAVE_RELOAD_MATCH';
  console.log(JSON.stringify({ result:report.result, checks: report.checks.map(check => check.name), errors: report.errors }));
} catch(error) {
  report.result='FAIL';report.failure=error.stack;process.exitCode=1;console.error(error.stack);
} finally {
  await writeFile(`${output}/registry-lab-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
