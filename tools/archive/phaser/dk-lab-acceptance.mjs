import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.argv[3] ?? process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/dk-all-attack-values/lab';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [] };
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
    return { id: s.p1.id, tuning: s.p1.getTuning(), grab: s.p1.getGrabSpec(),
      moves: [...s.p1.attacks.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  });
}
try {
  await page.goto(process.argv[2] ?? process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4176/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await(await page.request.get(report.bundle)).body()).digest('hex');
  await open('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off',
    players: [{ index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
  const baseline = await actualKit();
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
  const draft = await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec());
  assert.equal(Object.keys(draft.moves).length, baseline.moves.length + 1);
  assert.deepEqual(draft.moves.nair, baseline.moves.find(move => move.id === 'donkeykong.nair'));
  for (const slot of ['jab2', 'upLight', 'downLight', 'uair', 'dair', 'bair', 'upSmash', 'downSmash', 'dashAttack', 'getupAttack', 'getupAttackFaceDown', 'tripAttack', 'ledgeAttack']) assert.ok(draft.moves[slot], slot);
  await clickText('CharacterEditorScene', 'SAVE TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'donkeykong-tune');
  const stored = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(':donkeykong-tune'))?.[1]);
  assert.ok(stored); assert.deepEqual(JSON.parse(stored).spec, draft);
  await page.screenshot({ path: `${output}/dk-live-kit-saved.png` });
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  const tested = await actualKit(); assert.deepEqual(tested, baseline);
  report.checks.push({ name: 'pointer-selected DK draft saves all 22 live attacks plus grab and tests with unchanged tuning', moves: tested.moves.map(move => move.id), legacyNair: draft.moves.nair });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('PauseMenuScene'));
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
  const returned = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterEditorScene'); return { spec: s.editState.getSpec(), slot: s.savedSlotId }; });
  assert.deepEqual(returned.spec, draft); assert.equal(returned.slot, 'donkeykong-tune');
  report.checks.push({ name: 'Return to Lab preserves saved DK source and complete draft' });
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await open('CharacterEditorScene');
  await clickText('CharacterEditorScene', 'DONKEYKONG-TUNE');
  await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene').savedSlotId === 'donkeykong-tune');
  assert.deepEqual(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').editState.getSpec()), draft);
  await clickText('CharacterEditorScene', 'TEST FIGHT');
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  assert.deepEqual(await actualKit(), baseline);
  report.checks.push({name:'Page reload and pointer-selected saved tune reconstruct the complete canonical kit in a match'});
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ checks: report.checks.map(check => check.name), errors: report.errors }));
} finally {
  await writeFile(`${output}/registry-lab-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
