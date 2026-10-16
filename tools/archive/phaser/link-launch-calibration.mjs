import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-20/production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], scenarios: [], notes: [
  'Production MatchScene, actual authored attacks and collision delivery, neutral inputs at fixed60Hz.',
  'Static fixtures isolate launch geometry; original arena platform masks are disabled for this measurement.',
  'Target is staged once before the first active step; the wall target settles one step earlier.',
  'Attacker is moved aside after contact to isolate recovery from soft fighter separation.',
  'First actionable step uses the pre-input item/action gate; reaching hitstun0 after input is distinct.',
  'Reference launch ticks may share a displayed step; inputs, rules, world time and unrelated body gravity advance once.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  for (const scenario of [
    { id: 'tilt-link-0-air', move: 'link.tilt', target: 'link', percent: 0, geometry: 'air' },
    { id: 'tilt-link-100-air', move: 'link.tilt', target: 'link', percent: 100, geometry: 'air' },
    { id: 'tilt-link-100-wall', move: 'link.tilt', target: 'link', percent: 100, geometry: 'wall' },
    { id: 'tilt-dk-100-air', move: 'link.tilt', target: 'donkeykong', percent: 100, geometry: 'air' },
    { id: 'uair-link-100-ceiling', move: 'link.uair', target: 'link', percent: 100, geometry: 'ceiling' },
  ]) {
    report.scenarios.push(await page.evaluate(spec => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 916,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: spec.target, paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      s.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
      s.inputResolver.isActionHeld = () => false;
      const a = s.p1, d = s.p2, origin = { x: 720, y: 120 };
      const relative = p => ({ x: p.x - origin.x, y: p.y - origin.y });
      const copy = v => v ? { x: v.x, y: v.y } : null;
      let frame = 0, firstActionableStep = null, hitstunEndedAt = null;
      const hits = [], trace = [];
      const clocks = { checkedSteps: 0, inputSamples: 0, ruleUpdates: 0, maxWorldTimeError: 0,
        attackerAnimationChecks: 0, witnessSteps: 0, maxWitnessPositionError: 0, maxWitnessVelocityError: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let witness = null;
      const witnessOrigin = { x: origin.x - 300, y: origin.y - 200 };
      const witnessVelocity = { x: 1.25, y: -1 };
      const contacts = () => s.matter.world.engine.pairs.list.filter(pair => pair.isActive && !pair.isSensor &&
        (pair.bodyA === d.body || pair.bodyB === d.body)).map(pair => {
          const direction = pair.bodyA === d.body ? 1 : -1;
          const other = pair.bodyA === d.body ? pair.bodyB : pair.bodyA;
          return { label: other.label, normal: { x: direction * pair.collision.normal.x,
            y: direction * pair.collision.normal.y } };
        });
      const read = () => ({ position: relative(d.getPosition()), velocity: d.getVelocity(),
        hitlag: d.getHitlagRemaining(), hitstun: d.getHitstunRemaining(), grounded: d.isGrounded(),
        damage: d.getDamagePercent(), launch: copy(d.launchVelocity),
        pendingLaunch: copy(d.pendingKnockback?.vector), canAct: d.canUseItemsBeforeInput(),
        knockedDown: d.isKnockedDown(), normals: contacts() });
      const applyHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = hit => {
        const before = read();
        const result = applyHit(hit);
        if (result.outcome === 'landed') hits.push({ step: frame + 1, attackFrame: a.getActiveAttack()?.framesElapsed,
          before, hit, result, attackerPosition: relative(a.getPosition()) });
        return result;
      };
      const step = (record = false) => {
        const before = read(), engineFrame = s.physicsEngine.getFrame();
        const worldTime = s.matter.world.engine.timing.timestamp;
        const gravity = { ...s.matter.world.engine.gravity };
        const inputSamples = clocks.inputSamples, ruleUpdates = clocks.ruleUpdates;
        const attackBefore = a.getActiveAttack();
        const attackerBefore = attackBefore && { moveId: attackBefore.move.id, frame: attackBefore.framesElapsed };
        if (hits.length && before.hitlag === 0 && before.canAct && firstActionableStep === null)
          firstActionableStep = frame + 1;
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
        if (s.physicsEngine.getFrame() !== engineFrame + 1) throw new Error('Expected exactly one fixed step');
        if (clocks.inputSamples !== inputSamples + 1 || clocks.ruleUpdates !== ruleUpdates + 1)
          throw new Error('Input sampling and match-rule clocks must advance once per displayed step');
        const timeError = Math.abs(s.matter.world.engine.timing.timestamp - worldTime - s.physicsEngine.fixedTimestepMs);
        clocks.maxWorldTimeError = Math.max(clocks.maxWorldTimeError, timeError);
        if (timeError > 1e-8) throw new Error(`World time accelerated by reference launch: ${timeError}`);
        if (['x', 'y', 'scale'].some(key => s.matter.world.engine.gravity[key] !== gravity[key]))
          throw new Error('Physics coordination did not restore world gravity');
        const attackAfter = a.getActiveAttack();
        if (attackerBefore && attackAfter && attackerBefore.moveId === attackAfter.move.id) {
          const advanced = attackAfter.framesElapsed - attackerBefore.frame;
          if (advanced < 0 || advanced > 1) throw new Error('Unrelated attack animation advanced more than once');
          clocks.attackerAnimationChecks++;
        }
        clocks.checkedSteps++;
        if (witness) {
          const n = ++clocks.witnessSteps;
          const gravityDelta = gravity.y * gravity.scale * s.physicsEngine.fixedTimestepMs ** 2;
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
            throw new Error('Unrelated free body departed from its ordinary world-gravity arc');
        }
        frame++;
        const sample = { step: frame, before, ...read() };
        if (hits.length && before.hitstun > 0 && sample.hitstun === 0 && hitstunEndedAt === null)
          hitstunEndedAt = frame;
        if (record) trace.push(sample);
        return sample;
      };
      for (let i = 0; i < 100; i++) step();
      const platformCategory = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      const obstacle = (x, y, width, height, label) => s.matter.add.rectangle(origin.x + x, origin.y + y, width, height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category: platformCategory }, plugin: { calibrationLabel: label } });
      if (spec.geometry !== 'ceiling') {
        obstacle(spec.geometry === 'wall' ? 0 : -487.5, 46, spec.geometry === 'wall' ? 2000 : 1025, 20, 'floor');
        if (spec.geometry === 'wall') obstacle(115, -1000, 20, 4000, 'wall');
      }
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0); a.setFacing(1);
      d.resetForRound(origin.x + 400, origin.y - 200); d.setDamagePercent(spec.percent);
      if (spec.geometry !== 'ceiling') for (let i = 0; i < 25; i++) step();
      frame = 0; hits.length = 0; firstActionableStep = null;
      if (!a.attemptAttack(spec.move)) throw new Error(`Cannot start ${spec.move}`);
      const move = a.getAttack(spec.move);
      const stagingFrame = move.startupFrames - (spec.geometry === 'wall' ? 2 : 1);
      while (a.getActiveAttack().framesElapsed < stagingFrame) step();
      const at = a.getPosition();
      if (spec.geometry === 'ceiling') {
        d.resetForRound(at.x, at.y - 66);
        obstacle(at.x - origin.x, at.y - origin.y - 132, 400, 20, 'ceiling');
      } else d.resetForRound(at.x + 62, spec.geometry === 'wall'
        ? origin.y + 36 - d.getTuning().height / 2 : at.y - 3);
      d.setDamagePercent(spec.percent);
      const staged = read();
      witness = s.matter.add.rectangle(witnessOrigin.x, witnessOrigin.y, 8, 8,
        { frictionAir: 0, collisionFilter: { mask: 0 }, label: 'calibration.clockWitness' });
      s.matter.body.setVelocity(witness, witnessVelocity);
      if (spec.geometry === 'wall') {
        step();
        if (!d.isGrounded()) throw new Error('Wall target must be supported before contact');
      }
      for (let i = 0; i < 180; i++) {
        step(true);
        if (i === 0 && hits.length) a.setPosition(at.x - 400, at.y);
        if (hitstunEndedAt !== null && frame >= hitstunEndedAt + 5) break;
      }
      const release = trace.find(sample => hits.length && sample.step > hits[0].step && sample.hitlag === 0);
      const firstFree = trace.find(sample => sample.step === firstActionableStep);
      const stunEnd = trace.find(sample => sample.before.hitstun > 0 && sample.hitstun === 0);
      const impact = hits[0]?.before.position;
      return { ...spec, moveData: move, tuning: d.getTuning(), gravity: s.matter.world.engine.gravity,
        dynamics: { positionIterations: s.matter.world.engine.positionIterations,
          velocityIterations: s.matter.world.engine.velocityIterations, friction: d.body.friction,
          frictionStatic: d.body.frictionStatic, frictionAir: d.body.frictionAir, inertia: d.body.inertia },
        staged, hits, trace, clocks, summary: { firstActionableStep, contactStep: hits[0]?.step,
          releaseStep: release?.step, releaseVelocity: release?.velocity, stunEndStep: stunEnd?.step,
          stunEndVelocity: stunEnd?.velocity, firstFreeVelocity: firstFree?.velocity,
          displacement: impact ? { x: trace.at(-1).position.x - impact.x, y: trace.at(-1).position.y - impact.y } : null,
          apex: impact ? impact.y - Math.min(...trace.map(sample => sample.position.y)) : null,
          normals: trace.flatMap(sample => sample.normals.map(contact => ({ step: sample.step, ...contact }))) } };
    }, scenario));
  }
  for (const scenario of report.scenarios) {
    assert.equal(scenario.hits.length, 1, `${scenario.id}: one actual strike`);
    const expectedKb = scenario.move === 'link.uair' ? 164.515
      : scenario.target === 'donkeykong' ? 155.48070484581498
        : scenario.percent === 0 ? 80.7335294117647 : 165.14529411764704;
    assert.ok(Math.abs(scenario.hits[0].result.knockback.referenceKnockback - expectedKb) < 1e-9);
    assert.equal(scenario.hits[0].result.knockback.ordinaryHitstunFrames, Math.floor(expectedKb * 0.4) - 1);
    const expectedHitstun = scenario.target === 'donkeykong' ? 43 : scenario.percent === 0 ? 31 : 44;
    assert.equal(scenario.hits[0].result.knockback.hitstunFrames, expectedHitstun);
    assert.equal(scenario.tuning.referenceWeight, scenario.target === 'donkeykong' ? 127 : 104);
    assert.equal(scenario.clocks.inputSamples, scenario.clocks.checkedSteps);
    assert.equal(scenario.clocks.ruleUpdates, scenario.clocks.checkedSteps);
    assert.ok(scenario.clocks.attackerAnimationChecks > 0 && scenario.clocks.witnessSteps > 0);
    assert.ok(scenario.clocks.maxWorldTimeError < 1e-8);
    assert.ok(scenario.clocks.maxWitnessPositionError < 1e-6 && scenario.clocks.maxWitnessVelocityError < 1e-6);
    assert.ok(scenario.summary.releaseStep > scenario.summary.contactStep);
    if (scenario.summary.firstActionableStep === null) {
      assert.ok(scenario.trace.at(-1).knockedDown, 'A landed tumble can remain locked after hitstun');
    } else assert.ok(scenario.summary.firstActionableStep > scenario.summary.releaseStep);
    assert.ok(scenario.trace.every(sample => Number.isFinite(sample.velocity.x) && Number.isFinite(sample.velocity.y)));
    assert.equal(scenario.trace.at(-1).step, scenario.summary.stunEndStep + 5);
    if (scenario.geometry === 'wall') assert.ok(scenario.summary.normals.some(contact => contact.normal.x < -0.5));
    if (scenario.geometry === 'ceiling') {
      assert.ok(scenario.summary.normals.some(contact => contact.normal.y > 0.5));
      assert.notEqual(scenario.summary.firstActionableStep, null);
      const freeVelocityY = scenario.trace.filter(sample => sample.step >= scenario.summary.firstActionableStep)
        .map(sample => sample.velocity.y);
      const expectedFreeVelocityY = [8.52, 8.04, 8, 8, 8];
      assert.equal(freeVelocityY.length, expectedFreeVelocityY.length);
      for (let index = 0; index < expectedFreeVelocityY.length; index++) {
        assert.ok(Math.abs(freeVelocityY[index] - expectedFreeVelocityY[index]) < 1e-8,
          `Ceiling recovery step ${index + 1}: vertical fall cap approaches ordinary fall cap gradually`);
      }
      scenario.summary.freeVelocityY = freeVelocityY;
    }
  }
  if (process.env.PF_LAUNCH_PHYSICS_REPORT) {
    const physics = JSON.parse(await readFile(process.env.PF_LAUNCH_PHYSICS_REPORT, 'utf8'));
    report.comparison = [];
    for (const actual of report.scenarios) {
      const expected = physics.measurements.find(row =>
        row.scenario.id.replace('ftilt-', 'tilt-').replace('-donkeykong-', '-dk-') === actual.id);
      assert.ok(expected, `${actual.id}: missing independent physics fixture`);
      let maxPositionError = 0, maxVelocityError = 0;
      for (const row of actual.trace) {
        const reference = expected.trace.find(sample => sample.step === row.step)?.afterConstraints;
        assert.ok(reference, `${actual.id}: missing physics step${row.step}`);
        assert.equal(row.hitlag, reference.hitlag); assert.equal(row.hitstun, reference.hitstun);
        assert.equal(row.grounded, reference.grounded);
        for (const axis of ['x', 'y']) {
          maxPositionError = Math.max(maxPositionError, Math.abs(row.position[axis] - reference.position[axis]));
          maxVelocityError = Math.max(maxVelocityError, Math.abs(row.velocity[axis] - reference.velocity[axis]));
        }
      }
      assert.ok(maxPositionError < 1e-6 && maxVelocityError < 1e-6,
        `${actual.id}: production/fixture divergence (${maxPositionError},${maxVelocityError})`);
      report.comparison.push({ id: actual.id, frames: actual.trace.length, maxPositionError, maxVelocityError });
    }
  }
  report.lab = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const lab = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const scene = game.scene.getScene('CharacterEditorScene');
      const profiles = [];
      for (const character of ['link', 'donkeykong']) {
        const source = scene.getSources().find(source => source.id === `shipped:${character}`);
        if (!source) throw new Error(`Missing shipped Lab source: ${character}`);
        scene.loadSpec(source.spec); scene.setSection('movement');
        const fields = [];
        let fits = true;
        do {
          scene.getPageFields().forEach((field, row) => {
            const label = scene.fieldLabels[row], value = scene.fieldValues[row];
            fits &&= label.getBounds().right <= value.getBounds().left;
            if (field.id.startsWith('movement.referenceLaunch.')) {
              fields.push({ id: field.id, path: field.path, value: field.value,
                label: label.text, displayedValue: value.text, precision: field.precision });
            }
          });
          scene.changePage(1);
        } while (scene.fieldPage !== 0);
        profiles.push({ character, fields, fits });
      }
      scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
      scene.setSection('movement');
      const weight = scene.getFields().find(field => field.id === 'movement.referenceWeight')?.value;
      const moves = [];
      for (const key of ['tilt', 'uair']) {
        scene.section = 'move'; scene.moveIndex = scene.getMoveKeys().indexOf(key);
        scene.fieldPage = 0; scene.refreshAll();
        const fields = scene.getFields().map(field => ({ id: field.id, value: field.value }));
        let fits = true;
        do {
          fits &&= scene.getPageFields().every((_field, row) =>
            scene.fieldLabels[row].getBounds().right <= scene.fieldValues[row].getBounds().left);
          scene.changePage(1);
        } while (scene.fieldPage !== 0);
        moves.push({ key, fields, fits });
      }
      scene.setSection('movement');
      const fieldId = 'movement.referenceLaunch.verticalGravity';
      if (!scene.getFields().some(field => field.id === fieldId)) throw new Error(`Missing Lab field ${fieldId}`);
      while (!scene.getPageFields().some(field => field.id === fieldId)) scene.changePage(1);
      scene.focusIndex = scene.getPageFields().findIndex(field => field.id === fieldId);
      scene.refreshFields();
      return { weight, profiles, moves, editBefore: {
        value: scene.getPageFields()[scene.focusIndex].value,
        displayedValue: scene.fieldValues[scene.focusIndex].text,
      } };
    });
    assert.equal(lab.weight, 104);
    const expectedProfiles = {
      link: { gravity: 0.096, fallSpeed: 1.6, verticalGravity: 0.076944, verticalFallSpeed: 1.8 },
      donkeykong: { gravity: 0.085, fallSpeed: 1.63, verticalGravity: 0.084672, verticalFallSpeed: 1.8 },
    };
    const expectedLabels = {
      gravity: 'Launch gravity (units/frame²)', fallSpeed: 'Launch fall cap (units/frame)',
      verticalGravity: 'Vertical launch gravity (units/frame²)',
      verticalFallSpeed: 'Vertical launch fall cap (units/frame)',
    };
    for (const profile of lab.profiles) {
      assert.ok(profile.fits, `${profile.character}: Lab movement labels fit at ${viewport.width}px`);
      assert.equal(profile.fields.length, 4, `${profile.character}: all four launch energy fields are editable`);
      for (const [key, expected] of Object.entries(expectedProfiles[profile.character])) {
        const field = profile.fields.find(field => field.id === `movement.referenceLaunch.${key}`);
        assert.ok(field, `${profile.character}: missing launch energy field ${key}`);
        assert.deepEqual(field.path, ['referenceLaunch', key]);
        assert.equal(field.value, expected);
        assert.equal(field.label, expectedLabels[key]);
        assert.equal(field.precision, 6);
        assert.equal(field.displayedValue, expected.toFixed(6));
      }
    }
    for (const move of lab.moves) {
      assert.ok(move.fits, `${move.key}: Lab field labels fit`);
      assert.ok(!move.fields.some(field => field.id === 'knockback.x'));
      assert.equal(move.fields.find(field => field.id === 'knockback.reference.base')?.value,
        move.key === 'tilt' ? 55 : 23);
      assert.equal(move.fields.find(field => field.id === 'knockback.reference.angle')?.value,
        move.key === 'tilt' ? 361 : 85);
    }
    assert.deepEqual(lab.editBefore, { value: 0.076944, displayedValue: '0.076944' });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene')
      .editState.getSpec().movement.referenceLaunch.verticalGravity === 0.077944);
    lab.editAfter = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('CharacterEditorScene');
      return { value: scene.getPageFields()[scene.focusIndex].value,
        displayedValue: scene.fieldValues[scene.focusIndex].text };
    });
    assert.deepEqual(lab.editAfter, { value: 0.077944, displayedValue: '0.077944' });
    await page.keyboard.press('z');
    await page.waitForFunction(() => window.__game.scene.getScene('CharacterEditorScene')
      .editState.getSpec().movement.referenceLaunch.verticalGravity === 0.076944);
    lab.editUndone = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('CharacterEditorScene');
      return { value: scene.getPageFields()[scene.focusIndex].value,
        displayedValue: scene.fieldValues[scene.focusIndex].text };
    });
    assert.deepEqual(lab.editUndone, lab.editBefore);
    report.lab.push({ viewport, ...lab });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(({ id, summary }) => ({ id, ...summary,
    normals: summary.normals.slice(0, 4) })), comparison: report.comparison, errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/link-launch.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
