import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const output = process.argv[3] ?? process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/lab';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
// JSON writes numeric -0 as 0. Preserve every other property/value while
// checking saved kits; retain the exact normalized paths for review.
function assertSavedEqual(actual, expected, label) {
  const paths = {actual: [], expected: []};
  const normalize = (value, side, path = '$') => {
    if (Object.is(value, -0)) { paths[side].push(path); return 0; }
    if (Array.isArray(value)) return value.map((v, i) => normalize(v, side, `${path}[${i}]`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([k, v]) => [k, normalize(v, side, `${path}.${k}`)]));
    return value;
  };
  assert.deepEqual(normalize(actual, 'actual'), normalize(expected, 'expected'), label);
  report.jsonSignedZeroComparisons ??= [];
  report.jsonSignedZeroComparisons.push({label, paths, scope: 'Only numeric -0 becomes 0; all other values and object properties remain exact.'});
}
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
    return { id: s.p1.id, tuning: s.p1.getTuning(), grab: s.p1.getGrabSpec(),
      moves: [...s.p1.attacks.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  });
}
async function savedOrdinaryReceiving(label) {
  const observed = await page.evaluate(() => {
    const scene = window.__game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    const actor = scene.p1, floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    actor.resetForRound(floor.position.x, floor.bounds.min.y - actor.getTuning().height / 2);
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 }); scene.inputResolver.isActionHeld = () => false;
    for (let n = 0; n < 60 && (actor.getOrdinaryPresentationState()?.framesElapsed ?? -1) < 26; n++) {
      scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause();
    }
    const sprite = scene.playerSlots[0].sprite;
    return { ordinary: actor.getOrdinaryPresentationState(), receiving: actor.getActiveHurtboxes(),
      texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY] };
  });
  const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
  assert.equal(observed.ordinary?.sheet, 'idle'); assert.equal(observed.ordinary.framesElapsed, 26);
  assert.equal(observed.texture, 'char.pikachu.idle'); assert.equal(observed.textureFrame, 1);
  assert.deepEqual(observed.receiving, poses.find(pose => pose.sheet === 'idle' && pose.artFrameIndex === 1).hurtboxes);
  assert.deepEqual(observed.origin, [0.5, 0.8125]);
  report.savedStateReceiving ??= [];
  report.savedStateReceiving.push({ label, observed });
}
async function savedTauntReceiving(label) {
  const observed = await page.evaluate(() => {
    const s=window.__game.scene.getScene('MatchScene');s.physicsEngine.pause();s.roundStartCountdown=0;
    const a=s.p1,floor=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');let input={};
    s.cpuControllers.clear();s.p2.resetForRound(floor.bounds.max.x-40,floor.bounds.min.y-25);
    s.inputResolver.getMoveVector=slot=>({x:0,y:slot===1?input.moveY??0:0});
    s.inputResolver.isActionHeld=(slot,key)=>slot===1&&input[key]===true;
    s.inputResolver.getAppeal=slot=>slot===1&&input.appeal===true;
    const step=(next={})=>{input=next;s.physicsEngine.resume();s.update(0,s.physicsEngine.fixedTimestepMs);s.physicsEngine.pause();};
    const rows=[];
    for(const [kind,moveY] of [['up',-1],['side',0],['down',1]]) {
      a.resetForRound(floor.position.x,floor.bounds.min.y-25);for(let n=0;n<12;n++)step();
      step({appeal:true,moveY});for(let n=0;n<10;n++)step();
      const v=s.playerSlots[0].sprite;rows.push({kind,state:a.getTauntPresentationState(),receiving:a.getActiveHurtboxes(),texture:v.texture.key,frame:Number(v.frame.name)});
    }
    return rows;
  });
  const {PIKACHU_STATE_AUTHORED_HURTBOX_POSES:poses}=await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts',import.meta.url).pathname,import.meta.url);
  report.savedTauntReceiving ??=[];report.savedTauntReceiving.push({label,observed});
  for(const r of observed) {
    assert.equal(r.state?.kind,r.kind);assert.equal(r.state.framesElapsed,10);assert.equal(r.texture,`char.pikachu.taunt_${r.kind}`);assert.equal(r.frame,1);
    assert.deepEqual(r.receiving,poses.find(p=>p.sheet===`taunt_${r.kind}`&&p.artFrameIndex===1).hurtboxes);
  }
}
try {
  await page.goto(process.argv[2] ?? process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4176/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
  await open('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off',
    players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
  const baseline = await actualKit();
  await open('CharacterEditorScene');
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const visible = await page.evaluate(() => !!window.__game.scene.getScene('CharacterEditorScene').children.getByName('shipped:pikachu'));
    if (visible) break;
    const point = await page.evaluate(() => {
      const game=window.__game, object=game.scene.getScene('CharacterEditorScene').children.getByName('roster-page-next');
      const b=object.getBounds(),canvas=game.canvas.getBoundingClientRect();
      return {x:canvas.left+b.centerX*canvas.width/game.scale.gameSize.width,y:canvas.top+b.centerY*canvas.height/game.scale.gameSize.height};
    });
    await page.mouse.click(point.x,point.y);
    await page.waitForTimeout(150);
  }
  await clickText('CharacterEditorScene', 'PIKACHU');
  await page.screenshot({ path: `${output}/pikachu-selection-diagnostic.png` });
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec().id === 'pikachu');
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').previewSprite?.texture.key),
    'char.pikachu.idle', 'Lab must show the dedicated accepted idle art');
  const draft = await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec());
  assert.equal(Object.keys(draft.moves).length, baseline.moves.length + 2);
  assert.deepEqual(draft.moves.taunts, { up: { cancelAfterFrames:49, presentationFrames:78 },
    side: { cancelAfterFrames:49, presentationFrames:71 }, down: { cancelAfterFrames:49, presentationFrames:75 } });
  assert.deepEqual(draft.moves.nair, baseline.moves.find(move => move.id === 'pikachu.neutral-air'));
  for (const slot of ['upLight', 'downLight', 'uair', 'dair', 'bair', 'upSmash', 'downSmash', 'dashAttack', 'getupAttack', 'getupAttackFaceDown', 'tripAttack', 'ledgeAttack']) assert.ok(draft.moves[slot], slot);
  await clickText('CharacterEditorScene', 'SAVE TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'pikachu-tune');
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':pikachu-tune'))?.[1]);
  assert.ok(stored); assertSavedEqual(JSON.parse(stored).spec, draft, 'JSON saved complete draft');
  await page.screenshot({ path: `${output}/pikachu-live-kit-saved.png` });
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  const tested = await actualKit(); assertSavedEqual(tested, baseline, 'Saved complete kit in a match');
  if (process.env.PF_LAB_STATE_RECEIVING === '1') await savedOrdinaryReceiving('saved draft before reload');
  if (process.env.PF_LAB_TAUNTS === '1') await savedTauntReceiving('saved draft before reload');
  report.checks.push({ name: 'pointer-selected dedicated Pikachu draft saves every live attack plus grab and tests with unchanged tuning', moves: tested.moves.map(move => move.id), legacyNair: draft.moves.nair });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('PauseMenuScene'));
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
  const returned = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterEditorScene'); return { spec: s.editState.getSpec(), slot: s.savedSlotId }; });
  assertSavedEqual(returned.spec, draft, 'Return to Lab complete draft'); assert.equal(returned.slot, 'pikachu-tune');
  report.checks.push({ name: 'Return to Lab preserves saved Pikachu source and complete draft' });
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await open('CharacterEditorScene');
  await clickText('CharacterEditorScene', 'PIKACHU-TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'pikachu-tune');
  assertSavedEqual(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec()), draft, 'Reloaded complete draft');
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  assertSavedEqual(await actualKit(), baseline, 'Reloaded complete kit in a match');
  if (process.env.PF_LAB_STATE_RECEIVING === '1') await savedOrdinaryReceiving('saved draft after reload');
  if (process.env.PF_LAB_TAUNTS === '1') await savedTauntReceiving('saved draft after reload');
  report.checks.push({name:'Page reload and pointer-selected saved tune reconstruct the complete canonical kit in a match'});
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ checks: report.checks.map(check => check.name), errors: report.errors }));
} finally {
  await writeFile(`${output}/registry-lab-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
