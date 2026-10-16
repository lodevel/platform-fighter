import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

// Run against the production preview; never infer its bundle from a local dist listing.
const OUT_DIR = process.env.PF_PROBE_OUT ?? 'docs/review/2026-10-02/donkeykong-recovery/browser';
const URL = process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
await mkdir(OUT_DIR, { recursive: true });

const report = {
  url: URL,
  engineVersion: null,
  bundleName: null,
  bundleUrl: null,
  bundleSha256: null,
  pageErrors: [],
  fatalError: null,
  notes: [
    'Trajectory bounds validate the project recovery calibration, not an exact measured Ultimate trajectory.',
    'Physics scenarios use deterministic resolver overrides in the real MatchScene; keyboard scenarios use Playwright keyboard events and the ordinary resolver.',
    'Human controller feel and visual parity with Ultimate are not established by these checks.',
  ],
  scenarios: {},
  summary: { passed: 0, failed: 0, total: 0 },
};

function record(key, data) {
  Object.assign((report.scenarios[key] ??= { checks: [] }), data);
}

function check(key, label, actual, fn) {
  const scenario = (report.scenarios[key] ??= { checks: [] });
  try {
    fn();
    scenario.checks.push({ label, pass: true, actual });
  } catch (error) {
    scenario.checks.push({ label, pass: false, actual, error: error.message });
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const scriptResponses = new Map();
const responseReads = [];
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('response', (response) => {
  if (response.request().resourceType() !== 'script') return;
  responseReads.push((async () => {
    try {
      const body = await response.body();
      scriptResponses.set(response.url(), {
        status: response.status(),
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    } catch (error) {
      scriptResponses.set(response.url(), { error: error.message });
    }
  })());
});

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  const scriptUrls = await page.locator('script[src]').evaluateAll((scripts) => scripts.map((script) => script.src));
  await Promise.all(responseReads);
  const bundleUrl = scriptUrls.find((url) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(url));
  report.bundleUrl = bundleUrl ?? null;
  report.bundleName = bundleUrl ? basename(new globalThis.URL(bundleUrl).pathname) : null;
  report.bundleSha256 = bundleUrl ? scriptResponses.get(bundleUrl)?.sha256 ?? null : null;
  record('build', { scripts: scriptUrls, responses: Object.fromEntries(scriptResponses) });
  check('build', 'production main bundle was fetched successfully', report.bundleUrl, () => {
    assert.ok(bundleUrl, 'No production index bundle in the page');
    assert.equal(scriptResponses.get(bundleUrl)?.status, 200);
    assert.ok(report.bundleSha256);
  });

  const setup = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', {
      matchConfig: {
        mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 819, itemFrequency: 'off',
        players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2' },
        ],
      },
    });
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause();
    const floor = s.baseStage.bodies.platformBodies.find((body) => body.label === 'platform.solid');
    if (!floor) throw new Error('Flat stage has no solid floor');
    const start = { x: floor.position.x, y: floor.bounds.min.y - s.p1.getTuning().height / 2 };
    const park = { x: floor.bounds.max.x - 55, y: floor.bounds.min.y - s.p2.getTuning().height / 2 };
    const input = { 1: {}, 2: {} };
    const original = {
      getMoveVector: s.inputResolver.getMoveVector.bind(s.inputResolver),
      isActionHeld: s.inputResolver.isActionHeld.bind(s.inputResolver),
    };
    const extract = (fighter) => {
      const active = fighter.getActiveAttack();
      return {
        ...fighter.getPosition(),
        vx: fighter.getVelocity().x, vy: fighter.getVelocity().y,
        grounded: fighter.isGrounded(), helpless: fighter.isHelpless(), facing: fighter.getFacing(),
        damage: fighter.getDamagePercent(),
        landingRecoveryRemaining: fighter.getAnimationActionState().landingRecoveryRemaining,
        active: active ? {
          id: active.move.id, framesElapsed: active.framesElapsed,
          sheetVariant: active.move.sheetVariant ?? null,
          sustainedRise: active.move.multiHitRising?.sustainedRise ?? null,
        } : null,
      };
    };
    const read = () => ({ frame: s.physicsEngine.getFrame(), p1: extract(s.p1), p2: extract(s.p2) });
    const tick = () => {
      s.physicsEngine.resume();
      s.update(0, s.physicsEngine.fixedTimestepMs);
      s.physicsEngine.pause();
      return read();
    };
    const injectedInput = () => {
      s.inputResolver.getMoveVector = (player) => ({ x: input[player]?.moveX ?? 0, y: input[player]?.moveY ?? 0 });
      s.inputResolver.isActionHeld = (player, action) => input[player]?.[action] === true;
    };
    window.__dkRecovery = {
      s, start, park, input, read, tick,
      injectedInput,
      keyboardInput() {
        s.inputResolver.getMoveVector = original.getMoveVector;
        s.inputResolver.isActionHeld = original.isActionHeld;
      },
      step(next1 = {}, next2 = {}) { input[1] = next1; input[2] = next2; return tick(); },
      reset(x = start.x, y = start.y, facing = 1, vx = 0, vy = 0) {
        s.p1.resetForRound(x, y);
        s.p1.setFacing(facing);
        s.p1.setDamagePercent(0);
        s.matter.body.setVelocity(s.p1.body, { x: vx, y: vy });
        s.p2.resetForRound(park.x, park.y);
        s.p2.setFacing(-1);
        return read();
      },
      land() {
        s.matter.body.setPosition(s.p1.body, { x: start.x, y: start.y - 45 });
        s.matter.body.setVelocity(s.p1.body, { x: 0, y: 5 });
        return read();
      },
    };
    injectedInput();
    window.__dkRecovery.reset();
    return { start, park, engineVersion: s.getMatchStartMetadata()?.engineVersion ?? null, tuning: s.p1.getTuning() };
  });
  report.engineVersion = setup.engineVersion;
  record('build', { setup });
  check('build', 'match reports an engine version', report.engineVersion, () => assert.ok(report.engineVersion));

  const step = (input = {}) => page.evaluate((next) => window.__dkRecovery.step(next), input);
  const read = () => page.evaluate(() => window.__dkRecovery.read());
  const reset = (options = {}) => page.evaluate(({ x, y, facing, vx, vy }) => window.__dkRecovery.reset(x, y, facing, vx, vy), options);
  const keyboardTick = () => page.evaluate(() => window.__dkRecovery.tick());
  const screenshot = (name) => page.screenshot({ path: join(OUT_DIR, name) });
  const UP = { moveY: -1, special: true };

  async function settle() {
    await reset();
    let state;
    for (let frame = 0; frame < 12; frame++) state = await step();
    assert.ok(state.p1.grounded, `DK not grounded after settle: ${JSON.stringify(state.p1)}`);
    return state;
  }

  {
    const key = 'aerialLift';
    const before = await reset({ y: setup.start.y - 260, vy: 8.15 });
    const timeline = [];
    let state = await step(UP);
    timeline.push({ gameFrame: 1, ...state.p1 });
    check(key, 'up special starts while falling', state.p1.active?.id, () => assert.equal(state.p1.active?.id, 'donkeykong.up_special'));
    check(key, 'activation reverses terminal downward speed', { before: before.p1.vy, after: state.p1.vy }, () => assert.ok(state.p1.vy < 0));
    await screenshot('dk-recovery-frame-01.png');
    for (let frame = 2; frame <= 43; frame++) {
      state = await step();
      timeline.push({ gameFrame: frame, ...state.p1 });
    }
    const at43 = state.p1;
    const rise = before.p1.y - at43.y;
    check(key, 'game43 rise is 150–190 pixels', rise, () => assert.ok(rise > 150 && rise < 190, `rise=${rise}`));
    check(key, 'game43 still rises faster than 3 pixels per step', at43.vy, () => assert.ok(at43.vy < -3));
    check(key, 'aerial data declares the sustained-rise phase', at43.active?.sustainedRise, () => assert.ok(at43.active?.sustainedRise));
    await screenshot('dk-recovery-frame-43.png');
    state = await step();
    timeline.push({ gameFrame: 44, ...state.p1 });
    const delta = state.p1.vy - at43.vy;
    check(key, 'ordinary gravity resumes on game44', delta, () => assert.ok(delta > 0.4, `vertical delta=${delta}`));
    record(key, { before: before.p1, riseAt43: rise, gravityRestorationDelta: delta, timeline });
  }

  for (const facing of [1, -1]) {
    const key = `steeringFacing${facing}`;
    const before = await reset({ y: setup.start.y - 260, facing, vx: -3, vy: 4 });
    let state = await step(UP);
    const activated = state.p1;
    const timeline = [{ gameFrame: 1, ...state.p1 }];
    check(key, 'activation retains leftward entry momentum in either facing', activated.vx, () => {
      assert.ok(activated.vx < -2.7 && activated.vx >= -3.01, `entry vx=${activated.vx}`);
    });
    for (let frame = 2; frame <= 6; frame++) {
      state = await step();
      timeline.push({ gameFrame: frame, ...state.p1 });
    }
    const neutral = state.p1;
    check(key, 'neutral input preserves spin momentum', { activated: activated.vx, neutral: neutral.vx }, () => assert.ok(Math.abs(neutral.vx - activated.vx) < 0.01));
    for (let frame = 7; frame <= 36; frame++) {
      state = await step({ moveX: 1 });
      timeline.push({ gameFrame: frame, ...state.p1 });
    }
    const right = state.p1;
    check(key, 'right input steers toward the 8.5 speed limit', right.vx, () => assert.ok(right.vx > 4 && right.vx <= 8.51));
    for (let frame = 37; frame <= 41; frame++) {
      state = await step({ moveX: -1 });
      timeline.push({ gameFrame: frame, ...state.p1 });
    }
    check(key, 'left input reverses steering acceleration', { before: right.vx, after: state.p1.vx }, () => assert.ok(right.vx - state.p1.vx > 1));
    check(key, 'steering keeps the original move facing', state.p1.facing, () => assert.equal(state.p1.facing, facing));
    record(key, { before: before.p1, activated, neutral, right, timeline });
  }

  {
    const key = 'finiteRecovery';
    await reset({ y: setup.start.y - 260 });
    let state = await step(UP);
    const timeline = [{ gameFrame: 1, ...state.p1 }];
    let frame = 1;
    while (state.p1.active !== null && frame < 120) {
      state = await step();
      timeline.push({ gameFrame: ++frame, ...state.p1 });
    }
    const ended = state.p1;
    check(key, 'spin finishes before touching ground', ended, () => {
      assert.equal(ended.active, null);
      assert.equal(ended.grounded, false);
      assert.equal(ended.helpless, true);
    });
    check(key, 'finite spin returns to a downward fall', ended.vy, () => assert.ok(ended.vy > 0));
    state = await step(UP);
    const repeat = state.p1;
    check(key, 'a repeated up special is blocked while helpless', repeat, () => {
      assert.equal(repeat.active, null);
      assert.equal(repeat.helpless, true);
    });
    await screenshot('dk-recovery-helpless.png');
    await page.evaluate(() => window.__dkRecovery.land());
    const landing = [];
    let observedLandingLag = false;
    for (let frame = 1; frame <= 100; frame++) {
      state = await step();
      landing.push({ frame, ...state.p1 });
      if (state.p1.landingRecoveryRemaining > 0) observedLandingLag = true;
      // Contact is detected by physics before the next input tick starts
      // landing recovery. A zero on the contact frame is not completion.
      if (observedLandingLag && state.p1.grounded && state.p1.landingRecoveryRemaining === 0) break;
    }
    check(key, 'landing actually enters the authored 38-frame lag', landing.map((sample) => sample.landingRecoveryRemaining), () => {
      assert.equal(observedLandingLag, true);
      assert.equal(Math.max(...landing.map((sample) => sample.landingRecoveryRemaining)), 38);
    });
    check(key, 'landing clears helpless after the landing lag', state.p1, () => {
      assert.equal(state.p1.grounded, true);
      assert.equal(state.p1.helpless, false);
      assert.equal(state.p1.landingRecoveryRemaining, 0);
    });
    state = await step(UP);
    check(key, 'grounded up special is available again', state.p1.active, () => {
      assert.equal(state.p1.active?.id, 'donkeykong.up_special');
      assert.equal(state.p1.active?.sheetVariant, 'ground');
    });
    record(key, { endedGameFrame: frame, ended, repeat, timeline, observedLandingLag, landing, afterLandingUpSpecial: state.p1 });
  }

  // P1 defaults: W is both moveUp and jump, G is special.
  // This restores the real dispatcher/resolver path before sending DOM keyboard events.
  record('keyboardBindings', { source: 'src/types/bindings.ts DEFAULT_KEYBOARD_P1_BINDINGS', upAndJumpKey: 'W (87)', specialKey: 'G (71)' });
  await page.focus('canvas');
  for (const delay of [0, 1, 2]) {
    const key = `groundKeyboardDelay${delay}`;
    await page.keyboard.up('w');
    await page.keyboard.up('g');
    await page.evaluate(() => window.__dkRecovery.injectedInput());
    await settle();
    await page.evaluate(() => window.__dkRecovery.keyboardInput());
    await keyboardTick(); // Refresh the resolver's released-key baseline.
    await page.keyboard.down('w');
    const leadIn = [];
    for (let frame = 1; frame <= delay; frame++) leadIn.push({ frame, ...(await keyboardTick()).p1 });
    await page.keyboard.down('g');
    let state = await keyboardTick();
    const started = state.p1;
    const resolved = await page.evaluate(() => ({
      move: window.__dkRecovery.s.inputResolver.getMoveVector(1),
      jump: window.__dkRecovery.s.inputResolver.isActionHeld(1, 'jump'),
      special: window.__dkRecovery.s.inputResolver.isActionHeld(1, 'special'),
    }));
    check(key, 'real W+G events resolve to up, jump and special', resolved, () => {
      assert.equal(resolved.move.y, -1);
      assert.equal(resolved.jump, true);
      assert.equal(resolved.special, true);
    });
    check(key, 'W+G starts the grounded Spinning Kong variant', started.active, () => {
      assert.equal(started.active?.id, 'donkeykong.up_special');
      assert.equal(started.active?.sheetVariant, 'ground');
    });
    await page.keyboard.up('g');
    const timeline = [{ gameFrame: 1, ...started }];
    for (let frame = 2; frame <= 26; frame++) {
      state = await keyboardTick();
      timeline.push({ gameFrame: frame, ...state.p1 });
    }
    check(key, 'held W does not trigger an unintended jump after starting the ground spin', timeline, () => {
      assert.ok(timeline.every((sample) => sample.grounded && Math.abs(sample.vy) < 0.01), 'DK left the floor during the ground spin');
    });
    if (delay === 2) await screenshot('dk-recovery-ground-keyboard-delay-2.png');
    record(key, { delayFrames: delay, leadIn, resolved, timeline });
    await page.keyboard.up('w');
    await keyboardTick();
  }

  check('runtime', 'browser raises no page errors', report.pageErrors, () => assert.deepEqual(report.pageErrors, []));
} catch (error) {
  report.fatalError = { message: error.message, stack: error.stack };
} finally {
  const checks = Object.values(report.scenarios).flatMap((scenario) => scenario.checks ?? []);
  report.summary = {
    passed: checks.filter((result) => result.pass).length,
    failed: checks.filter((result) => !result.pass).length,
    total: checks.length,
  };
  await writeFile(join(OUT_DIR, 'dk-recovery-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify({ ...report.summary, engineVersion: report.engineVersion, bundleName: report.bundleName, fatalError: report.fatalError }, null, 2));
  if (report.summary.failed > 0 || report.fatalError !== null) process.exitCode = 1;
}
