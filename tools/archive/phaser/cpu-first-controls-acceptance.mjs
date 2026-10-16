import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-09/controls';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
async function stopScenes() {
  await page.evaluate(() => { for (const s of window.__game.scene.getScenes(true)) window.__game.scene.stop(s.scene.key); });
  await page.waitForTimeout(60);
}
async function clickObject(kind) {
  const point = await page.evaluate(kind => {
    const game = window.__game, s = game.scene.getScene('CharacterSelectScene');
    const bounds = kind === 'card' ? s.cards[1].cardBounds : s.portraitTiles[10].bounds;
    const canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + bounds.centerX * canvas.width / game.scale.gameSize.width,
      y: canvas.top + bounds.centerY * canvas.height / game.scale.gameSize.height };
  }, kind);
  await page.mouse.click(point.x, point.y);
}
async function verifyControls() {
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    s.physicsEngine.resume();
    for (let i = 0; i < 80; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
    const y = s.p2.getPosition().y;
    s.p1.resetForRound(1500, y); s.p2.resetForRound(650, y);
    for (let i = 0; i < 5; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
    s.physicsEngine.pause();
  });
  const samples = [];
  for (const key of ['d', 'ArrowRight']) {
    await page.keyboard.down(key);
    samples.push(await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
      for (let i = 0; i < 10; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();
      return { input: s.inputResolver.getMoveVector(2), vx: s.p2.getVelocity().x,
        profile: s.matchParticipants[1].slot.bindingProfileIndex, layout: s.matchParticipants[1].slot.inputDevice.layout,
        cpuHasBindings: Object.values(s.matchParticipants[0].bindings?.bindings ?? {}).some(entries => entries.length) };
    }));
    await page.keyboard.up(key);
  }
  assert.equal(samples[0].input.x, 0); assert.equal(samples[0].vx, 0);
  assert.equal(samples[1].input.x, 1); assert.ok(samples[1].vx > 0);
  for (const sample of samples) { assert.equal(sample.profile, 2); assert.equal(sample.layout, 'keyboard_p2'); assert.equal(sample.cpuHasBindings, false); }
  return samples;
}
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  for (const join of ['card', 'space', 'portrait', 'restored']) {
    await stopScenes();
    await page.evaluate(() => {
      const game = window.__game;
      game.registry.remove('lastCharacterSelectState'); game.registry.remove('lastCharacterSelectPads');
      game.scene.start('CharacterSelectScene');
    });
    await page.keyboard.press('c'); // P1 is a CPU before any keyboard player joins.
    if (join === 'restored') {
      await page.evaluate(() => {
        const game = window.__game, s = game.scene.getScene('CharacterSelectScene');
        game.registry.set('lastCharacterSelectState', { slots: s.state.slots.map(slot => slot.index === 2
          ? { ...slot, mode: 'human', inputType: 'keyboard_p1', pickedCharacterId: 'link' } : slot) });
      });
      await stopScenes();
      await page.evaluate(() => window.__game.scene.start('CharacterSelectScene'));
    } else if (join === 'card') await clickObject('card');
    else { await page.keyboard.press('2'); if (join === 'space') await page.keyboard.press('Space'); else await clickObject('portrait'); }
    const selected = await page.evaluate(() => {
      const s = window.__game.scene.getScene('CharacterSelectScene');
      return { p1: s.state.slots[0].mode, p2: s.state.slots[1].inputType, label: s.cards[1].inputLabel.text };
    });
    assert.equal(selected.p1, 'bot'); assert.equal(selected.p2, 'keyboard_p2');
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('StageSelectScene'));
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
    const controls = await verifyControls();
    // Use the actual restart payload, whose original slot/profile identity must persist.
    const launch = await page.evaluate(() => window.__game.scene.getScene('MatchScene').launchData);
    await stopScenes();
    await page.evaluate(data => { window.__game.scene.start('MatchScene', data); window.__game.scene.getScene('MatchScene').physicsEngine.pause(); }, launch);
    const restarted = await verifyControls();
    report.checks.push({ join, selected, controls, restarted });
    console.log(`PASS P1 CPU, P2 ${join}: P2 keys retained through stage handoff and restart; P1 keys have no effect`);
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/cpu-first-controls.json`, JSON.stringify(report, null, 2)); await browser.close(); }
