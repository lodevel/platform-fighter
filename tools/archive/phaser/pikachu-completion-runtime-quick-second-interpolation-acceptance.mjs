import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-quick-second-interpolation';
if (!process.env.PF_BUILD_RECORD) throw new Error('Set PF_BUILD_RECORD to the immutable Quick checkpoint');
const build = JSON.parse(await readFile(process.env.PF_BUILD_RECORD, 'utf8'));
const { STALE_FRESH_MULTIPLIER } = await tsImport(new URL('../src/characters/combat.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual production Match InputResolver Quick Attack second-burst frame28→29 interpolation against an8×8 fixture receiver, both facings and vertical/diagonal paths. Midpoint must hit;20px perpendicular receiver inside diagonal broadphase AABB must miss. First-born endpoint/stale-root tests remain a separate retained probe. First horizontal warp followed by source-qualified vertical/diagonal direction change. No native whole swept collision or moving hurtbox parity claim.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureInterpolation', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4233/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.build = build;
  assert.equal(report.bundleSha256, build.bundleSha256);
  report.rows = await page.evaluate(async () => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 863, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.x ?? 0 : 0, y: slot === 1 ? input.y ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && action === 'special' && input.special === true;
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, receiver = scene.p2;
    receiver.setTuning({ width: 8, height: 8 });
    const read = () => { const sprite = scene.playerSlots[0].sprite, active = actor.getActiveAttack();
      return { state: actor.getPikachuSpecialState(), position: actor.getPosition(), facing: actor.getFacing(), velocity: actor.getVelocity(),
        sensor: active?.hitboxBody ? { ...active.hitboxBody.position } : null,
        previousPointContact: active?.hitboxBody?.plugin?.previousPointContact ?? null,
        texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), rotation: sprite.rotation,
        receiving: actor.getActiveHurtboxes(), targetPosition: receiver.getPosition(), targetReceiving: receiver.getActiveHurtboxes(), damage: receiver.getDamagePercent() }; };
    const rows = [];
    for (const facing of [1, -1]) for (const direction of ['vertical', 'diagonal']) for (const placement of ['midpoint', 'off-path']) {
      actor.resetForRound(floor.position.x - 100, floor.bounds.min.y - 550); receiver.resetForRound(floor.position.x + 350, floor.bounds.min.y - 4);
      actor.setDamagePercent(0); receiver.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      const stick = direction === 'vertical' ? { x: 0, y: -1 } : { x: 0.8 * facing, y: -0.6 };
      const first = { x: facing, y: 0 };
      step({ x: 0, y: -1, special: true }); for (let n = 1; n <= 28; n++) step(n >= 27 ? stick : first);
      const before = read(); if (!before.sensor || before.state.frame !== 28 || !before.state.second) throw new Error('Expected second completed warp frame28');
      const velocity = { x: 49.5 * stick.x, y: 49.5 * stick.y }, length = Math.hypot(velocity.x, velocity.y);
      const perpendicular = placement === 'off-path' ? 20 : 0;
      const target = { x: before.sensor.x + velocity.x / 2 - velocity.y / length * perpendicular,
        y: before.sensor.y + velocity.y / 2 + velocity.x / length * perpendicular };
      receiver.resetForRound(target.x, target.y); receiver.setDamagePercent(0);
      step(stick); const observation = read(), screenshot = `quick-second-interpolation-${facing}-${direction}-${placement}.png`;
      await window.__captureInterpolation(screenshot);
      rows.push({ facing, direction, placement, stick, velocity, target, before, observation, screenshot });
    }
    return rows;
  });
  assert.equal(report.rows.length, 8);
  for (const row of report.rows) {
    assert.equal(row.before.state.frame, 28); assert.equal(row.observation.state.frame, 29);
    assert.equal(row.observation.texture, 'char.pikachu.up_special');
    assert.equal(row.observation.receiving.length, 12);
    assert.ok(Math.abs(row.observation.damage - (row.placement === 'midpoint' ? 3 * STALE_FRESH_MULTIPLIER : 0)) < 1e-5,
      `${row.facing}/${row.direction}/${row.placement}: damage${row.observation.damage}`);
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/quick-second-interpolation-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
