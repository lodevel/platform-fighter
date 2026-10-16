import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_ANIMATION_OUTPUT ?? 'docs/review/2026-09-09/link-gameplay';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], notes: [
  'Real MatchScene, Matter and loaded Phaser art in isolated software WebGL.',
  'Aerial timeline fixtures are held above the floor to inspect all strike windows; natural landing is tested separately.',
  'The multihit victim is kept within sword range to test damage identity, not to assert a guaranteed natural combo.',
  'Existing Link back-air art is a forward sword slash, so presentation faces that art toward the actual rear hitbox.',
] };
page.on('pageerror', error => report.errors.push(error.message));
const config = { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off', players: [
  { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
  { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
] };
const windows = {
  'link.usmash': [[9, 15], [24, 30], [40, 45]],
  'link.dsmash': [[11, 13], [23, 25]],
  'link.fair': [[15, 17], [23, 25]],
  'link.bair': [[5, 8], [14, 17]],
  'link.nair': [[6, 8], [8, 31]],
  'link.uair': [[10, 13], [13, 40]],
};
try {
  await page.goto(process.env.PF_ANIMATION_URL ?? 'http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await page.evaluate(config => {
    const game = window.__game;
    game.scene.stop('PasswordGateScene'); game.scene.start('MatchScene', { matchConfig: config });
    game.scene.getScene('MatchScene').physicsEngine.pause();
  }, config);
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
  const timelines = await page.evaluate(ids => {
    const s = window.__game.scene.getScene('MatchScene');
    s.physicsEngine.resume();
    const step = () => s.update(0, s.physicsEngine.fixedTimestepMs);
    for (let i = 0; i < 90; i++) step();
    const groundY = s.p1.getPosition().y;
    let debug = null;
    const render = s.hitboxDebugLayer.render.bind(s.hitboxDebugLayer);
    s.hitboxDebugLayer.render = snapshots => { debug = snapshots[0]?.activeAttack ?? null; render(snapshots); };
    s.hitboxDebugLayer.setEnabled(true);
    function reset(id, aerial = false) {
      s.p1.resetForRound(650, aerial ? groundY - 260 : groundY); s.p1.setFacing(1);
      s.p2.resetForRound(1300, groundY);
      if (id === 'link.bair') {
        s.p1.applyInput({ moveX: -1, moveY: 0, jump: false, attack: true });
      } else if (!s.p1.attemptAttack(id)) throw new Error(`Cannot start ${id}`);
      s.update(0, 0);
      if (s.p1.getActiveAttack()?.move.id !== id) throw new Error(`Wrong attack for ${id}`);
    }
    function capture() {
      const active = s.p1.getActiveAttack(), slot = s.playerSlots[0], body = active.hitboxBody;
      const trail = s.swingTrails.get(slot.playerIndex).rect;
      return {
        elapsed: active.framesElapsed, phase: active.phase, hitbox: !!body,
        window: body?.plugin.hitWindowIndex ?? null,
        sensor: body ? { offsetX: body.position.x - s.p1.getPosition().x,
          offsetY: body.position.y - s.p1.getPosition().y,
          width: body.bounds.max.x - body.bounds.min.x, height: body.bounds.max.y - body.bounds.min.y } : null,
        debug: debug ? debug.move.hitbox : null,
        pose: slot.spriteAnimSm.current(), art: Number(slot.sprite.frame.name),
        artCount: slot.sprite.anims.currentAnim.frames.length, flipX: slot.sprite.flipX,
        actionFacing: active.facing, controlFacing: s.p1.getFacing(),
        trail: { visible: trail.visible, x: trail.x, y: trail.y, width: trail.width, height: trail.height },
      };
    }
    const records = {};
    for (const id of ids) {
      const aerial = !id.endsWith('smash');
      reset(id, aerial);
      const frames = [];
      while (s.p1.getActiveAttack()) {
        frames.push(capture());
        if (aerial) s.matter.body.setPosition(s.p1.body, { x: 650, y: groundY - 260 });
        step();
        if (frames.length > 200) throw new Error('Attack did not end');
      }
      records[id] = frames;
    }
    window.__linkProbe = { s, step, reset, capture, groundY };
    s.physicsEngine.pause();
    return records;
  }, Object.keys(windows));
  report.timelines = timelines;
  for (const [id, frames] of Object.entries(timelines)) {
    assert.ok(frames.length > 20, `${id} whole timeline recorded`);
    for (const f of frames) {
      const activeWindow = windows[id].findIndex(([start, end]) => f.elapsed >= start && f.elapsed < end);
      assert.equal(f.hitbox, activeWindow >= 0, `${id} sensor at elapsed ${f.elapsed}`);
      assert.equal(f.window, activeWindow >= 0 ? activeWindow : null, `${id} live window index`);
      assert.equal(f.art, f.pose.frameIndex, `${id} actual Phaser pose`);
      assert.deepEqual(f.debug, f.sensor, `${id} F3 must show actual sensor or no box at elapsed ${f.elapsed}`);
      if (!f.hitbox) assert.equal(f.trail.visible, false, `${id} no harmless-gap swing trail`);
      const contactFrame = f.artCount === 4 ? 2 : 1;
      if (f.artCount >= 3 && f.artCount <= 4) {
        assert.equal(f.art === contactFrame, f.hitbox, `${id} visible contact pose at elapsed ${f.elapsed}`);
      }
    }
  }
  const reverse = timelines['link.dsmash'];
  const first = reverse.find(f => f.elapsed === 11), second = reverse.find(f => f.elapsed === 23);
  assert.ok(first.sensor.offsetX > 0 && second.sensor.offsetX < 0);
  assert.equal(first.pose.facing, 1); assert.equal(second.pose.facing, -1);
  assert.notEqual(first.flipX, second.flipX); assert.equal(first.controlFacing, second.controlFacing);
  assert.ok(first.trail.visible && second.trail.visible);
  assert.ok(first.trail.x > 650 && second.trail.x < 650);
  assert.equal(second.trail.width, second.sensor.width);
  assert.equal(second.trail.height, second.sensor.height);
  const back = timelines['link.bair'].find(f => f.hitbox);
  assert.equal(back.controlFacing, 1); assert.equal(back.actionFacing, -1);
  assert.ok(back.sensor.offsetX < 0); assert.equal(back.pose.facing, -1);
  report.checks.push({ name: 'six actual attack timelines: strike/gap art, rear facing and F3 geometry', passed: true });

  for (const [label, elapsed] of [['first-strike', 11], ['harmless-gap', 16], ['reverse-strike', 23]]) {
    await page.evaluate(elapsed => {
      const p = window.__linkProbe; p.s.physicsEngine.resume(); p.reset('link.dsmash');
      while (p.s.p1.getActiveAttack().framesElapsed < elapsed) p.step();
      p.s.physicsEngine.pause();
    }, elapsed);
    await page.screenshot({ path: `${output}/animation-${label}.png` });
  }
  const pausedBefore = await page.evaluate(() => window.__linkProbe.capture());
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.__linkProbe.capture()), pausedBefore);
  const hitlag = await page.evaluate(() => {
    const p = window.__linkProbe; p.s.physicsEngine.resume(); p.s.p1.armAttackerHitlag(8);
    const frames = [];
    for (let i = 0; i < 7; i++) { p.step(); frames.push(p.capture()); }
    p.s.physicsEngine.pause(); return frames;
  });
  report.hitlag = hitlag;

  const multihit = await page.evaluate(() => {
    const p = window.__linkProbe, s = p.s; s.physicsEngine.resume(); p.reset('link.usmash');
    const before = s.p1.getStaleOccurrences('link.usmash');
    let damage = s.p2.getDamagePercent();
    const initialDamage = damage, hits = [];
    for (let i = 0; i < 200 && s.p1.getActiveAttack(); i++) {
      s.matter.body.setPosition(s.p1.body, { x: 650, y: p.groundY });
      s.matter.body.setVelocity(s.p1.body, { x: 0, y: 0 });
      s.matter.body.setPosition(s.p2.body, { x: 658, y: p.groundY - 42 });
      s.matter.body.setVelocity(s.p2.body, { x: 0, y: 0 });
      p.step();
      const next = s.p2.getDamagePercent();
      if (next !== damage) {
        hits.push({ elapsed: s.p1.getActiveAttack()?.framesElapsed, damage: next - damage,
          stale: s.p1.getStaleOccurrences('link.usmash') });
        damage = next;
      }
    }
    s.physicsEngine.pause();
    return { before, after: s.p1.getStaleOccurrences('link.usmash'), initialDamage, hits };
  });
  report.multihit = multihit;
  assert.equal(multihit.before, 0);
  assert.equal(multihit.after, 1);
  assert.deepEqual(multihit.hits.map(hit => hit.damage), [4, 3, 11]);
  assert.ok(multihit.hits.every(hit => hit.stale === 1));
  report.checks.push({ name: 'real MatchScene three-hit damage remains 4/3/11 and records only one stale occurrence', passed: true });
  for (const f of hitlag) assert.deepEqual(f, hitlag[0]);
  report.checks.push({ name: 'reverse-strike sensor and pose remain frozen through pause and seven hitlag steps', passed: true });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ checks: report.checks, multihit, errors: report.errors }));
} finally {
  await writeFile(`${output}/animation-runtime-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
