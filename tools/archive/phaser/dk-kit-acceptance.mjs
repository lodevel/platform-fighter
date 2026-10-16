import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

// Evidence folder: override with PF_PROBE_OUT=docs/review/<date>/donkeykong-character/browser for a new dated record.
const OUT_DIR = process.env.PF_PROBE_OUT ?? '/mnt/c/Workspace/platform-fighter/docs/review/2026-09-25/donkeykong-character/browser';
await mkdir(OUT_DIR, { recursive: true });

const report = {
  engineVersion: null,
  bundleName: null,
  pageErrors: [],
  adaptations: [],
  scenarios: {},
};

/** Run an assertion; on failure, record it (with the measured value) and continue. */
function check(scenarioKey, label, actualValue, fn) {
  const bucket = (report.scenarios[scenarioKey] ??= { checks: [] });
  try {
    fn();
    bucket.checks.push({ label, pass: true, actual: actualValue });
    return true;
  } catch (error) {
    bucket.checks.push({ label, pass: false, actual: actualValue, error: error.message });
    return false;
  }
}

function record(scenarioKey, data) {
  const bucket = (report.scenarios[scenarioKey] ??= { checks: [] });
  Object.assign(bucket, data);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) => report.pageErrors.push(error.message));

try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, {
    timeout: 60000,
  });

  // ---------------------------------------------------------------------
  // Setup: start MatchScene (DK vs Wolf), wire deterministic per-player
  // input override, expose helpers on window.__pf for the Node-side
  // driving loop to call frame-by-frame (so we can interleave
  // page.screenshot() calls at exact frames).
  // ---------------------------------------------------------------------
  const setup = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', {
      matchConfig: {
        mode: 'stocks',
        stockCount: 5,
        stageId: 'flat',
        rngSeed: 819,
        itemFrequency: 'off',
        players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2' },
        ],
      },
    });
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause();

    const input = { 1: {}, 2: {} };
    const origGetMoveVector = s.inputResolver.getMoveVector.bind(s.inputResolver);
    const origIsActionHeld = s.inputResolver.isActionHeld.bind(s.inputResolver);
    s.inputResolver.getMoveVector = (player) => ({
      x: input[player]?.moveX ?? 0,
      y: input[player]?.moveY ?? 0,
    });
    s.inputResolver.isActionHeld = (player, action) => input[player]?.[action] === true;

    const floor = s.baseStage.bodies.platformBodies.find((b) => b.label === 'platform.solid');
    const start = { x: floor.position.x, y: floor.bounds.min.y - s.p1.getTuning().height / 2 };
    const p2StandY = floor.bounds.min.y - s.p2.getTuning().height / 2;
    const parkX = floor.bounds.max.x - 50;

    const extract = (f) => {
      const pos = f.getPosition();
      const vel = f.getVelocity();
      const active = f.getActiveAttack();
      return {
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        grounded: f.isGrounded(),
        damage: f.getDamagePercent(),
        facing: typeof f.getFacing === 'function' ? f.getFacing() : null,
        active: active
          ? {
              id: active.move.id,
              framesElapsed: active.framesElapsed,
              chargeHeldFrames: active.chargeHeldFrames ?? null,
            }
          : null,
      };
    };

    window.__pf = {
      s,
      input,
      origGetMoveVector,
      origIsActionHeld,
      start,
      p2StandY,
      parkX,
      step(next1, next2) {
        input[1] = next1 || {};
        input[2] = next2 || {};
        s.physicsEngine.resume();
        s.update(0, s.physicsEngine.fixedTimestepMs);
        s.physicsEngine.pause();
        return { p1: extract(s.p1), p2: extract(s.p2) };
      },
      read() {
        return { p1: extract(s.p1), p2: extract(s.p2) };
      },
      resetP1(x, y, facing = 1) {
        s.p1.resetForRound(x, y);
        s.p1.setFacing(facing);
        s.p1.setDamagePercent(0);
      },
      resetP2(x, y, facing = 1) {
        s.p2.resetForRound(x, y);
        s.p2.setFacing(facing);
        s.p2.setDamagePercent(0);
      },
      restoreInput() {
        s.inputResolver.getMoveVector = origGetMoveVector;
        s.inputResolver.isActionHeld = origIsActionHeld;
      },
    };

    // Park P2 out of the way by default.
    window.__pf.resetP2(parkX, p2StandY, -1);
    window.__pf.resetP1(start.x, start.y, 1);

    const meta = s.getMatchStartMetadata();
    return {
      engineVersion: meta?.engineVersion ?? null,
      start,
      p2StandY,
      p1Tuning: s.p1.getTuning(),
    };
  });

  report.engineVersion = setup.engineVersion;
  const bundleLs = execSync('ls /mnt/c/Workspace/platform-fighter/dist/assets/index-*.js').toString().trim();
  report.bundleName = bundleLs.split('/').pop();

  const step = (n1, n2) => page.evaluate(({ n1, n2 }) => window.__pf.step(n1, n2), { n1: n1 || {}, n2: n2 || {} });
  const read = () => page.evaluate(() => window.__pf.read());
  const resetP1 = (x, y, facing = 1) =>
    page.evaluate(({ x, y, facing }) => window.__pf.resetP1(x, y, facing), { x, y, facing });
  const resetP2 = (x, y, facing = 1) =>
    page.evaluate(({ x, y, facing }) => window.__pf.resetP2(x, y, facing), { x, y, facing });
  const dkStandXY = () => page.evaluate(() => window.__pf.start);
  const p2StandY = () => page.evaluate(() => window.__pf.p2StandY);
  const parkP2 = () =>
    page.evaluate(() => window.__pf.resetP2(window.__pf.parkX, window.__pf.p2StandY, -1));

  async function settle({ p2x, p2y, p2Facing = 1 } = {}) {
    const start = await dkStandXY();
    await resetP1(start.x, start.y, 1);
    if (p2x != null) await resetP2(p2x, p2y, p2Facing);
    else await parkP2();
    let last;
    for (let i = 0; i < 12; i++) last = await step({}, {});
    if (!last.p1.grounded) {
      throw new Error(`DK not grounded after settle: ${JSON.stringify(last.p1)}`);
    }
    return last;
  }

  // =====================================================================
  // Scenario 1: full hop / short hop
  // =====================================================================
  {
    const results = {};
    for (const kind of ['full', 'short']) {
      await settle();
      let origin = (await read()).p1.y;
      let minimum = origin;
      let firstAir = null;
      let contact = null;
      for (let frame = 1; frame <= 120; frame++) {
        const held = kind === 'full' ? true : frame === 1;
        const st = await step({ jump: held });
        minimum = Math.min(minimum, st.p1.y);
        if (!st.p1.grounded && firstAir === null) firstAir = frame;
        if (firstAir !== null && st.p1.grounded) {
          contact = frame;
          break;
        }
      }
      const height = origin - minimum;
      const duration = contact === null ? null : contact - firstAir + 1;
      results[kind] = { height, firstAir, contact, duration };
    }
    record('jumps', { results });
    check('jumps', 'full hop height ~170px', results.full.height, () =>
      assert.ok(Math.abs(results.full.height - 170) <= 2, `full hop height ${results.full.height}`),
    );
    check('jumps', 'full hop duration ~53 frames', results.full.duration, () =>
      assert.ok(
        results.full.duration !== null && Math.abs(results.full.duration - 53) <= 1,
        `full hop duration ${results.full.duration}`,
      ),
    );
    check('jumps', 'short hop height ~86.5px', results.short.height, () =>
      assert.ok(Math.abs(results.short.height - 86.5) <= 2, `short hop height ${results.short.height}`),
    );
  }

  // =====================================================================
  // Scenario 2: ground movement (dash/run)
  // =====================================================================
  {
    const groundMotion = [];
    for (const facing of [1, -1]) {
      await settle();
      const samples = [];
      for (let frame = 1; frame <= 24; frame++) {
        const st = await step({ moveX: facing });
        samples.push({ frame, speed: st.p1.vx, grounded: st.p1.grounded });
      }
      groundMotion.push({ facing, samples });
    }
    record('ground', { groundMotion });
    for (const { facing, samples } of groundMotion) {
      const firstStep = Math.abs(samples[0].speed);
      const frame15 = Math.abs(samples[14].speed);
      const settled = Math.abs(samples.at(-1).speed);
      check('ground', `facing ${facing} first-step |speed| ~10.45`, firstStep, () =>
        assert.ok(Math.abs(firstStep - 10.45) <= 0.02, `first-step speed ${firstStep}`),
      );
      check('ground', `facing ${facing} frame15 |speed| ~10.45`, frame15, () =>
        assert.ok(Math.abs(frame15 - 10.45) <= 0.02, `frame15 speed ${frame15}`),
      );
      check('ground', `facing ${facing} settled(frame24) |speed| ~9.365`, settled, () =>
        assert.ok(Math.abs(settled - 9.365) <= 0.02, `settled speed ${settled}`),
      );
      check('ground', `facing ${facing} remains grounded`, null, () =>
        assert.ok(samples.every((sm) => sm.grounded), 'left the ground during dash/run'),
      );
    }
  }

  // =====================================================================
  // Scenario 3: jab string (jab -> jab2, no jab3)
  // =====================================================================
  {
    await settle();
    const timeline = [];
    // Press attack for one frame.
    let st = await step({ attack: true });
    timeline.push({ frame: 1, active: st.p1.active });
    check('jabString', 'jab starts on press', st.p1.active?.id, () =>
      assert.equal(st.p1.active?.id, 'donkeykong.jab'),
    );
    // Release, step until framesElapsed >= 7 (jab's advanceWindowStart).
    let frame = 1;
    while ((st.p1.active?.framesElapsed ?? 0) < 7 && frame < 60) {
      st = await step({});
      frame++;
      timeline.push({ frame, active: st.p1.active });
    }
    check('jabString', 'jab reached advanceWindowStart(7) while still jab', st.p1.active, () =>
      assert.ok(st.p1.active?.id === 'donkeykong.jab' && st.p1.active.framesElapsed >= 7, JSON.stringify(st.p1.active)),
    );
    // One release frame, then press again -> jab2.
    st = await step({});
    frame++;
    timeline.push({ frame, active: st.p1.active, note: 'release frame' });
    st = await step({ attack: true });
    frame++;
    timeline.push({ frame, active: st.p1.active, note: 'second press' });
    check('jabString', 'second press advances to jab2', st.p1.active?.id, () =>
      assert.equal(st.p1.active?.id, 'donkeykong.jab2'),
    );
    // Release, then a third press shortly after jab2 starts: must NOT produce jab3.
    st = await step({});
    frame++;
    timeline.push({ frame, active: st.p1.active, note: 'release before third press' });
    st = await step({ attack: true });
    frame++;
    timeline.push({ frame, active: st.p1.active, note: 'third press' });
    const thirdPressActiveId = st.p1.active?.id ?? null;
    check('jabString', 'third press does not produce jab3', thirdPressActiveId, () =>
      assert.notEqual(thirdPressActiveId, 'donkeykong.jab3'),
    );
    // Track what actually happens over the following frames.
    st = await step({});
    frame++;
    for (let i = 0; i < 40; i++) {
      st = await step({});
      frame++;
      timeline.push({ frame, active: st.p1.active });
      if (st.p1.active === null) break;
    }
    record('jabString', { timeline, outcome: 'see timeline for what the third press actually produced' });
  }

  // =====================================================================
  // Scenario 4: forward smash reach (far 115px -> 22, close 55px -> 21)
  // =====================================================================
  {
    const start = await dkStandXY();
    const standY2 = await p2StandY();
    const far = {};
    const close = {};
    for (const [label, distance, target] of [['far', 115, far], ['close', 55, close]]) {
      await settle({ p2x: start.x + distance, p2y: standY2, p2Facing: -1 });
      const before = (await read()).p2.damage;
      // BUGFIX (probe): `attackHeavy` never reaches `Character.applyInput`
      // for a human/keyboard slot — `buildCharacterInputFromResolver`
      // (src/input/InputResolver.ts) does not set that field at all; the
      // production smash trigger is `attack` rising on the same frame as
      // a rest->flick of the stick past DEFAULT_SMASH_FLICK_THRESHOLD
      // (src/characters/groundedAttackInput.ts). Send `attack: true` (not
      // `attackHeavy`) with the flick so `classifyGroundedAttack` actually
      // dispatches the smash.
      let st = await step({ attack: true, moveX: 1 });
      let landedFrame = null;
      let landedElapsed = null;
      let delta = 0;
      for (let frame = 1; frame <= 60; frame++) {
        if (frame > 1) st = await step({});
        const d = st.p2.damage - before;
        if (d > 0.001 && landedFrame === null) {
          landedFrame = frame;
          landedElapsed = st.p1.active?.framesElapsed ?? null;
          delta = d;
          if (label === 'far') {
            await page.screenshot({ path: `${OUT_DIR}/dk-fsmash-far-contact.png` });
          }
        }
      }
      const after = (await read()).p2.damage;
      Object.assign(target, { distance, before, after, delta: after - before, landedFrame, landedElapsed });
    }
    record('forwardSmash', { far, close });
    // A move that is absent from the stale queue gets the 1.05 freshness bonus
    // (STALE_FRESH_MULTIPLIER in src/characters/combat.ts), so an authored
    // 22% / 21% hit lands as 23.1% / 22.05% on a fresh opponent.
    check('forwardSmash', 'far (115px) damage delta = 22 x 1.05 fresh bonus', far.delta, () =>
      assert.ok(Math.abs(far.delta - 22 * 1.05) < 0.01, `far delta ${far.delta}`),
    );
    check('forwardSmash', 'far (115px) landed elapsed in [21,22]', far.landedElapsed, () =>
      assert.ok(far.landedElapsed !== null && far.landedElapsed >= 21 && far.landedElapsed <= 22, `elapsed ${far.landedElapsed}`),
    );
    check('forwardSmash', 'close (55px) damage delta = 21 x 1.05 fresh bonus', close.delta, () =>
      assert.ok(Math.abs(close.delta - 21 * 1.05) < 0.01, `close delta ${close.delta}`),
    );
    check('forwardSmash', 'close (55px) landed elapsed in [21,22]', close.landedElapsed, () =>
      assert.ok(close.landedElapsed !== null && close.landedElapsed >= 21 && close.landedElapsed <= 22, `elapsed ${close.landedElapsed}`),
    );
  }

  // =====================================================================
  // Scenario 5: Hand Slap ground-only (down special)
  // =====================================================================
  {
    const start = await dkStandXY();
    const standY2 = await p2StandY();

    // Grounded P2 case: expect damage rises at elapsed ~11-12, ~22-23, and again ~26 frames later.
    //
    // BUGFIX (probe): DK is 60px wide, Wolf 45px wide (half-widths sum to
    // 52.5px). `start.x + 30` spawns P2 already overlapping DK's body, so
    // `settle()`'s 12 empty-input physics frames let Matter's contact
    // resolution shove P2 apart to ~80px separation BEFORE Hand Slap ever
    // fires — well outside the shockwave's ground capsule reach (51.5px
    // radius centred on DK + Wolf's 22.5px half-width ~= 74px max reach).
    // 55px clears the overlap (no push) and stays inside the 74px reach.
    {
      await settle({ p2x: start.x + 55, p2y: standY2, p2Facing: -1 });
      const before = (await read()).p2.damage;
      const rises = [];
      let prevDamage = before;
      let st = await step({ special: true, moveY: 1 });
      let screenshotTaken = false;
      let repressed = false;
      // P2's state when the second slap window opens (elapsed 22): Ultimate
      // buries a grounded opponent on the first slap so the second connects;
      // this engine has no bury (recorded gap), so a launched P2 is expected
      // to be airborne here and out of the ground-only capsule.
      let p2AtSecondWindow = null;
      const totalFrames = 90;
      for (let frame = 1; frame <= totalFrames; frame++) {
        if (frame > 1) {
          const elapsed = st.p1.active?.framesElapsed ?? -1;
          const doRepress = !repressed && elapsed === 15;
          if (doRepress) repressed = true;
          st = await step({ moveY: 1, special: doRepress });
        }
        if ((st.p1.active?.framesElapsed ?? -1) === 22 && p2AtSecondWindow === null) {
          p2AtSecondWindow = { x: st.p2.x, y: st.p2.y, vy: st.p2.vy, grounded: st.p2.grounded, dx: st.p2.x - st.p1.x, dy: st.p2.y - st.p1.y };
        }
        if (st.p2.damage > prevDamage + 0.001) {
          rises.push({ frame, elapsed: st.p1.active?.framesElapsed ?? null, delta: st.p2.damage - prevDamage });
          if (!screenshotTaken) {
            await page.screenshot({ path: `${OUT_DIR}/dk-handslap-first-slap.png` });
            screenshotTaken = true;
          }
        }
        prevDamage = st.p2.damage;
      }
      record('handSlap', { grounded: { rises, p2AtSecondWindow } });
      // Sourced behaviour (UFD + script capture SpecialLwLoop): the first slap
      // hits at 12-13 (elapsed 11-12) for 14 % with BKB 85 at 78°, which
      // launches a 0 % target; the second window (23-24, elapsed 22-23) is
      // ground-only, so it cannot connect on the launched target. Neither
      // source records a bury or a re-hit on the same target, so the probe
      // asserts exactly that: one rise, then an airborne P2 at the second window.
      check('handSlap', 'exactly one damage rise on a grounded P2 (the first slap launches him)', rises.length, () =>
        assert.equal(rises.length, 1, `${rises.length} rises`),
      );
      if (rises.length >= 1) {
        check('handSlap', 'first rise elapsed in [11,12]', rises[0].elapsed, () =>
          assert.ok(rises[0].elapsed >= 11 && rises[0].elapsed <= 12, `elapsed ${rises[0].elapsed}`),
        );
        check('handSlap', 'first slap damage = 14 x 1.05 fresh bonus', rises[0].delta, () =>
          assert.ok(Math.abs(rises[0].delta - 14 * 1.05) < 0.01, `delta ${rises[0].delta}`),
        );
      }
      check('handSlap', 'P2 launched and airborne when the second (ground-only) window opens at elapsed 22', p2AtSecondWindow, () =>
        assert.ok(p2AtSecondWindow !== null && p2AtSecondWindow.grounded === false && p2AtSecondWindow.dy < -40,
          `p2 at second window ${JSON.stringify(p2AtSecondWindow)}`),
      );
    }

    // Airborne P2 case: expect NO damage while P2 stays off the ground.
    // Same overlap/placement bugfix as the grounded case above — without
    // it this sub-check "passed" for the wrong reason (P2 shoved out of
    // reach during settle(), not because airborne is exempt from the
    // ground-only capsule).
    {
      await settle({ p2x: start.x + 55, p2y: standY2, p2Facing: -1 });
      const before = (await read()).p2.damage;
      let st = await step({ special: true, moveY: 1 }, { jump: true });
      let maxDelta = 0;
      for (let frame = 1; frame <= 30; frame++) {
        const p2Input = st.p2.grounded ? { jump: true } : {};
        st = await step({ moveY: 1 }, p2Input);
        maxDelta = Math.max(maxDelta, st.p2.damage - before);
      }
      record('handSlap', { airborne: { maxDelta, before, after: before + maxDelta } });
      check('handSlap', 'airborne P2 takes no Hand Slap damage', maxDelta, () =>
        assert.ok(maxDelta < 0.001, `airborne P2 took ${maxDelta} damage`),
      );
    }
  }

  // =====================================================================
  // Scenario 6: Giant Punch charge bank + super armour
  // =====================================================================
  {
    const start = await dkStandXY();
    const standY2 = await p2StandY();
    // BUGFIX (probe): DK (60px wide) + Wolf (45px wide) half-widths sum to
    // 52.5px, so `start.x + 35` spawns P2 overlapping DK's body. settle()'s
    // 12 empty-input physics frames then let Matter's contact resolution
    // shove P2 apart to ~80px separation (confirmed empirically) — beyond
    // Wolf's jab reach (~68px from centre-to-centre) — so P2's later jab at
    // DK never lands and the armour sub-check can't observe anything. 55px
    // clears the overlap (settles at exactly 55, no push) and stays inside
    // jab range.
    await settle({ p2x: start.x + 55, p2y: standY2, p2Facing: -1 });

    // Hold special >= 115 frames; confirm charging (no active attack yet).
    let st;
    for (let i = 0; i < 115; i++) st = await step({ special: true });
    const chargingHasNoActiveAttack = st.p1.active === null;
    check('giantPunch', 'no active attack while charging', st.p1.active, () =>
      assert.equal(st.p1.active, null),
    );

    // Bank the charge with a one-frame shield press (still holding special,
    // mirroring the real Samus/DK charge-cancel input).
    st = await step({ shield: true, special: true });
    const afterBank = st.p1.active;
    // Release for ~20 frames.
    for (let i = 0; i < 20; i++) st = await step({});
    // Press special once -> should fire the banked full charge.
    st = await step({ special: true });
    const fired = st.p1.active;
    check('giantPunch', 'banked charge fires as neutral_special', fired?.id, () =>
      assert.equal(fired?.id, 'donkeykong.neutral_special'),
    );
    check('giantPunch', 'chargeHeldFrames >= 111 on fire', fired?.chargeHeldFrames, () =>
      assert.ok((fired?.chargeHeldFrames ?? 0) >= 111, `chargeHeldFrames ${fired?.chargeHeldFrames}`),
    );

    // During elapsed 9-19, have P2 jab DK; expect damage increase + move continues (armour).
    const dkDamageBefore = st.p1.damage;
    let pressed = false;
    let armourOutcome = null;
    for (let frame = 0; frame < 60; frame++) {
      const elapsed = st.p1.active?.framesElapsed ?? -1;
      const p2Input = !pressed && elapsed === 9 ? { attack: true } : {};
      if (!pressed && elapsed === 9) pressed = true;
      st = await step({}, p2Input);
      if (st.p1.damage > dkDamageBefore + 0.001 && armourOutcome === null) {
        armourOutcome = {
          frame,
          dkDamageDelta: st.p1.damage - dkDamageBefore,
          activeStillPunch: st.p1.active?.id === 'donkeykong.neutral_special',
        };
      }
      if (st.p1.active === null) break;
    }
    record('giantPunch', { chargingHasNoActiveAttack, afterBankActive: afterBank, firedActive: fired, armourOutcome });
    check('giantPunch', 'DK damage increases from P2 jab while armoured', armourOutcome?.dkDamageDelta, () =>
      assert.ok(armourOutcome !== null && armourOutcome.dkDamageDelta > 0, `armourOutcome ${JSON.stringify(armourOutcome)}`),
    );
    check('giantPunch', 'active attack still the punch during armour hit', armourOutcome?.activeStillPunch, () =>
      assert.equal(armourOutcome?.activeStillPunch, true),
    );
  }

  // =====================================================================
  // Scenario 7: Headbutt (side special) armour then interrupt
  // =====================================================================
  {
    const start = await dkStandXY();
    const standY2 = await p2StandY();
    // BUGFIX (probe): same overlap/placement issue as Scenario 6 — 35px is
    // inside the 52.5px DK+Wolf half-width sum, so settle() shoves P2 out
    // to ~80px before either sub-test runs. 55px avoids the push and keeps
    // P2 inside Wolf's jab range for both the armour and interrupt checks.
    await settle({ p2x: start.x + 55, p2y: standY2, p2Facing: -1 });

    // First activation: armour test at elapsed 6.
    let st = await step({ special: true, moveX: 1 });
    let pressed = false;
    let armourOutcome = null;
    const dkDamageBefore1 = st.p1.damage;
    for (let frame = 0; frame < 70; frame++) {
      const elapsed = st.p1.active?.framesElapsed ?? -1;
      const p2Input = !pressed && elapsed === 6 ? { attack: true } : {};
      if (!pressed && elapsed === 6) pressed = true;
      st = await step({}, p2Input);
      if (st.p1.damage > dkDamageBefore1 + 0.001 && armourOutcome === null) {
        armourOutcome = {
          frame,
          dkDamageDelta: st.p1.damage - dkDamageBefore1,
          stillSideSpecial: st.p1.active?.id === 'donkeykong.side_special',
          activeAfter: st.p1.active,
        };
      }
      if (st.p1.active === null) break;
    }

    // Let the move fully finish, then re-settle for the interrupt test with P2
    // BEHIND DK: the Headbutt's own hit connects at elapsed ~14 and launches a
    // P2 standing in front, so a front P2 can never jab at elapsed 15+. Behind
    // DK, Wolf's jab (facing right, toward DK's back) reaches DK's body while
    // the Headbutt travels away from him.
    for (let i = 0; i < 40; i++) st = await step({});
    await settle({ p2x: start.x - 55, p2y: standY2, p2Facing: 1 });

    st = await step({ special: true, moveX: 1 });
    let pressed2 = false;
    let interruptOutcome = null;
    const dkDamageBefore2 = st.p1.damage;
    const idBefore2 = st.p1.active?.id ?? null;
    for (let frame = 0; frame < 70; frame++) {
      const elapsed = st.p1.active?.framesElapsed ?? -1;
      const p2Input = !pressed2 && elapsed === 15 ? { attack: true } : {};
      if (!pressed2 && elapsed === 15) pressed2 = true;
      const prevId = st.p1.active?.id ?? null;
      st = await step({}, p2Input);
      if (st.p1.damage > dkDamageBefore2 + 0.001 && interruptOutcome === null) {
        interruptOutcome = {
          frame,
          dkDamageDelta: st.p1.damage - dkDamageBefore2,
          idBeforeHit: prevId,
          idAfterHit: st.p1.active?.id ?? null,
          interrupted: (st.p1.active?.id ?? null) !== 'donkeykong.side_special',
        };
      }
      if (interruptOutcome !== null && frame > interruptOutcome.frame + 3) break;
    }

    record('headbutt', { armourOutcome, interruptOutcome, idBefore2 });
    check('headbutt', 'DK damage increases from P2 jab at elapsed 6 (armour)', armourOutcome?.dkDamageDelta, () =>
      assert.ok(armourOutcome !== null && armourOutcome.dkDamageDelta > 0, `armourOutcome ${JSON.stringify(armourOutcome)}`),
    );
    check('headbutt', 'side_special continues after armoured hit', armourOutcome?.stillSideSpecial, () =>
      assert.equal(armourOutcome?.stillSideSpecial, true),
    );
    check('headbutt', 'DK damage increases from P2 jab at elapsed 15+ (interrupt)', interruptOutcome?.dkDamageDelta, () =>
      assert.ok(interruptOutcome !== null && interruptOutcome.dkDamageDelta > 0, `interruptOutcome ${JSON.stringify(interruptOutcome)}`),
    );
    check('headbutt', 'side_special is interrupted by the elapsed-15+ hit', interruptOutcome?.interrupted, () =>
      assert.equal(interruptOutcome?.interrupted, true),
    );
  }

  // =====================================================================
  // Scenario 8: real keyboard route
  // =====================================================================
  {
    // Read the default P1 keyboard binding for 'attack'.
    const bindingInfo = await page.evaluate(async () => {
      const mod = await import('/src/types/bindings.ts').catch(() => null);
      return mod ? { attackKeyCode: mod.DEFAULT_KEYBOARD_P1_BINDINGS?.attack?.[0]?.keyCode ?? null } : null;
    }).catch(() => null);

    // We already resolved this from source: F = keyCode 70 for P1 attack
    // (src/types/bindings.ts DEFAULT_KEYBOARD_P1_BINDINGS.attack = kb(KC.F), KC.F = 70).
    const attackKey = 'f';

    await settle();
    await page.evaluate(() => window.__pf.restoreInput());

    let keyboardOutcome;
    try {
      await page.focus('canvas');
      await page.keyboard.down(attackKey);
      let st;
      for (let i = 0; i < 6; i++) {
        st = await page.evaluate(() => {
          const s = window.__pf.s;
          s.physicsEngine.resume();
          s.update(0, s.physicsEngine.fixedTimestepMs);
          s.physicsEngine.pause();
          return window.__pf.read();
        });
        if (st.p1.active?.id === 'donkeykong.jab') break;
      }
      await page.keyboard.up(attackKey);
      keyboardOutcome =
        st.p1.active?.id === 'donkeykong.jab'
          ? 'keyboard event routed'
          : `keyboard press did not start jab; active=${JSON.stringify(st.p1.active)}`;
    } catch (error) {
      keyboardOutcome = `exception: ${error.message}`;
    }

    record('keyboardRoute', { attackKeyBindingSource: bindingInfo, attackKeyUsed: attackKey, outcome: keyboardOutcome });
    check('keyboardRoute', 'real keyboard "F" press starts DK jab', keyboardOutcome, () =>
      assert.equal(keyboardOutcome, 'keyboard event routed'),
    );
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${OUT_DIR}/dk-kit-acceptance.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
