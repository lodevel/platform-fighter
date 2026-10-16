import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_DOWN_AIR_OUTPUT ?? 'docs/review/2026-09-21/down-air-launches/production';
const physicsPath = process.env.PF_DOWN_AIR_PHYSICS_REPORT ?? 'docs/review/2026-09-21/down-air-launches/physics.json';
const physics = JSON.parse(await readFile(physicsPath, 'utf8'));
assert.equal(physics.schemaVersion, 1);
assert.equal(physics.measurements.length, 17, 'Expected seventeen coordinated early, grounded, late and returning down-air fixtures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], physicsPath, scenarios: [], lab: [], notes: [
  'Production MatchScene, actual Link early, grounded, late and returning down-air hitboxes and collision delivery.',
  'Each case reproduces the exported real-Matter fixture geometry and compares every displayed frame through three free steps.',
  'Original platforms and KO registrations are disabled for isolated launch measurement; this probe does not measure KO thresholds.',
  'Targets are staged immediately before the selected active step; grounded targets first settle on a real solid floor.',
  'A supporting test floor is removed after the final contact so subsequent flight remains an isolated launch measurement.',
  'Return cases keep the initial attack alive after an actual rebound and reset the same victim for an isolated second launch.',
  'A collision-free ordinary Matter body checks world gravity independently from each accelerated fighter trajectory.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_DOWN_AIR_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_DOWN_AIR_EXPECT_ARTIFACT)), 'Expected rebuilt down-air artifact');

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
      const attackInstances = new Set(), hitGroups = [];
      const originalInput = d.applyInput.bind(d);
      d.applyInput = input => { originalInput(input); afterInput = snapshot(); };
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const attackerGrounded = a.isGrounded(), targetGrounded = d.isGrounded();
        const attackerPosition = relative(a.getPosition()), targetPosition = relative(d.getPosition());
        const attack = a.getActiveAttack();
        const group = attack?.hitboxBody?.plugin.hitGroup;
        const instance = attack?.hitboxBody?.plugin.attackInstance;
        const result = originalHit(info);
        if (result.outcome === 'landed') { attackInstances.add(instance); hitGroups.push(group); }
        if (result.outcome === 'landed') hits.push({ frame: frame + 1, attackFrame: a.getActiveAttack()?.framesElapsed,
          moveId: a.getActiveAttack()?.move.id, damage: result.damageApplied, launchFacing: info.facing,
          launch: result.knockback, hitlag: d.getHitlagRemaining(), attackerGrounded, targetGrounded,
          attackerPosition, targetPosition });
        return result;
      };
      const originalRebound = a.applyAerialRebound.bind(a);
      a.applyAerialRebound = (...args) => {
        const rebound = originalRebound(...args);
        if (hits.length) hits.at(-1).rebound = rebound;
        return rebound;
      };
      const step = (record = false) => {
        const beforeInput = snapshot(), engineFrame = s.physicsEngine.getFrame();
        const attackBefore = a.getActiveAttack();
        const attackFrameBefore = attackBefore?.framesElapsed;
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
        if (record && hits.length) trace.push(row);
        return row;
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      const customPad = setup.pad ? s.matter.add.rectangle(origin.x + setup.pad.center.x, origin.y + setup.pad.center.y,
        setup.pad.width, setup.pad.height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } }) : null;
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0);
      d.resetForRound(origin.x + 5000, origin.y);
      const side = spec.side === 'front' ? 1 : -1;
      const offset = { x: side * spec.facing * 8, y: 36 + d.getTuning().height / 2 + 4 };
      if (setup.pad) {
        a.resetForRound(origin.x - 1000, origin.y);
        d.resetForRound(origin.x + offset.x, origin.y + offset.y);
        for (let i = 0; i < 20; i++) step();
        if (!d.isGrounded()) throw new Error('Grounded source record requires a supported target');
        // Keep startup away from the supported victim; MatchScene also
        // separates overlapping fighters before the move becomes active.
        a.resetForRound(origin.x - 1000, origin.y);
      }
      frame = 0; hits.length = 0; trace.length = 0;
      a.setFacing(spec.facing);
      if (!a.attemptAttack(`link.${spec.move}`)) throw new Error(`Cannot start ${spec.move}`);
      const move = a.getAttack(`link.${spec.move}`);
      const contactFrame = spec.phase === 'late' ? 19 : 13;
      while (a.getActiveAttack().framesElapsed < contactFrame - 1) step();
      witness = s.matter.add.rectangle(witnessOrigin.x, witnessOrigin.y, 8, 8,
        { frictionAir: 0, collisionFilter: { mask: 0 }, label: 'calibration.clockWitness' });
      s.matter.body.setVelocity(witness, witnessVelocity);
      let prelude = null;
      if (spec.phase === 'return') {
        if (setup.pad) s.matter.body.setPosition(a.body, { x: origin.x, y: d.getPosition().y - offset.y });
        const firstAnchor = a.getPosition();
        if (!setup.pad) d.resetForRound(firstAnchor.x + offset.x, firstAnchor.y + offset.y);
        d.setDamagePercent(0);
        const preludeStaged = snapshot();
        s.matter.body.setVelocity(a.body, { x: 0, y: 0 });
        step();
        if (hits.length !== 1 || hits[0].attackFrame !== 13 || !hits[0].rebound)
          throw new Error('Return setup requires an actual early hit and rebound');
        const initial = hits[0], frozenFrames = a.getHitlagRemaining();
        if (a.getActiveAttack().hitboxBody) throw new Error('Initial rebound must remove the entire hitbox');
        d.resetForRound(origin.x + (setup.pad ? 130 : 5000), origin.y + (setup.pad ? offset.y : 0));
        let releaseVelocity = null;
        for (let i = 0; i < 100 && a.getActiveAttack()?.framesElapsed < 42; i++) {
          const frozen = a.getHitlagRemaining();
          step();
          const active = a.getActiveAttack();
          if (frozen > 0 && active?.framesElapsed !== 13) throw new Error('Outgoing hitlag advanced attack time');
          if (frozen === 1) releaseVelocity = { ...a.getVelocity() };
          if (active?.hitboxBody || hits.length !== 1) throw new Error('Returning hitbox appeared before its 30-frame gap');
        }
        if (a.getActiveAttack()?.framesElapsed !== 42 || !(releaseVelocity?.y < -6) || attackInstances.size !== 1)
          throw new Error('Return prelude lost the original attack or rebound velocity');
        prelude = { hit: initial, staged: preludeStaged, attackerAnchor: relative(firstAnchor),
          frozenFrames, releaseVelocity, absentThroughAttackFrame: 42 };
        hits.length = 0; trace.length = 0;
      }
      if (setup.pad) s.matter.body.setPosition(a.body, { x: origin.x, y: d.getPosition().y - offset.y });
      const at = a.getPosition();
      // Fixture geometry is a shared test manifest, independent from the
      // production move data and runtime launch calculation being measured.
      if (!setup.pad) d.resetForRound(at.x + offset.x, at.y + offset.y);
      else s.matter.body.setPosition(d.body, { x: at.x + offset.x, y: d.getPosition().y });
      s.matter.body.setVelocity(a.body, { x: 0, y: 0 });
      d.setDamagePercent(spec.percent);
      const staged = snapshot();
      let stunEndAt = null;
      for (let i = 0; i < 250; i++) {
        const row = step(true);
        if (i === 0 && hits.length) {
          if (customPad && setup.removePadAfterContact) s.matter.world.remove(customPad);
          a.setPosition(at.x - 400, at.y);
        }
        if (hits.length && row.afterConstraints.hitlag === 0 && row.afterConstraints.hitstun === 0 && stunEndAt === null)
          stunEndAt = row.sinceContact;
        if (stunEndAt !== null && row.sinceContact >= stunEndAt + 3) break;
      }
      if (prelude && (attackInstances.size !== 1 || hitGroups.length !== 2 || hitGroups[0] === hitGroups[1]
        || hits[0]?.attackFrame !== 43)) throw new Error('Returning hit requires a fresh group in the same attack');
      return { scenario: spec, moveData: move, staged, attackerAnchor: relative(at), prelude, hits, trace, clocks,
        summary: { releaseAt: trace.find(row => row.sinceContact > 0 && row.afterConstraints.hitlag === 0)?.sinceContact ?? null,
          stunEndAt, firstActionableAt: trace.find(row => row.sinceContact > 0 && row.beforeInput.canUseItemsBeforeInput)?.sinceContact ?? null } };
    }, { spec: fixture.scenario, releaseInput: fixture.input, setup: fixture.setup });
    report.scenarios.push(actual);
    const id = fixture.scenario.id;
    assert.equal(actual.hits.length, 1, `${id}: one actual authored strike`);
    const hit = actual.hits[0], expectedHit = fixture.hits[0];
    for (const key of ['attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded', 'rebound'])
      assert.equal(hit[key], expectedHit[key], `${id}: hit ${key}`);
    for (const key of ['referenceKnockback', 'ordinaryHitstunFrames', 'hitstunFrames', 'launchDecayPerFrame'])
      assert.ok(Math.abs(hit.launch[key] - expectedHit.launch[key]) < 1e-9, `${id}: launch ${key}`);
    assert.deepEqual(actual.summary, fixture.summary, `${id}: release and recovery timing`);
    if (fixture.prelude) {
      assert.equal(actual.prelude.frozenFrames, fixture.prelude.frozenFrames);
      assert.equal(actual.prelude.absentThroughAttackFrame, fixture.prelude.absentThroughAttackFrame);
      for (const key of ['attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded', 'rebound'])
        assert.equal(actual.prelude.hit[key], fixture.prelude.hit[key], `${id}: initial rebound hit ${key}`);
      for (const key of ['referenceKnockback', 'ordinaryHitstunFrames', 'hitstunFrames', 'launchDecayPerFrame'])
        assert.ok(Math.abs(actual.prelude.hit.launch[key] - fixture.prelude.hit.launch[key]) < 1e-9,
          `${id}: initial rebound launch ${key}`);
      for (const axis of ['x', 'y']) assert.ok(Math.abs(actual.prelude.releaseVelocity[axis]
        - fixture.prelude.releaseVelocity[axis]) < 1e-6, `${id}: rebound release ${axis}`);
    } else assert.equal(actual.prelude, null);
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

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const fields = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const scene = game.scene.getScene('CharacterEditorScene');
      scene.savedSlotId = null;
      scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
      return ['dair'].map(key => {
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
      const move = row.key;
      const authored = report.scenarios.find(scenario => scenario.scenario.move === move).moveData;
      const reference = { base: 30, growth: 80, angle: 270 };
      assert.deepEqual(authored.knockback.reference, reference, `${move}: selected source launch`);
      assert.ok(row.fits, `${move}: Lab labels fit at ${viewport.width}px`);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `knockback.reference.${key}`)?.value,
          reference[key], `${move}: editable reference ${key}`);
      assert.ok(!row.fields.some(field => ['knockback.x', 'knockback.y', 'knockback.scaling'].includes(field.id)));
      assert.equal(row.move.launchAwayFromSource, true);
      for (const [path, record, expected] of [
        ['hitWindows.0.groundedKnockback', authored.hitWindows[0].groundedKnockback, { base: 30, growth: 78, angle: 60 }],
        ['hitWindows.1.knockback', authored.hitWindows[1].knockback, { base: 30, growth: 80, angle: 60 }],
        ['rebound.returnHit.knockback', authored.rebound.returnHit.knockback, { base: 50, growth: 80, angle: 65 }],
      ]) {
        assert.deepEqual(record.reference, expected, `dair: ${path} source record`);
        for (const key of ['base', 'growth', 'angle'])
          assert.equal(row.fields.find(field => field.id === `${path}.reference.${key}`)?.value,
            expected[key], `dair: editable ${path} ${key}`);
        assert.ok(!row.fields.some(field => ['x', 'y', 'scaling'].some(key =>
          field.id === `${path}.${key}`)));
      }
      assert.equal(row.move.hitWindows[0].group, row.move.hitWindows[1].group);
      assert.equal(row.move.hitWindows[0].damage, 18);
      assert.equal(row.move.hitWindows[1].damage, 15);
      assert.equal(row.move.rebound.returnHit.damage, 11);
      assert.equal(row.move.rebound.upwardSpeed, 6.65);
      assert.equal(row.move.rebound.rehitFrames, 30);
    }
    report.lab.push({ viewport, moves: fields });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.scenario.id,
    damage: row.hits[0].damage, launchFacing: row.hits[0].launchFacing, frames: row.trace.length,
    maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })),
    labViewports: report.lab.map(row => row.viewport), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/down-air-launches.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
