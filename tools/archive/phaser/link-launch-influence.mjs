import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_INFLUENCE_OUTPUT ?? 'docs/review/2026-09-20/launch-influence/production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], scenarios: [], notes: [
  'Actual production MatchScene attacks and collision delivery; victim stick held only during hitlag, neutral afterward.',
  'Original platforms and KO registrations are disabled for isolated open trajectories; this probe does not measure KO thresholds.',
  'Expected release uses independent reference knockback, gravity boost, DI and LSI arithmetic with the project unit-disc input adapter.',
  'Expected trajectories iterate ordinary launch decay and gravity ticks using an independent source reaction-clock recurrence.',
  'Release position includes real SDI. Trajectory comparisons begin immediately before the first release integration.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

const inputs = { neutral: { x: 0, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  diagonal: { x: 1, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const scenarios = [
  ...['neutral', 'up', 'down', 'diagonal'].map(input => ({ target: 'link', move: 'tilt', input })),
  { target: 'link', move: 'tilt', input: 'diagonal', facing: -1 },
  ...['neutral', 'up', 'down'].map(input => ({ target: 'donkeykong', move: 'tilt', input })),
  ...['neutral', 'up', 'down', 'left', 'right'].map(input => ({ target: 'link', move: 'uair', input })),
  { target: 'link', move: 'uair', input: 'right', facing: -1 },
  ...['neutral', 'up', 'right'].map(input => ({ target: 'donkeykong', move: 'uair', input })),
  { target: 'link', move: 'uair', input: 'diagonal', percent: 0 },
].map(spec => {
  const facing = spec.facing ?? 1, percent = spec.percent ?? 100;
  return { ...spec, facing, percent, stick: { x: inputs[spec.input].x * facing, y: inputs[spec.input].y },
    id: `${spec.move}-${spec.target}-${percent}-${spec.input}-${facing === 1 ? 'right' : 'left'}` };
});

function reference(spec) {
  const weight = spec.target === 'link' ? 104 : 127;
  const profile = spec.target === 'link'
    ? { gravity: 0.096, fallSpeed: 1.6, verticalGravity: 0.076944, verticalFallSpeed: 1.8 }
    : { gravity: 0.085, fallSpeed: 1.63, verticalGravity: 0.084672, verticalFallSpeed: 1.8 };
  const damage = spec.move === 'tilt' ? 13 : 15;
  const postPercent = spec.percent + damage;
  const kb = (((postPercent / 10 + postPercent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
    * (spec.move === 'tilt' ? 0.82 : 0.93)) + (spec.move === 'tilt' ? 55 : 23);
  const h = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = h + 1 >= 32;
  const radians = spec.move === 'tilt' ? 0.663225 : 85 * Math.PI / 180;
  const vertical = tumble && radians >= 1.22173 && radians <= 1.91986;
  const boost = tumble && !vertical ? 25 * (profile.gravity - 0.075) : 0;
  const queued = { x: kb * 0.15 * Math.cos(radians) * spec.facing,
    y: -kb * 0.15 * Math.sin(radians) - boost };
  const magnitude = Math.hypot(queued.x, queued.y), angle = Math.atan2(queued.y, queued.x);
  const divisor = Math.max(1, Math.hypot(spec.stick.x, spec.stick.y));
  const stick = { x: spec.stick.x / divisor, y: spec.stick.y / divisor };
  const eligible = tumble && Math.atan2(Math.abs(queued.y), Math.abs(queued.x)) >= 0.17;
  const rotatedAngle = angle + (eligible ? 0.17 * (stick.y * queued.x - stick.x * queued.y) / magnitude : 0);
  const degrees = ((rotatedAngle * 180 / Math.PI) % 360 + 360) % 360;
  const immune = (degrees > 65 && degrees < 115) || (degrees > 245 && degrees < 295);
  const multiplier = eligible && !immune ? 1 - (stick.y < 0 ? 0.095 : 0.08) * stick.y : 1;
  const release = { x: magnitude * multiplier * Math.cos(rotatedAngle),
    y: magnitude * multiplier * Math.sin(rotatedAngle) };

  // Independent iterative version of ReactionFrameMulSpeedUp. No runtime
  // combat, launch-influence, gravity or scheduling helper is imported.
  const faf = h + 1, maximum = tumble ? 1 + 5 * Math.min(1, Math.max(0, (faf - 30) / 50)) : 1;
  const remaining = start => {
    let r = start, mag = maximum, elapsed = 0;
    while (mag > 1) {
      mag = Math.min(1, Math.max(0, (faf * (1 - 0.7) - r) / (faf * (1 - 0.7) - faf))) * maximum;
      r -= Math.max(1, mag); elapsed++;
    }
    return elapsed + Math.ceil(r);
  };
  const displayedFaf = remaining(faf), groups = Array(displayedFaf).fill(0);
  for (let n = 0; n < faf; n++) groups[displayedFaf - remaining(faf - n)]++;
  return { kb, damage, h, tumble, profile, vertical, boost, queued, release, multiplier, rotatedAngle, groups };
}

function expectedTrajectory(expected) {
  const rows = [], initialMagnitude = Math.hypot(expected.release.x, expected.release.y);
  let n = 0, x = 0, y = 0, gravity = 0;
  for (let displayed = 0; displayed < expected.groups.length; displayed++) {
    let velocity;
    for (let tick = 0; tick < expected.groups[displayed]; tick++, n++) {
      const scale = Math.max(0, initialMagnitude - 0.255 * n) / initialMagnitude;
      const acceleration = 5 * (expected.vertical ? expected.profile.verticalGravity : expected.profile.gravity);
      const cap = 5 * (expected.vertical ? expected.profile.verticalFallSpeed : expected.profile.fallSpeed);
      if (n > 0) gravity = Math.min(cap, gravity + acceleration);
      velocity = { x: expected.release.x * scale, y: expected.release.y * scale + gravity };
      x += velocity.x; y += velocity.y;
    }
    rows.push({ displayed, ordinaryTick: n - 1, position: { x, y }, velocity,
      hitstun: expected.groups.length - 1 - displayed });
  }
  return rows;
}

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_INFLUENCE_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_INFLUENCE_EXPECT_ARTIFACT)), 'Expected rebuilt LSI artifact');
  for (const spec of scenarios) {
    const expected = reference(spec);
    const actual = await page.evaluate(spec => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 920,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: spec.target, paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      const a = s.p1, d = s.p2, origin = { x: 720, y: 120 };
      for (const index of [0, 1]) {
        s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
      }
      s.inputResolver.getMoveVector = index => index === 2 && d.getHitlagRemaining() > 0 ? { ...spec.stick } : { x: 0, y: 0 };
      s.inputResolver.isActionHeld = () => false;
      const hits = [], trace = [], clocks = { checkedSteps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let frame = 0, release = null;
      const read = () => ({ position: { ...d.getPosition() }, velocity: { ...d.getVelocity() },
        hitlag: d.getHitlagRemaining(), hitstun: d.getHitstunRemaining(), grounded: d.isGrounded() });
      const hit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const result = hit(info);
        if (result.outcome === 'landed') hits.push({ frame: frame + 1, info, result });
        return result;
      };
      const applyInput = d.applyInput.bind(d);
      d.applyInput = input => {
        const releasing = d.getHitlagRemaining() === 1 && d.pendingKnockback !== null;
        const queued = releasing ? { ...d.pendingKnockback.vector } : null;
        applyInput(input);
        if (releasing) release = { frame: frame + 1, input: { ...input }, queued, ...read() };
      };
      const step = (record = false) => {
        const before = { frame: s.physicsEngine.getFrame(), time: s.matter.world.engine.timing.timestamp,
          input: clocks.inputSamples, rules: clocks.ruleUpdates, gravity: { ...s.matter.world.engine.gravity } };
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); frame++;
        if (s.physicsEngine.getFrame() !== before.frame + 1 || clocks.inputSamples !== before.input + 1
          || clocks.ruleUpdates !== before.rules + 1) throw new Error('Outer game clocks advanced more than once');
        const timeError = Math.abs(s.matter.world.engine.timing.timestamp - before.time - s.physicsEngine.fixedTimestepMs);
        clocks.maxTimeError = Math.max(clocks.maxTimeError, timeError);
        if (timeError > 1e-8) throw new Error('World time accelerated');
        if (['x', 'y', 'scale'].some(key => s.matter.world.engine.gravity[key] !== before.gravity[key]))
          throw new Error('World gravity not restored');
        clocks.checkedSteps++;
        if (record && release) trace.push({ frame, ...read() });
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      if (spec.move === 'tilt') s.matter.add.rectangle(origin.x - spec.facing * 487.5, origin.y + 46, 1025, 20,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0); a.setFacing(spec.facing);
      d.resetForRound(origin.x + 400, origin.y - 200);
      if (spec.move === 'tilt') for (let i = 0; i < 25; i++) step();
      a.setFacing(spec.facing);
      if (!a.attemptAttack(`link.${spec.move}`)) throw new Error(`Cannot start ${spec.move}`);
      const move = a.getAttack(`link.${spec.move}`);
      while (a.getActiveAttack().framesElapsed < move.startupFrames - 1) step();
      const at = a.getPosition();
      d.resetForRound(at.x + spec.facing * (spec.move === 'tilt' ? 62 : 4), at.y - (spec.move === 'tilt' ? 3 : 66));
      d.setDamagePercent(spec.percent);
      for (let i = 0; i < 180; i++) {
        step(true);
        if (i === 0 && hits.length) a.setPosition(at.x - spec.facing * 400, at.y);
        if (release && d.getHitstunRemaining() === 0) break;
      }
      return { hits, release, trace, clocks, tuning: d.getTuning(), finalDamage: d.getDamagePercent() };
    }, spec);
    report.scenarios.push({ ...spec, expected, ...actual });
    assert.equal(actual.hits.length, 1, `${spec.id}: one actual authored collision hit`);
    assert.ok(actual.release, `${spec.id}: hitlag release observed`);
    assert.equal(actual.hits[0].result.damageApplied, expected.damage);
    assert.equal(actual.finalDamage, spec.percent + expected.damage);
    assert.ok(Math.abs(actual.hits[0].result.knockback.referenceKnockback - expected.kb) < 1e-9);
    assert.equal(actual.hits[0].result.knockback.ordinaryHitstunFrames, expected.h);
    assert.equal(actual.release.hitstun, expected.groups.length - 1);
    assert.equal(actual.release.input.moveX, spec.stick.x);
    assert.equal(actual.release.input.moveY, spec.stick.y);
    for (const axis of ['x', 'y']) {
      assert.ok(Math.abs(actual.release.queued[axis] - expected.queued[axis]) < 1e-8, `${spec.id}: queued ${axis}`);
      assert.ok(Math.abs(actual.release.velocity[axis] - expected.release[axis]) < 1e-8, `${spec.id}: influenced ${axis}`);
    }
    const trajectory = expectedTrajectory(expected);
    assert.equal(actual.trace.length, trajectory.length, `${spec.id}: displayed trajectory length`);
    let maxPositionError = 0, maxVelocityError = 0;
    for (let i = 0; i < trajectory.length; i++) {
      const sample = actual.trace[i], oracle = trajectory[i];
      assert.equal(sample.hitstun, oracle.hitstun, `${spec.id}: displayed step ${i} hitstun`);
      assert.equal(sample.grounded, false, `${spec.id}: isolated aerial launch`);
      for (const axis of ['x', 'y']) {
        maxPositionError = Math.max(maxPositionError,
          Math.abs(sample.position[axis] - actual.release.position[axis] - oracle.position[axis]));
        maxVelocityError = Math.max(maxVelocityError, Math.abs(sample.velocity[axis] - oracle.velocity[axis]));
      }
    }
    assert.ok(maxPositionError < 1e-6 && maxVelocityError < 1e-6,
      `${spec.id}: independent trajectory mismatch (${maxPositionError}, ${maxVelocityError})`);
    Object.assign(report.scenarios.at(-1), { maxPositionError, maxVelocityError });
    assert.equal(actual.clocks.inputSamples, actual.clocks.checkedSteps);
    assert.equal(actual.clocks.ruleUpdates, actual.clocks.checkedSteps);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.id,
    multiplier: row.expected.multiplier, release: row.release.velocity, frames: row.trace.length,
    maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/launch-influence.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
