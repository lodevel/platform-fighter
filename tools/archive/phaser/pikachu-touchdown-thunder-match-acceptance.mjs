import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const { STALE_FRESH_MULTIPLIER } = await tsImport(new URL('../src/characters/combat.ts', import.meta.url).pathname, import.meta.url);

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/touchdown-thunder';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], failedResponses: [], quick: [], thunder: [], scope: 'Production MatchScene normal resolver input and real Matter physics. Quick neutral-stick recovery through physical touchdown and24-step landing commitment in both facings; Thunder first-bolt early/late actual receiver contacts in both facings. Receiver position is a controlled fixture seeded once before article birth, without moving the owner. Native common Quick ground STOP remains unqualified.' };
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) report.failedResponses.push({ url: response.url(), status: response.status() }); });
await page.exposeFunction('__captureRecoveryThunder', name => page.screenshot({ path: `${output}/${name}.png` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://localhost:4240/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  const result = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 2819,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(b => b !== floor);
    let x;
    for (let candidate = floor.bounds.min.x + 150; candidate < floor.bounds.max.x - 150; candidate += 20)
      if (overhead.every(b => candidate + 50 < b.bounds.min.x || candidate - 50 > b.bounds.max.x)) { x = candidate; break; }
    if (x === undefined) throw new Error('Clear sky column unavailable');
    const reset = facing => {
      scene.p1.resetForRound(x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(x + 300, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      for (let i = 0; i < 12; i++) step();
      scene.p1.setFacing(facing); scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
    };
    const snapshot = () => ({ state: scene.p1.getPikachuSpecialState(), objects: scene.p1.getPikachuSpecialVisuals(),
      grounded: scene.p1.isGrounded(), landing: scene.p1.getLandingPresentationState(), position: scene.p1.getPosition(),
      texture: scene.playerSlots[0].sprite.texture.key, frame: scene.playerSlots[0].sprite.frame.name,
      receiving: scene.p1.getActiveHurtboxes(), damage: scene.p2.getDamagePercent(), velocity: scene.p2.getVelocity(),
      hitlag: scene.p2.getHitlagRemaining(), ownerHitlag: scene.p1.getHitlagRemaining() });
    const quick = [], thunder = [];
    for (const facing of [1, -1]) {
      reset(facing); step({ special: true, moveY: -1 });
      const trace = [snapshot()]; let touchdown = null;
      for (let i = 0; i < 100; i++) {
        step(); const s = snapshot(); trace.push(s);
        if (s.grounded && s.state?.quickEndGrounded === false && s.state.frame >= s.state.firstBurstEnd) { touchdown = s; break; }
      }
      await window.__captureRecoveryThunder(`quick-${facing}-touchdown`);
      step({ special: true, moveY: -1 }); const landing = snapshot();
      await window.__captureRecoveryThunder(`quick-${facing}-landing`);
      const lock = [];
      for (let i = 1; i < 24; i++) { step({ special: i < 23, moveY: -1 }); lock.push(snapshot()); }
      step({ special: true, moveY: -1 }); const free = snapshot();
      quick.push({ facing, trace, touchdown, landing, lock, free });
    }
    const actualHit = scene.p2.applyHitDetailed.bind(scene.p2);
    let hits = [];
    scene.p2.applyHitDetailed = hit => { const result = actualHit(hit); hits.push({ hit, result }); return result; };
    for (const phase of ['early', 'late']) for (const facing of [1, -1]) {
      reset(facing); hits = []; step({ special: true, moveY: 1 });
      for (let i = 0; i < 20; i++) {
        const cloud = scene.p1.getPikachuSpecialVisuals().find(v => v.kind === 'cloud');
        if (cloud?.age === 10) break;
        step();
      }
      const cloud = scene.p1.getPikachuSpecialVisuals().find(v => v.kind === 'cloud');
      if (!cloud || cloud.age !== 10) throw new Error('Missed pre-bolt receiver fixture');
      scene.p2.resetForRound(cloud.x, cloud.y + (phase === 'early' ? 30 : 170));
      const fixture = { cloud, receiver: scene.p2.getPosition() }, trace = [];
      await window.__captureRecoveryThunder(`thunder-${phase}-${facing}-before`);
      for (let i = 0; i < 20 && !hits.some(h => h.result.outcome === 'landed'); i++) { step(); trace.push(snapshot()); }
      const contact = snapshot();
      await window.__captureRecoveryThunder(`thunder-${phase}-${facing}-contact`);
      const contactHits = structuredClone(hits);
      for (let i = 0; i < 30 && (scene.p2.getHitlagRemaining() > 0 || i === 0); i++) step();
      const launch = snapshot();
      thunder.push({ phase, facing, fixture, trace, contact, hits: contactHits, launch });
    }
    return { quick, thunder };
  });
  Object.assign(report, result);
  for (const c of report.quick) {
    assert.ok(c.touchdown, 'Quick must physically land during aerial END');
    assert.equal(c.touchdown.texture, 'char.pikachu.up_special_air_end');
    assert.ok(c.touchdown.state.frame - c.touchdown.state.firstBurstEnd >= 33);
    assert.equal(c.touchdown.receiving.length, 12);
    assert.equal(c.landing.state, null);
    assert.equal(c.landing.texture, 'char.pikachu.landing_special');
    assert.equal(c.landing.landing.remainingFrames, 24);
    for (const [i, s] of c.lock.entries()) { assert.equal(s.state, null); assert.equal(s.landing.remainingFrames, 23 - i); }
    assert.equal(c.free.state?.frame, 0);
  }
  for (const c of report.thunder) {
    const hit = c.hits.find(h => h.result.outcome === 'landed').hit;
    assert.ok(Math.abs(hit.damage - (c.phase === 'early' ? 6 : 8) * STALE_FRESH_MULTIPLIER) < 1e-8,
      'Actual production damage includes the shared fresh-move multiplier');
    assert.equal(c.contact.state.branchFrame, null);
    assert.ok(c.trace.some(s => s.objects.some(o => o.kind === 'bolt' && (c.phase === 'early' ? o.age < 3 : o.age >= 3))));
    if (c.phase === 'early') {
      assert.equal(hit.knockback.reference.fixed, 125);
      assert.equal(c.contact.hitlag, 0); assert.equal(c.contact.ownerHitlag, 0);
      assert.ok(c.launch.velocity.y > 0);
    } else assert.ok(c.launch.velocity.y < 0);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedResponses, []);
  report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, quick: report.quick.length, thunder: report.thunder.length, bundle: report.bundle }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.message; throw error; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2)); await browser.close(); }
