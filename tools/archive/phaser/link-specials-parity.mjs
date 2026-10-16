import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_SPECIALS_OUTPUT ?? 'docs/review/2026-09-22/combat-parity/specials/production';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { schemaVersion: 1, scenarios: [], errors: [], loadErrors: [], notes: [
  'Normal resolved special inputs drive bow, boomerang, Spin and bomb. Target staging isolates the selected phase; physical controllers are outside this probe.',
  'Actual MatchScene projectile sweeps and Matter attack sensors deliver hits. Independent arithmetic checks base damage, weighted staling, rage, source launch and hitlag.',
  'Freeze traces cover neutral hitlag and first release; these are not whole-flight trajectory or KO acceptance measurements.',
  'Bow flight/charge clock, boomerang path/catch/smash throw, bomb item flight and unsupported aerial Spin linkers retain documented local behavior.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));
const cases = [
  // SmashWiki Link (SSBU)/Neutral special: damage floor(4 + 8 × charge / 60), full (12%) from 36 charge frames;
  // charging starts on frame 16 (UFD Neutral B charge 16-52).
  ...[0, 18, 36].map(held => ({ id: `bow-${held}`, kind: 'bow', held, damage: held >= 36 ? 12 : Math.floor(4 + 8 * held / 60),
    base: 10, growth: 71, angle: 361, hitlag: 0.8 })),
  // The probe throws with a smash input (stick flicked with the press): SmashWiki Link (SSBU)/Side special,
  // clean 8% and late 6% are multiplied by 1.2 for a smash-input throw; the returning 3% is not.
  ...[
    { phase: 'clean', age: 1, damage: 8 * 1.2, base: 80, growth: 40, angle: 70 },
    { phase: 'late', age: 10, damage: 6 * 1.2, base: 60, growth: 40, angle: 65 },
    { phase: 'return', age: 38, damage: 3, base: 50, growth: 40, angle: 70 },
  ].map(spec => ({ ...spec, id: `boomerang-${spec.phase}`, kind: 'boomerang', hitlag: 1 })),
  { id: 'boomerang-two-pass', kind: 'boomerang-two-pass', damage: 8 * 1.2, base: 80, growth: 40, angle: 70, hitlag: 1 },
  // Ground Spin `frame` is the 0-based release-local age of the hitting frame (the attack instance starts on
  // release, after the 3 GroundStart frames). SmashWiki Link (SSBU)/Up special: clean/mid/late/latest are
  // release-local 4-5, 6-10, 11-20, 21-36 (uncharged public 7-8, 9-13, 14-23, 24-39; UFD: "Startup is 4 from
  // charge state"); damage × (1 + 0.6 × charge / 60).
  ...[0, 60].flatMap(held => [
    { phase: 'clean', frame: 3, damage: 14, base: 60, growth: 88, angle: 45, hitlag: 1.4 },
    { phase: 'mid', frame: 5, damage: 12, base: 52, growth: 88, angle: 43, hitlag: 1 },
    { phase: 'late', frame: 10, damage: 9, base: 48, growth: 84, angle: 43, hitlag: 1 },
    { phase: 'latest', frame: 20, damage: 7, base: 20, growth: 82, angle: 361, hitlag: 1 },
  // `side`: where the target is staged; the sword sweeps in front on release-local frames 4, 11 and 21 and
  // behind on frame 6.
  ].map(spec => ({ ...spec, side: spec.phase === 'mid' ? -1 : 1, damage: spec.damage * (1 + 0.6 * held / 60),
    id: `spin-${spec.phase}-${held}`, kind: 'ground-spin', held }))),
  { id: 'spin-partial-rage', kind: 'ground-spin', frame: 3, side: 1, held: 30, damage: 18.2, base: 60, growth: 88, angle: 45, hitlag: 1.4, rage: 150 },
  { id: 'air-spin-fixed71', kind: 'air-spin', frame: 21, damage: 2, base: 0, growth: 100, angle: 83, fixed: 71, setWeight: true, hitlag: 1, sdi: 0.3, rage: 150 },
  { id: 'air-spin-fixed62', kind: 'air-spin', frame: 30, damage: 2, base: 0, growth: 100, angle: 69, fixed: 62, setWeight: true, hitlag: 1, sdi: 0.3 },
  { id: 'air-spin-finish', kind: 'air-spin', frame: 46, damage: 4, base: 30, growth: 200, angle: 361, hitlag: 2 },
  ...[-1, 1].map(side => ({ id: `bomb-side${side}`, kind: 'bomb', side, damage: 7, base: 60, growth: 115, angle: 52, hitlag: 0.8 })),
  // Self hit: Link is the attacker at 100%, so his own rage (1 + (100 − 35) / 115 × 0.1) scales the blast.
  { id: 'bomb-self', kind: 'bomb-self', damage: 7, base: 60, growth: 115, angle: 52, hitlag: 0.8, rage: 100 },
];

// Two players with items off: SmashWiki 1v1 multiplier, 1.2× damage taken; knockback and hitlag use the
// unmultiplied damage (ultimateUniversalRules M18).
const ONE_ON_ONE = 1.2;
function expected(spec, hit, stale = 1.05) {
  const damage = spec.damage * stale;
  const percent = hit.percentBefore + damage;
  const weight = spec.setWeight ? 100 : 104;
  const damageTerm = spec.damage * (1 - (1 - stale) * 0.3);
  const growthTerm = spec.fixed ? 1 + spec.fixed / 2 : percent / 10 + percent * damageTerm / 20;
  const rage = spec.fixed ? 1 : 1 + Math.max(0, Math.min(1, ((spec.rage ?? 0) - 35) / 115)) * 0.1;
  const kb = ((growthTerm * 1.4 * 200 / (weight + 100) + 18) * spec.growth / 100 + spec.base) * rage;
  return { damage: damage * ONE_ON_ONE, kb, hitlag: Math.min(30, Math.floor((damage * 0.65 + 6) * spec.hitlag)) };
}

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_SPECIALS_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_SPECIALS_EXPECT_ARTIFACT)), 'Expected final specials artifact');

  // PF_SPECIALS_ONLY=<substring> runs only the matching case ids (e.g. bomb).
  for (const spec of cases.filter(c => !process.env.PF_SPECIALS_ONLY || c.id.includes(process.env.PF_SPECIALS_ONLY))) {
    const actual = await page.evaluate(spec => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 922, linkIntroPolicy: 'none',
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
      const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
      const a = scene.p1, d = scene.p2, body = scene.matter.body, neutral = { moveX: 0, moveY: 0 };
      const inputs = [neutral, neutral];
      scene.inputResolver.getMoveVector = index => ({ x: inputs[index - 1]?.moveX ?? 0, y: inputs[index - 1]?.moveY ?? 0 });
      scene.inputResolver.isActionHeld = (index, action) => inputs[index - 1]?.[action] === true;
      for (const index of [0, 1]) { scene.blastZoneWatcher.unregisterPlayer(index); scene.blastZonePositionWatcher.unregisterPlayer(index); }
      const clocks = { steps: 0, inputSamples: 0, ruleUpdates: 0, maxTimeError: 0 };
      for (const [owner, method, counter] of [
        [scene.inputResolver, 'update', 'inputSamples'], [scene.matchRules, 'update', 'ruleUpdates'],
      ]) {
        const original = owner[method].bind(owner);
        owner[method] = (...args) => { clocks[counter]++; return original(...args); };
      }
      const hits = [], trace = [], identityIds = new Map();
      const identityId = value => {
        if (!value) return null;
        if (!identityIds.has(value)) identityIds.set(value, identityIds.size + 1);
        return identityIds.get(value);
      };
      for (const [index, fighter] of [a, d].entries()) {
        const original = fighter.applyHitDetailed.bind(fighter);
        fighter.applyHitDetailed = info => {
          const percentBefore = fighter.getDamagePercent(), position = { ...fighter.getPosition() };
          const result = original(info);
          if (result.outcome === 'landed') hits.push({ index, frame: clocks.steps + 1,
            attackFrame: a.getActiveAttack()?.framesElapsed ?? null,
            percentBefore, position, damage: result.damageApplied, baseDamage: info.baseDamage ?? info.damage,
            staleMultiplier: info.staleMultiplier, facing: info.facing, hitlag: fighter.getHitlagRemaining(),
            sourceHitlagMultiplier: info.hitlagMultiplier, sourceSdiMultiplier: info.sdiMultiplier,
            launch: result.knockback, knockback: info.knockback });
          return result;
        };
      }
      // Owner self-damage reaches the applyHitDetailed hook above (Character.applyHit delegates to it).
      let tracking = false;
      const victim = spec.kind === 'bomb-self' ? a : d;
      const snapshot = () => ({ position: { ...victim.getPosition() }, velocity: { ...victim.getVelocity() },
        hitlag: victim.getHitlagRemaining(), hitstun: victim.getHitstunRemaining() });
      const step = (first = neutral, second = neutral) => {
        inputs[0] = first; inputs[1] = second;
        const before = snapshot();
        const oldFrame = scene.physicsEngine.getFrame(), timestamp = scene.matter.world.engine.timing.timestamp;
        const oldInput = clocks.inputSamples, oldRules = clocks.ruleUpdates;
        scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause();
        clocks.steps++;
        clocks.maxTimeError = Math.max(clocks.maxTimeError,
          Math.abs(scene.matter.world.engine.timing.timestamp - timestamp - scene.physicsEngine.fixedTimestepMs));
        if (scene.physicsEngine.getFrame() !== oldFrame + 1 || clocks.inputSamples !== oldInput + 1 || clocks.ruleUpdates !== oldRules + 1)
          throw new Error('An outer clock advanced more than once');
        if (tracking) trace.push({ before, after: snapshot() });
      };
      const until = (predicate, limit = 250, first = neutral, second = neutral) => {
        for (let i = 0; i < limit && !predicate(); i++) step(first, second);
        if (!predicate()) throw new Error(`Timed out: ${spec.id}`);
      };
      for (let frame = 0; frame < 100; frame++) step();
      const category = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid').collisionFilter.category;
      for (const platform of scene.baseStage.bodies.platformBodies) platform.collisionFilter.mask = 0;
      if (spec.kind !== 'air-spin') scene.matter.add.rectangle(720, 168, 1600, 20,
        { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(720, 120); d.resetForRound(5720, 120);
      a.setDamagePercent(spec.rage ?? 0); d.setDamagePercent(100); a.setFacing(1);
      if (spec.kind !== 'air-spin') for (let frame = 0; frame < 20; frame++) step();
      const stageTarget = (x, y, percent = 100) => { d.resetForRound(x, y); d.setDamagePercent(percent); };
      const shotSnapshot = p => ({ phase: p.link?.state?.phase, phaseAge: p.link?.state?.phaseAge, returning: p.link?.returning,
        damage: p.damage, knockback: p.knockback, velocity: { x: p.vx, y: p.vy },
        owner: p.ownerSlotIndex, identity: identityId(p.attackInstance), position: { x: p.x, y: p.y } });
      const beforeHits = [];
      let returnedIdentity = null, selfBomb = null;

      if (['bow', 'boomerang', 'boomerang-two-pass'].includes(spec.kind)) {
        const held = { moveX: spec.kind === 'bow' ? 0 : 1, moveY: 0, special: true };
        step(held);
        if (spec.kind === 'bow') {
          // Press step = frame 1; frames 2-15 are startup; each later held step is one charge frame.
          if (spec.held > 0) for (let frame = 0; frame < 14 + spec.held; frame++) step(held);
          step();
        }
        until(() => scene.projectiles.length > 0);
        let p = scene.projectiles[0];
        // Boomerang contact phase (linkBoomerangFlightContactPhase; SmashWiki Link (SSBU)/Side special): flight
        // ages 0-9 clean, 10+ late, the turned-back pass is the return. Hold the target off until that phase.
        if (spec.phase === 'late') until(() => p.link.state.phase === 'fly' && p.link.state.phaseAge >= 10);
        if (spec.phase === 'return') until(() => p.link.state.phase === 'turn');
        const stageAhead = () => {
          const offset = Math.sign(p.vx) * (Math.abs(p.vx) + p.width / 2 + d.getTuning().width / 2 - 3);
          stageTarget(p.x + offset, p.y + p.vy - 5);
        };
        stageAhead();
        beforeHits.push(shotSnapshot(p)); tracking = true;
        until(() => hits.some(hit => hit.index === 1), 5);
        if (spec.kind === 'boomerang-two-pass') {
          // A confirmed hit turns the boomerang back (linkProjectileHit); the return pass may hit the same victim.
          tracking = false; stageTarget(5720, 120);
          until(() => p.link.state.phase === 'turn' && p.vx < 0);
          returnedIdentity = identityId(p.attackInstance);
          stageAhead();
          beforeHits.push(shotSnapshot(p)); tracking = true;
          until(() => hits.filter(hit => hit.index === 1).length === 2, 5);
        }
        for (const projectile of scene.projectiles) projectile.container.destroy();
        scene.projectiles = [];
      } else if (spec.kind === 'ground-spin' || spec.kind === 'air-spin') {
        const held = { moveX: 0, moveY: -1, special: true }; step(held);
        if (spec.kind === 'ground-spin') {
          if (spec.held > 0) for (let frame = 0; frame < 3 + spec.held; frame++) step(held);
          if (spec.held !== 60) step();
        }
        // The ground attack instance restarts on release (after GroundStart frames 1-3), so wait for that phase.
        until(() => (spec.kind === 'air-spin' || a.getLinkSpinState()?.phase === 'ground-release')
          && a.getActiveAttack()?.framesElapsed === spec.frame - 1);
        const position = a.getPosition();
        stageTarget(position.x + (spec.kind === 'ground-spin' ? spec.side * 65 : 58), position.y - (spec.kind === 'ground-spin' ? 20 : 8));
        tracking = true; step();
        if (!hits.length) throw new Error(`Expected actual Spin contact: ${spec.id}`);
        a.setPosition(-500, -500);
      } else {
        const down = { moveX: 0, moveY: 1, special: true }; step(down);
        for (let frame = 0; frame < 45; frame++) step();
        // A held bomb cannot be detonated (SmashWiki Link (SSBU)/Down special: not while another character
        // holds it; native SpecialLw admission rejects any holder, Link included), so it leaves the hand first:
        // thrown away for the opponent cases, Z-dropped at Link's feet for the self hit. Either item action
        // must end before the Down Special press is read.
        if (spec.kind === 'bomb') step({ moveX: 1, moveY: 0, attack: true });
        else { step({ moveX: 0, moveY: 0, grab: true }); a.setDamagePercent(100); }
        until(() => a.getItemActionState() === null && scene.getInventory(0).getHeldItem() === null, 60);
        if (spec.kind === 'bomb') { body.setPosition(a.body, { x: 220, y: 120 }); body.setVelocity(a.body, { x: 0, y: 0 }); }
        // Detonation is Link's intrinsic special (not an attack instance): the blast comes out on detonate
        // frame 12 (UFD Down B Detonate startup 12; SmashWiki: 12 frames of startup), i.e. state age 11.
        step(down); until(() => a.getLinkSpecialState()?.kind === 'bomb' && a.getLinkSpecialState().phase === 'detonate'
          && a.getLinkSpecialState().age === 10);
        // The Remote Bomb is an item (LinkRemoteBombItem) whose fuse lives in the scene's Link articles (src/match/linkArticles.ts).
        const row = scene.linkArticles.snapshot().bombs.find(b => b.ownerIndex === scene.playerSlots[0].playerIndex);
        const bombItem = row && scene.itemRegistry.getActive().find(e => e.id === row.itemId);
        const bomb = bombItem ? { ...row, x: bombItem.getPosition().x, y: bombItem.getPosition().y } : null;
        if (!bomb) throw new Error('Expected live remote bomb');
        if (spec.kind === 'bomb') stageTarget(bomb.x + spec.side * 30, bomb.y - 10);
        else {
          // The dropped bomb falls past the probe's floor (items ignore that test body), so stage Link at it.
          selfBomb = { ...bomb };
          body.setPosition(a.body, { x: bomb.x + 30, y: bomb.y - 10 }); body.setVelocity(a.body, { x: 0, y: 0 });
        }
        tracking = true; step();
        if (!hits.some(hit => hit.index === (spec.kind === 'bomb-self' ? 0 : 1))) throw new Error('Expected bomb blast contact');
      }

      // Keep the just-hit fighter in place until release. No SDI is authored.
      until(() => victim.getHitlagRemaining() === 0, 40);
      step();
      return { scenario: spec, hits, trace, clocks, beforeHits, returnedIdentity, selfBomb,
        staleCounts: { bow: a.getStaleOccurrences('link.neutral_special'), boomerang: a.getStaleOccurrences('link.side_special'),
          spin: a.getStaleOccurrences('link.up_special'), bomb: a.getStaleOccurrences('link.down_special') } };
    }, spec);
    report.scenarios.push(actual);
    const relevant = actual.hits.filter(hit => hit.index === (spec.kind === 'bomb-self' ? 0 : 1));
    assert.equal(relevant.length, spec.kind === 'boomerang-two-pass' ? 2 : 1, `${spec.id}: contact count`);
    for (const [index, hit] of relevant.entries()) {
      const source = spec.kind === 'boomerang-two-pass' && index === 1
        ? { ...spec, damage: 3, base: 50, growth: 40, angle: 70 } : spec;
      // SmashWiki Stale-move negation: player-generated items such as Link's Remote Bomb are immune to staling.
      const stale = spec.kind.startsWith('bomb') ? 1 : 1.05;
      const oracle = expected(source, hit, stale);
      assert.ok(Math.abs(hit.damage - oracle.damage) < 1e-9, `${spec.id}: sourced damage`);
      assert.ok(Math.abs(hit.launch.referenceKnockback - oracle.kb) < 1e-9, `${spec.id}: independent reference knockback`);
      assert.equal(hit.hitlag, oracle.hitlag, `${spec.id}: sourced hitlag`);
      assert.equal(hit.sourceSdiMultiplier, spec.sdi ?? 1, `${spec.id}: SDI metadata`);
      assert.equal(hit.knockback.reference.angle, source.angle);
      if (spec.kind === 'ground-spin') assert.equal(hit.facing, spec.side, 'Ground Spin launches away from its origin');
      if (spec.kind === 'bomb') assert.equal(hit.facing, spec.side, 'Bomb launches away from its own origin');
    }
    for (const row of actual.trace) if (row.before.hitlag > 1 && row.after.hitlag > 0) {
      assert.ok(Math.abs(row.after.position.x - row.before.position.x) < 1e-7, `${spec.id}: hitlag x freeze`);
      assert.ok(Math.abs(row.after.position.y - row.before.position.y) < 1e-7, `${spec.id}: hitlag y freeze`);
    }
    if (spec.kind === 'boomerang-two-pass') {
      assert.equal(actual.beforeHits[0].identity, actual.returnedIdentity);
      assert.equal(actual.staleCounts.boomerang, 1, 'Both passes share one stale registration');
    }
    assert.equal(actual.clocks.steps, actual.clocks.inputSamples);
    assert.equal(actual.clocks.steps, actual.clocks.ruleUpdates);
    assert.ok(actual.clocks.maxTimeError < 1e-8);
    console.log(`PASS ${spec.id}: ${relevant.length} actual hit(s), source launch/hitlag and outer clocks`);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, scenarios: report.scenarios.length,
    traceFrames: report.scenarios.reduce((sum, row) => sum + row.trace.length, 0),
    outerSteps: report.scenarios.reduce((sum, row) => sum + row.clocks.steps, 0), errors: report.errors }, null, 2));
} finally {
  await writeFile(`${output}/specials-parity.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
