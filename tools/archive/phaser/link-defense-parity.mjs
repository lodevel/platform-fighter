import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';

const output = process.env.PF_DEFENSE_OUTPUT ?? 'docs/review/2026-09-22/combat-parity/defense/production';
await mkdir(output, { recursive: true });
const source = await readFile('docs/review/2026-09-22/combat-parity/shared/sources/calculator-formulas.js', 'utf8');
const oracle = runInNewContext(source + '\n({parameters, ParryHitlag, AttackerParryHitlag, ShieldStun, ShieldHitlag})');
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { schemaVersion: 1, scenarios: [], lab: [], errors: [], loadErrors: [], notes: [
  'Normal MatchScene resolved inputs start defense actions; this does not test physical controller hardware.',
  'Fresh action timing and intangibility use measured UFD counts. Air angle interpolation, travel, ground roll distance, dodge staling, and directional landing19 remain documented approximations.',
  'Shield boundary delivery calls Character.applyHitDetailed after normal release. Category/freeze rows exercise the actual MatchScene resolveCombatHit callback, with a synthetic registered category witness; they are callback integration checks, not shield geometry tests.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));
const cases = [
  ...[
    ['neutral', 0, 0, 49, 29], ['right', 1, 0, 82, 20], ['left', -1, 0, 82, 20],
    ['up', 0, -1, 108, 20], ['down', 0, 1, 69, 20],
    ['up-right', 1, -1, 95, 20], ['down-left', -1, 1, 74, 20],
  ].map(([id, x, y, total, end]) => ({ id: `air-${id}`, kind: 'air', x, y, total, start: 2, end, facing: 1 })),
  ...[
    ['spot', 0, 1, 26, 2, 16], ['forward', 1, 1, 30, 3, 14],
    ['backward', -1, 1, 35, 4, 15], ['forward-mirror', -1, -1, 30, 3, 14],
    ['backward-mirror', 1, -1, 35, 4, 15],
  ].map(([id, x, facing, total, start, end]) => ({ id: `ground-${id}`, kind: 'ground', x, y: 0, facing, total, start, end })),
  ...[0, 4, 5, 10].map(elapsed => ({ id: `release-hit-${elapsed}`, kind: 'shield', elapsed })),
  ...[false, true].map(directional => ({ id: `landing-${directional ? 'directional' : 'neutral'}`, kind: 'landing', directional })),
  ...['normal', 'aerial', 'smash', 'projectile'].map(category => ({ id: `shield-callback-${category}`, kind: 'callback', category, parry: false })),
  ...['normal', 'projectile'].map(category => ({ id: `parry-callback-${category}`, kind: 'callback', category, parry: true })),
];

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_DEFENSE_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_DEFENSE_EXPECT_ARTIFACT)), 'Expected final defense artifact');
  for (const spec of cases) {
    const actual = await page.evaluate(spec => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 922,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
      const ch = scene.p1, body = scene.matter.body, neutral = { moveX: 0, moveY: 0 };
      let input = neutral;
      scene.inputResolver.getMoveVector = index => index === 1 ? { x: input.moveX ?? 0, y: input.moveY ?? 0 } : { x: 0, y: 0 };
      scene.inputResolver.isActionHeld = (index, action) => index === 1 && input[action] === true;
      for (const index of [0, 1]) { scene.blastZoneWatcher.unregisterPlayer(index); scene.blastZonePositionWatcher.unregisterPlayer(index); }
      const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0, maxWitnessError: 0 };
      for (const [owner, method, counter] of [[scene.inputResolver, 'update', 'inputSamples'], [scene.matchRules, 'update', 'ruleUpdates']]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let witness = null;
      const snapshot = () => ({ dodge: ch.getDodgeState(), invincible: ch.isDodgeInvincible(),
        position: { ...ch.getPosition() }, velocity: { ...ch.getVelocity() }, facing: ch.getFacing(),
        grounded: ch.isGrounded(), canAttack: ch.canAttack(), shielding: ch.isShielding(),
        release: ch.getShieldReleaseRemaining(), parrying: ch.isShieldParrying(),
        landing: ch.getAnimationActionState().landingRecoveryRemaining });
      const step = (next = neutral) => {
        input = next;
        const frame = scene.physicsEngine.getFrame(), timestamp = scene.matter.world.engine.timing.timestamp;
        const samples = clocks.inputSamples, rules = clocks.ruleUpdates;
        const previousWitness = witness && { x: witness.position.x, y: witness.position.y, vy: witness.velocity.y };
        const gravity = scene.matter.world.engine.gravity;
        const expectedGravity = gravity.y * gravity.scale * scene.physicsEngine.fixedTimestepMs ** 2;
        scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause();
        clocks.steps++;
        clocks.maxTimeError = Math.max(clocks.maxTimeError, Math.abs(scene.matter.world.engine.timing.timestamp - timestamp - scene.physicsEngine.fixedTimestepMs));
        if (scene.physicsEngine.getFrame() !== frame + 1 || clocks.inputSamples !== samples + 1 || clocks.ruleUpdates !== rules + 1)
          throw new Error('Outer input/rule/physics clocks did not advance once');
        if (previousWitness) clocks.maxWitnessError = Math.max(clocks.maxWitnessError,
          Math.abs(witness.position.x - previousWitness.x - 2),
          Math.abs(witness.position.y - previousWitness.y - previousWitness.vy - expectedGravity));
        return snapshot();
      };
      for (let i = 0; i < 100; i++) step();
      const category = scene.baseStage.bodies.platformBodies.find(platform => platform.label === 'platform.solid').collisionFilter.category;
      for (const platform of scene.baseStage.bodies.platformBodies) platform.collisionFilter.mask = 0;
      if (['ground', 'shield', 'callback'].includes(spec.kind)) scene.matter.add.rectangle(720, 166, 4000, 20,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      ch.resetForRound(720, 120); scene.p2.resetForRound(5720, 120);
      if (['ground', 'shield', 'callback'].includes(spec.kind)) for (let i = 0; i < 20; i++) step();
      ch.setFacing(spec.facing ?? 1);
      witness = scene.matter.add.rectangle(10000, -1000, 5, 5, { frictionAir: 0, collisionFilter: { mask: 0 } });
      body.setVelocity(witness, { x: 2, y: 0 });
      const trace = [];
      let hit = null;
      if (spec.kind === 'callback') {
        for (let i = 0; i < 3; i++) step({ shield: true }); if (spec.parry) step();
        const owner = scene.p2;
        // Exercise MatchScene's real attack callback, including stale lookup,
        // shield category selection, outcome reporting and owner freeze.
        // DK's corresponding authored type differs by ID; register only the
        // category witness, then deliver the same bounded damage in all rows.
        const moveId = `defense.probe.${spec.category}`;
        owner.addAttack({ ...ch.getAttack('link.jab'), id: moveId,
          type: spec.category === 'smash' ? 'smash' : spec.category === 'aerial' ? 'aerial' : 'jab' });
        const original = ch.applyHitDetailed.bind(ch);
        ch.applyHitDetailed = info => { const result = original(info); hit = { ...result, effective: info }; return result; };
        const callback = scene.resolveCombatHit(0, { damage: 10, hitlagMultiplier: 0.8,
          knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 },
          { attackerPlayerIndex: 1, attackerOwnerId: owner.id, moveId,
            attackInstance: {}, projectile: spec.category === 'projectile' });
        hit = { ...hit, callback, defenderFreeze: ch.getHitlagRemaining(), ownerFreeze: owner.getHitlagRemaining(),
          shieldstun: spec.parry ? ch.getShieldParryStunRemaining() : ch.getShieldState().blockStunRemaining,
          damage: ch.getDamagePercent() };
        const duration = Math.max(hit.defenderFreeze + hit.shieldstun, hit.ownerFreeze);
        for (let frame = 0; frame <= duration; frame++) {
          trace.push({ defenderFreeze: ch.getHitlagRemaining(), ownerFreeze: owner.getHitlagRemaining(),
            parryStun: ch.getShieldParryStunRemaining(), protected: ch.isInvincible() });
          step({ shield: !spec.parry });
        }
      } else if (spec.kind === 'shield') {
        for (let i = 0; i < 3; i++) step({ shield: true });
        for (let elapsed = 0; elapsed <= spec.elapsed; elapsed++) trace.push(step());
        const hp = ch.getShieldHealth();
        hit = ch.applyHitDetailed({ damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 });
        hit = { ...hit, hpBefore: hp, hpAfter: ch.getShieldHealth(), damage: ch.getDamagePercent(), releaseAfter: ch.getShieldReleaseRemaining() };
      } else if (spec.kind === 'landing') {
        trace.push(step({ moveX: spec.directional ? 1 : 0, dodge: true }));
        for (let i = 0; i < 31; i++) step();
        const p = ch.getPosition();
        scene.matter.add.rectangle(p.x, p.y + ch.getTuning().height / 2 + 11, 1000, 20,
          { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
        body.setVelocity(ch.body, { x: 0, y: 2 }); step();
        if (!ch.isGrounded()) throw new Error('Landing fixture missed support');
        const duration = spec.directional ? 19 : 10;
        for (let i = 0; i <= duration; i++) trace.push(step({ shield: true }));
      } else {
        trace.push(step({ moveX: spec.x, moveY: spec.y, dodge: true }));
        for (let elapsed = 1; elapsed <= spec.total; elapsed++) trace.push(step());
      }
      return { spec, trace, hit, clocks, tuning: ch.getTuning().dodge };
    }, spec);
    report.scenarios.push(actual);
    assert.ok(actual.clocks.maxTimeError < 1e-8 && actual.clocks.maxWitnessError < 1e-7, `${spec.id}: outer clocks/gravity`);
    if (spec.kind === 'callback') {
      const projectile = spec.category === 'projectile';
      const damage = 10 * 1.05;
      assert.equal(actual.hit.outcome, spec.parry ? 'parried' : 'shielded');
      assert.equal(actual.hit.damage, 0); assert.equal(actual.hit.effective.damage, damage);
      const defender = spec.parry ? oracle.ParryHitlag(damage, .67, false, projectile, false, !projectile, 2)
        : oracle.ShieldHitlag(damage, 0.8, false, false, projectile, false, !projectile);
      const attacker = spec.parry ? oracle.AttackerParryHitlag(damage, .67, false, projectile, false, !projectile, 2)
        : projectile ? 0 : defender;
      assert.equal(actual.hit.defenderFreeze, defender, `${spec.id}: defender freeze`);
      assert.equal(actual.hit.ownerFreeze, attacker, `${spec.id}: owner freeze`);
      assert.equal(actual.hit.shieldstun, oracle.ShieldStun(damage, 1, projectile, false, false,
        spec.category === 'smash', spec.category === 'aerial'));
      actual.trace.forEach((state, frame) => {
        assert.equal(state.defenderFreeze, Math.max(0, defender - frame));
        assert.equal(state.ownerFreeze, Math.max(0, attacker - frame));
        if (spec.parry) {
          assert.equal(state.parryStun, Math.max(0, actual.hit.shieldstun - Math.max(0, frame - defender)));
          assert.equal(state.protected, frame <= defender + actual.hit.shieldstun);
        }
      });
    } else if (spec.kind === 'shield') {
      assert.equal(actual.hit.outcome, spec.elapsed < 5 ? 'parried' : 'landed');
      assert.equal(actual.hit.releaseAfter, 0);
      actual.trace.forEach((state, elapsed) => {
        assert.equal(state.release, 11 - elapsed); assert.equal(state.parrying, elapsed < 5);
      });
    } else if (spec.kind === 'landing') {
      const duration = spec.directional ? 19 : 10;
      actual.trace.slice(1, -1).forEach((state, index) => {
        assert.equal(state.landing, duration - index); assert.equal(state.shielding, false);
      });
      assert.equal(actual.trace.at(-1).shielding, true);
    } else {
      actual.trace.forEach((state, elapsed) => {
        assert.equal(state.dodge.active !== null, elapsed < spec.total, `${spec.id}: commitment ${elapsed}`);
        assert.equal(state.invincible, elapsed >= spec.start && elapsed <= spec.end, `${spec.id}: iframe ${elapsed}`);
        if (spec.kind === 'ground') {
          const forward = spec.x !== 0 && Math.sign(spec.x) === spec.facing;
          assert.equal(state.facing, forward && elapsed >= 19 ? -spec.facing : spec.facing, `${spec.id}: facing ${elapsed}`);
          assert.equal(state.grounded, true);
        }
      });
    }
  }

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const scene = game.scene.getScene('CharacterEditorScene');
      scene.savedSlotId = null; scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
      scene.section = 'movement'; scene.fieldPage = 0; scene.refreshAll();
      const fields = scene.getFields().filter(field => field.id.startsWith('movement.dodge.'));
      let fits = true;
      do {
        fits &&= scene.getPageFields().every((_field, row) => scene.fieldLabels[row].getBounds().right <= scene.fieldValues[row].getBounds().left);
        scene.changePage(1);
      } while (scene.fieldPage !== 0);
      const index = scene.getFields().findIndex(field => field.id === 'movement.dodge.directionalAirUpRecoveryFrames');
      scene.fieldPage = Math.floor(index / 12); scene.refreshAll(); scene.stepFieldAt(index % 12, 1, 1);
      const edited = scene.editState.getSpec().movement.dodge.directionalAirUpRecoveryFrames;
      scene.handleSave(false); const slot = scene.savedSlotId;
      scene.editState.setMovementNumericField(['dodge', 'directionalAirUpRecoveryFrames'], 12);
      window.confirm = () => true; scene.loadSaved(slot);
      return { fields, fits, edited, saved: scene.editState.getSpec().movement.dodge, slot };
    });
    assert.ok(result.fits, `Lab labels fit at ${viewport.width}`);
    assert.equal(result.edited, 88); assert.equal(result.saved.directionalAirUpRecoveryFrames, 88);
    for (const [id, value] of [['air.iframeStartFrame', 2], ['air.recoveryFrames', 19],
      ['directionalAir.recoveryFrames', 61], ['backwardRoll.recoveryFrames', 19], ['roll.reverseFacingFrame', 19]])
      assert.equal(result.fields.find(field => field.id === `movement.dodge.${id}`)?.value, value);
    report.lab.push({ viewport, ...result });
    await page.screenshot({ path: `${output}/lab-${viewport.width}.png`, fullPage: true });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.length,
    tracedSteps: report.scenarios.reduce((n, row) => n + row.trace.length, 0),
    maxTimeError: Math.max(...report.scenarios.map(row => row.clocks.maxTimeError)),
    maxWitnessError: Math.max(...report.scenarios.map(row => row.clocks.maxWitnessError)),
    labViewports: report.lab.map(row => row.viewport), errors: report.errors }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
