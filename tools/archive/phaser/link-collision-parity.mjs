import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_COLLISION_OUTPUT ?? 'docs/review/2026-09-22/combat-parity/collision/production';
await mkdir(output, { recursive: true });
const report = { errors: [], loadErrors: [], contacts: [], chains: [], lab: [], notes: [
  'Real MatchScene collision delivery with production freshness, staleness, rage, hitlag and separation enabled.',
  'Region probes use a controlled 1px tangible hurtbox inside the receiver body to isolate source IDs; they are not claims about native fighter hurtbox shape.',
  'Normal jab chains use unchanged full fighter hurtboxes and no repositioning after their initial setup.',
  'Static top-bone capsules use the documented project projection. Native animated bone transforms and angle367 remain outside this evidence.',
] };
const cases = [
  { id: 'jab-inner-priority', move: 'jab', x: 45, y: -4, selected: 0 },
  { id: 'jab-middle', move: 'jab', x: 70, y: -4, selected: 1 },
  { id: 'jab-inward-air', move: 'jab', x: 94, y: -4, selected: 2, angle: 180 },
  { id: 'jab-inward-ground', move: 'jab', x: 94, y: -4, selected: 2, angle: 180, ground: true },
  { id: 'jab-inward-mirror', move: 'jab', x: 94, y: -4, selected: 2, angle: 180, facing: -1 },
  { id: 'jab2-inward', move: 'jab2', x: 104, y: -6.5, selected: 2, angle: 180 },
  { id: 'jab3-rounded-corner-miss', move: 'jab3', x: 96.8, y: 17.8, miss: true },
  { id: 'dtilt-diagonal-interior', move: 'dtilt', x: 55, y: 20, selected: 0 },
  { id: 'dtilt-diagonal-corner-miss', move: 'dtilt', x: 95, y: 2, miss: true },
  { id: 'fair-ground-outer', move: 'fair', x: 100, y: -21.5, selected: 0, ground: true, angle: 43 },
  { id: 'fair-ground-middle', move: 'fair', x: 60, y: -21.5, selected: 2, ground: true, angle: 47 },
  { id: 'fair-ground-inner', move: 'fair', x: 10, y: -21.5, selected: 4, ground: true, angle: 47 },
  { id: 'fair-air-inner', move: 'fair', x: 10, y: -21.5, selected: 5, angle: 38 },
  { id: 'fair-air-outer-legacy367', move: 'fair', x: 100, y: -21.5, selected: 1, legacy: true },
  ...[0, 0.5, 1].map(sdi => ({ id: `sdi-factor-${sdi}`, move: 'jab', x: 45, y: -4, selected: 0, sdi })),
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push({ url: request.url(), error: request.failure()?.errorText }));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_COLLISION_EXPECT_ARTIFACT)
    assert.ok(report.artifact.some(url => url.includes(process.env.PF_COLLISION_EXPECT_ARTIFACT)));
  // Kept inside one browser function so every scenario uses the same real scene
  // setup. Inputs are resolved actions; OS keyboard/gamepad routing is separate.
  const run = async spec => page.evaluate(spec => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 922,
      itemFrequency: 'off', players: [
        { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
      ] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    const a = s.p1, d = s.p2, origin = { x: 720, y: 120 }, facing = spec.facing ?? 1;
    for (const index of [0, 1]) {
      s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
    }
    const neutral = { moveX: 0, moveY: 0, attack: false };
    let ai = neutral, di = neutral, frame = 0, context = null;
    s.inputResolver.getMoveVector = index => ({ x: (index === 1 ? ai : di).moveX, y: (index === 1 ? ai : di).moveY });
    s.inputResolver.isActionHeld = (index, action) => (index === 1 ? ai : di)[action] === true;
    const snapshot = fighter => ({ position: { ...fighter.getPosition() }, velocity: { ...fighter.getVelocity() },
      hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(), grounded: fighter.isGrounded(),
      canAct: fighter.canUseItemsBeforeInput() });
    const hits = [], trace = [], instances = new Set();
    const originalCallback = s.hitboxDamageHandler.callback;
    s.hitboxDamageHandler.callback = (index, hit, source) => {
      context = source; return originalCallback(index, hit, source);
    };
    const originalHit = d.applyHitDetailed.bind(d);
    d.applyHitDetailed = info => {
      const before = snapshot(d), percentBefore = d.getDamagePercent();
      const active = a.getActiveAttack(), result = originalHit(info);
      if (result.outcome === 'landed') {
        instances.add(context?.attackInstance);
        hits.push({ frame: frame + 1, id: context?.collisionHitId, move: context?.moveId,
          attackFrame: active?.framesElapsed, damage: result.damageApplied, percentBefore,
          info: { damage: info.damage, baseDamage: info.baseDamage, staleMultiplier: info.staleMultiplier,
            knockback: info.knockback, facing: info.facing, hitlagMultiplier: info.hitlagMultiplier,
            sdiMultiplier: info.sdiMultiplier, velocityCarry: info.velocityCarry, minHitstunFrames: info.minHitstunFrames },
          launch: result.knockback, before, after: snapshot(d) });
      }
      return result;
    };
    let broadContacts = 0;
    s.matter.world.on('collisionstart', event => {
      for (const pair of event.pairs) {
        const other = pair.bodyA === d.body ? pair.bodyB : pair.bodyB === d.body ? pair.bodyA : null;
        if (other?.plugin?.ownerBodyId === a.body.id && other.isSensor) broadContacts++;
      }
    });
    const step = (attacker = neutral, defender = neutral) => {
      ai = attacker; di = defender;
      const before = snapshot(d);
      s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); frame++;
      trace.push({ frame, before, after: snapshot(d), attacker: snapshot(a), move: a.getActiveAttack()?.move.id,
        attackFrame: a.getActiveAttack()?.framesElapsed });
    };
    for (let n = 0; n < 100; n++) step();
    const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
    for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
    s.matter.add.rectangle(origin.x, origin.y + 46, spec.chain || spec.ground ? 400 : 40, 20,
      { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
    a.resetForRound(origin.x, origin.y); a.setFacing(facing); a.setDamagePercent(0);
    d.resetForRound(origin.x + (spec.chain ? 49 : 160) * facing, origin.y); d.setDamagePercent(spec.percent ?? 0);
    for (let n = 0; n < 20; n++) step();
    if (!spec.chain && !spec.ground) d.resetForRound(origin.x + 5000, origin.y);
    if (spec.move === 'fair') { a.resetForRound(origin.x, origin.y - 100); a.setFacing(facing); }
    if (spec.sdi !== undefined) a.addAttack({ ...a.getAttack('link.jab'), sdiMultiplier: spec.sdi });
    hits.length = 0; trace.length = 0; broadContacts = 0; frame = 0;
    if (spec.chain) {
      step({ ...neutral, attack: true });
      for (let n = 0; n < 160; n++) {
        const active = a.getActiveAttack(), chain = active?.move.jabChain;
        const fresh = chain && a.getHitlagRemaining() === 0 && active.framesElapsed === chain.advanceWindowStart - 1;
        if (!hits.length) {
          const overlap = Math.min(a.body.bounds.max.x, d.body.bounds.max.x) - Math.max(a.body.bounds.min.x, d.body.bounds.min.x);
          if (overlap > 1e-7) throw new Error('Unmodeled pre-contact fighter overlap');
        }
        step(fresh ? { ...neutral, attack: true } : neutral);
        if (hits.length === 3 && d.canUseItemsBeforeInput() && !d.getHitlagRemaining()) break;
      }
      return { spec, hits, trace, instances: instances.size, broadContacts };
    }
    // Holding down before the attack edge selects tilt; a fresh down flick
    // correctly requests down smash through the production input controller.
    if (spec.move === 'dtilt') for (let n = 0; n < 8; n++) step({ ...neutral, moveY: 1 });
    step({ ...neutral, attack: true, moveX: spec.move === 'fair' ? facing : 0, moveY: spec.move === 'dtilt' ? 1 : 0 });
    const desired = `link.${spec.move}`;
    for (let n = 0; n < 100; n++) {
      const active = a.getActiveAttack();
      if (active?.move.id === desired && active.framesElapsed >= active.move.startupFrames - 1) break;
      const chain = active?.move.jabChain;
      step(chain && active.framesElapsed === chain.advanceWindowStart - 1 ? { ...neutral, attack: true } : neutral);
    }
    if (a.getActiveAttack()?.move.id !== desired) throw new Error(`Normal dispatch did not reach ${desired}`);
    if (spec.move === 'fair') {
      s.matter.body.setPosition(a.body, { x: origin.x, y: origin.y - 4 });
      s.matter.body.setVelocity(a.body, { x: 0, y: 0 });
    }
    const anchor = { ...a.getPosition() }, point = { x: anchor.x + spec.x * facing, y: anchor.y + spec.y };
    if (spec.ground) s.matter.body.setPosition(d.body, { x: point.x, y: d.getPosition().y });
    else d.resetForRound(point.x, point.y);
    s.matter.body.setVelocity(d.body, { x: 0, y: 0 });
    const offsetY = point.y - d.getPosition().y;
    d.getActiveHurtboxes = () => [{ id: 'controlled-probe', offsetX: 0, offsetY, width: 1, height: 1 }];
    const beforeContact = { attacker: snapshot(a), target: snapshot(d), point };
    step();
    let sdiDisplacement = null;
    if (spec.sdi !== undefined && hits.length) {
      const before = { ...d.getPosition() }; step(neutral, { ...neutral, moveX: 1 });
      sdiDisplacement = { x: d.getPosition().x - before.x, y: d.getPosition().y - before.y };
    }
    return { spec, beforeContact, hits, broadContacts, sdiDisplacement, trace };
  }, spec);

  for (const spec of cases) {
    const row = await run(spec); report.contacts.push(row);
    assert.ok(row.broadContacts > 0, `${spec.id}: real Matter broad contact required`);
    if (spec.miss) { assert.equal(row.hits.length, 0, spec.id); continue; }
    assert.equal(row.hits.length, 1, spec.id); const hit = row.hits[0];
    assert.equal(hit.id, spec.selected, spec.id);
    assert.equal(hit.before.grounded, !!spec.ground, spec.id);
    if (spec.angle !== undefined) assert.equal(hit.info.knockback.reference.angle, spec.angle, spec.id);
    if (spec.legacy) { assert.equal(hit.info.knockback.reference, undefined); assert.ok(hit.info.velocityCarry); }
    if (spec.move === 'fair' && !spec.legacy) assert.equal(hit.info.velocityCarry, undefined);
    assert.ok(Math.abs(hit.damage - (spec.move === 'fair' ? 8 : spec.move === 'dtilt' ? 9 : 3) * 1.05) < 1e-9);
    if (spec.sdi !== undefined) assert.ok(Math.abs(row.sdiDisplacement.x - 10 * spec.sdi) < 1e-9);
  }
  for (const percent of [0, 100]) {
    const row = await run({ id: `normal-jab-chain-${percent}`, chain: true, percent }); report.chains.push(row);
    assert.deepEqual(row.hits.map(hit => hit.move), ['link.jab', 'link.jab2', 'link.jab3']);
    assert.equal(row.instances, 3, 'Each chained stage owns its stale execution identity');
    row.hits.forEach((hit, i) => {
      const baseDamage = i === 2 ? 4 : 3, actualDamage = baseDamage * 1.05;
      assert.ok(Math.abs(hit.damage - actualDamage) < 1e-9);
      const source = i === 2 ? { base: 70, growth: 70, angle: 30 }
        : hit.id >= 2 ? { base: 20, growth: 15, angle: 180 } : { base: 25, growth: 25, angle: 361 };
      assert.deepEqual(hit.info.knockback.reference, source);
      const p = hit.percentBefore + actualDamage, growthDamage = baseDamage * (0.7 + 0.3 * 1.05);
      const kb = ((p / 10 + p * growthDamage / 20) * 1.4 * 200 / 204 + 18) * source.growth / 100 + source.base;
      assert.ok(Math.abs(hit.launch.referenceKnockback - kb) < 1e-7, 'Freshness must affect reference growth independently of actual damage');
    });
    const first = row.hits[0].frame, last = row.hits.at(-1).frame;
    row.actionableGaps = row.trace.filter(t => t.frame > first && t.frame < last && t.before.canAct && t.before.hitlag === 0).map(t => t.frame);
    assert.deepEqual(row.actionableGaps, [], 'The measured earliest Link jab chains retain their connected window');
    // Actual production clocks are recorded; source capsule reach is not a
    // universal guarantee against every recipient, input, or timing choice.
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const row = await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1920, 1080); game.scene.start('CharacterEditorScene');
      const s = game.scene.getScene('CharacterEditorScene'); s.savedSlotId = null;
      s.loadSpec(s.getSources().find(source => source.id === 'shipped:link').spec);
      s.section = 'move'; s.moveIndex = s.getMoveKeys().indexOf('jab'); s.fieldPage = 0; s.refreshAll();
      const fields = s.getFields().map(({ id, value, label }) => ({ id, value, label })), overflows = [];
      do {
        s.getPageFields().forEach((f, i) => { if (s.fieldLabels[i].getBounds().right > s.fieldValues[i].getBounds().left) overflows.push(f.id); });
        s.changePage(1);
      } while (s.fieldPage !== 0);
      for (const id of ['collisionHits.0.capsule.radius', 'hitlagMultiplier']) {
        for (let n = 0; n < 60; n++) {
          const index = s.getPageFields().findIndex(f => f.id === id);
          if (index >= 0) { s.stepFieldAt(index, 1, 1); break; }
          s.changePage(1);
        }
      }
      s.handleSave(false); const slot = s.savedSlotId;
      s.loadSpec(s.getSources().find(source => source.id === 'shipped:link').spec); s.loadSaved(slot);
      const saved = s.editState.getSpec().moves.jab;
      s.section = 'move'; s.moveIndex = s.getMoveKeys().indexOf('fair'); s.fieldPage = 0; s.refreshAll();
      const fairFields = s.getFields().map(({ id, value }) => ({ id, value }));
      do {
        s.getPageFields().forEach((f, i) => { if (s.fieldLabels[i].getBounds().right > s.fieldValues[i].getBounds().left) overflows.push(`fair:${f.id}`); });
        s.changePage(1);
      } while (s.fieldPage !== 0);
      s.section = 'move'; s.moveIndex = s.getMoveKeys().indexOf('jab'); s.fieldPage = 0; s.refreshAll();
      s.focusIndex = s.getPageFields().findIndex(f => f.id === 'collisionHits.0.capsule.radius');
      s.refreshFields(); s.refreshPreview();
      return { fields, fairFields, overflows, slot, saved };
    });
    report.lab.push({ viewport, ...row });
    assert.deepEqual(row.overflows, []); assert.ok(!row.fields.some(f => f.id.startsWith('hitbox.')));
    assert.ok(!row.fairFields.some(f => f.id.startsWith('hitbox.')));
    assert.equal(row.saved.collisionHits[0].capsule.radius, 9.5);
    assert.ok(Math.abs(row.saved.hitlagMultiplier - 1.65) < 1e-9);
    assert.equal(row.fairFields.find(f => f.id === 'hitWindows.0.collisionHits.5.knockback.reference.angle')?.value, 38);
    assert.equal(row.fairFields.find(f => f.id === 'hitWindows.0.collisionHits.0.knockback.reference.angle')?.value, 43);
    await page.screenshot({ path: `${output}/lab-capsules-${viewport.width}.png` });
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify({ artifact: report.artifact, contacts: report.contacts.map(r => ({ id: r.spec.id, hits: r.hits.length,
    selected: r.hits[0]?.id, broadContacts: r.broadContacts })), chains: report.chains.map(r => ({ percent: r.spec.percent,
    damage: r.hits.map(h => h.damage), frames: r.hits.map(h => h.frame), actionableGaps: r.actionableGaps })), lab: report.lab.length }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/collision-parity.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
