/** Targeted Quick Attack release/steering acceptance through unchanged browser
 * input adapters. Gamepad evidence is explicitly simulated navigator hardware;
 * keyboard evidence uses Playwright DOM key presses. Ground positioning is a
 * fixture; airborne entry uses a real resolved jump. No special/velocity patch. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';
const arg = (name, fallback) => { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', 'docs/review/2026-10-16/pikachu-quick-attack-gravity/before');
const expectFixed = process.argv.includes('--expect-fixed');
const suite = arg('suite', 'ordinary');
assert.ok(['ordinary', 'launch', 'held'].includes(suite), `Unknown suite: ${suite}`);
await mkdir(out, { recursive: true });
const report = { url, suite, phase: expectFixed ? 'fixed-acceptance' : 'before-observation', errors: [], cases: [],
  method: 'Default saved-profile resolution; simulated standard gamepad axes/button3(Y) polled by unchanged navigator adapter, plus real DOM W+G keyboard bindings. host.step() has no injected CharacterInput. Ground positions and60%entry damage are labeled setup; airborne cases use normal jump and launched cases use opponent right-stick up-smash with natural hitlag/hitstun. Manual simulation steps, normal RAF renders.',
  scope: 'Pikachu Quick Attack Up+special then left/right, early first-burst steering and later second-burst steering; ground/air/launched entry and240-tick release timeline. Human physical-controller feel and source-game numeric parity are not claimed.' };
report.harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const edge = await launchWindowsEdgeCdp({ windowsPort: 9237, bridgePort: 9238 });
const browser = await chromium.connectOverCDP(edge.endpoint);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const pads = [0, 1].map(index => ({ id: `Acceptance simulated Standard Gamepad ${index}`, index, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null }));
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
  window.__qaPad = (x = 0, y = 0, pressed = [], index = 0, smashX = 0, smashY = 0) => {
    const pad = pads[index]; pad.axes[2] = smashX; pad.axes[3] = smashY;
    pad.axes[0] = x; pad.axes[1] = y; pad.timestamp = performance.now();
    pad.buttons.forEach((button, index) => { button.pressed = pressed.includes(index); button.touched = button.pressed; button.value = Number(button.pressed); });
  };
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
function summarize(trace) {
  const active = trace.filter(row => row.special?.kind === 'quickAttack');
  const start = trace.findIndex(row => row.special?.kind === 'quickAttack');
  const end = trace.findIndex((row, index) => index > start && !row.special && !row.attack);
  const later = end < 0 ? [] : trace.slice(end + 1).filter(row => !row.grounded && !row.special && !row.attack);
  const afterWarp = trace.filter(row => row.tick >= 40 && row.velocity.y > .01);
  const suspended = later.filter(row => Math.abs(row.velocity.y) < 1e-7);
  const landed = trace.find(row => row.tick > 30 && row.grounded && !row.special && !row.attack);
  return { startedTick: start, endedTick: end, sourceEndFrame: active.at(-1)?.special.frame ?? null,
    secondBurst: active.some(row => row.special.second), firstDownwardAfterWarpTick: afterWarp[0]?.tick ?? null,
    firstDownwardAfterEndTick: later.find(row => row.velocity.y > .01)?.tick ?? null, landedTick: landed?.tick ?? null,
    airbornePostActionFrames: later.length, zeroVerticalPostActionFrames: suspended.length,
    postActionVerticalDisplacement: later.length ? later.at(-1).position.y - later[0].position.y : null,
    stuckAfterAction: later.length >= 30 && suspended.length === later.length,
    before: trace[0], after: trace.at(-1) };
}
const ordinaryCases = [
  ...['ground', 'air'].flatMap(entry => [-1, 1].map(direction => ({ input: 'simulated-gamepad', entry, direction, steerTick: 20 }))),
  ...[-1, 1].map(direction => ({ input: 'simulated-gamepad', entry: 'ground', direction, steerTick: 1 })),
  ...[-1, 1].map(direction => ({ input: 'real-keyboard', entry: 'ground', direction, steerTick: 20 })),
];
const launchCases = ['immediate', 'descending'].flatMap(timing => [-1, 1].map(direction => ({
  input: 'simulated-gamepad', entry: 'launched', direction, steerTick: 20, launchTiming: timing,
})));
const heldCases = ['ground', 'air'].flatMap(entry => [-1, 1].map(direction => ({
  input: 'simulated-gamepad', entry, direction, steerTick: 20, holdSpecial: 181,
})));
const cases = suite === 'launch' ? launchCases : suite === 'held' ? heldCases : ordinaryCases;
try {
  report.browser = browser.version(); report.script = await openMatchHost(page, url);
  report.graphics = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  for (const scenario of cases) {
    const key = `${scenario.input}-${scenario.entry}-${scenario.direction < 0 ? 'left' : 'right'}-steer${scenario.steerTick}${scenario.launchTiming ? `-${scenario.launchTiming}` : ''}${scenario.holdSpecial ? '-heldY' : ''}`;
    const row = { key, ...scenario, trace: [], screenshots: [] }; report.cases.push(row);
    await page.evaluate(() => { window.__qaPad(); window.__qaPad(0, 0, [], 1); });
    await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161016, itemFrequency: 'off', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: scenario.input === 'simulated-gamepad' ? 'gamepad' : 'keyboard_p1',
        ...(scenario.input === 'simulated-gamepad' ? { inputDevice: { kind: 'gamepad', gamepadIndex: 0 } } : {}) },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 1 } }] });
    row.setup = await page.evaluate(async scenario => {
      const host = window.__sim, sim = host.match, actor = sim.p1;
      for (let tick = 0; tick < 240; tick++) host.step();
      const floor = sim.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      const top = floor.bounds.min.y;
      actor.resetForRound(floor.position.x, top - actor.getTuning().height / 2);
      sim.p2.resetForRound(floor.position.x + 460, top - sim.p2.getTuning().height / 2);
      actor.setFacing(scenario.direction);
      for (let tick = 0; tick < 30; tick++) host.step();
      const launchTrace = [];
      if (scenario.entry === 'launched') {
        actor.setDamagePercent(60);
        sim.p2.resetForRound(floor.position.x - 34, top - sim.p2.getTuning().height / 2);
        sim.p2.setFacing(1);
        for (let tick = 0; tick < 15; tick++) host.step();
        let sawHit = false;
        for (let tick = 0; tick < 240; tick++) {
          // Right-stick up enters the unchanged gamepad smash binding; this
          // produces a real sourced attack/contact and reference launch.
          window.__qaPad(0, 0, [], 1, 0, tick === 0 ? -1 : 0);
          const view = host.step(); await new Promise(resolve => requestAnimationFrame(resolve));
          const state = { tick, frame: view.frame, damage: actor.getDamagePercent(), grounded: actor.isGrounded(),
            hitlag: actor.getHitlagRemaining(), hitstun: actor.getHitstunRemaining(), position: actor.getPosition(), velocity: actor.getVelocity(),
            referenceLaunch: actor.referenceLaunch ? structuredClone(actor.referenceLaunch) : null,
            launchVelocity: actor.launchVelocity && { ...actor.launchVelocity },
            opponentAttack: sim.p2.getActiveAttack()?.move.id ?? null,
            opponentInput: host.inputResolver.snapshotSlot(sim.playerSlots[1].bindingsSlot) };
          launchTrace.push(state); sawHit ||= state.damage > 60;
          if (sawHit && state.hitlag === 0 && state.hitstun === 0 && !state.grounded && state.referenceLaunch &&
              (scenario.launchTiming === 'immediate' || state.velocity.y > 0)) break;
        }
      }
      const slot = sim.playerSlots[0].bindingsSlot, bindings = host.inputResolver.dispatcher.bindings.get(slot);
      const keyboard = Object.fromEntries(['up', 'left', 'right', 'special', 'jump'].map(action => [action,
        bindings.bindings[action].find(binding => binding.kind === 'keyboard')?.keyCode ?? null]));
      if (scenario.entry === 'air') {
        window.__qaPad(0, 0, [0]); host.step(); window.__qaPad();
        for (let tick = 0; tick < 15; tick++) host.step();
      }
      let current = 0;
      const read = (view, tick) => {
        const attack = actor.getActiveAttack();
        const draw = host.presentation(0);
        return { tick, frame: view.frame, position: actor.getPosition(), root: actor.getSourceRootPosition(), velocity: actor.getVelocity(),
          grounded: actor.isGrounded(), helpless: actor.isHelpless(), ignoreGravity: actor.body.ignoreGravity ?? false,
          sleeping: actor.body.isSleeping, static: actor.body.isStatic, frictionAir: actor.body.frictionAir,
          hitlag: actor.getHitlagRemaining(), hitstun: actor.getHitstunRemaining(), damage: actor.getDamagePercent(),
          referenceLaunch: actor.referenceLaunch ? structuredClone(actor.referenceLaunch) : null,
          launchVelocity: actor.launchVelocity && { ...actor.launchVelocity },
          gravityDose: actor.pikachuLastGravityDose, referenceStunnedStep: actor.referenceStunnedStep,
          pendingKnockback: actor.pendingKnockback ? { velocity: actor.pendingKnockback.velocity,
            hitstunFrames: actor.pendingKnockback.hitstunFrames, referenceLaunch: actor.pendingKnockback.referenceLaunch } : null,
          special: actor.getPikachuSpecialState(), attack: attack && { id: attack.move.id, frame: attack.framesElapsed, gravityScale: attack.move.gravityScale },
          jumpsUsed: actor.getJumpsUsed(), input: host.inputResolver.snapshotSlot(slot),
          capturedInput: sim.getInputCaptureBuffer().getFrame(sim.physicsEngine.getFrame() - 1)?.inputs[0] ?? null,
          draw: draw && { key: draw.key, frame: draw.frame, x: draw.x, y: draw.y, visible: draw.visible, submitted: draw.submitted,
            rotation: draw.rotation, flipX: draw.flipX }, fault: host.fault };
      };
      window.__qaGravity = {
        async advance(until) {
          const rows = [];
          while (current < until) {
            if (scenario.input === 'simulated-gamepad') {
              window.__qaPad(current < scenario.steerTick ? 0 : current < 81 ? scenario.direction : 0,
                current < scenario.steerTick ? -1 : 0, current < (scenario.holdSpecial ?? 1) ? [3] : []);
            }
            const view = host.step(); // normal GameplayInput -> resolver -> simulation path
            await new Promise(resolve => requestAnimationFrame(resolve));
            rows.push(read(view, current++));
          }
          return rows;
        },
      };
      return { buildIdentity: sim.buildIdentity, bindings, keyboard, resolvedSlot: slot, initialGrounded: actor.isGrounded(),
        initialPosition: actor.getPosition(), initialVelocity: actor.getVelocity(), initialSpecial: actor.getPikachuSpecialState(),
        savedProfiles: localStorage.getItem('platformfighter.inputProfiles.v1'), fixedStepMs: sim.physicsEngine.fixedTimestepMs, launchTrace };
    }, scenario);
    assert.equal(row.setup.initialGrounded, scenario.entry === 'ground', `${key} actual entry state`);
    if (scenario.entry === 'launched') {
      assert.ok(row.setup.launchTrace.some(state => state.damage > 60 && state.referenceLaunch), `${key} genuine source contact/launch`);
      const entry = row.setup.launchTrace.at(-1);
      assert.equal(entry.hitstun, 0, `${key} hitstun completed naturally`);
      assert.ok(entry.referenceLaunch, `${key} retained reference launch at recovery entry`);
    }
    const keyName = code => code === 32 ? 'Space' : String.fromCharCode(code);
    const advance = async until => row.trace.push(...await page.evaluate(until => window.__qaGravity.advance(until), until));
    if (scenario.input === 'real-keyboard') {
      await page.keyboard.down(keyName(row.setup.keyboard.up)); await page.keyboard.down(keyName(row.setup.keyboard.special));
      await advance(1); await page.keyboard.up(keyName(row.setup.keyboard.special));
      await advance(scenario.steerTick); await page.keyboard.up(keyName(row.setup.keyboard.up));
      await page.keyboard.down(keyName(row.setup.keyboard[scenario.direction < 0 ? 'left' : 'right']));
    }
    for (const until of [41, 81, 121, 241]) {
      await advance(until);
      if (scenario.input === 'real-keyboard' && until === 81) await page.keyboard.up(keyName(row.setup.keyboard[scenario.direction < 0 ? 'left' : 'right']));
      const path = `${out}/${key}-tick${until - 1}.png`; await page.screenshot({ path }); row.screenshots.push(path);
    }
    row.summary = summarize(row.trace);
    assert.equal(row.trace[0].input.special, true, `${key} special enters through resolved browser input`);
    assert.equal(row.trace[0].input.moveUp, true, `${key} up enters through resolved browser input`);
    assert.ok(row.trace.some(state => state.special?.kind === 'quickAttack'), `${key} starts actual Quick Attack`);
    assert.ok(row.trace.every(state => state.fault === null), `${key} no runtime fault`);
    assert.ok(row.trace.every(state => [state.position.x, state.position.y, state.velocity.x, state.velocity.y].every(Number.isFinite)), `${key} finite trajectory`);
    if (expectFixed) {
      assert.ok(!row.summary.stuckAfterAction, `${key} ordinary gravity must resume after action`);
      if (scenario.entry === 'launched') assert.equal(row.trace[0].referenceLaunch, null, `${key} Quick Attack replaces preceding launch ownership`);
      if (scenario.steerTick > 1) assert.ok(row.summary.firstDownwardAfterWarpTick !== null, `${key} upward recovery must lead to descent`);
      assert.ok(row.summary.landedTick !== null, `${key} returns to the floor after releasing the stick`);
    }
    console.log(JSON.stringify({ key, summary: { ...row.summary, before: undefined, after: undefined } }));
    await save();
  }
  assert.deepEqual(report.errors, []);
  report.result = expectFixed ? 'PASS' : report.cases.some(row => row.summary.stuckAfterAction) ? 'BUG_REPRODUCED' : 'OBSERVED_NO_STUCK_POST_ACTION';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await save(); await context.close(); await browser.close(); await edge.close(); }
