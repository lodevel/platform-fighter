// Browser acceptance for the dedicated Smash input (keyboard V / gamepad right stick).
//
// P1 (Donkey Kong, keyboard_p1) is driven by REAL keyboard events
// (page.keyboard.down/up) through Phaser's keyboard plugin. P2 (Wolf) owns
// a SIMULATED standard-mapping gamepad: navigator.getGamepads is replaced by
// an init script that returns one pad whose axes/buttons the probe sets
// before each fixed step. The simulation is stepped deterministically
// (physics paused, one s.update(0, fixed) per step), as in dk-kit-acceptance.
//
// Scenarios: 1-5 keyboard smash / charge / dash attack; 6 simulated-pad
// right stick; 7 Controls panels (P1 keyboard + pad); 8 keyboard up smash
// out of W's jumpsquat (and up air after takeoff); 9 shield + W + V is the
// out-of-shield up smash, not a dodge; 10 dodge key + V is the smash, not a
// dodge; 11 P2 keyboard layout (Numpad 0 smash) in a keyboard-vs-keyboard
// match; 12 the arrows-preset Controls panel shows 'Numpad 0'.
//
// Usage: npm run build && npm run preview, then
//   node tools/smash-input-acceptance.mjs
// Env: PF_REWORK_URL (default preview URL), PF_PROBE_OUT (evidence folder).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT_DIR = process.env.PF_PROBE_OUT ?? '/mnt/c/Workspace/platform-fighter/docs/review/2026-09-28/smash-input';
const URL = process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
await mkdir(OUT_DIR, { recursive: true });

const report = {
  url: URL,
  bundleName: null,
  engineVersion: null,
  inputs: {
    p1: 'Real keyboard events (Playwright page.keyboard.down/up) routed through Phaser keyboard -> DeviceInputDispatcher -> InputResolver.',
    p2: 'SIMULATED gamepad: navigator.getGamepads overridden by an init script with one standard-mapping pad (4 axes, 17 buttons); axes/buttons set by the probe before each fixed step.',
    p2Keyboard: 'Scenario 11 (separate match, P2 keyboard_p2): arrow keys are real Playwright keyboard events; Numpad 0 / Numpad 6 are trusted browser key events sent through CDP Input.dispatchKeyEvent with NumLock-on codes (keyCode 96 / 102, isKeypad so DOM location is 3), because Playwright\'s named Numpad keys model NumLock off (Numpad0 = Insert, keyCode 45).',
  },
  gameSize: null,
  pageErrors: [],
  scenarios: {},
};

/** Run an assertion; record it with the measured value either way. */
function check(key, label, actual, fn) {
  const bucket = (report.scenarios[key] ??= { checks: [] });
  try {
    fn();
    bucket.checks.push({ label, pass: true, actual });
    return true;
  } catch (error) {
    bucket.checks.push({ label, pass: false, actual, error: error.message });
    return false;
  }
}

function record(key, data) {
  const bucket = (report.scenarios[key] ??= { checks: [] });
  Object.assign(bucket, data);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/** Fresh page with the simulated pad installed before any game code runs. */
async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(() => {
    window.__probePads = [{
      id: 'Simulated Standard Gamepad (smash-input probe)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 1,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
    }];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__probePads });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  const bundle = await page.evaluate(() =>
    [...document.scripts].map((s) => s.src).find((src) => /\/index-[^/]+\.js/.test(src))?.split('/').pop() ?? null);
  report.bundleName ??= bundle;
  return { context, page };
}

/** Wait for `count` real game-loop ticks (Phaser processes queued key events per tick). */
async function loopTicks(page, count = 2) {
  const frame = await page.evaluate(() => window.__game.loop.frame);
  await page.waitForFunction(({ frame, count }) => window.__game.loop.frame >= frame + count, { frame, count }, { timeout: 10000 });
}

async function setPad(page, { axes, buttons } = {}) {
  await page.evaluate(({ axes, buttons }) => {
    const pad = window.__probePads[0];
    // Phaser's gamepad plugin ignores samples stamped before the pad object was created.
    pad.timestamp = performance.now();
    if (axes) pad.axes = axes.slice();
    if (buttons) {
      for (const [index, value] of Object.entries(buttons)) {
        pad.buttons[Number(index)] = { pressed: value > 0.5, touched: value > 0, value };
      }
    }
  }, { axes, buttons });
}

try {
  // =====================================================================
  // Match page: DK (keyboard_p1) vs Wolf (gamepad 0), flat stage.
  // =====================================================================
  // `page` is reassigned when scenario 11 opens its own match page; every
  // helper below reads it at call time.
  let { context: matchContext, page } = await openPage();
  /** Start a MatchScene on `page` and install the window.__pf step/read helpers. */
  const startMatch = (players, rngSeed) => page.evaluate(({ players, rngSeed }) => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', {
      matchConfig: {
        mode: 'stocks',
        stockCount: 5,
        stageId: 'flat',
        rngSeed,
        itemFrequency: 'off',
        players,
      },
    });
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause();

    const floor = s.baseStage.bodies.platformBodies.find((b) => b.label === 'platform.solid');
    const standY = (f) => floor.bounds.min.y - f.getTuning().height / 2;

    const extract = (f) => {
      const pos = f.getPosition();
      const vel = f.getVelocity();
      const active = f.getActiveAttack();
      const charge = f.chargingSmash;
      return {
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        grounded: f.isGrounded(),
        facing: f.getFacing(),
        fastFallLatched: f.fastFallLatched === true,
        shielding: (() => { try { return f.isShielding(); } catch { return null; } })(),
        dodge: (() => { try { return f.getDodgeState().name; } catch { return null; } })(),
        locomotion: (() => { try { return f.getLocomotionState(); } catch { return null; } })(),
        active: active
          ? { id: active.move.id, facing: active.facing, framesElapsed: active.framesElapsed, chargeHeldFrames: active.chargeHeldFrames ?? null }
          : null,
        charging: charge
          ? { id: charge.moveId, facing: charge.facing, framesHeld: charge.framesHeld, startupElapsed: charge.startupElapsed ?? null, holdFrame: charge.holdFrame ?? null }
          : null,
      };
    };
    const captured = () => {
      const last = s.inputCaptureBuffer.getLastFrame();
      const frame = last === null ? null : s.inputCaptureBuffer.getFrame(last);
      if (!frame) return null;
      const pick = (i) => {
        const input = frame.inputs[i];
        return input ? {
          moveX: input.moveX, moveY: input.moveY, attack: input.attack, attackHeavy: input.attackHeavy,
          attackStickX: input.attackStickX, attackStickY: input.attackStickY, jump: input.jump,
          shield: input.shield, dodge: input.dodge,
        } : null;
      };
      return { frame: frame.frame, p1: pick(0), p2: pick(1) };
    };
    const read = () => ({ p1: extract(s.p1), p2: extract(s.p2), input: captured() });

    window.__pf = {
      s,
      read,
      step() {
        s.physicsEngine.resume();
        s.update(0, s.physicsEngine.fixedTimestepMs);
        s.physicsEngine.pause();
        return read();
      },
      place(which, x, facing) {
        const f = which === 1 ? s.p1 : s.p2;
        f.resetForRound(x, standY(f));
        f.setFacing(facing);
        f.setDamagePercent(0);
      },
      floor: { minX: floor.bounds.min.x, maxX: floor.bounds.max.x, centerX: floor.position.x },
      held(slot) {
        return s.inputDispatcher.sampleActions(slot);
      },
    };

    const meta = s.getMatchStartMetadata();
    const participants = s.matchParticipants.map((p) => ({
      slot: p.slot.index,
      device: p.slot.inputDevice,
      bindingProfileId: p.slot.bindingProfileId ?? null,
      smashBindings: p.bindings?.bindings.smash ?? null,
    }));
    return {
      engineVersion: meta?.engineVersion ?? null,
      gameSize: { width: game.scale.gameSize.width, height: game.scale.gameSize.height },
      floor: window.__pf.floor,
      participants,
      p2Tuning: { maxFallSpeed: s.p2.getTuning().maxFallSpeed, fastFallSpeed: s.p2.getTuning().fastFallSpeed },
    };
  }, { players, rngSeed });
  const setup = await startMatch([
    { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 0 } },
  ], 2809);
  report.engineVersion = setup.engineVersion;
  report.gameSize = setup.gameSize;
  record('setup', { participants: setup.participants, floor: setup.floor, p2Tuning: setup.p2Tuning });
  check('setup', 'P1 keyboard_p1 Smash binding is V (keyCode 86)', setup.participants[0].smashBindings, () =>
    assert.ok(setup.participants[0].smashBindings?.some((b) => b.kind === 'keyboard' && b.keyCode === 86)));
  check('setup', 'P2 gamepad Smash bindings are the four right-stick half-axes on pad 0', setup.participants[1].smashBindings, () => {
    const axes = (setup.participants[1].smashBindings ?? [])
      .filter((b) => b.kind === 'gamepad' && b.gamepadIndex === 0 && b.source.type === 'axis')
      .map((b) => `${b.source.axisIndex}:${b.source.direction}`).sort();
    assert.deepEqual(axes, ['2:-1', '2:1', '3:-1', '3:1']);
  });
  check('setup', 'default game size kept (1920x1080)', setup.gameSize, () =>
    assert.deepEqual(setup.gameSize, { width: 1920, height: 1080 }));

  const step = () => page.evaluate(() => window.__pf.step());
  const read = () => page.evaluate(() => window.__pf.read());
  const place = (which, x, facing) => page.evaluate(({ which, x, facing }) => window.__pf.place(which, x, facing), { which, x, facing });
  let floor = setup.floor;
  let centerX = floor.centerX;
  let leftParkX = floor.minX + 60;
  let rightParkX = floor.maxX - 60;

  /** Press a real key and wait until the dispatcher sees the action held. */
  async function keyDown(key, action, slot = 1) {
    await page.keyboard.down(key);
    await page.waitForFunction(({ action, slot }) => window.__pf.held(slot)[action] === true, { action, slot }, { timeout: 5000 });
  }
  async function keyUp(key, action, slot = 1) {
    await page.keyboard.up(key);
    await page.waitForFunction(({ action, slot }) => window.__pf.held(slot)[action] === false, { action, slot }, { timeout: 5000 });
  }
  /**
   * Press several real keys between two fixed steps (so the next step
   * samples them all on one frame) and wait until every action reads held.
   */
  async function keysDown(pairs, slot = 1) {
    for (const [key] of pairs) await page.keyboard.down(key);
    const actions = pairs.map(([, action]) => action);
    await page.waitForFunction(({ actions, slot }) => actions.every((a) => window.__pf.held(slot)[a] === true), { actions, slot }, { timeout: 5000 });
  }
  async function keysUp(pairs, slot = 1) {
    for (const [key] of pairs) await page.keyboard.up(key);
    const actions = pairs.map(([, action]) => action);
    await page.waitForFunction(({ actions, slot }) => actions.every((a) => window.__pf.held(slot)[a] === false), { actions, slot }, { timeout: 5000 });
  }

  /** Let any running move finish, then reset both fighters to known positions. */
  async function settle({ p1x = centerX, p1Facing = 1, p2x = rightParkX, p2Facing = -1 } = {}) {
    await setPad(page, { axes: [0, 0, 0, 0], buttons: { 0: 0, 1: 0, 2: 0, 3: 0 } });
    await loopTicks(page, 2);
    for (let i = 0; i < 150; i++) {
      const st = await read();
      if (!st.p1.active && !st.p1.charging && !st.p2.active && !st.p2.charging) break;
      await step();
    }
    await place(1, p1x, p1Facing);
    await place(2, p2x, p2Facing);
    let last;
    for (let i = 0; i < 12; i++) last = await step();
    if (!last.p1.grounded || !last.p2.grounded) throw new Error(`fighters not grounded after settle: ${JSON.stringify(last)}`);
    return last;
  }

  /** Step until `pred(state)` holds (max frames); returns { state, frames } or null. */
  async function stepUntil(pred, max) {
    for (let i = 1; i <= max; i++) {
      const st = await step();
      if (pred(st)) return { state: st, frames: i };
    }
    return null;
  }

  // Keyboard smash: press V, step until the charge (or instant move) starts,
  // release V, step until the move is active. Returns the measurements.
  async function keyboardSmash(extraHoldFrames = 1) {
    await keyDown('v', 'smash');
    const started = await stepUntil((st) => st.p1.charging || st.p1.active, 4);
    const pressInput = started?.state.input?.p1 ?? null;
    for (let i = 0; i < extraHoldFrames; i++) await step();
    await keyUp('v', 'smash');
    const fired = (await stepUntil((st) => st.p1.active !== null, 30))?.state ?? null;
    return { started: started?.state.p1 ?? null, startFrames: started?.frames ?? null, pressInput, fired: fired?.p1 ?? null };
  }

  // ---------------------------------------------------------------------
  // Scenario 1: hold D 6 frames, tap V -> forward smash facing right.
  // ---------------------------------------------------------------------
  {
    await settle();
    await keyDown('d', 'right');
    let st;
    for (let i = 0; i < 6; i++) st = await step();
    const beforeSmash = st.p1;
    const result = await keyboardSmash(1);
    await keyUp('d', 'right');
    record('s1_dRight_vForwardSmash', { beforeSmash, ...result });
    const startedId = result.started?.charging?.id ?? result.started?.active?.id ?? null;
    check('s1_dRight_vForwardSmash', 'V press starts donkeykong.smash', startedId, () => assert.equal(startedId, 'donkeykong.smash'));
    check('s1_dRight_vForwardSmash', 'fired move is donkeykong.smash', result.fired?.active?.id, () => assert.equal(result.fired?.active?.id, 'donkeykong.smash'));
    check('s1_dRight_vForwardSmash', 'smash faces right (+1)', { attackFacing: result.fired?.active?.facing, facing: result.fired?.facing }, () => {
      assert.equal(result.fired?.active?.facing, 1);
      assert.equal(result.fired?.facing, 1);
    });
    check('s1_dRight_vForwardSmash', 'captured input on the press frame: attackHeavy held, no stick direction', result.pressInput, () => {
      assert.equal(result.pressInput?.attackHeavy, true);
      assert.equal(result.pressInput?.attackStickX, 0);
      assert.equal(result.pressInput?.attackStickY, 0);
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 2: hold A (facing right at start), then V -> forward smash left.
  // ---------------------------------------------------------------------
  {
    await settle({ p1Facing: 1 });
    await keyDown('a', 'left');
    let st;
    for (let i = 0; i < 6; i++) st = await step();
    const beforeSmash = st.p1;
    const result = await keyboardSmash(1);
    await keyUp('a', 'left');
    record('s2_aLeft_vForwardSmashLeft', { initialFacing: 1, beforeSmash, ...result });
    const startedId = result.started?.charging?.id ?? result.started?.active?.id ?? null;
    check('s2_aLeft_vForwardSmashLeft', 'V press starts donkeykong.smash', startedId, () => assert.equal(startedId, 'donkeykong.smash'));
    check('s2_aLeft_vForwardSmashLeft', 'fired move is donkeykong.smash', result.fired?.active?.id, () => assert.equal(result.fired?.active?.id, 'donkeykong.smash'));
    check('s2_aLeft_vForwardSmashLeft', 'smash faces left (-1)', { attackFacing: result.fired?.active?.facing, facing: result.fired?.facing }, () => {
      assert.equal(result.fired?.active?.facing, -1);
      assert.equal(result.fired?.facing, -1);
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 3: hold S, then V -> down smash.
  // ---------------------------------------------------------------------
  {
    await settle();
    await keyDown('s', 'down');
    let st;
    for (let i = 0; i < 6; i++) st = await step();
    const beforeSmash = st.p1;
    const result = await keyboardSmash(1);
    await keyUp('s', 'down');
    record('s3_sDown_vDownSmash', { beforeSmash, ...result });
    const startedId = result.started?.charging?.id ?? result.started?.active?.id ?? null;
    check('s3_sDown_vDownSmash', 'V press starts donkeykong.dsmash', startedId, () => assert.equal(startedId, 'donkeykong.dsmash'));
    check('s3_sDown_vDownSmash', 'fired move is donkeykong.dsmash', result.fired?.active?.id, () => assert.equal(result.fired?.active?.id, 'donkeykong.dsmash'));
  }

  // ---------------------------------------------------------------------
  // Scenario 4: hold V 40 frames -> the charge grows; release fires it.
  // ---------------------------------------------------------------------
  {
    const HOLD = 40;
    await settle();
    await keyDown('v', 'smash');
    const series = [];
    for (let i = 0; i < HOLD; i++) {
      const st = await step();
      series.push({
        frame: i + 1,
        charging: st.p1.charging,
        active: st.p1.active?.id ?? null,
        attackHeavy: st.input?.p1?.attackHeavy ?? null,
      });
    }
    await keyUp('v', 'smash');
    const fired = (await stepUntil((st) => st.p1.active !== null, 5))?.state.p1 ?? null;
    const heldSeries = series.map((f) => f.charging?.framesHeld ?? null);
    const startupSeries = series.map((f) => f.charging?.startupElapsed ?? null);
    const lastCharge = series[series.length - 1]?.charging ?? null;
    record('s4_holdVCharges', { holdFrames: HOLD, framesHeldSeries: heldSeries, startupElapsedSeries: startupSeries, attackHeavySeries: series.map((f) => f.attackHeavy), lastCharge, fired });
    check('s4_holdVCharges', 'still charging donkeykong.smash after the hold (no early fire)', lastCharge, () => {
      assert.equal(lastCharge?.id, 'donkeykong.smash');
      assert.ok(series.every((f) => f.active === null), 'no move fired while V was held');
    });
    check('s4_holdVCharges', 'attackHeavy captured HELD on every held frame', series.map((f) => f.attackHeavy).filter((v) => v !== true).length, () =>
      assert.ok(series.every((f) => f.attackHeavy === true)));
    const numericHeld = heldSeries.filter((v) => v !== null);
    check('s4_holdVCharges', 'charge frames grow monotonically while held', { first: numericHeld[0], last: numericHeld[numericHeld.length - 1] }, () => {
      for (let i = 1; i < numericHeld.length; i++) assert.ok(numericHeld[i] >= numericHeld[i - 1]);
      assert.ok(numericHeld[numericHeld.length - 1] > numericHeld[0] + 10);
    });
    check('s4_holdVCharges', 'release fires donkeykong.smash with the held charge', { id: fired?.active?.id, chargeHeldFrames: fired?.active?.chargeHeldFrames, lastFramesHeld: lastCharge?.framesHeld }, () => {
      assert.equal(fired?.active?.id, 'donkeykong.smash');
      assert.ok(fired.active.chargeHeldFrames >= lastCharge.framesHeld && fired.active.chargeHeldFrames > 10);
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 5: run (D held 40 frames) + F still gives the dash attack.
  // ---------------------------------------------------------------------
  {
    await settle({ p1x: floor.minX + 150 });
    await keyDown('d', 'right');
    let st;
    for (let i = 0; i < 40; i++) st = await step();
    const beforeAttack = st.p1;
    await keyDown('f', 'attack');
    const started = await stepUntil((s) => s.p1.active !== null, 6);
    await keyUp('f', 'attack');
    await keyUp('d', 'right');
    record('s5_runPlusFDashAttack', { beforeAttack, started: started?.state.p1 ?? null, startFrames: started?.frames ?? null, pressInput: started?.state.input?.p1 ?? null });
    check('s5_runPlusFDashAttack', 'running + F starts donkeykong.dashAttack', started?.state.p1.active?.id, () =>
      assert.equal(started?.state.p1.active?.id, 'donkeykong.dashAttack'));
    check('s5_runPlusFDashAttack', 'F press is a light attack (attackHeavy false)', started?.state.input?.p1, () => {
      assert.equal(started?.state.input?.p1?.attack, true);
      assert.equal(started?.state.input?.p1?.attackHeavy, false);
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 6: simulated gamepad P2 (Wolf) right stick.
  // ---------------------------------------------------------------------
  const p2Settle = (facing = 1) => settle({ p1x: leftParkX, p1Facing: 1, p2x: centerX + 100, p2Facing: facing });

  /** Push the right stick for `hold` frames, then release; measures the move. */
  async function stickSmash(axes, hold = 12) {
    await setPad(page, { axes });
    const frames = [];
    for (let i = 0; i < hold; i++) {
      const st = await step();
      frames.push({ frame: i + 1, active: st.p2.active, charging: st.p2.charging, facing: st.p2.facing, input: st.input?.p2 ?? null });
    }
    await setPad(page, { axes: [0, 0, 0, 0] });
    const firstActive = frames.find((f) => f.active);
    const pressInput = frames[0]?.input ?? null;
    return {
      firstActiveFrame: firstActive?.frame ?? null,
      move: firstActive?.active ?? null,
      facingAfter: frames[frames.length - 1]?.facing ?? null,
      chargingFrames: frames.filter((f) => f.charging).length,
      pressInput,
      laterAttackHeavy: frames.slice(1).map((f) => f.input?.attackHeavy ?? null),
      moveXY: frames.map((f) => [f.input?.moveX ?? null, f.input?.moveY ?? null]),
    };
  }

  // 6a: right stick right (facing right) -> uncharged forward smash.
  {
    await p2Settle(1);
    const r = await stickSmash([0, 0, 1, 0], 20);
    record('s6a_stickRightForwardSmash', r);
    check('s6a_stickRightForwardSmash', 'fires donkeykong.smash within 2 frames while the stick stays held', { move: r.move?.id, frame: r.firstActiveFrame }, () => {
      assert.equal(r.move?.id, 'donkeykong.smash');
      assert.ok(r.firstActiveFrame <= 2);
    });
    check('s6a_stickRightForwardSmash', 'uncharged (chargeHeldFrames 0) although the stick is held 20 frames', r.move?.chargeHeldFrames, () =>
      assert.equal(r.move?.chargeHeldFrames, 0));
    check('s6a_stickRightForwardSmash', 'faces right (+1)', r.move?.facing, () => assert.equal(r.move?.facing, 1));
    check('s6a_stickRightForwardSmash', 'press frame input: attackHeavy, attackStick (1, 0), left stick (0, 0)', r.pressInput, () => {
      assert.equal(r.pressInput?.attackHeavy, true);
      assert.equal(r.pressInput?.attackStickX, 1);
      assert.equal(r.pressInput?.attackStickY, 0);
      assert.equal(r.pressInput?.moveX, 0);
      assert.equal(r.pressInput?.moveY, 0);
    });
    check('s6a_stickRightForwardSmash', 'attackHeavy only on the rising edge while the stick is held', r.laterAttackHeavy, () =>
      assert.ok(r.laterAttackHeavy.every((v) => v === false)));
  }

  // 6b: right stick left while facing right -> turns and smashes left.
  {
    await p2Settle(1);
    const before = (await read()).p2.facing;
    const r = await stickSmash([0, 0, -1, 0], 12);
    record('s6b_stickLeftTurnaroundSmash', { facingBefore: before, ...r });
    check('s6b_stickLeftTurnaroundSmash', 'fires donkeykong.smash', r.move?.id, () => assert.equal(r.move?.id, 'donkeykong.smash'));
    check('s6b_stickLeftTurnaroundSmash', 'was facing right, smash faces left (-1)', { before, attackFacing: r.move?.facing, facingAfter: r.facingAfter }, () => {
      assert.equal(before, 1);
      assert.equal(r.move?.facing, -1);
      assert.equal(r.facingAfter, -1);
    });
    check('s6b_stickLeftTurnaroundSmash', 'left stick stayed neutral (turn came from the right stick)', r.moveXY, () =>
      assert.ok(r.moveXY.every(([x, y]) => x === 0 && y === 0)));
    check('s6b_stickLeftTurnaroundSmash', 'uncharged (chargeHeldFrames 0)', r.move?.chargeHeldFrames, () => assert.equal(r.move?.chargeHeldFrames, 0));
  }

  // 6c: right stick up / down -> up / down smash.
  for (const [key, axes, expected] of [
    ['s6c_stickUpUpSmash', [0, 0, 0, -1], 'donkeykong.usmash'],
    ['s6d_stickDownDownSmash', [0, 0, 0, 1], 'donkeykong.dsmash'],
  ]) {
    await p2Settle(1);
    const r = await stickSmash(axes, 12);
    record(key, r);
    check(key, `fires ${expected}`, r.move?.id, () => assert.equal(r.move?.id, expected));
    check(key, 'uncharged (chargeHeldFrames 0)', r.move?.chargeHeldFrames, () => assert.equal(r.move?.chargeHeldFrames, 0));
    check(key, 'left stick stayed neutral', r.moveXY, () => assert.ok(r.moveXY.every(([x, y]) => x === 0 && y === 0)));
  }

  // 6e/6f: airborne right stick (while descending) -> aerial, no fast-fall.
  for (const [key, axes, expected] of [
    ['s6e_airStickForwardFair', [0, 0, 1, 0], 'donkeykong.fair'],
    ['s6f_airStickDownDairNoFastFall', [0, 0, 0, 1], 'donkeykong.dair'],
  ]) {
    await p2Settle(1);
    await setPad(page, { buttons: { 0: 1 } });
    for (let i = 0; i < 8; i++) await step();
    await setPad(page, { buttons: { 0: 0 } });
    const descending = await stepUntil((st) => !st.p2.grounded && st.p2.vy > 0.5, 90);
    const atPress = descending?.state.p2 ?? null;
    await setPad(page, { axes });
    const frames = [];
    for (let i = 0; i < 12; i++) {
      const st = await step();
      frames.push({ frame: i + 1, active: st.p2.active, grounded: st.p2.grounded, vy: st.p2.vy, fastFallLatched: st.p2.fastFallLatched, facing: st.p2.facing, input: st.input?.p2 ?? null });
    }
    await setPad(page, { axes: [0, 0, 0, 0] });
    const firstActive = frames.find((f) => f.active);
    const airborneFrames = frames.filter((f) => !f.grounded);
    record(key, {
      atPress,
      firstActiveFrame: firstActive?.frame ?? null,
      move: firstActive?.active ?? null,
      pressInput: frames[0]?.input ?? null,
      series: frames.map((f) => ({ frame: f.frame, grounded: f.grounded, vy: f.vy, fastFallLatched: f.fastFallLatched, active: f.active?.id ?? null })),
      tuning: setup.p2Tuning,
    });
    check(key, 'was airborne and descending when the stick was pushed', atPress && { grounded: atPress.grounded, vy: atPress.vy }, () => {
      assert.equal(atPress?.grounded, false);
      assert.ok(atPress.vy > 0);
    });
    check(key, `fires ${expected} within 2 frames`, { move: firstActive?.active?.id, frame: firstActive?.frame }, () => {
      assert.equal(firstActive?.active?.id, expected);
      assert.ok(firstActive.frame <= 2);
    });
    check(key, 'no fast-fall: latch stays off and vy stays at or under maxFallSpeed', { latched: frames.map((f) => f.fastFallLatched), maxVy: Math.max(...airborneFrames.map((f) => f.vy)), maxFallSpeed: setup.p2Tuning.maxFallSpeed }, () => {
      assert.ok(frames.every((f) => f.fastFallLatched === false));
      assert.ok(airborneFrames.every((f) => f.vy <= setup.p2Tuning.maxFallSpeed + 1e-6));
    });
    check(key, 'facing unchanged by the air stick', frames.map((f) => f.facing), () => assert.ok(frames.every((f) => f.facing === 1)));
    check(key, 'left stick stayed neutral (moveY 0)', frames.map((f) => [f.input?.moveX, f.input?.moveY]), () =>
      assert.ok(frames.every((f) => f.input?.moveX === 0 && f.input?.moveY === 0)));
  }

  // ---------------------------------------------------------------------
  // Keyboard helpers for scenarios 8-10: step a tapped/held move to its
  // end, recording grounded / dodge / move per frame for `which` fighter.
  // ---------------------------------------------------------------------
  const moveId = (f) => f.charging?.id ?? f.active?.id ?? null;
  const frameRow = (i, f, input) => ({
    frame: i, grounded: f.grounded, vy: f.vy, shielding: f.shielding, dodge: f.dodge,
    charging: f.charging?.id ?? null, active: f.active?.id ?? null, input: input ?? null,
  });
  /** Step until `which`'s move has fired and ended (max frames). */
  async function stepMoveToEnd(which, first, max = 90) {
    const pick = (st) => (which === 1 ? st.p1 : st.p2);
    const pickInput = (st) => (which === 1 ? st.input?.p1 : st.input?.p2);
    const series = [frameRow(0, pick(first), pickInput(first))];
    let fired = pick(first).active ? pick(first) : null;
    let ended = false;
    for (let i = 1; i <= max; i++) {
      const st = await step();
      const f = pick(st);
      series.push(frameRow(i, f, pickInput(st)));
      if (f.active && !fired) fired = f;
      if (fired && !f.active && !f.charging) { ended = true; break; }
    }
    return { series, fired, ended };
  }

  // ---------------------------------------------------------------------
  // Scenario 8: keyboard up smash. W is both up and jump for P1, so W held
  // a few frames is already in jumpsquat when V lands.
  // ---------------------------------------------------------------------
  for (const wFrames of [5, 6, 7]) {
    const key = `s8_w${wFrames}ThenVUpSmash`;
    await settle();
    await keyDown('w', 'up');
    const wSeries = [];
    for (let i = 0; i < wFrames; i++) {
      const st = await step();
      wSeries.push({ frame: i + 1, grounded: st.p1.grounded, vy: st.p1.vy, active: st.p1.active?.id ?? null });
    }
    await keyDown('v', 'smash');
    const press = await step(); // V press frame (W still held)
    await keyUp('v', 'smash'); // tap: V held for exactly one fixed step
    const run = await stepMoveToEnd(1, press);
    await keyUp('w', 'up');
    const groundedAll = run.series.every((r) => r.grounded);
    record(key, { wHeldFrames: wFrames, wSeries, pressState: press.p1, pressInput: press.input?.p1 ?? null, fired: run.fired, moveEnded: run.ended, series: run.series.map(({ input, ...rest }) => rest) });
    check(key, `DK still grounded after W held ${wFrames} frames`, wSeries.map((r) => r.grounded), () =>
      assert.ok(wSeries.every((r) => r.grounded)));
    check(key, 'V press frame starts donkeykong.usmash', { id: moveId(press.p1), grounded: press.p1.grounded }, () => {
      assert.equal(moveId(press.p1), 'donkeykong.usmash');
      assert.equal(press.p1.grounded, true);
    });
    check(key, 'press-frame input: attackHeavy held, up (moveY -1), jump held', press.input?.p1, () => {
      assert.equal(press.input?.p1?.attackHeavy, true);
      assert.equal(press.input?.p1?.moveY, -1);
      assert.equal(press.input?.p1?.jump, true);
    });
    check(key, 'tapped V fires donkeykong.usmash', { id: run.fired?.active?.id, chargeHeldFrames: run.fired?.active?.chargeHeldFrames }, () =>
      assert.equal(run.fired?.active?.id, 'donkeykong.usmash'));
    check(key, 'DK grounded on every frame from the V press to the end of the up smash (no jump)', { frames: run.series.length, airborneFrames: run.series.filter((r) => !r.grounded).map((r) => r.frame), minVy: Math.min(...run.series.map((r) => r.vy)), ended: run.ended }, () => {
      assert.ok(run.ended, 'move ended within the window');
      assert.ok(groundedAll);
    });
  }

  // 8b: W held until DK leaves the ground, then V -> up air.
  {
    const key = 's8b_vAfterTakeoffUpAir';
    await settle();
    await keyDown('w', 'up');
    const takeoff = await stepUntil((st) => !st.p1.grounded, 30);
    await keyDown('v', 'smash');
    const press = await step();
    await keyUp('v', 'smash');
    const later = press.p1.active ? null : await stepUntil((st) => st.p1.active !== null, 3);
    await keyUp('w', 'up');
    const fired = press.p1.active ? press.p1 : later?.state.p1 ?? null;
    record(key, { takeoffAfterWFrames: takeoff?.frames ?? null, atTakeoff: takeoff?.state.p1 ?? null, pressState: press.p1, pressInput: press.input?.p1 ?? null, firedAfterPressFrames: press.p1.active ? 1 : later ? later.frames + 1 : null, fired });
    check(key, 'DK left the ground while W was held', { takeoffAfterWFrames: takeoff?.frames ?? null }, () => assert.ok(takeoff !== null));
    check(key, 'V after takeoff fires donkeykong.uair (airborne)', { id: fired?.active?.id, grounded: fired?.grounded, firedAfterPressFrames: press.p1.active ? 1 : later ? later.frames + 1 : null }, () => {
      assert.equal(fired?.active?.id, 'donkeykong.uair');
      assert.equal(fired?.grounded, false);
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 9: shield + W + V -> out-of-shield up smash, no dodge.
  // ---------------------------------------------------------------------
  // 9a: shield up (H held 8 frames), then W + V pressed on the same frame.
  {
    const key = 's9a_shieldThenWPlusVOosUpSmash';
    await settle();
    await keyDown('h', 'shield');
    let st;
    for (let i = 0; i < 8; i++) st = await step();
    const beforePress = st.p1;
    await keysDown([['w', 'up'], ['v', 'smash']]);
    const press = await step(); // H + W + V on this frame
    await keyUp('v', 'smash'); // tap V; H and W stay held through the move
    const run = await stepMoveToEnd(1, press);
    await keysUp([['w', 'up'], ['h', 'shield']]);
    record(key, { beforePress, pressState: press.p1, pressInput: press.input?.p1 ?? null, fired: run.fired, moveEnded: run.ended, series: run.series.map(({ input, ...rest }) => ({ ...rest, inputDodge: input?.dodge ?? null })) });
    check(key, 'shield was up before the press', { shielding: beforePress.shielding }, () => assert.equal(beforePress.shielding, true));
    check(key, 'press-frame input: shield + up + attackHeavy, dodge false', press.input?.p1, () => {
      assert.equal(press.input?.p1?.shield, true);
      assert.equal(press.input?.p1?.moveY, -1);
      assert.equal(press.input?.p1?.attackHeavy, true);
      assert.equal(press.input?.p1?.dodge, false);
    });
    check(key, 'press frame starts donkeykong.usmash', moveId(press.p1), () => assert.equal(moveId(press.p1), 'donkeykong.usmash'));
    check(key, 'fires donkeykong.usmash', run.fired?.active?.id, () => assert.equal(run.fired?.active?.id, 'donkeykong.usmash'));
    check(key, 'no dodge and grounded on every frame from the press to the end of the move', { dodgeStates: [...new Set(run.series.map((r) => r.dodge))], airborneFrames: run.series.filter((r) => !r.grounded).map((r) => r.frame), ended: run.ended }, () => {
      assert.ok(run.ended);
      assert.ok(run.series.every((r) => r.dodge === 'idle'));
      assert.ok(run.series.every((r) => r.grounded));
    });
  }

  // 9b: H, W and V all pressed on one frame from NEUTRAL (shield not up
  // yet), V tapped, H + W kept held — the literal "same frame" reading.
  // A second run taps all three keys for one frame (record only).
  {
    const key = 's9b_hWvSameFrameFromNeutral';
    await settle();
    await keysDown([['h', 'shield'], ['w', 'up'], ['v', 'smash']]);
    const press = await step();
    await keyUp('v', 'smash');
    const run = await stepMoveToEnd(1, press, 60);
    await keysUp([['w', 'up'], ['h', 'shield']]);
    const series = run.series.map(({ input, ...rest }) => ({ ...rest, inputDodge: input?.dodge ?? null, inputShield: input?.shield ?? null }));
    const firstDodgeFrame = series.find((r) => r.dodge !== 'idle')?.frame ?? null;

    await settle();
    await keysDown([['h', 'shield'], ['w', 'up'], ['v', 'smash']]);
    const tapPress = await step();
    await keysUp([['h', 'shield'], ['w', 'up'], ['v', 'smash']]);
    const tapRun = await stepMoveToEnd(1, tapPress, 30);
    const tapSeries = tapRun.series.map(({ input, ...rest }) => ({ ...rest, inputDodge: input?.dodge ?? null }));

    record(key, {
      pressState: press.p1, pressInput: press.input?.p1 ?? null, fired: run.fired, firstDodgeFrame, series,
      tapAllThreeVariant: { pressState: tapPress.p1, pressInput: tapPress.input?.p1 ?? null, fired: tapRun.fired, moves: [...new Set(tapSeries.map((r) => r.charging ?? r.active))], dodgeStates: [...new Set(tapSeries.map((r) => r.dodge))], series: tapSeries.slice(0, 12) },
    });
    check(key, 'press-frame input: dodge false', press.input?.p1, () => assert.equal(press.input?.p1?.dodge, false));
    check(key, 'fires donkeykong.usmash', { atPress: moveId(press.p1), shieldingAtPress: press.p1.shielding, fired: run.fired?.active?.id ?? null }, () =>
      assert.equal(run.fired?.active?.id, 'donkeykong.usmash'));
    check(key, 'no dodge on any frame (H + W still held after the tap)', { dodgeStates: [...new Set(series.map((r) => r.dodge))], firstDodgeFrame, inputDodgeFrame1: series[1]?.inputDodge ?? null }, () =>
      assert.ok(series.every((r) => r.dodge === 'idle')));
  }

  // 9c (control): shield up, then W without V is still the up dodge.
  {
    const key = 's9c_controlShieldPlusWDodges';
    await settle();
    await keyDown('h', 'shield');
    for (let i = 0; i < 8; i++) await step();
    await keyDown('w', 'up');
    const press = await step();
    await keysUp([['w', 'up'], ['h', 'shield']]);
    for (let i = 0; i < 40; i++) await step();
    record(key, { pressState: press.p1, pressInput: press.input?.p1 ?? null });
    check(key, 'shield + W (no V) starts a dodge', { inputDodge: press.input?.p1?.dodge, dodge: press.p1.dodge }, () => {
      assert.equal(press.input?.p1?.dodge, true);
      assert.equal(press.p1.dodge, 'active');
    });
  }

  // ---------------------------------------------------------------------
  // Scenario 10: dodge key (R) + V on the same frame -> smash, no dodge.
  // ---------------------------------------------------------------------
  {
    const key = 's10_dodgeKeyPlusVNoDodge';
    await settle();
    await keysDown([['r', 'taunt'], ['v', 'smash']]);
    const press = await step();
    await keysUp([['r', 'taunt'], ['v', 'smash']]);
    const run = await stepMoveToEnd(1, press);
    record(key, { pressState: press.p1, pressInput: press.input?.p1 ?? null, fired: run.fired, moveEnded: run.ended, series: run.series.map(({ input, ...rest }) => ({ ...rest, inputDodge: input?.dodge ?? null })) });
    check(key, 'press-frame input: attackHeavy, dodge false', press.input?.p1, () => {
      assert.equal(press.input?.p1?.attackHeavy, true);
      assert.equal(press.input?.p1?.dodge, false);
    });
    check(key, 'press frame starts donkeykong.smash', moveId(press.p1), () => assert.equal(moveId(press.p1), 'donkeykong.smash'));
    check(key, 'fires donkeykong.smash', run.fired?.active?.id, () => assert.equal(run.fired?.active?.id, 'donkeykong.smash'));
    check(key, 'no dodge on any frame from the press to the end of the move', { dodgeStates: [...new Set(run.series.map((r) => r.dodge))], ended: run.ended }, () => {
      assert.ok(run.ended);
      assert.ok(run.series.every((r) => r.dodge === 'idle'));
    });
  }

  // 10b (control): the dodge key alone still dodges.
  {
    const key = 's10b_controlDodgeKeyAloneDodges';
    await settle();
    await keyDown('r', 'taunt');
    const press = await step();
    await keyUp('r', 'taunt');
    for (let i = 0; i < 40; i++) await step();
    record(key, { pressState: press.p1, pressInput: press.input?.p1 ?? null });
    check(key, 'R alone starts a dodge', { inputDodge: press.input?.p1?.dodge, dodge: press.p1.dodge }, () => {
      assert.equal(press.input?.p1?.dodge, true);
      assert.equal(press.p1.dodge, 'active');
    });
  }

  await page.screenshot({ path: `${OUT_DIR}/match-final.png` });
  await matchContext.close();

  // =====================================================================
  // Scenario 11: P2 keyboard layout (keyboard_p2): Numpad 0 is P2's smash.
  // Separate match: DK (keyboard_p1) vs Wolf (keyboard_p2), both keyboard.
  // Numpad keys are sent through CDP Input.dispatchKeyEvent with NumLock-on
  // codes (keyCode 96 / 102, key '0' / '6', keypad location): Playwright's
  // named 'Numpad0' key models NumLock off (Insert, keyCode 45).
  // =====================================================================
  {
    const key = 's11_p2KeyboardNumpad0Smash';
    ({ context: matchContext, page } = await openPage());
    const cdp = await matchContext.newCDPSession(page);
    await page.evaluate(() => {
      window.__probeKeys = [];
      for (const type of ['keydown', 'keyup']) {
        window.addEventListener(type, (e) => window.__probeKeys.push({ type, key: e.key, code: e.code, keyCode: e.keyCode, location: e.location, isTrusted: e.isTrusted }), true);
      }
    });
    const setup2 = await startMatch([
      { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
    ], 2811);
    floor = setup2.floor;
    centerX = floor.centerX;
    leftParkX = floor.minX + 60;
    rightParkX = floor.maxX - 60;
    record(key, { participants: setup2.participants, gameSize: setup2.gameSize });
    check(key, 'P2 keyboard_p2 Smash binding is Numpad 0 (keyCode 96), not Numpad 6 (102)', setup2.participants[1].smashBindings, () => {
      const codes = (setup2.participants[1].smashBindings ?? []).filter((b) => b.kind === 'keyboard').map((b) => b.keyCode);
      assert.deepEqual(codes, [96]);
    });
    check(key, 'P1 keyboard_p1 Smash binding is still V (86)', setup2.participants[0].smashBindings, () =>
      assert.deepEqual((setup2.participants[0].smashBindings ?? []).filter((b) => b.kind === 'keyboard').map((b) => b.keyCode), [86]));
    check(key, 'default game size kept (1920x1080)', setup2.gameSize, () => assert.deepEqual(setup2.gameSize, { width: 1920, height: 1080 }));

    const NUMPAD = {
      0: { key: '0', code: 'Numpad0', windowsVirtualKeyCode: 96, nativeVirtualKeyCode: 96, isKeypad: true },
      6: { key: '6', code: 'Numpad6', windowsVirtualKeyCode: 102, nativeVirtualKeyCode: 102, isKeypad: true },
    };
    const numpadDown = (n) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...NUMPAD[n], text: NUMPAD[n].key, unmodifiedText: NUMPAD[n].key });
    const numpadUp = (n) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...NUMPAD[n] });
    const waitHeld = (slot, actions, value) => page.waitForFunction(({ slot, actions, value }) =>
      actions.every((a) => window.__pf.held(slot)[a] === value), { slot, actions, value }, { timeout: 5000 });
    const p2Place = (p2Facing = -1) => settle({ p1x: leftParkX, p1Facing: 1, p2x: centerX + 100, p2Facing });

    /** Tap Numpad 0 (one fixed step) after `arrows` are held `holdFrames`; run the P2 move to its end. */
    async function p2NumpadSmash(arrows, holdFrames) {
      for (const [arrow] of arrows) await page.keyboard.down(arrow);
      if (arrows.length) await waitHeld(2, arrows.map(([, a]) => a), true);
      for (let i = 0; i < holdFrames; i++) await step();
      await numpadDown(0);
      await waitHeld(2, ['smash'], true);
      const press = await step();
      await numpadUp(0);
      await waitHeld(2, ['smash'], false);
      const run = await stepMoveToEnd(2, press);
      for (const [arrow] of arrows) await page.keyboard.up(arrow);
      if (arrows.length) await waitHeld(2, arrows.map(([, a]) => a), false);
      return { press, run };
    }

    // 11a: neutral Numpad 0 -> forward smash (P2 faces left).
    {
      await p2Place(-1);
      await page.evaluate(() => { window.__probeKeys.length = 0; });
      const { press, run } = await p2NumpadSmash([], 0);
      const keyEvents = await page.evaluate(() => window.__probeKeys.filter((e) => e.code === 'Numpad0'));
      const p1After = (await read()).p1;
      record('s11a_numpad0NeutralForwardSmash', { keyEvents, pressState: press.p2, pressInput: press.input?.p2 ?? null, p1PressInput: press.input?.p1 ?? null, fired: run.fired, series: run.series.map(({ input, ...rest }) => rest), p1After });
      check('s11a_numpad0NeutralForwardSmash', 'browser delivered trusted Numpad0 keydown/keyup with keyCode 96 on the numpad (location 3)', keyEvents, () => {
        assert.ok(keyEvents.some((e) => e.type === 'keydown' && e.keyCode === 96 && e.location === 3 && e.isTrusted));
        assert.ok(keyEvents.some((e) => e.type === 'keyup' && e.keyCode === 96 && e.location === 3 && e.isTrusted));
      });
      check('s11a_numpad0NeutralForwardSmash', 'press-frame input: P2 attackHeavy, P1 untouched', { p2: press.input?.p2, p1: press.input?.p1 }, () => {
        assert.equal(press.input?.p2?.attackHeavy, true);
        assert.equal(press.input?.p1?.attackHeavy, false);
      });
      check('s11a_numpad0NeutralForwardSmash', 'Numpad 0 press frame starts donkeykong.smash', moveId(press.p2), () => assert.equal(moveId(press.p2), 'donkeykong.smash'));
      check('s11a_numpad0NeutralForwardSmash', 'fires donkeykong.smash facing left (-1)', { id: run.fired?.active?.id, facing: run.fired?.active?.facing }, () => {
        assert.equal(run.fired?.active?.id, 'donkeykong.smash');
        assert.equal(run.fired?.active?.facing, -1);
      });
      check('s11a_numpad0NeutralForwardSmash', 'P1 (DK) started no move from Numpad 0', { active: p1After.active, charging: p1After.charging, pressMove: moveId(press.p1) }, () => {
        assert.equal(moveId(press.p1), null);
        assert.equal(p1After.active, null);
        assert.equal(p1After.charging, null);
      });
    }

    // 11b: ArrowRight held 6 frames (turns from left to right) + Numpad 0 -> forward smash right.
    {
      await p2Place(-1);
      const { press, run } = await p2NumpadSmash([['ArrowRight', 'right']], 6);
      record('s11b_arrowRightNumpad0ForwardSmashRight', { initialFacing: -1, pressState: press.p2, pressInput: press.input?.p2 ?? null, fired: run.fired });
      check('s11b_arrowRightNumpad0ForwardSmashRight', 'fires donkeykong.smash facing right (+1)', { id: run.fired?.active?.id, facing: run.fired?.active?.facing }, () => {
        assert.equal(run.fired?.active?.id, 'donkeykong.smash');
        assert.equal(run.fired?.active?.facing, 1);
      });
    }

    // 11c: ArrowDown held 6 frames + Numpad 0 -> down smash.
    {
      await p2Place(-1);
      const { press, run } = await p2NumpadSmash([['ArrowDown', 'down']], 6);
      record('s11c_arrowDownNumpad0DownSmash', { pressState: press.p2, pressInput: press.input?.p2 ?? null, fired: run.fired });
      check('s11c_arrowDownNumpad0DownSmash', 'fires donkeykong.dsmash', { atPress: moveId(press.p2), fired: run.fired?.active?.id }, () =>
        assert.equal(run.fired?.active?.id, 'donkeykong.dsmash'));
    }

    // 11d: ArrowUp (up + jump for P2) and Numpad 0 on the same frame -> grounded up smash.
    {
      await p2Place(-1);
      const { press, run } = await p2NumpadSmash([['ArrowUp', 'up']], 0);
      record('s11d_arrowUpNumpad0UpSmash', { pressState: press.p2, pressInput: press.input?.p2 ?? null, fired: run.fired, moveEnded: run.ended, series: run.series.map(({ input, ...rest }) => rest) });
      check('s11d_arrowUpNumpad0UpSmash', 'press-frame input: up (moveY -1) + attackHeavy', press.input?.p2, () => {
        assert.equal(press.input?.p2?.moveY, -1);
        assert.equal(press.input?.p2?.attackHeavy, true);
      });
      check('s11d_arrowUpNumpad0UpSmash', 'fires donkeykong.usmash, grounded throughout', { id: run.fired?.active?.id, airborneFrames: run.series.filter((r) => !r.grounded).map((r) => r.frame), ended: run.ended }, () => {
        assert.equal(run.fired?.active?.id, 'donkeykong.usmash');
        assert.ok(run.series.every((r) => r.grounded));
      });
    }

    // 11e: Numpad 6 (NumLock on, keyCode 102) is no longer bound: nothing starts.
    {
      await p2Place(-1);
      await numpadDown(6);
      await loopTicks(page, 3);
      const heldWhileDown = await page.evaluate(() => window.__pf.held(2));
      let st;
      const frames = [];
      for (let i = 0; i < 8; i++) { st = await step(); frames.push({ move: moveId(st.p2), vx: st.p2.vx, attackHeavy: st.input?.p2?.attackHeavy, moveX: st.input?.p2?.moveX }); }
      await numpadUp(6);
      await loopTicks(page, 3);
      const heldActions = Object.entries(heldWhileDown).filter(([, v]) => v === true).map(([k]) => k);
      record('s11e_numpad6NotBound', { heldActions, frames });
      check('s11e_numpad6NotBound', 'Numpad 6 (102) holds no action and starts no move', { heldActions, moves: [...new Set(frames.map((f) => f.move))] }, () => {
        assert.deepEqual(heldActions, []);
        assert.ok(frames.every((f) => f.move === null && f.attackHeavy === false && f.moveX === 0));
      });
    }

    // 11f: both keyboard halves in one match: P1's V still smashes, P2 stays idle.
    {
      await settle({ p1x: centerX - 200, p1Facing: 1, p2x: rightParkX, p2Facing: -1 });
      await keyDown('v', 'smash');
      const press = await step();
      await keyUp('v', 'smash');
      const run = await stepMoveToEnd(1, press);
      const p2After = (await read()).p2;
      record('s11f_p1VInKeyboardVsKeyboard', { pressState: press.p1, fired: run.fired, p2PressInput: press.input?.p2 ?? null, p2After });
      check('s11f_p1VInKeyboardVsKeyboard', 'P1 V fires donkeykong.smash; P2 attackHeavy false and idle', { p1: run.fired?.active?.id, p2AttackHeavy: press.input?.p2?.attackHeavy, p2Move: moveId(p2After) }, () => {
        assert.equal(run.fired?.active?.id, 'donkeykong.smash');
        assert.equal(press.input?.p2?.attackHeavy, false);
        assert.equal(moveId(p2After), null);
      });
    }

    await page.screenshot({ path: `${OUT_DIR}/match-p2-keyboard-final.png` });
    await matchContext.close();
  }

  // =====================================================================
  // Scenario 7: character-select Controls panels (keyboard P1 + gamepad).
  // =====================================================================
  {
    const key7 = 's7_controlsPanelSmashRow';
    const { context, page: menu } = await openPage();
    const scene = async (name) => {
      await menu.waitForFunction((name) => window.__game?.scene.isActive(name), name, { timeout: 20000 });
      await loopTicks(menu, 3);
    };
    const press = async (value) => { await menu.keyboard.press(value); await loopTicks(menu, 3); };
    const padPulse = async (button) => {
      await setPad(menu, { buttons: { [button]: 1 } });
      await loopTicks(menu, 6);
      await setPad(menu, { buttons: { [button]: 0 } });
      await loopTicks(menu, 6);
    };
    await menu.evaluate(() => {
      const game = window.__game;
      for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
      game.scene.start('MainMenuScene');
    });
    await scene('MainMenuScene');
    await press('Enter');
    await scene('ModeSelectScene');
    await press('Enter');
    await scene('CharacterSelectScene');
    // Keyboard P1 joins slot 1 and picks (Space). The simulated pad joins
    // with A, picks the portrait under its mid-grid hand with a second A
    // (Controls only open for a slot with a picked fighter), then opens
    // Controls with X. 'r' opens the keyboard player's Controls.
    await press('1');
    await press('Space');
    await padPulse(0);
    await padPulse(0);
    const lobby = await menu.evaluate(() => {
      const s = window.__game.scene.getScene('CharacterSelectScene');
      return {
        slots: s.state.slots.slice(0, 2).map((slot) => ({ index: slot.index, mode: slot.mode, inputType: slot.inputType, picked: slot.pickedCharacterId })),
        pads: [...s.padAssignments],
      };
    });
    record(key7, { lobby });
    await padPulse(2);
    await press('r');
    await loopTicks(menu, 6);
    const panels = await menu.evaluate(() => {
      const game = window.__game;
      const s = game.scene.getScene('CharacterSelectScene');
      const canvas = game.canvas.getBoundingClientRect();
      const toPage = (b) => ({
        x: canvas.left + b.x * canvas.width / game.scale.gameSize.width,
        y: canvas.top + b.y * canvas.height / game.scale.gameSize.height,
        width: b.width * canvas.width / game.scale.gameSize.width,
        height: b.height * canvas.height / game.scale.gameSize.height,
      });
      return [...s.controlsEditors.entries()].map(([index, editor]) => ({
        index,
        device: editor.session.device,
        profile: editor.session.profileName,
        rows: editor.panel.rows.map((row) => ({ label: row.label.text, value: row.value.visible ? row.value.text : null })),
        pageBounds: toPage(editor.panel.bounds),
      }));
    });
    await menu.screenshot({ path: `${OUT_DIR}/controls-panels.png` });
    for (const panel of panels) {
      const b = panel.pageBounds;
      const name = panel.device.kind === 'keyboard' ? `controls-p${panel.index}-keyboard.png` : `controls-p${panel.index}-gamepad.png`;
      await menu.screenshot({ path: `${OUT_DIR}/${name}`, clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: b.height } });
    }
    const keyboardPanel = panels.find((p) => p.device.kind === 'keyboard');
    const gamepadPanel = panels.find((p) => p.device.kind === 'gamepad');
    const smashRow = (panel) => panel?.rows.find((row) => row.label === 'Smash') ?? null;
    record(key7, { panels, screenshots: ['controls-panels.png', ...panels.map((p) => p.device.kind === 'keyboard' ? `controls-p${p.index}-keyboard.png` : `controls-p${p.index}-gamepad.png`)] });
    check(key7, 'two Controls panels open (keyboard P1 + gamepad)', panels.map((p) => ({ index: p.index, device: p.device })), () => {
      assert.ok(keyboardPanel && keyboardPanel.device.layout === 'keyboard_p1');
      assert.ok(gamepadPanel && gamepadPanel.device.gamepadIndex === 0);
    });
    check(key7, "keyboard P1 panel: 'Smash' row shows 'V'", smashRow(keyboardPanel), () => assert.equal(smashRow(keyboardPanel)?.value, 'V'));
    check(key7, "gamepad panel: 'Smash' row shows 'Right Stick'", smashRow(gamepadPanel), () => assert.equal(smashRow(gamepadPanel)?.value, 'Right Stick'));
    check(key7, 'Smash row is the last action row, above the reset/copy/done/cancel buttons', keyboardPanel?.rows.map((r) => r.label), () => {
      const labels = keyboardPanel.rows.map((r) => r.label);
      assert.equal(labels[labels.indexOf('Smash') + 1], 'Reset bindings');
    });
    await context.close();
  }

  // =====================================================================
  // Scenario 12: character-select Controls panel for the arrows preset
  // (keyboard P2 in slot 2) shows 'Numpad 0' on the Smash row.
  // =====================================================================
  {
    const key12 = 's12_controlsPanelArrowsNumpad0';
    const { context, page: menu } = await openPage();
    const scene = async (name) => {
      await menu.waitForFunction((name) => window.__game?.scene.isActive(name), name, { timeout: 20000 });
      await loopTicks(menu, 3);
    };
    const press = async (value) => { await menu.keyboard.press(value); await loopTicks(menu, 3); };
    await menu.evaluate(() => {
      const game = window.__game;
      for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
      game.scene.start('MainMenuScene');
    });
    await scene('MainMenuScene');
    await press('Enter');
    await scene('ModeSelectScene');
    await press('Enter');
    await scene('CharacterSelectScene');
    // '1' + Space: keyboard P1 joins slot 1 and picks. '2' + Space: the
    // second keyboard half joins slot 2 (keyboard_p2) and picks. 'r' opens
    // the Controls panel of the focused slot (2).
    await press('1');
    await press('Space');
    await press('2');
    await press('Space');
    const lobby = await menu.evaluate(() => {
      const s = window.__game.scene.getScene('CharacterSelectScene');
      return s.state.slots.slice(0, 2).map((slot) => ({ index: slot.index, mode: slot.mode, inputType: slot.inputType, picked: slot.pickedCharacterId }));
    });
    await press('r');
    await loopTicks(menu, 6);
    const panels = await menu.evaluate(() => {
      const game = window.__game;
      const s = game.scene.getScene('CharacterSelectScene');
      const canvas = game.canvas.getBoundingClientRect();
      const toPage = (b) => ({
        x: canvas.left + b.x * canvas.width / game.scale.gameSize.width,
        y: canvas.top + b.y * canvas.height / game.scale.gameSize.height,
        width: b.width * canvas.width / game.scale.gameSize.width,
        height: b.height * canvas.height / game.scale.gameSize.height,
      });
      return [...s.controlsEditors.entries()].map(([index, editor]) => ({
        index,
        device: editor.session.device,
        profileId: editor.session.profileId,
        profile: editor.session.profileName,
        rows: editor.panel.rows.map((row) => ({ label: row.label.text, value: row.value.visible ? row.value.text : null })),
        pageBounds: toPage(editor.panel.bounds),
      }));
    });
    await menu.screenshot({ path: `${OUT_DIR}/controls-panel-arrows.png` });
    const arrowsPanel = panels.find((p) => p.device.kind === 'keyboard' && p.device.layout === 'keyboard_p2') ?? null;
    if (arrowsPanel) {
      const b = arrowsPanel.pageBounds;
      await menu.screenshot({ path: `${OUT_DIR}/controls-p2-keyboard-arrows.png`, clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: b.height } });
    }
    const smashRow = arrowsPanel?.rows.find((row) => row.label === 'Smash') ?? null;
    record(key12, { lobby, panels, screenshots: ['controls-panel-arrows.png', ...(arrowsPanel ? ['controls-p2-keyboard-arrows.png'] : [])] });
    check(key12, 'slot 2 joined as keyboard_p2 with a picked fighter', lobby[1], () => {
      assert.equal(lobby[1]?.mode, 'human');
      assert.equal(lobby[1]?.inputType, 'keyboard_p2');
      assert.ok(lobby[1]?.picked);
    });
    check(key12, 'Controls panel open for slot 2 on the keyboard_p2 device with the arrows preset', arrowsPanel && { index: arrowsPanel.index, device: arrowsPanel.device, profileId: arrowsPanel.profileId, profile: arrowsPanel.profile }, () => {
      assert.equal(arrowsPanel?.index, 2);
      assert.equal(arrowsPanel?.profileId, 'keyboard-arrows');
    });
    check(key12, "arrows preset panel: 'Smash' row shows 'Numpad 0'", smashRow, () => assert.equal(smashRow?.value, 'Numpad 0'));
    await context.close();
  }
} finally {
  for (const bucket of Object.values(report.scenarios)) bucket.pass = bucket.checks.every((c) => c.pass);
  report.summary = Object.fromEntries(Object.entries(report.scenarios).map(([key, bucket]) => [key, bucket.pass ? 'PASS' : 'FAIL']));
  await writeFile(`${OUT_DIR}/acceptance.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ bundleName: report.bundleName, engineVersion: report.engineVersion, summary: report.summary, pageErrors: report.pageErrors }, null, 2));
if (Object.values(report.summary ?? {}).some((v) => v !== 'PASS') || report.pageErrors.length) process.exitCode = 1;
