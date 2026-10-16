import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/special-timing';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual MatchScene source Quick Attack air termination/special-fall/floor recovery and Skull Bash held charge/release-before-contact. Deterministic values use real InputResolver. Missing special body clips remain unqualified.' };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4213/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.result = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 820,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0,
      y: player === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume();
      scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(body => body !== floor);
    const columns = [];
    for (let x = floor.bounds.min.x + 200; x < floor.bounds.max.x - 300; x += 20)
      if (overhead.every(body => x + 25 < body.bounds.min.x || x - 25 > body.bounds.max.x)) columns.push(x);
    if (!columns.length) throw new Error('Quick fixture needs a clear floor landing column');
    const originX = columns[0];
    const reset = height => {
      scene.p1.resetForRound(originX, floor.bounds.min.y - height);
      scene.p2.resetForRound(floor.bounds.max.x - 50, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let i = 0; i < 12; i++) step();
    };
    const quick = [];
    for (const second of [false, true]) {
      reset(450); step({ moveY: -1, special: true });
      if (scene.p1.getPikachuSpecialState()?.kind !== 'quickAttack') throw new Error('Quick Attack did not start');
      const trace = []; let ended = null;
      for (let frame = 1; frame <= 90; frame++) {
        step(second && frame >= 27 && frame <= 32 ? { moveX: 0.8, moveY: -0.6 } : { moveY: -1 });
        const state = scene.p1.getPikachuSpecialState();
        trace.push({ frame, state, grounded: scene.p1.isGrounded(), position: scene.p1.getPosition(), velocity: scene.p1.getVelocity() });
        if (!state) { ended = { frame, helpless: scene.p1.isHelpless(), grounded: scene.p1.isGrounded() }; break; }
      }
      let landing = null;
      if (!second && ended) for (let frame = 1; frame < 180; frame++) {
        step();
        if (scene.p1.isGrounded()) {
          const contactPosition = scene.p1.getPosition();
          // Matter establishes grounded after this step's character input.
          // The next fixed input installs the landing state at its frame0.
          step();
          landing = { stepsAfterEnding: frame, contactPosition,
          remaining: scene.p1.getAnimationActionState().landingRecoveryRemaining,
          helpless: scene.p1.isHelpless(), position: scene.p1.getPosition(), floorTop: floor.bounds.min.y }; break; }
      }
      quick.push({ second, ended, landing, trace });
    }
    reset(25); scene.p1.setFacing(1); step({ moveX: 0.5, special: true });
    for (let frame = 0; frame < 60 && (scene.p1.getPikachuSpecialState()?.charge ?? 0) < 20; frame++)
      step({ moveX: 0.5, special: true });
    const held = scene.p1.getPikachuSpecialState(); const skull = [];
    for (let frame = 1; frame <= 12; frame++) {
      step(); const active = scene.p1.getActiveAttack();
      skull.push({ frame, state: scene.p1.getPikachuSpecialState(), local: active?.framesElapsed,
        contact: !!active?.hitboxBody, velocity: scene.p1.getVelocity(), position: scene.p1.getPosition() });
    }
    return { quick, skull: { held, release: skull } };
  });
  for (const row of report.result.quick) {
    assert.equal(row.ended?.frame, row.second ? 83 : 69);
    assert.equal(row.ended?.helpless, true); assert.equal(row.ended?.grounded, false);
    if (!row.second) {
      assert.equal(row.landing?.remaining, 24, 'actual floor installs source24 landing recovery');
      assert.equal(row.landing?.helpless, false);
      assert.ok(Math.abs(row.landing.position.y + 25 - row.landing.floorTop) < 1);
    }
  }
  assert.equal(report.result.skull.held?.charge, 20);
  const releasedMotion = report.result.skull.release.filter(frame => frame.local >= 13 && frame.local < 17);
  assert.equal(releasedMotion.length, 4);
  assert.ok(releasedMotion.every(frame => frame.velocity.x > 0 && !frame.contact), 'source Skull release moves for four windup steps before contact17');
  assert.ok(report.result.skull.release.some(frame => frame.local === 17 && frame.contact));
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ quickBranches: report.result.quick.length, skullWindupSteps: releasedMotion.length, errors: report.errors }));
} finally {
  await writeFile(`${output}/special-timing-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
