import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_NAIR_DASH_OUTPUT ?? 'docs/review/2026-09-21/nair-dash-launches/production';
const physicsPath = process.env.PF_NAIR_DASH_PHYSICS_REPORT ?? 'docs/review/2026-09-21/nair-dash-launches/physics.json';
const physics = JSON.parse(await readFile(physicsPath, 'utf8'));
assert.equal(physics.schemaVersion, 1);
assert.equal(physics.measurements.length, 16, 'Expected sixteen coordinated early/late aerial and dash fixtures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], physicsPath, scenarios: [], lab: [], notes: [
  'Production MatchScene, actual Link early/late neutral-air and dash-attack hitboxes and collision delivery.',
  'Each case reproduces the exported real-Matter fixture geometry and compares every displayed frame through three free steps.',
  'Original platforms and KO registrations are disabled for isolated launch measurement; this probe does not measure KO thresholds.',
  'Targets are staged once immediately before the selected early/late active step; late aerial targets are fresh.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_NAIR_DASH_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_NAIR_DASH_EXPECT_ARTIFACT)), 'Expected rebuilt nair/dash artifact');

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
      const hits = [], trace = [], clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let frame = 0, afterInput = null;
      const originalInput = d.applyInput.bind(d);
      d.applyInput = input => { originalInput(input); afterInput = snapshot(); };
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const attackerGrounded = a.isGrounded(), targetGrounded = d.isGrounded();
        const attackerPosition = relative(a.getPosition()), targetPosition = relative(d.getPosition());
        const result = originalHit(info);
        if (result.outcome === 'landed') hits.push({ frame: frame + 1, attackFrame: a.getActiveAttack()?.framesElapsed,
          moveId: a.getActiveAttack()?.move.id, damage: result.damageApplied, launchFacing: info.facing,
          launch: result.knockback, hitlag: d.getHitlagRemaining(), attackerGrounded, targetGrounded,
          attackerPosition, targetPosition });
        return result;
      };
      const step = (record = false) => {
        const beforeInput = snapshot(), engineFrame = s.physicsEngine.getFrame();
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
        const row = { sinceContact: hits.length ? frame - hits[0].frame : null,
          beforeInput, afterInput, afterConstraints: snapshot() };
        if (record && hits.length) trace.push(row);
        return row;
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      if (setup.pad) s.matter.add.rectangle(origin.x + setup.pad.center.x, origin.y + setup.pad.center.y,
        setup.pad.width, setup.pad.height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0);
      d.resetForRound(origin.x + 5000, origin.y);
      if (setup.pad) for (let i = 0; i < 20; i++) step();
      frame = 0; hits.length = 0; trace.length = 0;
      a.setFacing(spec.facing);
      if (!a.attemptAttack(`link.${spec.move}`)) throw new Error(`Cannot start ${spec.move}`);
      const move = a.getAttack(`link.${spec.move}`);
      const contactFrame = spec.phase === 'late' ? move.hitWindows[1].startFrame : move.startupFrames;
      while (a.getActiveAttack().framesElapsed < contactFrame - 1) step();
      const at = a.getPosition();
      // Fixture geometry is a shared test manifest, independent from the
      // production move data and runtime launch calculation being measured.
      d.resetForRound(origin.x + setup.staged.position.x, origin.y + setup.staged.position.y);
      d.setDamagePercent(spec.percent);
      const staged = snapshot();
      let stunEndAt = null;
      for (let i = 0; i < 200; i++) {
        const row = step(true);
        if (i === 0 && hits.length) a.setPosition(at.x - 400, at.y);
        if (hits.length && row.afterConstraints.hitlag === 0 && row.afterConstraints.hitstun === 0 && stunEndAt === null)
          stunEndAt = row.sinceContact;
        if (stunEndAt !== null && row.sinceContact >= stunEndAt + 3) break;
      }
      return { scenario: spec, moveData: move, staged, attackerAnchor: relative(at), hits, trace, clocks,
        summary: { releaseAt: trace.find(row => row.sinceContact > 0 && row.afterConstraints.hitlag === 0)?.sinceContact ?? null,
          stunEndAt, firstActionableAt: trace.find(row => row.sinceContact > 0 && row.beforeInput.canUseItemsBeforeInput)?.sinceContact ?? null } };
    }, { spec: fixture.scenario, releaseInput: fixture.input, setup: fixture.setup });
    report.scenarios.push(actual);
    const id = fixture.scenario.id;
    assert.equal(actual.hits.length, 1, `${id}: one actual authored strike`);
    const hit = actual.hits[0], expectedHit = fixture.hits[0];
    for (const key of ['attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded'])
      assert.equal(hit[key], expectedHit[key], `${id}: hit ${key}`);
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
      return ['nair', 'dashAttack'].map(key => {
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
      const reference = move === 'nair' ? { base: 22, growth: 100, angle: 361 } : { base: 85, growth: 85, angle: 50 };
      assert.deepEqual(authored.knockback.reference, reference, `${move}: selected source launch`);
      assert.ok(row.fits, `${move}: Lab labels fit at ${viewport.width}px`);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `knockback.reference.${key}`)?.value,
          reference[key], `${move}: editable reference ${key}`);
      assert.ok(!row.fields.some(field => ['knockback.x', 'knockback.y', 'knockback.scaling'].includes(field.id)));
      assert.equal(row.move.launchAwayFromSource, authored.launchAwayFromSource);
      if (move === 'nair') {
        const late = { base: 15, growth: 100, angle: 361 };
        assert.deepEqual(authored.hitWindows[1].knockback.reference, late);
        for (const key of ['base', 'growth', 'angle'])
          assert.equal(row.fields.find(field => field.id === `hitWindows.1.knockback.reference.${key}`)?.value,
            late[key], `nair: editable late reference ${key}`);
        assert.ok(!row.fields.some(field => ['x', 'y', 'scaling'].some(key =>
          field.id === `hitWindows.1.knockback.${key}`)));
        assert.equal(row.move.hitWindows[0].group, row.move.hitWindows[1].group);
        assert.equal(row.move.hitWindows[0].damage, 11);
        assert.equal(row.move.hitWindows[1].damage, 6);
      }
    }
    report.lab.push({ viewport, moves: fields });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.scenario.id,
    damage: row.hits[0].damage, launchFacing: row.hits[0].launchFacing, frames: row.trace.length,
    maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })),
    labViewports: report.lab.map(row => row.viewport), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/nair-dash-launches.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
