import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-09/animation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], notes: ['Real Phaser sprites and MatchScene simulation; isolated software WebGL browser.', 'Loaded art is reused. Three-frame strips share one pose per action phase; missing directional sheets fall back to their move family.'] };
page.on('pageerror', error => report.errors.push(error.message));
const config = { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off', players: [
  { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
  { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
] };
try {
  await page.goto(process.env.PF_ANIMATION_URL ?? 'http://127.0.0.1:4174/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await page.evaluate(config => {
    const game = window.__game;
    game.scene.stop('PasswordGateScene'); game.scene.start('MatchScene', { matchConfig: config });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
  }, config);
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  const timelines = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    s.physicsEngine.resume();
    for (let i = 0; i < 90; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
    const groundY = s.p1.getPosition().y;
    const records = {};
    for (const id of ['link.jab', 'link.smash', 'link.uair', 'link.dair', 'link.fair', 'link.bair', 'link.dtilt']) {
      const aerial = ['uair', 'dair', 'fair', 'bair'].some(part => id.endsWith(part));
      s.p1.resetForRound(650, aerial ? groundY - 260 : groundY);
      s.p2.resetForRound(1300, groundY);
      if (!s.p1.attemptAttack(id)) throw new Error(`Could not start ${id}`);
      s.update(0, 0);
      const frames = [];
      while (s.p1.getActiveAttack()) {
        const active = s.p1.getActiveAttack(), slot = s.playerSlots[0], pose = slot.spriteAnimSm.current();
        frames.push({ elapsed: active.framesElapsed, phase: active.phase, hitbox: active.hitboxBody !== null, key: slot.sprite.anims.currentAnim.key, frame: Number(slot.sprite.frame.name), poseIndex: pose.frameIndex });
        // Keep the aerial fixture clear of the floor while checking its entire
        // attack timeline; natural landing cancellation is covered by combat tests.
        if (aerial) s.matter.body.setPosition(s.p1.body, { x: 650, y: groundY - 260 });
        s.update(0, s.physicsEngine.fixedTimestepMs);
        if (frames.length > 200) throw new Error('Attack did not complete');
      }
      records[id] = frames;
    }
    s.p1.resetForRound(650, groundY); s.p1.attemptAttack('link.smash');
    for (let i = 0; i < 14; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
    s.physicsEngine.pause();
    return records;
  });
  report.checks.push({ name: 'real move timeline samples (aerial fixture kept above floor)', timelines });
  for (const [id, frames] of Object.entries(timelines)) {
    assert.ok(frames.length > 0);
    for (const f of frames) { assert.equal(f.frame, f.poseIndex); assert.ok(f.key.includes(id.split('.')[1])); }
    const windup = frames.filter(f => f.phase === 'startup');
    const contact = frames.filter(f => f.phase === 'active');
    const recovery = frames.filter(f => f.phase === 'recovery');
    assert.ok(windup.length && contact.length && recovery.length, `all phases for ${id}`);
    assert.ok(Math.max(...windup.map(f => f.frame)) < Math.min(...contact.map(f => f.frame)), `contact pose follows windup for ${id}`);
    assert.ok(Math.max(...contact.map(f => f.frame)) < Math.min(...recovery.map(f => f.frame)), `recovery follows contact for ${id}`);
    assert.ok(contact.every(f => f.hitbox), `real hitbox active during contact art for ${id}`);
  }
  report.checks.push({ name: 'seven real move timelines match loaded art and hitbox phases', passed: true });
  await page.screenshot({ path: `${output}/link-contact.png` });

  const before = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'), sprite = s.playerSlots[0].sprite;
    return { frame: Number(sprite.frame.name), action: s.p1.getActiveAttack().framesElapsed, key: sprite.anims.currentAnim.key };
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'), sprite = s.playerSlots[0].sprite;
    return { frame: Number(sprite.frame.name), action: s.p1.getActiveAttack().framesElapsed, key: sprite.anims.currentAnim.key };
  });
  assert.deepEqual(after, before);
  report.checks.push({ name: 'paused simulation has no autonomous Phaser frame drift over 250 ms', before, after });

  const hitlag = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
    s.p1.armAttackerHitlag(8);
    const frames = [];
    for (let i = 0; i < 7; i++) {
      s.update(0, s.physicsEngine.fixedTimestepMs);
      frames.push({ action: s.p1.getActiveAttack().framesElapsed, art: Number(s.playerSlots[0].sprite.frame.name), position: s.p1.getPosition() });
    }
    s.physicsEngine.pause(); return frames;
  });
  for (const frame of hitlag) assert.deepEqual(frame, hitlag[0]);
  report.checks.push({ name: 'contact pose and real Matter fighter freeze together through hitlag', frames: hitlag });

  const menuBefore = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume(); s.openPauseMenu();
    return { sim: s.physicsEngine.getFrame(), art: Number(s.playerSlots[0].sprite.frame.name) };
  });
  await page.waitForTimeout(250);
  const menuAfter = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    return { sim: s.physicsEngine.getFrame(), art: Number(s.playerSlots[0].sprite.frame.name) };
  });
  assert.deepEqual(menuAfter, menuBefore);
  report.checks.push({ name: 'pause menu preserves actual sprite frame and simulation tick', menuBefore, menuAfter });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(`${output}/runtime-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
