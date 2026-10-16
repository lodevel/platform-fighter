import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/trip-clank';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual MatchScene source down-tilt contacts and named combat-trip MatchRng draws, then direct normal melee capsule clanks. Public move entry is used; physical controls have separate evidence. Native trip recovery and native clank rebound art remain adaptations; special/projectile/article clanks are outside this implemented scope.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuCombat', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4219/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.observations = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    const seed = 20261008;
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: seed,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 }); scene.inputResolver.isActionHeld = () => false;
    const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const reset = (facing, gap) => {
      scene.p1.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.position.x + facing * gap, floor.bounds.min.y - 25);
      scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let n = 0; n < 12; n++) step();
      scene.p1.setFacing(facing); scene.p2.setFacing(-facing);
    };
    const read = actor => ({ percent: actor.getDamagePercent(), hitlag: actor.getHitlagRemaining(),
      tripped: actor.isTripped(), knockedDown: actor.isKnockedDown(), hitstun: actor.getHitstunRemaining(),
      grounded: actor.isGrounded(), position: actor.getPosition(), velocity: actor.getVelocity() });
    const draws = [], stream = scene.matchRng.stream('combat-trip'), originalNext = stream.next.bind(stream);
    // Observe the existing named MatchRng stream without replacing, forcing or
    // consuming an extra draw. Both actor closures call this same stream.
    stream.next = () => { const value = originalNext(); draws.push(value); return value; };
    const trials = [], screenshots = new Set();
    for (const facing of [1, -1]) for (let trial = 0; trial < 12; trial++) {
      reset(facing, 55);
      const before = draws.length;
      if (!scene.p1.attemptAttack('pikachu.down-tilt')) throw new Error('Actual source down-tilt entry failed');
      for (let n = 0; n < 15 && scene.p2.getDamagePercent() === 0; n++) step();
      const impact = read(scene.p2), sourceFrame = scene.p1.getActiveAttack()?.framesElapsed;
      let freezeSteps = 0;
      while (scene.p2.getHitlagRemaining() > 0 && freezeSteps++ < 30) step();
      const afterFreeze = read(scene.p2), key = `${facing}-${afterFreeze.tripped ? 'trip' : 'nontrip'}`;
      let screenshot = null;
      if (!screenshots.has(key)) { screenshot = `down-tilt-${key}.png`; screenshots.add(key); await window.__capturePikachuCombat(screenshot); }
      trials.push({ facing, trial, sourceFrame, impact, afterFreeze, freezeSteps,
        draws: draws.slice(before), damageInputs: { nativeDamage: 6, freshnessMultiplier: 1.05,
          policy: 'resetForRound clears stale history; real match freshness applies' },
        probabilityInputs: { nativeBonus: 0.3, base: 0.07, grounded: impact.grounded,
          noLiftSourceAngle: 361, receiverPercentBefore: 0 }, probability: 0.37, screenshot });
    }
    const clanks = [];
    const pose = slot => {
      const actor = slot.character, context = actor.getAttackClankPresentationState();
      return { phase: context?.phase, age: context?.framesElapsed, totalFrames: context?.totalFrames,
        contactFrame: context?.interruptedAttack?.framesElapsed, moveId: context?.interruptedAttack?.move.id,
        receiving: actor.getActiveHurtboxes(), facing: actor.getFacing(), percent: actor.getDamagePercent(),
        position: actor.getPosition(), hitlag: actor.getHitlagRemaining(), canAttack: actor.canAttack(),
        texture: slot.sprite.texture.key, textureFrame: Number(slot.sprite.frame.name), origin: [slot.sprite.originX, slot.sprite.originY] };
    };
    for (const facing of [1, -1]) {
      reset(facing, 75);
      if (!scene.p1.attemptAttack('pikachu.down-tilt') || !scene.p2.attemptAttack('pikachu.down-tilt')) throw new Error('Both actual clank moves must enter');
      for (let n = 0; n < 15 && !scene.p1.getAttackClankPresentationState(); n++) step();
      const impact = scene.playerSlots.map(pose);
      const freezeScreenshot = `clank-${facing}-freeze.png`; await window.__capturePikachuCombat(freezeScreenshot);
      let freezeSteps = 0;
      while ((scene.p1.getHitlagRemaining() > 0 || scene.p2.getHitlagRemaining() > 0) && freezeSteps++ < 30) step();
      const rebound = scene.playerSlots.map(pose);
      const reboundScreenshot = `clank-${facing}-rebound.png`; await window.__capturePikachuCombat(reboundScreenshot);
      const blocked = [];
      for (let n = 0; n < 18; n++) { step(); blocked.push(scene.playerSlots.map(slot => ({
        canAttack: slot.character.canAttack(), context: slot.character.getAttackClankPresentationState()?.phase,
        position: slot.character.getPosition(), active: slot.character.getActiveAttack()?.move.id ?? null }))); }
      step(); const released = scene.playerSlots.map(pose);
      clanks.push({ facing, impact, rebound, blocked, released, freezeSteps, freezeScreenshot, reboundScreenshot });
    }
    return { seed, stream: 'combat-trip', rng: scene.matchRng.snapshotState(), draws, trials, clanks,
      adaptations: { tripRecoveryFrames: 26, reboundPresentation: 'captured contact pose held; native rebound art missing',
        clankScope: 'current body-attached grounded normal sensors; airborne and special/projectile/article clanks deferred' } };
  });
  for (const trial of report.observations.trials) {
    assert.equal(trial.impact.percent, trial.damageInputs.nativeDamage * trial.damageInputs.freshnessMultiplier);
    assert.ok(trial.impact.hitlag > 0);
    assert.equal(trial.impact.tripped, false); assert.equal(trial.draws.length, 1);
    assert.equal(trial.afterFreeze.tripped, trial.draws[0] < trial.probability);
    if (trial.afterFreeze.tripped) { assert.equal(trial.afterFreeze.hitstun, 0); assert.equal(trial.afterFreeze.velocity.x, 0); }
    else assert.ok(Math.abs(trial.afterFreeze.velocity.x) > 0);
  }
  for (const facing of [1, -1]) {
    assert.ok(report.observations.trials.some(t => t.facing === facing && t.afterFreeze.tripped));
    assert.ok(report.observations.trials.some(t => t.facing === facing && !t.afterFreeze.tripped));
  }
  for (const row of report.observations.clanks) {
    for (let slot = 0; slot < 2; slot++) {
      const impact = row.impact[slot], rebound = row.rebound[slot];
      assert.equal(impact.phase, 'freeze'); assert.equal(impact.totalFrames, 18); assert.equal(impact.contactFrame, 6);
      assert.equal(impact.percent, 0); assert.equal(impact.receiving.length, 12); assert.equal(impact.texture, 'char.pikachu.dtilt');
      assert.deepEqual(rebound.receiving, impact.receiving); assert.equal(rebound.textureFrame, impact.textureFrame);
      assert.ok(row.blocked.every(step => step[slot].canAttack === false && step[slot].active === null));
      assert.equal(row.released[slot].canAttack, true); assert.equal(row.released[slot].phase, undefined);
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ trials: report.observations.trials.length, clanks: report.observations.clanks.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/trip-clank-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
