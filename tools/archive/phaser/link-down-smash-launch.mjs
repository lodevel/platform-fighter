import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_DOWN_SMASH_OUTPUT ?? 'docs/review/2026-09-21/down-smash-launches/production';
const physicsPath = process.env.PF_DOWN_SMASH_PHYSICS_REPORT ?? 'docs/review/2026-09-21/down-smash-launches/physics.json';
const physics = JSON.parse(await readFile(physicsPath, 'utf8'));
assert.equal(physics.schemaVersion, 1);
assert.equal(physics.measurements.length, 17);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], physicsPath, scenarios: [], resolverSmoke: [], lab: [], notes: [
  'Production MatchScene and actual front/back down-smash collision delivery.',
  'Resolved attackHeavy is injected at the normal Character.applyInput boundary; device bindings are outside this probe.',
  'Charge holds of 0, 30 and 60 use actual charge state, including automatic maximum-charge release.',
  'Back-strike measurements intentionally whiff the front strike and stage a fresh target before the rear window.',
  'Targets are staged immediately before contact; original platforms and KO watchers are disabled for isolated launch measurements.',
  'Each displayed frame is compared with the independently asserted real-Matter fixture through three free steps.',
  'A collision-free ordinary Matter body checks world gravity and clocks alongside accelerated fighter movement.',
  'Grounded recipients settle on a real floor; that floor is removed after contact to isolate subsequent flight.',
  'A front sensor overlap across the attacker root checks position-based launch direction independently from sprite facing.',
  'Separate resolver-level attack-plus-down-flick smoke cases use no Character.applyInput override and check a 30-frame charge for each strike.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_DOWN_SMASH_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_DOWN_SMASH_EXPECT_ARTIFACT)), 'Expected rebuilt down-smash artifact');

  for (const fixture of physics.measurements) {
    const actual = await page.evaluate(({ spec, releaseInput, setup }) => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 921,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: spec.target, paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      const a = s.p1, d = s.p2, origin = setup.worldOrigin;
      for (const index of [0, 1]) {
        s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
      }
      s.inputResolver.getMoveVector = index => index === 2 && d.getHitlagRemaining() === 1
        ? { x: releaseInput.moveX, y: releaseInput.moveY ?? 0 } : { x: 0, y: 0 };
      s.inputResolver.isActionHeld = () => false;
      let heavyHeld = false;
      const originalAttackerInput = a.applyInput.bind(a);
      a.applyInput = input => originalAttackerInput({ ...input, attackHeavy: heavyHeld, moveY: heavyHeld ? 1 : 0 });
      const relative = p => ({ x: p.x - origin.x, y: p.y - origin.y });
      const snapshot = () => ({ position: relative(d.getPosition()), velocity: { ...d.getVelocity() },
        hitlag: d.getHitlagRemaining(), hitstun: d.getHitstunRemaining(), grounded: d.isGrounded(),
        tumbling: d.isTumbling(), canUseItemsBeforeInput: d.canUseItemsBeforeInput() });
      const hits = [], trace = [], clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0,
        witnessSteps: 0, maxWitnessPositionError: 0, maxWitnessVelocityError: 0, attackerAnimationChecks: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let frame = 0, afterInput = null, witness = null;
      const witnessOrigin = { x: origin.x - 300, y: origin.y - 200 };
      const witnessVelocity = { x: 1.25, y: -1 };
      const originalInput = d.applyInput.bind(d);
      d.applyInput = input => { originalInput(input); afterInput = snapshot(); };
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const attackerGrounded = a.isGrounded(), targetGrounded = d.isGrounded();
        const attackerPosition = relative(a.getPosition()), targetPosition = relative(d.getPosition());
        const active = a.getActiveAttack();
        const result = originalHit(info);
        if (result.outcome === 'landed') hits.push({ frame: frame + 1, attackFrame: active?.framesElapsed,
          moveId: active?.move.id, damage: result.damageApplied, launchFacing: info.facing,
          launch: result.knockback, hitlag: d.getHitlagRemaining(), attackerGrounded, targetGrounded,
          attackerPosition, targetPosition, chargeHeldFrames: active?.chargeHeldFrames ?? null,
          sweetSpot: info.sweetSpot === true });
        return result;
      };
      const step = (heavy = false) => {
        heavyHeld = heavy;
        const beforeInput = snapshot(), engineFrame = s.physicsEngine.getFrame();
        const attackBefore = a.getActiveAttack(), attackFrameBefore = attackBefore?.framesElapsed;
        const before = { time: s.matter.world.engine.timing.timestamp, input: clocks.inputSamples,
          rules: clocks.ruleUpdates, gravity: { ...s.matter.world.engine.gravity } };
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); frame++;
        if (s.physicsEngine.getFrame() !== engineFrame + 1 || clocks.inputSamples !== before.input + 1
          || clocks.ruleUpdates !== before.rules + 1) throw new Error('Outer game clocks must advance once');
        const timeError = Math.abs(s.matter.world.engine.timing.timestamp - before.time - s.physicsEngine.fixedTimestepMs);
        clocks.maxTimeError = Math.max(clocks.maxTimeError, timeError);
        if (timeError > 1e-8) throw new Error('World time changed during reference transport');
        if (['x', 'y', 'scale'].some(key => s.matter.world.engine.gravity[key] !== before.gravity[key]))
          throw new Error('World gravity not restored');
        clocks.steps++;
        const attackAfter = a.getActiveAttack();
        if (attackBefore && attackAfter?.move.id === attackBefore.move.id) {
          const advanced = attackAfter.framesElapsed - attackFrameBefore;
          if (advanced < 0 || advanced > 1) throw new Error('Unrelated attack animation advanced more than once');
          clocks.attackerAnimationChecks++;
        }
        if (witness) {
          const n = ++clocks.witnessSteps;
          const gravityDelta = before.gravity.y * before.gravity.scale * s.physicsEngine.fixedTimestepMs ** 2;
          const expectedPosition = { x: witnessOrigin.x + n * witnessVelocity.x,
            y: witnessOrigin.y + n * witnessVelocity.y + gravityDelta * n * (n + 1) / 2 };
          const expectedVelocity = { x: witnessVelocity.x, y: witnessVelocity.y + gravityDelta * n };
          for (const axis of ['x', 'y']) {
            clocks.maxWitnessPositionError = Math.max(clocks.maxWitnessPositionError,
              Math.abs(witness.position[axis] - expectedPosition[axis]));
            clocks.maxWitnessVelocityError = Math.max(clocks.maxWitnessVelocityError,
              Math.abs(witness.velocity[axis] - expectedVelocity[axis]));
          }
          if (clocks.maxWitnessPositionError > 1e-6 || clocks.maxWitnessVelocityError > 1e-6)
            throw new Error('Unrelated body departed from its ordinary gravity arc');
        }
        const row = { sinceContact: hits.length ? frame - hits[0].frame : null,
          beforeInput, afterInput, afterConstraints: snapshot() };
        if (hits.length) trace.push(row);
        return row;
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      const customPad = s.matter.add.rectangle(origin.x + setup.pad.center.x, origin.y + setup.pad.center.y,
        setup.pad.width, setup.pad.height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0);
      const strikeSign = spec.strike === 'back' ? -1 : 1;
      if (spec.groundedVictim) d.resetForRound(origin.x + strikeSign * spec.facing * 130,
        origin.y + 36 - d.getTuning().height / 2);
      else d.resetForRound(origin.x + 5000, origin.y);
      for (let i = 0; i < 20; i++) step();
      if (!a.isGrounded() || (spec.groundedVictim && !d.isGrounded()))
        throw new Error('Grounded setup must settle on the support pad');
      a.setFacing(spec.facing);
      step(true);
      const charging = a.getAnimationActionState();
      if (charging.chargeHeldFrames !== 0 || charging.chargingMove?.id !== 'link.dsmash')
        throw new Error('Initial heavy plus down input must start down-smash charge');
      const heldInputSteps = spec.held === 0 ? 0 : 3 + spec.held;
      for (let i = 0; i < heldInputSteps; i++) step(true);
      if (spec.held !== 60) step();
      if (a.getActiveAttack()?.move.id !== 'link.dsmash' || a.getActiveAttack()?.chargeHeldFrames !== spec.held)
        throw new Error('Charge release count differs from requested hold');
      const chargeRelease = { heldInputSteps, autoReleased: spec.held === 60,
        attackFrame: a.getActiveAttack().framesElapsed };
      const move = a.getAttack('link.dsmash');
      const contactFrame = spec.strike === 'front' ? 11 : 23;
      while (a.getActiveAttack().framesElapsed < contactFrame - 1) step();
      if (hits.length) throw new Error('Selected strike must be isolated from previous contacts');
      const anchor = a.getPosition();
      const offset = spec.crossRoot
        ? { x: -spec.facing * strikeSign * 8, y: 7 - d.getTuning().height / 2 }
        : { x: strikeSign * spec.facing * 62, y: 14 };
      if (spec.groundedVictim)
        s.matter.body.setPosition(d.body, { x: anchor.x + offset.x, y: d.getPosition().y });
      else d.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
      d.setDamagePercent(spec.percent);
      const staged = snapshot();
      witness = s.matter.add.rectangle(witnessOrigin.x, witnessOrigin.y, 8, 8,
        { frictionAir: 0, collisionFilter: { mask: 0 }, label: 'calibration.clockWitness' });
      s.matter.body.setVelocity(witness, witnessVelocity);
      step();
      if (hits.length !== 1) throw new Error('Staged target must receive one actual smash hit');
      if (setup.removePadAfterContact) s.matter.world.remove(customPad);
      a.setPosition(anchor.x - 400, anchor.y);
      let firstActionableAt = null;
      for (let i = 0; i < 250; i++) {
        const row = step();
        if (firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput) firstActionableAt = row.sinceContact;
        if (firstActionableAt !== null && row.sinceContact >= firstActionableAt + 2) break;
      }
      return { scenario: spec, moveData: move, setup: { attackerAnchor: relative(anchor), staged, chargeRelease },
        hits, trace, clocks, summary: { releaseAt: trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact,
          stunEndAt: firstActionableAt - 1, firstActionableAt } };
    }, { spec: fixture.scenario, releaseInput: fixture.input, setup: fixture.setup });
    report.scenarios.push(actual);
    const id = fixture.scenario.id;
    assert.equal(actual.hits.length, 1, `${id}: one actual authored strike`);
    assert.deepEqual(actual.setup.chargeRelease, fixture.setup.chargeRelease, `${id}: charge release`);
    const hit = actual.hits[0], expectedHit = fixture.hits[0];
    for (const key of ['attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded', 'chargeHeldFrames', 'sweetSpot'])
      assert.equal(hit[key], expectedHit[key], `${id}: hit ${key}`);
    const records = { front: { damage: 16, base: 40, growth: 88, angle: 78 },
      back: { damage: 12, base: 80, growth: 63, angle: 30 } };
    const source = records[fixture.scenario.strike];
    const damage = source.damage * (1 + fixture.scenario.held / 150);
    const percent = fixture.scenario.percent + damage, weight = fixture.scenario.target === 'link' ? 104 : 127;
    const kb = ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
      * source.growth / 100 + source.base;
    assert.ok(Math.abs(hit.damage - damage) < 1e-10, `${id}: independent charged damage`);
    assert.ok(Math.abs(hit.launch.referenceKnockback - kb) < 1e-9, `${id}: charge changes damage terms, not BKB/KBG`);
    for (const key of ['referenceKnockback', 'ordinaryHitstunFrames', 'hitstunFrames', 'launchDecayPerFrame'])
      assert.ok(Math.abs(hit.launch[key] - expectedHit.launch[key]) < 1e-9, `${id}: launch ${key}`);
    assert.deepEqual(actual.summary, fixture.summary, `${id}: release and recovery timing`);
    assert.equal(actual.trace.length, fixture.trace.length, `${id}: matching frame count`);
    let maxPositionError = 0, maxVelocityError = 0;
    for (const [index, row] of actual.trace.entries()) {
      const expected = fixture.trace[index];
      assert.equal(row.sinceContact, expected.sinceContact);
      for (const stateKey of ['beforeInput', 'afterInput', 'afterConstraints']) {
        const state = row[stateKey], reference = expected[stateKey];
        for (const key of ['hitlag', 'hitstun', 'grounded', 'tumbling', 'canUseItemsBeforeInput'])
          assert.equal(state[key], reference[key], `${id}: frame ${row.sinceContact} ${stateKey}.${key}`);
        for (const axis of ['x', 'y']) {
          maxPositionError = Math.max(maxPositionError, Math.abs(state.position[axis] - reference.position[axis]));
          maxVelocityError = Math.max(maxVelocityError, Math.abs(state.velocity[axis] - reference.velocity[axis]));
        }
      }
    }
    assert.ok(maxPositionError < 1e-6 && maxVelocityError < 1e-6,
      `${id}: production/fixture divergence (${maxPositionError}, ${maxVelocityError})`);
    Object.assign(actual, { maxPositionError, maxVelocityError });
    assert.equal(actual.clocks.inputSamples, actual.clocks.steps);
    assert.equal(actual.clocks.ruleUpdates, actual.clocks.steps);
    assert.ok(actual.clocks.witnessSteps > 0 && actual.clocks.attackerAnimationChecks > 0);
  }

  for (const strike of ['front', 'back']) {
    const smoke = await page.evaluate(strike => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 921,
      itemFrequency: 'off', players: [
        { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
      ] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    const a = s.p1, d = s.p2;
    for (const index of [0, 1]) {
      s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
    }
    let moveY = 0, attack = false;
    s.inputResolver.getMoveVector = index => ({ x: 0, y: index === 1 ? moveY : 0 });
    s.inputResolver.isActionHeld = (index, action) => index === 1 && action === 'attack' && attack;
    const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
    for (const [owner, method, counter] of [
      [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
    ]) {
      const original = owner[method].bind(owner);
      owner[method] = (...args) => { clocks[counter]++; return original(...args); };
    }
    const step = (held = false, vertical = 0) => {
      attack = held; moveY = vertical;
      const frame = s.physicsEngine.getFrame(), timestamp = s.matter.world.engine.timing.timestamp;
      const inputs = clocks.inputSamples, rules = clocks.ruleUpdates;
      s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      clocks.steps++;
      clocks.maxTimeError = Math.max(clocks.maxTimeError,
        Math.abs(s.matter.world.engine.timing.timestamp - timestamp - s.physicsEngine.fixedTimestepMs));
      if (s.physicsEngine.getFrame() !== frame + 1 || clocks.inputSamples !== inputs + 1 || clocks.ruleUpdates !== rules + 1)
        throw new Error('Resolver smoke advanced outer clocks incorrectly');
    };
    for (let i = 0; i < 100; i++) step();
    const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
    for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
    s.matter.add.rectangle(720, 166, 40, 20,
      { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
    a.resetForRound(720, 120); a.setDamagePercent(0); d.resetForRound(5720, 120);
    for (let i = 0; i < 20; i++) step();
    if (!a.isGrounded()) throw new Error('Resolver smoke requires grounded attacker');
    const hits = [];
    const originalHit = d.applyHitDetailed.bind(d);
    d.applyHitDetailed = info => {
      const active = a.getActiveAttack();
      const result = originalHit(info);
      if (result.outcome === 'landed') hits.push({ moveId: active.move.id, attackFrame: active.framesElapsed,
        chargeHeldFrames: active.chargeHeldFrames, damage: result.damageApplied, sweetSpot: info.sweetSpot === true,
        referenceKnockback: result.knockback.referenceKnockback, launchFacing: info.facing });
      return result;
    };
    step(true, 1);
    if (a.getAnimationActionState().chargingMove?.id !== 'link.dsmash')
      throw new Error('Attack plus fresh down flick must begin down-smash charging');
    for (let i = 0; i < 33; i++) step(true);
    const heldFramesBeforeRelease = a.getAnimationActionState().chargeHeldFrames;
    step();
    if (heldFramesBeforeRelease !== 30 || a.getActiveAttack()?.chargeHeldFrames !== 30)
      throw new Error('Resolver attack hold must release exactly 30 charge frames');
    const frame = strike === 'front' ? 11 : 23, side = strike === 'front' ? 1 : -1;
    while (a.getActiveAttack().framesElapsed < frame - 1) step();
    const anchor = a.getPosition();
    if (hits.length) throw new Error('Resolver smoke must isolate the selected strike');
    d.resetForRound(anchor.x + side * 62, anchor.y + 14);
    d.setDamagePercent(100); step();
    return { strike, heldFramesBeforeRelease, hits, clocks,
      limitation: 'Resolver action/vector responses are controlled; physical keyboard/gamepad events and same-target two-hit connectivity are not measured.' };
    }, strike);
    report.resolverSmoke.push(smoke);
    assert.equal(smoke.heldFramesBeforeRelease, 30);
    assert.equal(smoke.hits.length, 1);
    const source = strike === 'front' ? { frame: 11, damage: 16, base: 40, growth: 88 }
      : { frame: 23, damage: 12, base: 80, growth: 63 };
    const hit = smoke.hits[0], damage = source.damage * 1.2;
    const percent = 100 + damage;
    const kb = ((percent / 10 + percent * damage / 20) * 1.4 * 200 / 204 + 18) * source.growth / 100 + source.base;
    assert.equal(hit.moveId, 'link.dsmash'); assert.equal(hit.attackFrame, source.frame);
    assert.equal(hit.chargeHeldFrames, 30); assert.equal(hit.sweetSpot, false);
    assert.equal(hit.launchFacing, strike === 'front' ? 1 : -1);
    assert.ok(Math.abs(hit.damage - damage) < 1e-10);
    assert.ok(Math.abs(hit.referenceKnockback - kb) < 1e-9);
    assert.equal(smoke.clocks.inputSamples, smoke.clocks.steps);
    assert.equal(smoke.clocks.ruleUpdates, smoke.clocks.steps);
    assert.ok(smoke.clocks.maxTimeError < 1e-8);
  }

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const fields = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const scene = game.scene.getScene('CharacterEditorScene'); scene.savedSlotId = null;
      scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
      return ['downSmash'].map(key => {
        scene.section = 'move'; scene.moveIndex = scene.getMoveKeys().indexOf(key);
        if (scene.moveIndex < 0) throw new Error(`Missing Lab move ${key}`);
        scene.fieldPage = 0; scene.refreshAll();
        const fields = scene.getFields().map(field => ({ id: field.id, value: field.value }));
        let fits = true;
        do {
          fits &&= scene.getPageFields().every((_field, row) =>
            scene.fieldLabels[row].getBounds().right <= scene.fieldValues[row].getBounds().left);
          scene.changePage(1);
        } while (scene.fieldPage !== 0);
        return { key, fields, fits, move: scene.editState.getSpec().moves[key] };
      });
    });
    for (const row of fields) {
      const reference = { base: 40, growth: 88, angle: 78 };
      assert.deepEqual(row.move.knockback.reference, reference);
      assert.equal(row.move.charge.knockbackMode, 'damage-only');
      assert.equal(row.move.launchAwayFromSource, true);
      assert.ok(row.fits, `${row.key}: Lab fields fit at ${viewport.width}px`);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `knockback.reference.${key}`)?.value, reference[key]);
      assert.ok(!row.fields.some(field => /^charge\.(min|max)Knockback\./.test(field.id)));
      assert.ok(!row.fields.some(field => ['knockback.x', 'knockback.y', 'knockback.scaling'].includes(field.id)));
      assert.equal(row.fields.find(field => field.id === 'charge.minDamage')?.value, 16);
      assert.equal(row.fields.find(field => field.id === 'charge.maxDamage')?.value, 22.4);
      const back = { base: 80, growth: 63, angle: 30 };
      assert.deepEqual(row.move.hitWindows[1].knockback.reference, back);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `hitWindows.1.knockback.reference.${key}`)?.value, back[key]);
      assert.ok(!row.fields.some(field => ['x', 'y', 'scaling'].some(key => field.id === `hitWindows.1.knockback.${key}`)));
      assert.equal(row.move.hitWindows[0].damage, 16);
      assert.equal(row.move.hitWindows[1].damage, 12);
      assert.equal(row.move.hitWindows[1].facing, -1);
      assert.notEqual(row.move.hitWindows[0].group, row.move.hitWindows[1].group);
    }
    report.lab.push({ viewport, moves: fields });
    await page.screenshot({ path: `${output}/lab-${viewport.width}.png` });
    await page.evaluate(() => {
      const scene = window.__game.scene.getScene('CharacterEditorScene');
      for (let attempts = 0; attempts < 30; attempts++) {
        if (scene.getPageFields().some(field => field.id === 'hitWindows.1.knockback.reference.base')) return;
        scene.changePage(1);
      }
      throw new Error('Rear-sweep launch controls must be reachable through Lab pages');
    });
    await page.screenshot({ path: `${output}/lab-back-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.scenario.id,
    damage: row.hits[0].damage, chargeHeldFrames: row.hits[0].chargeHeldFrames, sweetSpot: row.hits[0].sweetSpot,
    frames: row.trace.length, maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })),
    resolverSmoke: report.resolverSmoke, labViewports: report.lab.map(row => row.viewport),
    errors: report.errors, loadErrors: report.loadErrors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/down-smash-launches.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
