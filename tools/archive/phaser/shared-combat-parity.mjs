import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-22/combat-parity/shared/production';
await mkdir(output, { recursive: true });
const source = await readFile('docs/review/2026-09-22/combat-parity/shared/sources/calculator-formulas.js', 'utf8');
const oracle = runInNewContext(source + '\n({Hitlag, StaleNegation, VSKB})', {
  Knockback: class { constructor(kb) { this.kb = kb; } },
});
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], loadErrors: [], cases: [], notes: [
  'Normal resolver attack input and real collision delivery to two recipients per swing.',
  'History is seeded explicitly to isolate weighted staleness; recipients are staged before each independent swing.',
  'Expected hitlag and combined damage/percent/weight/rage/stale KB execute the pinned independent calculator.',
  'This isolates modifiers and identity; continuous combo geometry is covered separately.',
] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('requestfailed', request => report.loadErrors.push(request.url()));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  if (process.env.PF_EXPECT_ARTIFACT) assert.ok(report.artifact.some(url => url.includes(process.env.PF_EXPECT_ARTIFACT)));
  const jab = { moveId: 'link.jab', shield: false };
  for (const spec of [
    { id: 'fresh', history: [], percent: 0 },
    { id: 'crouching-victims', history: [], percent: 0, crouching: true },
    { id: 'rage', history: [], percent: 150 },
    { id: 'recent', history: [jab], percent: 0 },
    { id: 'older', history: [jab, { moveId: 'link.ftilt', shield: false }], percent: 0 },
    { id: 'shield-history', history: [{ ...jab, shield: true }], percent: 0 },
    { id: 'fully-stale-rage', history: Array(9).fill(jab), percent: 150 },
  ]) {
    const row = await page.evaluate(spec => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scale.setGameSize(1440, 1000);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 923,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
          { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
        ] } });
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
      const a = s.p1, victims = [s.p2, s.extraFighters[0]];
      for (const index of [0, 1, 2]) {
        s.blastZoneWatcher.unregisterPlayer(index); s.blastZonePositionWatcher.unregisterPlayer(index);
      }
      let attack = false, steps = 0;
      s.inputResolver.getMoveVector = index => ({ x: 0, y: index !== 1 && spec.crouching ? 1 : 0 });
      s.inputResolver.isActionHeld = (index, action) => index === 1 && action === 'attack' && attack;
      const step = (held = false) => {
        attack = held;
        const frame = s.physicsEngine.getFrame();
        s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
        if (s.physicsEngine.getFrame() !== frame + 1) throw new Error('Outer clock must advance once');
        steps++;
      };
      for (let i = 0; i < 100; i++) step();
      const category = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid').collisionFilter.category;
      for (const body of s.baseStage.bodies.platformBodies) body.collisionFilter.mask = 0;
      s.matter.add.rectangle(720, 166, 400, 20, { isStatic: true, label: 'platform.solid', collisionFilter: { category } });
      a.resetForRound(720, 120); a.setDamagePercent(spec.percent); a.setFacing(1);
      victims.forEach((victim, index) => { victim.resetForRound(720 + (index ? -130 : 130), 120); victim.setDamagePercent(0); });
      for (const entry of spec.history) a.registerLandedMove(entry.moveId, entry.shield);
      for (let i = 0; i < 20; i++) step();
      const beforeFactor = a.getStaleMultiplier('link.jab'), beforeCount = a.getStaleOccurrences('link.jab');
      const hits = [], identities = new Set();
      victims.forEach((victim, index) => {
        const original = victim.applyHitDetailed.bind(victim);
        victim.applyHitDetailed = info => {
          const active = a.getActiveAttack();
          const grounded = victim.isGrounded();
          const result = original(info);
          if (result.outcome === 'landed') {
            const identity = active?.hitboxBody?.plugin.attackInstance;
            if (!identity) throw new Error('Missing shared attack identity');
            identities.add(identity);
            hits.push({ victim: index, grounded, damage: result.damageApplied, baseDamage: info.baseDamage,
              stale: info.staleMultiplier, hitlag: victim.getHitlagRemaining(), kb: result.knockback.referenceKnockback,
              attackFrame: active.framesElapsed, multiplier: info.hitlagMultiplier });
          }
          return result;
        };
      });
      step(true);
      if (a.getActiveAttack()?.move.id !== 'link.jab') throw new Error('Neutral attack must select jab');
      while (a.getActiveAttack().framesElapsed < 5) step();
      victims.forEach(victim => s.matter.body.setPosition(victim.body, { x: a.getPosition().x + 49, y: victim.getPosition().y }));
      step();
      const attackerHitlag = a.getHitlagRemaining();
      for (let i = 0; i < 3; i++) step();
      return { spec, hits, beforeFactor, beforeCount, afterCount: a.getStaleOccurrences('link.jab'),
        afterFactor: a.getStaleMultiplier('link.jab'), identities: identities.size, attackerHitlag, steps };
    }, spec);
    report.cases.push(row);
    const queue = [...spec.history].reverse();
    const matches = queue.map(entry => entry.moveId === 'link.jab');
    const shields = queue.map(entry => entry.shield);
    const stale = oracle.StaleNegation(matches, shields, false);
    const kb = oracle.VSKB(0, 3, 3, 104, 25, 25, .096, 1.6, spec.crouching ? .85 : 1, matches, shields, false,
      spec.percent, 361, false, false, false, false, { X: 0, Y: 0 }, false, 1).kb;
    assert.equal(row.hits.length, 2, `${spec.id}: both recipients must be hit exactly once`);
    assert.equal(row.identities, 1);
    assert.equal(row.afterCount, Math.min(9, row.beforeCount + 1));
    assert.equal(row.attackerHitlag, oracle.Hitlag(3 * stale, 1.6, false, 1, false, 3));
    assert.ok(Math.abs(row.beforeFactor - stale) < 1e-12);
    for (const hit of row.hits) {
      assert.equal(hit.grounded, true); assert.equal(hit.attackFrame, 6);
      assert.equal(hit.baseDamage, 3); assert.equal(hit.multiplier, 1.6);
      assert.ok(Math.abs(hit.damage - 3 * stale) < 1e-12);
      assert.ok(Math.abs(hit.kb - kb) < 1e-10);
      assert.equal(hit.hitlag, oracle.Hitlag(3 * stale, 1.6, false, spec.crouching ? .67 : 1, false, 3));
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.loadErrors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/shared-combat.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
