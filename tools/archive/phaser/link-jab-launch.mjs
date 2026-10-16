import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_JAB_OUTPUT ?? 'docs/review/2026-09-22/jab-launches/production';
const physicsPath = process.env.PF_JAB_PHYSICS_REPORT ?? 'docs/review/2026-09-22/jab-launches/physics.json';
const physics = JSON.parse(await readFile(physicsPath, 'utf8'));
assert.equal(physics.schemaVersion, 1);
assert.equal(physics.measurements.length, 33, 'Expected thirty-three coordinated jab-chain fixtures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], physicsPath, scenarios: [], resolverSmoke: [], lab: [], notes: [
  'Production MatchScene and actual jab-stage collision delivery through normal neutral attack input and fresh chain presses.',
  'Resolver responses are controlled; physical keyboard/gamepad events are outside this probe.',
  'Isolated later-strike measurements intentionally whiff prior sweeps and stage a fresh target before the selected window.',
  'Targets are staged immediately before contact; original platforms and KO watchers are disabled for isolated launch measurements.',
  'Every displayed frame is compared with the real-Matter fixture through three free steps; isolated reference launches have an independent formula oracle.',
  'A collision-free ordinary Matter body checks world gravity and clocks alongside accelerated fighter movement.',
  'Grounded recipients settle on a real floor; isolated fixtures remove that floor after contact to measure subsequent flight.',
  'Connected fixtures keep both fighters intact between actual hits; missing follow-ups are recorded rather than forcing contact.',
  'Jab1/2 use the selected inner361-degree records; inward fighter-only tips and their category fallback remain omitted spatial variants.',
  'Jab hitboxes use the selected static top-bone capsule envelopes projected at5px/unit from the baseline Link foot; native animated bone transforms and rounded corners remain unmodeled.',
  'The existing grounded fresh-edge chain windows11/7 remain project input behavior; native combo/no-hit/restart status semantics are not claimed.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_JAB_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_JAB_EXPECT_ARTIFACT)), 'Expected rebuilt jab artifact');

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
      const currentDefense = () => spec.sequence && hits.length > 0
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
      const hits = [], trace = [], transitions = [], attackInstances = new Set(), hitGroups = new Set();
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
      let frame = 0, setupFrameOrigin = 0, hitlagPressDone = false;
      let finalActionableAt = null;
      let afterInput = null, defenderInput = null, resolvedAttackerInput = null, witness = null;
      const witnessOrigin = { x: origin.x - 300, y: origin.y - 200 };
      const witnessVelocity = { x: 1.25, y: -1 };
      const originalInput = d.applyInput.bind(d);
      d.applyInput = input => { defenderInput = { ...input }; originalInput(input); afterInput = snapshot(); };
      const originalAttackerInput = a.applyInput.bind(a);
      a.applyInput = input => { resolvedAttackerInput = { ...input }; originalAttackerInput(input); };
      const originalHit = d.applyHitDetailed.bind(d);
      d.applyHitDetailed = info => {
        const attackerGrounded = a.isGrounded(), targetGrounded = d.isGrounded();
        const attackerPosition = relative(a.getPosition()), targetPosition = relative(d.getPosition());
        const active = a.getActiveAttack();
        const instance = active?.hitboxBody?.plugin.attackInstance;
        const group = active?.hitboxBody?.plugin.hitGroup ?? active?.hitboxBody?.id;
        const result = originalHit(info);
        if (result.outcome === 'landed') {
          finalActionableAt = null;
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
      const neutral = { moveX: 0, moveY: 0, jump: false };
      const step = requestedInput => {
        attackerInput = requestedInput ?? neutral;
        const beforeInput = snapshot(), engineFrame = s.physicsEngine.getFrame();
        const attackBefore = a.getActiveAttack(), attackFrameBefore = attackBefore?.framesElapsed;
        if (!requestedInput && spec.sequence && attackBefore) {
          const chain = attackBefore.move.jabChain;
          const threshold = (chain?.advanceWindowStart ?? 99) + (spec.chainMode === 'late' ? 4 : 0);
          if (spec.chainMode === 'held') attackerInput = { ...neutral, attack: true };
          else if (spec.chainMode === 'hitlag-press') {
            if (!hitlagPressDone && a.getHitlagRemaining() > 0) {
              attackerInput = { ...neutral, attack: true }; hitlagPressDone = true;
            }
          } else if (chain && a.getHitlagRemaining() === 0 && attackBefore.framesElapsed === threshold - 1)
            attackerInput = { ...neutral, attack: true };
        }
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
        if (attackBefore && attackAfter && attackAfter.move.id !== attackBefore.move.id)
          transitions.push({ fromId: attackBefore.move.id, fromFrame: attackBefore.framesElapsed,
            toId: attackAfter.move.id, toFrame: attackAfter.framesElapsed,
            sinceContact: hits.length ? frame - hits[0].frame : frame - setupFrameOrigin + 1 });
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
          moveId: a.getActiveAttack()?.move.id ?? null, attackerInput: resolvedAttackerInput,
          beforeInput, afterInput, afterConstraints: snapshot() };
        if (hits.length) trace.push(row);
        return row;
      };
      for (let i = 0; i < 100; i++) step();
      setupFrameOrigin = frame;
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      const customPad = setup.pad ? s.matter.add.rectangle(origin.x + setup.pad.center.x, origin.y + setup.pad.center.y,
        setup.pad.width, setup.pad.height,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } }) : null;
      const attackFacing = spec.facing;
      const contactX = 26 + d.getTuning().width / 2;
      a.resetForRound(origin.x, origin.y); a.setDamagePercent(0);
      if (spec.groundedVictim) d.resetForRound(origin.x + attackFacing * (spec.sequence ? contactX : 130),
        origin.y + 36 - d.getTuning().height / 2);
      else d.resetForRound(origin.x + 5000, origin.y);
      for (let i = 0; i < 20; i++) step(neutral);
      if (!a.isGrounded() || (spec.groundedVictim && !d.isGrounded()))
        throw new Error('Grounded setup must settle on the support pad');
      d.setDamagePercent(spec.percent);
      a.setFacing(spec.facing);
      const inputDispatch = { initialFacing: a.getFacing(), moveX: 0 };
      const attackInput = { ...neutral, attack: true };
      step(attackInput);
      Object.assign(inputDispatch, { moveId: a.getActiveAttack()?.move.id, attackFacing: a.getActiveAttack()?.facing,
        fighterFacingAfter: a.getFacing() });
      if (inputDispatch.moveId !== 'link.jab' || inputDispatch.attackFacing !== attackFacing)
        throw new Error('Neutral grounded attack must dispatch jab1 in the current facing');
      const moveIds = ['link.jab', 'link.jab2', 'link.jab3'];
      for (let stage = 1; stage < spec.stage; stage++) {
        const chain = a.getActiveAttack().move.jabChain;
        while (a.getActiveAttack().framesElapsed < chain.advanceWindowStart - 1) step(neutral);
        step(attackInput);
        if (a.getActiveAttack()?.move.id !== moveIds[stage] || a.getActiveAttack()?.framesElapsed !== 0)
          throw new Error('A fresh chain edge must start the next jab at frame0');
      }
      const move = a.getAttack(moveIds[spec.stage - 1]);
      const contactFrame = [6, 4, 5][spec.stage - 1];
      while (a.getActiveAttack().framesElapsed < contactFrame - 1) step();
      if (hits.length) throw new Error('Selected strike must be isolated from previous contacts');
      const anchor = a.getPosition();
      const isolatedContactX = move.hitbox.offsetX + move.hitbox.width / 2 + d.getTuning().width / 2 - 5;
      if (spec.groundedVictim && !spec.sequence)
        s.matter.body.setPosition(d.body, { x: anchor.x + attackFacing * isolatedContactX, y: d.getPosition().y });
      else if (!spec.groundedVictim)
        d.resetForRound(anchor.x + attackFacing * isolatedContactX, anchor.y + 34 - d.getTuning().height / 2);
      d.setDamagePercent(spec.percent);
      const staged = snapshot();
      witness = s.matter.add.rectangle(witnessOrigin.x, witnessOrigin.y, 8, 8,
        { frictionAir: 0, collisionFilter: { mask: 0 }, label: 'calibration.clockWitness' });
      s.matter.body.setVelocity(witness, witnessVelocity);
      step();
      if (hits.length !== 1) throw new Error('Selected target must receive one actual jab hit');
      if (!spec.sequence) {
        if (setup.removePadAfterContact && customPad) s.matter.world.remove(customPad);
        a.setPosition(anchor.x - 400, anchor.y);
      }
      let firstActionableAt = null;
      for (let i = 0; i < 250; i++) {
        const row = step();
        if (firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput)
          firstActionableAt = row.sinceContact;
        if (finalActionableAt === null && row.sinceContact > hits.at(-1).sinceContact
          && row.beforeInput.canUseItemsBeforeInput) finalActionableAt = row.sinceContact;
        if ((!spec.sequence || a.getActiveAttack() === null) && finalActionableAt !== null
          && row.sinceContact >= finalActionableAt + 2) break;
      }
      return { scenario: spec, moveData: move, setup: { attackerAnchor: relative(anchor), staged, inputDispatch },
        hits, trace, clocks, transitions, summary: { releaseAt: trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact,
          stunEndAt: firstActionableAt === null ? null : firstActionableAt - 1, firstActionableAt,
          finalStunEndAt: finalActionableAt === null ? null : finalActionableAt - 1, finalActionableAt,
          attackInstances: attackInstances.size, hitGroups: hitGroups.size,
          jumpsUsed: d.getJumpsUsed() }, activeOverlapEvents };
    }, { spec: fixture.scenario, releaseInput: fixture.input, setup: fixture.setup });
    report.scenarios.push(actual);
    const id = fixture.scenario.id;
    assert.equal(actual.hits.length, fixture.hits.length, `${id}: observed actual strikes`);
    assert.equal(actual.setup.inputDispatch.moveId, 'link.jab', `${id}: normal neutral jab dispatch`);
    assert.equal(actual.setup.inputDispatch.attackFacing, fixture.scenario.facing, `${id}: attack-facing direction`);
    let percent = fixture.scenario.percent;
    for (const [index, hit] of actual.hits.entries()) {
      const expectedHit = fixture.hits[index];
      for (const key of ['sinceContact', 'attackFrame', 'moveId', 'damage', 'launchFacing', 'hitlag', 'attackerGrounded', 'targetGrounded'])
        assert.equal(hit[key], expectedHit[key], `${id}: hit${index} ${key}`);
      assert.equal(hit.carry, undefined, `${id}: no attacker-motion carry`);
      for (const position of ['attackerPosition', 'targetPosition']) for (const axis of ['x', 'y'])
        assert.ok(Math.abs(hit[position][axis] - expectedHit[position][axis]) < 1e-6,
          `${id}: hit${index} ${position}.${axis}`);
      const finish = hit.moveId === 'link.jab3';
      const damage = finish ? 4 : 3;
      percent += damage;
      const weight = fixture.scenario.target === 'link' ? 104 : 127;
      const kb = ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
          * (finish ? 0.7 : 0.25) + (finish ? 70 : 25);
      assert.ok(Math.abs(hit.damage - damage) < 1e-10, `${id}: independent source damage`);
      assert.ok(Math.abs(hit.launch.referenceKnockback - kb) < 1e-9, `${id}: independent ordinary KB`);
      for (const key of ['referenceKnockback', 'ordinaryHitstunFrames', 'hitstunFrames', 'launchDecayPerFrame'])
        assert.ok(Math.abs(hit.launch[key] - expectedHit.launch[key]) < 1e-9, `${id}: launch ${key}`);
    }
    assert.deepEqual(actual.transitions, fixture.transitions, `${id}: fresh-edge jab-chain transitions`);
    assert.deepEqual(actual.summary, fixture.summary, `${id}: release and recovery timing`);
    if (fixture.scenario.sequence) {
      if (['held', 'hitlag-press'].includes(fixture.scenario.chainMode)) {
        assert.equal(actual.hits.length, 1, `${id}: held or hitlag-only input does not advance the chain`);
        assert.equal(actual.transitions.length, 0);
      } else {
        assert.deepEqual(actual.hits.map(hit => hit.moveId), ['link.jab', 'link.jab2', 'link.jab3']);
        if (fixture.scenario.chainMode === 'late')
          assert.ok(actual.summary.firstActionableAt < actual.hits[1].sinceContact,
            `${id}: delayed continuation exposes an actionable gap`);
        else assert.ok(actual.trace.filter(row => row.sinceContact > 0
          && row.sinceContact <= actual.hits[2].sinceContact).every(row => !row.beforeInput.canUseItemsBeforeInput),
          `${id}: earliest continuation does not grant an actionable gap`);
      }
    }
    assert.equal(actual.trace.length, fixture.trace.length, `${id}: matching frame count`);
    let maxPositionError = 0, maxVelocityError = 0;
    for (const [index, row] of actual.trace.entries()) {
      const expected = fixture.trace[index];
      assert.equal(row.sinceContact, expected.sinceContact);
      assert.equal(row.attackFrame, expected.attackFrame, `${id}: attacker timeline`);
      assert.equal(row.moveId, expected.moveId, `${id}: active jab stage`);
      for (const [key, value] of Object.entries(expected.attackerInput))
        assert.equal(row.attackerInput[key], value, `${id}: attacker input ${key}`);
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
          { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'gamepad',
            inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      const a = s.p1, victims = [s.p2, s.extraFighters[0]];
      if (!victims.every(Boolean)) throw new Error('Multi-victim smoke requires three actual fighters');
      for (const index of [0, 1, 2]) {
        s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
      }
      let attack = false;
      s.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
      s.inputResolver.isActionHeld = (index, action) => index === 1 && action === 'attack' && attack;
      const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
      for (const [owner, method, counter] of [
        [s.inputResolver, 'update', 'inputSamples'], [s.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      const step = (held = false) => {
        attack = held;
        const frame = s.physicsEngine.getFrame(), timestamp = s.matter.world.engine.timing.timestamp;
        const inputs = clocks.inputSamples, rules = clocks.ruleUpdates;
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
        clocks.steps++;
        clocks.maxTimeError = Math.max(clocks.maxTimeError,
          Math.abs(s.matter.world.engine.timing.timestamp - timestamp - s.physicsEngine.fixedTimestepMs));
        if (s.physicsEngine.getFrame() !== frame + 1 || clocks.inputSamples !== inputs + 1 || clocks.ruleUpdates !== rules + 1)
          throw new Error('Multi-victim smoke advanced outer clocks incorrectly');
      };
      const hits = [], instances = new Set();
      for (const [index, victim] of victims.entries()) {
        const originalHit = victim.applyHitDetailed.bind(victim);
        victim.applyHitDetailed = info => {
          const active = a.getActiveAttack(), instance = active?.hitboxBody?.plugin.attackInstance;
          const targetGrounded = victim.isGrounded();
          const result = originalHit(info);
          if (result.outcome === 'landed') {
            if (!instance) throw new Error('A single-sensor jab must identify its attack instance');
            instances.add(instance);
            hits.push({ victim: index, moveId: active.move.id, attackFrame: active.framesElapsed,
              damage: result.damageApplied, targetGrounded,
              referenceKnockback: result.knockback.referenceKnockback, launchFacing: info.facing });
          }
          return result;
        };
      }
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      s.matter.add.rectangle(720, 166, 400, 20,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(720, 120); a.setDamagePercent(0); a.setFacing(1);
      const stageFar = () => victims.forEach((victim, index) => {
        victim.resetForRound(720 + (index ? -130 : 130), 120); victim.setDamagePercent(0);
      });
      const stageContact = () => victims.forEach(victim => {
        if (!victim.isGrounded()) throw new Error('Fresh smoke victims must be grounded');
        s.matter.body.setPosition(victim.body, { x: a.getPosition().x + 49, y: victim.getPosition().y });
      });
      stageFar();
      for (let i = 0; i < 20; i++) step();
      step(true);
      if (a.getActiveAttack()?.move.id !== 'link.jab') throw new Error('Neutral attack must start jab1');
      while (a.getActiveAttack().framesElapsed < 5) step();
      stageContact(); step();
      const afterFirst = { hits: hits.length, stale: a.getStaleOccurrences('link.jab'), instances: instances.size };
      while (a.getHitlagRemaining() > 0 || a.getActiveAttack().framesElapsed < 10) step();
      step(true);
      if (a.getActiveAttack()?.move.id !== 'link.jab2' || a.getActiveAttack()?.framesElapsed !== 0)
        throw new Error('Fresh neutral re-press must advance to jab2');
      stageFar();
      while (a.getActiveAttack().framesElapsed < 3) step();
      stageContact(); step();
      return { kind: 'multi-victim-jab-identity', hits, afterFirst, clocks, instances: instances.size,
        stale: { jab: a.getStaleOccurrences('link.jab'), jab2: a.getStaleOccurrences('link.jab2') },
        limitation: 'Victims are intentionally restaged before each active strike to isolate action identity; this is not uninterrupted combo evidence.' };
    });
    report.resolverSmoke.push(smoke);
    assert.deepEqual(smoke.afterFirst, { hits: 2, stale: 1, instances: 1 });
    assert.equal(smoke.hits.length, 4); assert.equal(smoke.instances, 2);
    assert.deepEqual(smoke.stale, { jab: 1, jab2: 1 });
    const kb = ((3 / 10 + 3 * 3 / 20) * 1.4 * 200 / 204 + 18) * 0.25 + 25;
    for (const [index, hit] of smoke.hits.entries()) {
      assert.equal(hit.moveId, index < 2 ? 'link.jab' : 'link.jab2');
      assert.equal(hit.attackFrame, index < 2 ? 6 : 4);
      assert.equal(hit.targetGrounded, true); assert.equal(hit.damage, 3); assert.equal(hit.launchFacing, 1);
      assert.ok(Math.abs(hit.referenceKnockback - kb) < 1e-9, 'Both victims receive the same fresh launch');
    }
    assert.equal(smoke.clocks.inputSamples, smoke.clocks.steps);
    assert.equal(smoke.clocks.ruleUpdates, smoke.clocks.steps);
    assert.ok(smoke.clocks.maxTimeError < 1e-8);
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [stage, moveKey] of ['jab', 'jab2', 'jab3'].entries()) {
      const row = await page.evaluate(key => {
        const game = window.__game;
        for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
        game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
        const scene = game.scene.getScene('CharacterEditorScene'); scene.savedSlotId = null;
        scene.loadSpec(scene.getSources().find(source => source.id === 'shipped:link').spec);
        scene.section = 'move'; scene.moveIndex = scene.getMoveKeys().indexOf(key);
        if (scene.moveIndex < 0) throw new Error(`Missing Lab move ${key}`);
        scene.fieldPage = 0; scene.refreshAll();
        const fields = scene.getFields().map(field => ({ id: field.id, value: field.value,
          step: field.step, integer: field.integer }));
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
      const reference = stage < 2 ? { base: 25, growth: 25, angle: 361 } : { base: 70, growth: 70, angle: 30 };
      assert.deepEqual(row.move.knockback.reference, reference);
      assert.equal(row.move.damage, stage < 2 ? 3 : 4);
      assert.deepEqual(row.move.hitbox, [
        { offsetX: 52.5, offsetY: -4, width: 53, height: 18 },
        { offsetX: 57.5, offsetY: -6.5, width: 65, height: 35 },
        { offsetX: 62.5, offsetY: -4, width: 70, height: 45 },
      ][stage], 'Selected top-bone capsule envelopes use the documented projection');
      assert.equal(row.move.launchAwayFromSource, undefined, 'Source LR uses attack direction, not target position');
      assert.equal(row.move.sweetSpot, undefined, 'Inward tip spatial variant remains explicitly omitted');
      assert.deepEqual(row.overflows, [], `${moveKey}: Lab fields fit at ${viewport.width}px`);
      for (const key of ['base', 'growth', 'angle'])
        assert.equal(row.fields.find(field => field.id === `knockback.reference.${key}`)?.value, reference[key]);
      assert.ok(!row.fields.some(field => ['knockback.x', 'knockback.y', 'knockback.scaling'].includes(field.id)));
      await page.screenshot({ path: `${output}/lab-${moveKey}-${viewport.width}.png` });
      if (stage < 2) {
        const expected = stage === 0 ? 11 : 7;
        assert.deepEqual(row.move.jabChain, { nextId: stage === 0 ? 'link.jab2' : 'link.jab3', advanceWindowStart: expected });
        const field = row.fields.find(field => field.id === 'jabChain.advanceWindowStart');
        assert.equal(field.value, expected); assert.equal(field.step, 1); assert.equal(field.integer, true);
        row.chainStep = await page.evaluate(() => {
          const scene = window.__game.scene.getScene('CharacterEditorScene');
          for (let attempts = 0; attempts < 30; attempts++) {
            const index = scene.getPageFields().findIndex(field => field.id === 'jabChain.advanceWindowStart');
            if (index >= 0) {
              const before = scene.getPageFields()[index].value;
              scene.stepFieldAt(index, 1, 1);
              const incremented = scene.getPageFields()[index].value;
              scene.stepFieldAt(index, -1, 1);
              const restored = scene.getPageFields()[index].value;
              scene.refreshAll();
              return { before, incremented, restored };
            }
            scene.changePage(1);
          }
          throw new Error('Jab chain timing control must be reachable through Lab pages');
        });
        assert.deepEqual(row.chainStep, { before: expected, incremented: expected + 1, restored: expected });
        report.lab.at(-1).chainStep = row.chainStep;
        await page.screenshot({ path: `${output}/lab-${moveKey}-chain-${viewport.width}.png` });
      }
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.map(row => ({ id: row.scenario.id,
    damage: row.hits.map(hit => hit.damage), attackFacing: row.setup.inputDispatch.attackFacing,
    frames: row.trace.length, maxPositionError: row.maxPositionError, maxVelocityError: row.maxVelocityError })),
    resolverSmoke: report.resolverSmoke, labViewports: report.lab.map(row => row.viewport),
    errors: report.errors, loadErrors: report.loadErrors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/jab-launches.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
