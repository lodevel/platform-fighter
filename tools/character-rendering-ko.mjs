/** Real production Inferno stock-loss flights. No synthetic KO, pose, damage,
 * stage clock, collision or drawing override: step neutral/crouch controls to
 * the authored gaze. One drained SimView per tick is shared with the host;
 * normal RAF flushes it while manual mode prevents simulation advances. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', '.tmp/character-rendering-ko');
await mkdir(out, { recursive: true });
const report = { url, scope: 'Two identical one-stock matches; accepted Inferno gaze kills DK/Pikachu/Link at frame1890 while a crouching DK survives. Every age0..99 and expiry100; both cold/warm resource lifetimes.',
  method: 'Fixed neutral/crouch control trace, normal stage simulation, one host.step SimView capture per tick and natural RAF render. No host.draw or separate sim.view reads during evidence capture.',
  counterLimits: 'Counts main-canvas WebGL API invocations (compileShader/linkProgram/texture uploads), not GPU driver compilation time or physical RAM/VRAM. Baseline first-use work is compared explicitly. Renderer.info and decoded RGBA estimates do not establish JavaScript heap collection.',
  errors: [], runs: [] };
report.harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const edge = await launchWindowsEdgeCdp({ windowsPort: 9237, bridgePort: 9238 });
const browser = await chromium.connectOverCDP(edge.endpoint);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const calls = new WeakMap();
  const methods = ['createShader', 'compileShader', 'linkProgram', 'createTexture', 'deleteTexture', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'texImage3D', 'texSubImage3D', 'texStorage3D'];
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!type) continue;
    for (const method of methods) {
      const original = type.prototype[method];
      if (typeof original !== 'function' || original.__koInstrumented) continue;
      const wrapped = function (...args) {
        let counts = calls.get(this);
        if (!counts) { counts = Object.fromEntries(methods.map(name => [name, 0])); calls.set(this, counts); }
        counts[method]++;
        return Reflect.apply(original, this, args);
      };
      wrapped.__koInstrumented = true;
      type.prototype[method] = wrapped;
    }
  }
  window.__koWebGL = () => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    return { ...Object.fromEntries(methods.map(name => [name, 0])), ...calls.get(gl) };
  };
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
const delta = (before, after) => Object.fromEntries(Object.keys(after).map(key => [key, after[key] - (before[key] ?? 0)]));
const normalized = value => JSON.parse(JSON.stringify(value));
const resourceSummary = diagnostics => ({ residentCount: diagnostics.textures.resident.length,
  rgbaBytes: diagnostics.textures.rgbaBytes, preparedDuringLoadingBytes: diagnostics.textures.preparedDuringLoadingBytes,
  pending: diagnostics.textures.pending, failures: diagnostics.textures.failures, memory: diagnostics.renderer.memory });
try {
  report.browser = browser.version();
  report.script = await openMatchHost(page, url);
  report.graphics = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  const config = { mode: 'stocks', stockCount: 1, stageId: 'inferno', rngSeed: 223017, itemFrequency: 'off', linkIntroPolicy: 'none',
    finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
    players: ['donkeykong', 'pikachu', 'link', 'donkeykong'].map((characterId, index) => ({ index: index + 1, characterId, paletteIndex: index % 3,
      inputType: 'ai', aiDifficulty: 'hard' })) };
  for (let repeat = 0; repeat < 2; repeat++) {
    await launchMatch(page, config);
    await page.waitForLoadState('networkidle');
    const row = { repeat, trace: [], screenshots: [] };
    report.runs.push(row);
    row.setup = await page.evaluate(async () => {
      const host = window.__sim, sim = host.match;
      const inputs = [0, 0, 0, 1].map(moveY => ({ moveX: 0, moveY, jump: false, attack: false, attackHeavy: false,
        special: false, shield: false, dodge: false, grab: false, dropThrough: false }));
      const rendered = () => new Promise(resolve => requestAnimationFrame(resolve));
      const resources = () => ({ diagnostics: host.renderDiagnostics(), counters: window.__koWebGL() });
      const appearance = index => host.presentation(index);
      const read = snapshot => ({ frame: snapshot.frame, hash: sim.getSimDigest().hash,
        stocks: snapshot.hud.players.map(player => player.stocks), flights: snapshot.knockoutFlights ?? [], events: snapshot.events,
        fighters: snapshot.fighters.map((fighter, index) => {
          const actor = sim.playerSlots[index].character;
          return { playerIndex: fighter.playerIndex, eliminated: fighter.eliminated, position: fighter.position, facing: fighter.facing,
            root: actor.getSourceRootPosition(), velocity: actor.getVelocity(), damage: actor.getDamagePercent(),
            hurtboxes: actor.getActiveHurtboxes(), socket: actor.getHeldItemSocket() };
        }), actual: [0, 1, 2].map(appearance), fault: host.fault });
      let last = null;
      for (let tick = 0; tick < 1889; tick++) {
        last = host.step(inputs);
        if (tick % 120 === 119) await rendered();
      }
      await rendered();
      const before = read(last);
      window.__renderingKO = { resources,
        async next(count) {
          const rows = [];
          for (let index = 0; index < count; index++) {
            last = host.step(inputs); // single capture; MatchView already received this same view
            const hash = sim.getSimDigest().hash;
            await rendered(); // app's earlier registered RAF flushes the scene without another SimView
            if (sim.getSimDigest().hash !== hash) throw new Error('RAF rendering changed simulation authority');
            rows.push(read(last));
          }
          return rows;
        },
      };
      return { buildIdentity: sim.buildIdentity, before, resources: resources() };
    });
    assert.equal(row.setup.before.frame, 1889);
    assert.deepEqual(row.setup.before.stocks, [1, 1, 1, 1]);
    assert.deepEqual(row.setup.before.flights, []);
    for (const target of [0, 10, 30, 60, 99, 100]) {
      const count = target + 1 - row.trace.length;
      row.trace.push(...await page.evaluate(count => window.__renderingKO.next(count), count));
      if ([0, 10, 30, 60, 99].includes(target)) {
        const screenshot = `${out}/run-${repeat}-flight-${target}.png`;
        await page.screenshot({ path: screenshot }); row.screenshots.push(screenshot);
      }
    }
    row.after = await page.evaluate(() => window.__renderingKO.resources());
    row.actionDelta = delta(row.setup.resources.counters, row.after.counters);
    row.resourcesBefore = resourceSummary(row.setup.resources.diagnostics);
    row.resourcesAfter = resourceSummary(row.after.diagnostics);
    for (let age = 0; age < 100; age++) {
      const state = row.trace[age];
      assert.equal(state.frame, 1890 + age);
      assert.deepEqual(state.stocks, [0, 0, 0, 1]);
      assert.equal(state.flights.length, 3);
      for (let index = 0; index < 3; index++) {
        const flight = state.flights.find(flight => flight.playerIndex === index), draw = state.actual[index];
        assert.equal(flight.age, age);
        assert.equal(state.fighters[index].eliminated, true);
        assert.ok(draw?.textureResident && draw.submitted && draw.visible, `repeat${repeat}/age${age}/${index}: eliminated native flight submitted`);
        assert.equal(draw.flight.playerIndex, index);
        assert.equal(draw.rotation, flight.rotation); assert.equal(draw.alpha, flight.alpha);
        assert.equal(draw.x, flight.sourceRoot.x); assert.equal(draw.y, flight.sourceRoot.y);
      }
      assert.equal(state.fault, null);
    }
    assert.equal(row.trace[100].frame, 1990);
    assert.deepEqual(row.trace[100].flights, []);
    assert.deepEqual(row.trace[100].actual, [null, null, null]);
    assert.deepEqual(row.resourcesAfter.pending, []); assert.deepEqual(row.resourcesAfter.failures, {});
    // Leave through the real menu to release MatchView-owned geometry/materials;
    // retained cache policy is deliberately unchanged by this refactor.
    await page.evaluate(async () => {
      const resources = window.__renderingKO.resources;
      window.__menu.go('title');
      await new Promise(resolve => requestAnimationFrame(resolve));
      window.__koCleanupResources = resources();
      delete window.__renderingKO;
    });
    row.cleanup = await page.evaluate(() => window.__koCleanupResources);
    console.log(JSON.stringify({ repeat, flightFrames: 100, actionDelta: row.actionDelta, resourcesAfter: row.resourcesAfter,
      cleanupMemory: row.cleanup.diagnostics.renderer.memory }));
    await save();
  }
  assert.deepEqual(report.runs[1].resourcesAfter, report.runs[0].resourcesAfter, 'repeated match has stable decoded resources and renderer allocations');
  assert.deepEqual(resourceSummary(report.runs[1].cleanup.diagnostics), resourceSummary(report.runs[0].cleanup.diagnostics), 'repeated disposal returns to the same cache/allocation baseline');
  const compare = arg('compare', null);
  if (compare) {
    const baseline = JSON.parse(await readFile(compare, 'utf8'));
    for (const row of report.runs) {
      const old = baseline.runs[row.repeat];
      assert.deepEqual(normalized(row.trace), old.trace, `run${row.repeat}: exact authority and submitted KO appearances`);
      assert.deepEqual(row.actionDelta, old.actionDelta, `run${row.repeat}: no new action-time shader or texture API work`);
      assert.deepEqual(row.resourcesBefore, old.resourcesBefore, `run${row.repeat}: same pre-KO shared resources`);
      assert.deepEqual(row.resourcesAfter, old.resourcesAfter, `run${row.repeat}: same post-KO shared resources`);
      assert.deepEqual(resourceSummary(row.cleanup.diagnostics), resourceSummary(old.cleanup.diagnostics), `run${row.repeat}: same disposal baseline`);
    }
    report.comparison = { baseline: compare, matchedTicks: 202, matchedFighterFlightAppearances: 600,
      actionTimeApiDeltasIdentical: true, residentAndRendererAllocationsIdentical: true };
  }
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await save(); await context.close(); await browser.close(); await edge.close(); }
