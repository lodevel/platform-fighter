import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/input';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { scope: 'Actual browser keyboard events through normal match bindings; no resolver replacement', checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4210/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.evaluate(() => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 2818,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    s.roundStartCountdown = 0;
    s.p1.resetForRound(floor.position.x, floor.bounds.min.y - 25);
    s.p2.resetForRound(floor.bounds.max.x - 80, floor.bounds.min.y - s.p2.getTuning().height / 2);
    window.__pikachuInputStep = () => { s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      const a = s.p1.getActiveAttack(), c = s.p1.getAnimationActionState();
      return { id: s.p1.id, attack: a?.move.id ?? c.chargingMove?.id ?? null, elapsed: a?.framesElapsed,
        special: s.p1.getPikachuSpecialState(), grounded: s.p1.isGrounded(), x: s.p1.getPosition().x,
        grab: s.p1.getGrabState(), receiverGrabbed: s.p2.isGrabbed(), receiverDamage: s.p2.getDamagePercent(),
        dodge: s.p1.getDodgeState?.(), shield: s.p1.getShieldState?.() };
    };
    for (let i = 0; i < 12; i++) window.__pikachuInputStep();
  });
  for (const row of [{ key: 'f', id: 'pikachu.jab' }, { key: 'v', id: 'pikachu.forward-smash' }, { key: 'g', id: 'pikachu.neutral_special' }]) {
    await page.keyboard.down(row.key);
    const result = await page.evaluate(() => window.__pikachuInputStep());
    await page.keyboard.up(row.key);
    assert.equal(result.id, 'pikachu'); assert.equal(result.attack, row.id);
    report.checks.push({ key: row.key, expected: row.id, measured: result });
    await page.evaluate(() => { for (let i = 0; i < 200; i++) window.__pikachuInputStep(); });
  }
  for (const row of [
    { direction: 'd', id: 'pikachu.side_special', kind: 'skullBash' },
    { direction: 'w', id: 'pikachu.up_special', kind: 'quickAttack' },
    { direction: 's', id: 'pikachu.down_special', kind: 'thunder' },
  ]) {
    await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene');
      const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      s.p1.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      s.p2.resetForRound(floor.bounds.max.x - 80, floor.bounds.min.y - s.p2.getTuning().height / 2);
      s.p1.setDamagePercent(0); s.p2.setDamagePercent(0);
      for (let frame = 0; frame < 12; frame++) window.__pikachuInputStep();
    });
    await page.keyboard.down(row.direction); await page.keyboard.down('g');
    const result = await page.evaluate(() => window.__pikachuInputStep());
    await page.keyboard.up('g'); await page.keyboard.up(row.direction);
    assert.equal(result.attack, row.id); assert.equal(result.special?.kind, row.kind);
    report.checks.push({ keys: [row.direction, 'g'], expected: row.id, measured: result });
    await page.evaluate(() => { for (let frame = 0; frame < 200; frame++) window.__pikachuInputStep(); });
  }
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    s.p1.resetForRound(floor.position.x, floor.bounds.min.y - 25);
    s.p2.resetForRound(floor.position.x + 35, floor.bounds.min.y - s.p2.getTuning().height / 2);
    s.p1.setDamagePercent(0); s.p2.setDamagePercent(0); s.p1.setFacing(1);
    for (let frame = 0; frame < 12; frame++) window.__pikachuInputStep();
  });
  await page.keyboard.down('t'); await page.evaluate(() => window.__pikachuInputStep()); await page.keyboard.up('t');
  const captured = await page.evaluate(() => { let result; for (let frame = 0; frame < 12; frame++) result = window.__pikachuInputStep(); return result; });
  assert.equal(captured.grab.name, 'holding'); assert.equal(captured.receiverGrabbed, true);
  report.checks.push({ key: 't', expected: 'actual held opponent', measured: captured });
  await page.keyboard.down('f'); await page.evaluate(() => window.__pikachuInputStep()); await page.keyboard.up('f');
  const pummel = await page.evaluate(() => { let result; for (let frame = 0; frame < 20; frame++) result = window.__pikachuInputStep(); return result; });
  assert.equal(pummel.receiverDamage, 1); assert.equal(pummel.receiverGrabbed, true);
  report.checks.push({ key: 'f during hold', expected: 'source pummel1', measured: pummel });
  await page.keyboard.down('w'); const thrown = await page.evaluate(() => window.__pikachuInputStep()); await page.keyboard.up('w');
  assert.equal(thrown.grab.name, 'throwing'); assert.equal(thrown.grab.active.throwDirection, 'up');
  const released = await page.evaluate(() => { let result; for (let frame = 0; frame < 60; frame++) result = window.__pikachuInputStep(); return result; });
  assert.equal(released.receiverGrabbed, false); assert.equal(released.receiverDamage, 9);
  report.checks.push({ key: 'w during hold', expected: 'source up throw8 after pummel1', measured: released });
  await page.screenshot({ path: `${output}/dedicated-pikachu-match.png` });
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.message; throw error;
} finally {
  await writeFile(`${output}/keyboard-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: report.checks.length, errors: report.errors }));
