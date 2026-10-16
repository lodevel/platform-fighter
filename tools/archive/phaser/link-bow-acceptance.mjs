import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-09/gameplay';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4174/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  for (const heldFrames of [1, 19, 38]) {
    await page.evaluate(() => {
      for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key);
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.__game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5,
        stageId: 'flat', rngSeed: 2468, itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const s = window.__game.scene.getScene('MatchScene');
      for (let i = 0; i < 90; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
      const y = s.p1.getPosition().y;
      s.p1.resetForRound(500, y); s.p2.resetForRound(900, y);
      for (let i = 0; i < 10; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();
    });
    await page.keyboard.down('g');
    const charge = await page.evaluate(count => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
      for (let i = 0; i < count; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();
      return { progress: s.p1.getChargeProgress(), held: s.p1.getActiveAttack()?.chargeHeldFrames };
    }, heldFrames);
    await page.keyboard.up('g');
    const result = await page.evaluate(() => {
      const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
      let shot;
      for (let i = 0; i < 40; i++) {
        s.update(0, s.physicsEngine.fixedTimestepMs);
        const p = s.projectiles[0];
        if (p) { shot = { damage: p.damage, speed: Math.abs(p.vx), owner: p.ownerSlotIndex,
          move: p.moveId, width: p.width, art: [p.container.x, p.container.y], physical: [p.x, p.y] }; break; }
      }
      for (let i = 0; i < 65; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();
      return { shot, victimDamage: s.p2.getDamagePercent(), shooterDamage: s.p1.getDamagePercent() };
    });
    if (!result.shot) console.log(JSON.stringify({ heldFrames, charge, result }));
    const expectedDamage = heldFrames === 1 ? 4 : heldFrames === 19 ? 8 : 12;
    const expectedSpeed = heldFrames === 1 ? 10 : heldFrames === 19 ? 16 : 22;
    assert.equal(result.shot?.damage, expectedDamage);
    assert.equal(result.shot?.speed, expectedSpeed);
    assert.deepEqual(result.shot.art, result.shot.physical);
    assert.equal(result.shot.owner, 0); assert.equal(result.shooterDamage, 0);
    assert.ok(result.victimDamage >= expectedDamage);
    if (heldFrames === 38) assert.equal(charge.held, 36);
    report.checks.push({ heldFrames, charge, ...result });
    console.log(`PASS keyboard bow hold ${heldFrames}: projectile ${expectedDamage} damage / ${expectedSpeed} speed, live hit ${result.victimDamage}`);
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/link-bow.json`, JSON.stringify(report, null, 2));
} finally { await browser.close(); }
