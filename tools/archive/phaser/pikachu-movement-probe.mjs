import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/match';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], inputEvidence: 'Deterministic values through the real match InputResolver route; physical keyboard/gamepad separately unverified here', physicsEvidence: 'Source-height Matter calibration and source movement caps; not native game integrator parity' };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4210/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.result = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 819,
      itemFrequency: 'off', players: [
        { index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' },
      ] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    let input = {};
    s.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: player === 1 ? input.moveY ?? 0 : 0 });
    s.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const step = (next = {}) => {
      input = next; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
    };
    const floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    // The standard flat stage has floating platforms above its centre; a
    // full hop there lands on one before returning to the original floor.
    const overhead = s.baseStage.bodies.platformBodies.filter(body => body !== floor);
    const columns = [];
    for (let x = floor.bounds.min.x + 300; x <= floor.bounds.max.x - 300; x += 20) {
      if (overhead.every(body => x + 25 < body.bounds.min.x || x - 25 > body.bounds.max.x)) columns.push(x);
    }
    if (!columns.length) throw new Error('Fixture needs an unobstructed jump column');
    const start = { x: columns[Math.floor(columns.length / 2)], y: floor.bounds.min.y - s.p1.getTuning().height / 2 };
    s.p2.resetForRound(floor.bounds.max.x - 50, start.y);
    const settle = () => {
      s.p1.resetForRound(start.x, start.y);
      for (let i = 0; i < 12; i++) step();
      if (!s.p1.isGrounded()) throw new Error(JSON.stringify({ message:'Fixture must begin grounded',
        position:s.p1.getPosition(),velocity:s.p1.getVelocity(),start,floor:floor.bounds,
        round:s.roundStartCountdown, frame:s.physicsEngine.getFrame?.(),active:s.p1.getActiveAttack()?.move.id,
        stocks:s.stockTracker.getStocks(0) }));
    };
    const arcs = [];
    for (const kind of ['full', 'short', 'full-fastfall', 'short-fastfall']) {
      settle(); const origin = s.p1.getPosition().y;
      let minimum = origin, firstAir = null, contact = null;
      for (let frame = 1; frame <= 120; frame++) {
        const short = kind.startsWith('short');
        step({ jump: short ? frame === 1 : true,
          moveY: kind.endsWith('fastfall') && firstAir !== null && s.p1.getVelocity().y >= 0 ? 1 : 0 });
        minimum = Math.min(minimum, s.p1.getPosition().y);
        if (!s.p1.isGrounded() && firstAir === null) firstAir = frame;
        if (firstAir !== null && s.p1.isGrounded()) { contact = frame; break; }
      }
      arcs.push({ kind, height: origin - minimum, firstAir, contact,
        duration: contact === null ? null : contact - firstAir + 1 });
    }
    settle();
    let peakAirSpeed = 0;
    for (let frame = 1; frame <= 36; frame++) {
      // Start steering after takeoff so this measures air control rather
      // than inheriting the new grounded initial-dash burst on the jump frame.
      step({ jump: true, moveX: frame >= 5 ? 1 : 0 });
      if (!s.p1.isGrounded()) peakAirSpeed = Math.max(peakAirSpeed, Math.abs(s.p1.getVelocity().x));
    }
    const groundMotion = [];
    for (const facing of [1, -1]) {
      settle();
      const samples = [];
      for (let frame = 1; frame <= 24; frame++) {
        step({ moveX: facing });
        samples.push({ frame, speed: s.p1.getVelocity().x, grounded: s.p1.isGrounded() });
      }
      groundMotion.push({ facing, samples });
    }
    return { arcs, peakAirSpeed, groundMotion, tuning: s.p1.getTuning(), transform: s.baseStage.transform };
  });
  const expected = { full: [177.5,53], short: [85.6,38], 'full-fastfall': [177.5,37], 'short-fastfall': [85.6,26] };
  for (const arc of report.result.arcs) {
    const [height,duration] = expected[arc.kind];
    assert.ok(Math.abs(arc.height-height) < 0.1, `${arc.kind}: height ${arc.height}`);
    assert.equal(arc.firstAir,4);
    assert.ok(Math.abs(arc.duration-duration) <= 1, `${arc.kind}: duration ${arc.duration}`);
  }
  assert.ok(Math.abs(report.result.peakAirSpeed-4.785) < 1e-6);
  // UFD Pikachu native speeds multiplied by the project's 5px/unit conversion.
  for (const { facing, samples } of report.result.groundMotion) {
    assert.ok(samples.every(sample => sample.grounded), 'dash/run remains grounded');
    // Live stage contact removes 0.004 px/step through Matter floor friction.
    assert.ok(Math.abs(samples[0].speed - facing * 9.9) < 0.005, 'first-step initial dash speed');
    assert.ok(Math.abs(samples[12].speed - facing * 9.9) < 0.005, 'thirteen-frame initial dash');
    assert.ok(Math.abs(samples.at(-1).speed - facing * 10.195) < 0.005, 'settled run speed');
  }
  assert.deepEqual(report.errors,[]);
  console.log(JSON.stringify(report,null,2));
} finally {
  await writeFile(`${output}/pikachu-movement-probe.json`, `${JSON.stringify(report,null,2)}\n`);
  await browser.close();
}
