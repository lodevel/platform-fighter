import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4183/platform-fighter/';
const out = process.argv[3] ?? 'docs/review/2026-10-06/pikachu-character/hurtbox-capsules/browser';
await mkdir(out, { recursive: true });
const report = { url, scope: 'Generic authored 2D capsule hurtboxes in production MatchScene with DK fixture bodies/moves. No native Pikachu posed geometry, roster or art acceptance.', errors: [], scenarios: [] };
const horizontal = { start: { x: -10, y: 0 }, end: { x: 10, y: 0 }, radius: 2 };
const rotated = { start: { x: 30, y: -10 }, end: { x: 40, y: 0 }, radius: 2 };
const definitions = [
  { name: 'rounded-corner-miss', capsule: horizontal, x: 12, y: 2, expected: 0 },
  { name: 'rounded-contact', capsule: horizontal, x: 11.5, y: 1.5, expected: 1 },
  { name: 'rotated-extended-contact', capsule: rotated, x: 35, y: -5, expected: 1 },
  { name: 'rotated-extended-miss', capsule: rotated, x: 35, y: 0, expected: 0 },
  { name: 'intangible-contact', capsule: rotated, x: 35, y: -5, intangible: true, expected: 0 },
  { name: 'fast-rotated-contact', capsule: rotated, x: 35, y: -30, vy: 40, projectileOnly: true, expected: 1 },
  { name: 'rounded-corner-flight-miss', capsule: horizontal, x: 12, y: 1.7, vx: 2, projectileOnly: true, expected: 0 },
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 90000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  for (const facing of [1, -1]) for (const mode of ['source', 'rectangle', 'projectile']) for (const def of definitions) {
    if (def.projectileOnly && mode !== 'projectile') continue;
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1051,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
    });
    await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1?.body);
    const result = await page.evaluate(({ facing, mode, def }) => {
      const source = mode === 'source';
      const scene = window.__game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
      scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
      scene.inputResolver.isActionHeld = () => false;
      scene.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
      const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
      for (let i = 0; i < 120; i++) step();
      const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      const origin = { x: floor.position.x, y: floor.bounds.min.y - 250 };
      scene.p1.resetForRound(origin.x, origin.y); scene.p2.resetForRound(origin.x, origin.y);
      scene.p1.setFacing(-facing); scene.p2.setFacing(facing);
      scene.matter.body.setStatic(scene.p1.body, true); scene.matter.body.setStatic(scene.p2.body, true);
      const hurtbox = { id: 'explicit-authored-limb', offsetX: 0, offsetY: 0, width: 1, height: 1,
        capsule: def.capsule, damageMultiplier: 1.5, ...(def.intangible ? { intangible: true } : {}) };
      const base = { type: 'jab', damage: 0, knockback: { x: 1, y: -1, scaling: 0 },
        hitbox: { offsetX: 500, offsetY: 0, width: 0.5, height: 0.5 },
        startupFrames: 1, activeFrames: 20, recoveryFrames: 1, cooldownFrames: 0 };
      scene.p2.addAttack({ ...base, id: 'capsule.defender', hurtboxModifiers: [{ replaceBody: true, hurtbox }] });
      if (!scene.p2.attemptAttack('capsule.defender')) throw new Error('Defender fixture failed');
      const x = -def.x, y = def.y;
      scene.p1.addAttack({ ...base, id: 'capsule.attacker', damage: 10,
        hitbox: { offsetX: x, offsetY: y, width: 0.5, height: 0.5 },
        ...(source ? { collisionHits: [{ id: 0, capsule: { start: { x, y }, end: { x, y }, radius: 0.25 } }] } : {}) });
      const hits = [];
      scene.hitboxDamageHandler.callback = (target, hit, context) => {
        if (target !== 1) return { confirmed: false };
        hits.push({ damage: hit.damage, region: context.collisionHitId }); return { confirmed: true };
      };
      if (mode === 'projectile') {
        scene.resolveCombatHit = (target, hit) => {
          if (target === 1) hits.push({ damage: hit.damage });
          return { confirmed: target === 1 };
        };
        scene.projectiles.push({ x: origin.x + def.x * facing, y: origin.y + def.y,
          vx: (def.vx ?? 0) * facing, vy: def.vy ?? 0, width: 0.5, height: 0.5, framesRemaining: 10,
          ownerSlotIndex: 0, facing: -facing, damage: 10,
          moveId: 'capsule.projectile-fixture', container: scene.add.container(0, 0) });
      } else if (!scene.p1.attemptAttack('capsule.attacker')) throw new Error('Attacker fixture failed');
      scene.hitboxDebugLayer.toggle();
      const frames = [];
      for (let i = 0; i < 4; i++) {
        step();
        const active = scene.p1.getActiveAttack();
        frames.push({ elapsed: active?.framesElapsed, phase: active?.phase,
          sensor: active?.hitboxBody ? { bounds: active.hitboxBody.bounds, plugin: active.hitboxBody.plugin } : null,
          attacker: scene.p1.getPosition(), attackerFacing: scene.p1.getFacing(), defender: scene.p2.getPosition(), defenderFacing: scene.p2.getFacing() });
      }
      const activeHurtboxes = scene.p2.getActiveHurtboxes();
      scene.p2.resetForRound(origin.x, origin.y);
      const resetCleared = scene.p2.getActiveHurtboxes().every(h => h.capsule === undefined);
      // Restore the live shape for the debug-layer screenshot only.
      scene.p2.attemptAttack('capsule.defender'); step();
      return { name: def.name, facing, mode, hits, activeHurtboxes, resetCleared, frames,
        engineVersion: scene.getMatchStartMetadata().engineVersion };
    }, { facing, mode, def });
    report.scenarios.push(result);
    assert.equal(result.hits.length, def.expected, `${def.name}/${facing}/${mode}`);
    if (def.expected) assert.equal(result.hits[0].damage, 15);
    assert.equal(result.resetCleared, true);
    assert.deepEqual(result.activeHurtboxes[0].capsule, def.capsule);
    if (mode === 'source' && def.name === 'rotated-extended-contact') await page.screenshot({ path: `${out}/capsule-facing-${facing}.png` });
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, errors: report.errors }));
