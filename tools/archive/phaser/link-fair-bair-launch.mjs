import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_FAIR_BAIR_OUTPUT ?? 'docs/review/2026-09-22/fair-bair-launches/production';
const physicsPath = process.env.PF_FAIR_BAIR_PHYSICS_REPORT ?? 'docs/review/2026-09-22/fair-bair-launches/physics.json';
const physics = JSON.parse(await readFile(physicsPath, 'utf8'));
assert.equal(physics.schemaVersion, 1);
assert.equal(physics.measurements.length, 34, 'Expected thirty-four coordinated fair/bair fixtures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], physicsPath, scenarios: [], resolverSmoke: [], lab: [], notes: [
  'Production MatchScene and actual forward-air/back-air collision delivery through normal resolved attack input.',
  'Resolver responses are controlled; physical keyboard/gamepad events are outside this probe.',
  'Isolated later-strike measurements intentionally whiff prior sweeps and stage a fresh target before the selected window.',
  'Targets are staged immediately before contact; original platforms and KO watchers are disabled for isolated launch measurements.',
  'Every displayed frame is compared with the real-Matter fixture through three free steps; isolated reference launches have an independent formula oracle.',
  'Connected forward-air sequences check retained project behavior; their calibrated first hit is not an Ultimate launch oracle.',
  'A collision-free ordinary Matter body checks world gravity and clocks alongside accelerated fighter movement.',
  'Grounded recipients settle on a real floor; isolated fixtures remove that floor after contact to measure subsequent flight.',
  'Connected fixtures keep both fighters intact between actual hits; missing follow-ups are recorded rather than forcing contact.',
  'Connected forward-air starts with a five-pixel body gap and back-air a three-pixel gap so startup drift does not invoke scene-only soft fighter separation.',
  'Back-air uses distal-knee reference records within the existing rectangular geometry; inner-knee/hip angles remain unmodeled.',
  'Forward-air first-hit legacy vector, minimum hitstun and airborne velocity carry remain calibrated approximations, not a verified angle367 port.',
  'Existing local stale damage remains active while fixed launch magnitude ignores attacker rage and stale launch scaling.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_FAIR_BAIR_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_FAIR_BAIR_EXPECT_ARTIFACT)), 'Expected rebuilt fair/bair artifact');

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
      let attackerInput = { moveX: 0, moveY: 0, attack: false };
      const currentDefense = () => spec.connected && hits.length > 0 && hits.length < 2
        && (frame + 1 - hits[0].frame) % 2 === 0 ? spec.defense : null;
      s.inputResolver.getMoveVector = index => index === 1
        ? { x: attackerInput.moveX, y: attackerInput.moveY ?? 0 }
        : index === 2 && !currentDefense() && d.getHitlagRemaining() === 1
          ? { x: releaseInput.moveX, y: releaseInput.moveY ?? 0 } : { x: 0, y: 0 };
      s.inputResolver.isActionHeld = (index, action) => index === 1
        ? attackerInput[action] === true : index === 2 && (
        currentDefense() === 'jump' && action === 'jump'
        || currentDefense() === 'dodge' && ['dodge', 'shield'].includes(action)
        || currentDefense() === 'attack' && action === 'attack');
      const relative = p => ({ x: p.x - origin.x, y: p.y - origin.y });
      const snapshot = () => ({ position: relative(d.getPosition()), velocity: { ...d.getVelocity() },
        hitlag: d.getHitlagRemaining(), hitstun: d.getHitstunRemaining(), grounded: d.isGrounded(),
        tumbling: d.isTumbling(), canUseItemsBeforeInput: d.canUseItemsBeforeInput() });
      const hits = [], trace = [], attackInstances = new Set(), hitGroups = new Set();
      let activeOverlapEvents = 0;
      s.matter.world.on('collisionactive', event => {
        for (const pair of event.pairs) {
          const other = pair.bodyA === d.body ? pair.bodyB : pair.bodyB === d.body ? pair.bodyA : null;
          if (other?.plugin?.ownerBodyId === a.body.id && other.isSensor) activeOverlapEvents++;
        }
      });
      const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0,
        witnessSteps: 0, maxWitnessPositionError: 0, maxWitnessVelocityError: 0, attackerAnimationChecks: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      let frame = 0, afterInput = null, defenderInput = null, witness = null;
      const witnessOrigin = { x: origin.x - 300, y: origin.y - 200 };
      const witnessVelocity = { x: 1.25, y: -1 };
      const originalInput = d.applyInput.bind(d);
      d.applyInput = input => { defenderInput = { ...input }; originalInput(input); afterInput = snapshot(); };
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const attackerGrounded = a.isGrounded(), targetGrounded = d.isGrounded();
        const attackerPosition = relative(a.getPosition()), targetPosition = relative(d.getPosition());
        const active = a.getActiveAttack();
        const instance = active?.hitboxBody?.plugin.attackInstance;
        const group = active?.hitboxBody?.plugin.hitGroup;
        const result = originalHit(info);
        if (result.outcome === 'landed') {
          if (instance) attackInstances.add(instance);
          hitGroups.add(group);
          hits.push({ frame: frame + 1, sinceContact: hits.length ? frame + 1 - hits[0].frame : 0,
          attackFrame: active?.framesElapsed,
          moveId: active?.move.id, damage: result.damageApplied, launchFacing: info.facing,
          launch: result.knockback, hitlag: d.getHitlagRemaining(), attackerGrounded, targetGrounded,
          attackerPosition, targetPosition, attackFacing: active?.facing, fighterFacing: a.getFacing(),
          ...(info.velocityCarry ? { carry: { ...info.velocityCarry } } : {}) });
        }
        return result;
      };
      const step = (input = { moveX: 0, moveY: 0, attack: false }) => {
        attackerInput = input;
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
          attackFrame: a.getActiveAttack()?.framesElapsed ?? null, attackerPosition: relative(a.getPosition()), defenderInput,
          beforeInput, afterInput, afterConstraints: snapshot() };
        if (hits.length) trace.push(row);
        return row;
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      const customPad = setup.pad ? s.matter.add.rectangle(origin.x + setup.pad.center.x, origin.y + setup.pad.center.y,
        setup.pad.width, setup.pad.height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } }) : null;
      const attackFacing = spec.facing * (spec.move === 'fair' ? 1 : -1);
      a.resetForRound(origin.x + (spec.groundedVictim ? -1000 : 0), origin.y + (spec.groundedVictim ? -100 : 0)); a.setDamagePercent(0);
      if (spec.groundedVictim) d.resetForRound(origin.x + attackFacing * (24 + d.getTuning().width / 2),
        origin.y + 36 - d.getTuning().height / 2);
      else if (spec.connected) {
        d.resetForRound(origin.x + attackFacing * ((spec.move === 'fair' ? 28 : 26) + d.getTuning().width / 2), origin.y);
        d.setDamagePercent(spec.percent);
        s.matter.body.setVelocity(a.body, { x: 0, y: spec.initialY ?? 0 });
        s.matter.body.setVelocity(d.body, { x: 0, y: spec.initialY ?? 0 });
      } else d.resetForRound(origin.x + 5000, origin.y);
      if (spec.groundedVictim) {
        for (let i = 0; i < 20; i++) step();
        if (!d.isGrounded()) throw new Error('Grounded target must settle on the support pad');
        a.resetForRound(origin.x - 1000, origin.y - 100);
      }
      d.setDamagePercent(spec.percent);
      a.setFacing(spec.facing);
      const inputDispatch = { initialFacing: a.getFacing(), moveX: attackFacing };
      step({ attack: true, moveX: attackFacing, moveY: 0 });
      Object.assign(inputDispatch, { moveId: a.getActiveAttack()?.move.id, attackFacing: a.getActiveAttack()?.facing,
        fighterFacingAfter: a.getFacing() });
      if (inputDispatch.moveId !== 'link.' + spec.move || inputDispatch.attackFacing !== attackFacing)
        throw new Error('Normal attack input must dispatch the requested aerial with its latched attack direction');
      const move = a.getAttack('link.' + spec.move);
      const contactFrame = spec.move === 'fair' ? (spec.strike === 'first' ? 15 : 23)
        : spec.strike === 'first' ? 5 : 14;
      while (a.getActiveAttack().framesElapsed < contactFrame - 1) step();
      if (hits.length) throw new Error('Selected strike must be isolated from previous contacts');
      if (spec.groundedVictim) {
        s.matter.body.setPosition(a.body, { x: origin.x, y: origin.y - 4 });
        s.matter.body.setVelocity(a.body, { x: 0, y: 0 });
      }
      const anchor = a.getPosition();
      if (!spec.groundedVictim && !spec.connected)
        d.resetForRound(anchor.x + attackFacing * (24 + d.getTuning().width / 2), anchor.y - 3);
      d.setDamagePercent(spec.percent);
      const staged = snapshot();
      witness = s.matter.add.rectangle(witnessOrigin.x, witnessOrigin.y, 8, 8,
        { frictionAir: 0, collisionFilter: { mask: 0 }, label: 'calibration.clockWitness' });
      s.matter.body.setVelocity(witness, witnessVelocity);
      step();
      if (hits.length !== 1) throw new Error('Selected target must receive one actual aerial hit');
      if (!spec.connected) {
        if (setup.removePadAfterContact && customPad) s.matter.world.remove(customPad);
        a.setPosition(anchor.x - 400, anchor.y);
      }
      let firstActionableAt = null, isolatedFinish = false;
      for (let i = 0; i < 250; i++) {
        const row = step();
        if (spec.connected && hits.length >= 2 && !isolatedFinish) {
          a.setPosition(anchor.x - 400, anchor.y); isolatedFinish = true;
        }
        const followUpObserved = !spec.connected || isolatedFinish || (a.getActiveAttack()?.framesElapsed ?? 99) >= (spec.move === 'fair' ? 25 : 17);
        if (followUpObserved && firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput)
          firstActionableAt = row.sinceContact;
        if (followUpObserved && firstActionableAt !== null && row.sinceContact >= firstActionableAt + 2) break;
      }
      return { scenario: spec, moveData: move, setup: { attackerAnchor: relative(anchor), staged, inputDispatch },
        hits, trace, clocks, summary: { releaseAt: trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact,
          stunEndAt: firstActionableAt === null ? null : firstActionableAt - 1, firstActionableAt,
          connected: hits.length === 2, attackInstances: attackInstances.size, hitGroups: hitGroups.size,
          jumpsUsed: d.getJumpsUsed() }, activeOverlapEvents };
    }, { spec: fixture.scenario, releaseInput: fixture.input, setup: fixture.setup });
    report.scenarios.push(actual);
    const id = fixture.scenario.id;
    assert.equal(actual.hits.length, fixture.hits.length, `${id}: observed actual strikes`);
    assert.equal(actual.setup.inputDispatch.moveId, 'link.' + fixture.scenario.move, `${id}: normal aerial dispatch`);
    assert.equal(actual.setup.inputDispatch.attackFacing,
      fixture.scenario.facing * (fixture.scenario.move === 'fair' ? 1 : -1), `${id}: latched attack-facing direction`);
    let percent = fixture.scenario.percent;
    for (const [index, hit] of actual.hits.entries()) {
      const expectedHit = fixture.hits[index];
      for (const key of ['sinceContact', 'attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded'])
        assert.equal(hit[key], expectedHit[key], `${id}: hit${index} ${key}`);
      assert.deepEqual(hit.carry, expectedHit.carry, `${id}: explicitly calibrated attacker-motion carry`);
      for (const position of ['attackerPosition', 'targetPosition']) for (const axis of ['x', 'y'])
        assert.ok(Math.abs(hit[position][axis] - expectedHit[position][axis]) < 1e-6,
          `${id}: hit${index} ${position}.${axis}`);
      const fair = fixture.scenario.move === 'fair';
      const first = hit.attackFrame < (fair ? 23 : 14);
      const damage = fair ? (first ? 8 : 10) : (first ? 5 : 7);
      percent += damage;
      const weight = fixture.scenario.target === 'link' ? 104 : 127;
      if (fair && first) {
        assert.equal(hit.launch.referenceKnockback, undefined, `${id}: fair first remains explicitly calibrated`);
        assert.ok(actual.moveData.hitWindows[0].airborneVelocityCarry);
        assert.equal(actual.moveData.hitWindows[0].minHitstunFrames, 8);
        assert.equal(actual.moveData.hitWindows[0].knockback.reference, undefined);
        continue;
      }
      const fixed = !fair && first ? (hit.targetGrounded ? 50 : 36) : 0;
      const kb = fixed ? (1 + fixed / 2) * 1.4 + 18
        : ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
          * (fair ? 1.2 : 0.98) + (fair ? 43 : 45);
      assert.ok(Math.abs(hit.damage - damage) < 1e-10, `${id}: independent source damage`);
      assert.ok(Math.abs(hit.launch.referenceKnockback - kb) < 1e-9, `${id}: independent fixed/ordinary KB`);
      for (const key of ['referenceKnockback', 'ordinaryHitstunFrames', 'hitstunFrames', 'launchDecayPerFrame'])
        assert.ok(Math.abs(hit.launch[key] - expectedHit.launch[key]) < 1e-9, `${id}: launch ${key}`);
      if (fixed) {
        assert.equal(hit.launch.hitstunFrames, Math.floor(Math.max(5, kb * 0.4)) - 1,
          `${id}: fixed reaction is uncompressed, with no added frames`);
        assert.equal(hit.launch.tumble, false, `${id}: bair linker is below tumble threshold`);
      }
    }
    assert.deepEqual(actual.summary, fixture.summary, `${id}: release and recovery timing`);
    assert.equal(actual.trace.length, fixture.trace.length, `${id}: matching frame count`);
    let maxPositionError = 0, maxVelocityError = 0;
    for (const [index, row] of actual.trace.entries()) {
      const expected = fixture.trace[index];
      assert.equal(row.sinceContact, expected.sinceContact);
      assert.equal(row.attackFrame, expected.attackFrame, `${id}: attacker timeline`);
      for (const axis of ['x', 'y'])
        assert.ok(Math.abs(row.attackerPosition[axis] - expected.attackerPosition[axis]) < 1e-6,
          `${id}: frame ${row.sinceContact} attacker position ${axis}`);
      for (const [key, value] of Object.entries(expected.defenderInput))
        assert.equal(row.defenderInput[key], value, `${id}: defender input ${key}`);
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

  {
    const smoke = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 922,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      const a = s.p1, d = s.p2;
      for (const index of [0, 1]) {
        s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
      }
      let moveX = 0, attack = false;
      s.inputResolver.getMoveVector = index => ({ x: index === 1 ? moveX : 0, y: 0 });
      s.inputResolver.isActionHeld = (index, action) => index === 1 && action === 'attack' && attack;
      const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      const step = (held = false, horizontal = 0) => {
        attack = held; moveX = horizontal;
        const frame = s.physicsEngine.getFrame(), timestamp = s.matter.world.engine.timing.timestamp;
        const inputs = clocks.inputSamples, rules = clocks.ruleUpdates;
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
        clocks.steps++;
        clocks.maxTimeError = Math.max(clocks.maxTimeError,
          Math.abs(s.matter.world.engine.timing.timestamp - timestamp - s.physicsEngine.fixedTimestepMs));
        if (s.physicsEngine.getFrame() !== frame + 1 || clocks.inputSamples !== inputs + 1 || clocks.ruleUpdates !== rules + 1)
          throw new Error('Resolver smoke advanced outer clocks incorrectly');
      };
      const hits = [], instances = new Set(), groups = new Set();
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const active = a.getActiveAttack();
        const instance = active?.hitboxBody?.plugin.attackInstance, group = active?.hitboxBody?.plugin.hitGroup;
        const targetGrounded = d.isGrounded();
        const result = originalHit(info);
        if (result.outcome === 'landed') {
          instances.add(instance); groups.add(group);
          hits.push({ moveId: active.move.id, attackFrame: active.framesElapsed,
            damage: result.damageApplied, targetGrounded, attackFacing: active.facing,
            referenceKnockback: result.knockback.referenceKnockback, launchFacing: info.facing,
            hitstun: result.knockback.hitstunFrames });
        }
        return result;
      };
      for (let i = 0; i < 100; i++) step();
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      a.resetForRound(720, 120); a.setDamagePercent(150); a.setFacing(1);
      d.resetForRound(5720, 120); d.setDamagePercent(100);
      for (let i = 0; i < 3; i++) a.registerLandedMove('link.bair');
      const attackerPercent = a.getDamagePercent(), occurrencesBefore = a.getStaleOccurrences('link.bair');
      step(true, -1);
      const inputDispatch = { moveId: a.getActiveAttack()?.move.id, attackFacing: a.getActiveAttack()?.facing };
      if (inputDispatch.moveId !== 'link.bair' || inputDispatch.attackFacing !== -1)
        throw new Error('Opposite-stick attack must dispatch back-air behind the original facing');
      while (a.getActiveAttack().framesElapsed < 4) step();
      const anchor = a.getPosition();
      d.resetForRound(anchor.x - 24 - d.getTuning().width / 2, anchor.y - 3); d.setDamagePercent(100);
      step();
      return { kind: 'fixed-stale-rage', attackerPercent, occurrencesBefore,
        occurrencesAfter: a.getStaleOccurrences('link.bair'), inputDispatch, hits, clocks,
        instances: instances.size, groups: groups.size,
        limitation: 'Resolver responses are controlled; physical keyboard/gamepad events and general combo balance are outside this smoke.' };
    });
    report.resolverSmoke.push(smoke);
    assert.equal(smoke.instances, 1); assert.equal(smoke.groups, 1);
    assert.equal(smoke.attackerPercent, 150); assert.equal(smoke.occurrencesBefore, 3);
    assert.equal(smoke.occurrencesAfter, 4);
    assert.equal(smoke.hits.length, 1); assert.equal(smoke.hits[0].targetGrounded, false);
    assert.equal(smoke.hits[0].attackFrame, 5); assert.equal(smoke.hits[0].launchFacing, -1);
    assert.ok(Math.abs(smoke.hits[0].damage - 5 * 0.85) < 1e-10, 'Existing local stale damage applies');
    assert.ok(Math.abs(smoke.hits[0].referenceKnockback - 44.6) < 1e-9, 'Fixed launch ignores rage and stale KB scaling');
    assert.equal(smoke.hits[0].hitstun, 16);
    assert.equal(smoke.clocks.inputSamples, smoke.clocks.steps);
    assert.equal(smoke.clocks.ruleUpdates, smoke.clocks.steps);
    assert.ok(smoke.clocks.maxTimeError < 1e-8);
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const moveKey of ['fair', 'bair']) {
      const row = await page.evaluate(key => {
        const game = window.__game;
        for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
        game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
        const scene = game.scene.getScene('CharacterEditorScene'); scene.savedSlotId = null;
        scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
        scene.section = 'move'; scene.moveIndex = scene.getMoveKeys().indexOf(key);
        if (scene.moveIndex < 0) throw new Error(`Missing Lab move ${key}`);
        scene.fieldPage = 0; scene.refreshAll();
        const fields = scene.getFields().map(field => ({ id: field.id, value: field.value }));
        const overflows = [];
        do {
          scene.getPageFields().forEach((field, row) => {
            const labelRight = scene.fieldLabels[row].getBounds().right;
            const valueLeft = scene.fieldValues[row].getBounds().left;
            if (labelRight > valueLeft) overflows.push({ id: field.id, page: scene.fieldPage, labelRight, valueLeft });
          });
          scene.changePage(1);
        } while (scene.fieldPage !== 0);
        return { key, fields, overflows, move: scene.editState.getSpec().moves[key] };
      }, moveKey);
      report.lab.push({ viewport, ...row });
      const fair = moveKey === 'fair';
      const reference = fair ? { base: 43, growth: 120, angle: 44 } : { base: 45, growth: 98, angle: 361 };
      assert.deepEqual(row.move.knockback.reference, reference);
      assert.equal(row.move.launchAwayFromSource, undefined, 'Source LR uses attack direction, not target position');
      assert.deepEqual(row.overflows, [], `${moveKey}: Lab fields fit at ${viewport.width}px`);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `knockback.reference.${key}`)?.value, reference[key]);
      assert.ok(!row.fields.some(field => ['knockback.x', 'knockback.y', 'knockback.scaling'].includes(field.id)));
      const first = row.move.hitWindows[0];
      if (fair) {
        assert.equal(first.knockback.reference, undefined);
        assert.deepEqual(first.knockback, { x: 0.8, y: -0.4, scaling: 0.025 });
        assert.equal(first.airborneVelocityCarry, true); assert.equal(first.minHitstunFrames, 8);
        for (const key of ['x', 'y', 'scaling'])
          assert.equal(row.fields.find(field => field.id === `hitWindows.0.knockback.${key}`)?.value, first.knockback[key]);
      } else {
        assert.equal(first.minHitstunFrames, undefined);
        for (const [recordKey, fixed, angle] of [['knockback', 36, 70], ['groundedKnockback', 50, 73]]) {
          const record = { base: 0, growth: 100, angle, fixed, setWeight: true };
          const prefix = 'hitWindows.0.' + recordKey;
          assert.deepEqual(first[recordKey].reference, record);
          for (const key of ['base', 'growth', 'angle', 'fixed'])
            assert.equal(row.fields.find(field => field.id === prefix + '.reference.' + key)?.value, record[key]);
          assert.ok(!row.fields.some(field => ['x', 'y', 'scaling'].some(key => field.id === prefix + '.' + key)));
          assert.ok(!row.fields.some(field => field.id === prefix + '.reference.setWeight'), 'Boolean remains JSON-authored');
        }
      }
      assert.deepEqual(row.move.hitWindows.map(window => window.damage), fair ? [8, 10] : [5, 7]);
      assert.equal(new Set(row.move.hitWindows.map(window => window.group)).size, 2);
      await page.screenshot({ path: `${output}/lab-${moveKey}-${viewport.width}.png` });
      await page.evaluate(id => {
        const scene = window.__game.scene.getScene('CharacterEditorScene');
        for (let attempts = 0; attempts < 30; attempts++) {
          if (scene.getPageFields().some(field => field.id === id)) return;
          scene.changePage(1);
        }
        throw new Error('First-hit authoring controls must be reachable through Lab pages');
      }, fair ? 'hitWindows.0.knockback.x' : 'hitWindows.0.groundedKnockback.reference.fixed');
      await page.screenshot({ path: `${output}/lab-${moveKey}-first-${viewport.width}.png` });
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.scenario.id,
    damage: row.hits.map(hit => hit.damage), attackFacing: row.setup.inputDispatch.attackFacing,
    frames: row.trace.length, maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })),
    resolverSmoke: report.resolverSmoke, labViewports: report.lab.map(row => row.viewport),
    errors: report.errors, loadErrors: report.loadErrors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/fair-bair-launches.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
