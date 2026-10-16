/** First-use and repeated Final playback through the actual browser frame loop.
 * Fixtures only grant resources/place actors between activations. During each
 * observation: real DOM press, normal RAF, no step/draw/screenshots/polling. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', 'docs/review/2026-10-16/final-visual-pacing/before');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive: true });
const report = { url, harnessSha256: hash(await readFile(new URL(import.meta.url))), errors: [], cases: [],
  method: 'Fresh browser context per owner, first and repeated Final in the same match/context. Normal saved DOM special press, natural RAF through completion and60post-action fixed ticks. No screenshots, explicit draws, manual steps, polling, or simulation wrappers during observation. Passive upload/compile counters and minimal per-RAF reads add observation overhead.',
  limits: 'First use follows actual application readiness policy; no cache eviction. One Edge/GPU session and bounded fixtures do not establish universal performance, physical-controller feel, source timing parity, or GPU driver compilation time. Deterministic animation density/authority and visual screenshots are qualified by the separate fighter harnesses.' };
const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null,
    p95: sorted[Math.floor(sorted.length * .95)] ?? null, p99: sorted[Math.floor(sorted.length * .99)] ?? null,
    max: sorted.at(-1) ?? null, over25ms: sorted.filter(value => value > 25).length,
    over50ms: sorted.filter(value => value > 50).length, over100ms: sorted.filter(value => value > 100).length };
};
const resourceSummary = diagnostics => ({ rgbaBytes: diagnostics.textures.rgbaBytes,
  residents: diagnostics.textures.resident.length, pending: diagnostics.textures.pending, failures: diagnostics.textures.failures,
  rendererMemory: diagnostics.renderer.memory,
  finalPages: diagnostics.textures.resident.filter(row => /char\.(?:pikachu|link)\.(?:visual_final_|final|fx__pikachu_final|d04final)/.test(row.key)) });
const delta = (before, after) => Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before[key] ?? 0)]));
const edge = await launchWindowsEdgeCdp({ windowsPort: 9237, bridgePort: 9238 });
const browser = await chromium.connectOverCDP(edge.endpoint);
let context;
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
try {
  report.browser = browser.version();
  for (const owner of ['pikachu', 'link']) {
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      const methods = ['compileShader', 'linkProgram', 'createTexture', 'deleteTexture', 'texImage2D', 'texSubImage2D', 'texStorage2D', 'texImage3D', 'texSubImage3D', 'texStorage3D'];
      const counters = new WeakMap();
      const state = window.__finalPacing = { enabled: false, uploads: [], longTasks: [] };
      for (const constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!constructor) continue;
        for (const method of methods) {
          if (!Object.hasOwn(constructor.prototype, method)) continue;
          const original = constructor.prototype[method];
          constructor.prototype[method] = function (...args) {
            let counts = counters.get(this);
            if (!counts) { counts = Object.fromEntries(methods.map(name => [name, 0])); counters.set(this, counts); }
            counts[method]++;
            if (state.enabled && /^(?:tex|compile|link)/.test(method)) {
              const source = args.find(value => value && typeof value === 'object' && 'width' in value && 'height' in value);
              state.uploads.push({ method, now: performance.now(), frame: window.__sim?.frame ?? null,
                ...(source ? { width: source.width, height: source.height } : {}) });
            }
            return Reflect.apply(original, this, args);
          };
        }
      }
      state.counts = () => {
        const gl = document.querySelector('canvas').getContext('webgl2');
        return { ...Object.fromEntries(methods.map(name => [name, 0])), ...counters.get(gl) };
      };
      try { new PerformanceObserver(list => {
        if (state.enabled) for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: false }); } catch {}
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
    const script = await openMatchHost(page, url);
    const bundleSha256 = hash(Buffer.from(await (await fetch(script)).arrayBuffer()));
    const graphics = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
    });
    await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161016, itemFrequency: 'off', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true },
      players: [{ index: 1, characterId: owner, paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }] });
    for (let activation = 0; activation < 2; activation++) {
      const row = { owner, activation, script, bundleSha256, graphics }; report.cases.push(row);
      row.setup = await page.evaluate(({ owner, activation }) => {
        const host = window.__sim, sim = host.match;
        host.manual(true);
        if (activation === 0) for (let tick = 0; tick < 240; tick++) host.step();
        if (sim.finalSmashController.getActive()) throw new Error('Previous Final remains active');
        const floor = sim.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
        for (const [index, actor] of [sim.p1, sim.p2].entries()) {
          actor.resetForRound(floor.position.x + (index ? owner === 'pikachu' ? 120 : -300 : 0), floor.bounds.min.y - actor.getTuning().height / 2);
          actor.setDamagePercent(0); actor.setFacing(index ? -1 : 1);
        }
        for (let tick = 0; tick < 10; tick++) host.step();
        const frame = host.frame;
        for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,
          slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
        sim.consumeFinalEvents(sim.finalSmashController.grantBall(0, frame), frame);
        const binding = host.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(binding => binding.kind === 'keyboard');
        return { buildIdentity: sim.buildIdentity, binding, frame, counters: window.__finalPacing.counts(), diagnostics: host.renderDiagnostics(),
          fighters: [sim.p1, sim.p2].map(actor => ({ position: actor.getPosition(), velocity: actor.getVelocity(), grounded: actor.isGrounded(), facing: actor.getFacing(), damage: actor.getDamagePercent() })) };
      }, { owner, activation });
      row.resourcesBefore = resourceSummary(row.setup.diagnostics); delete row.setup.diagnostics;
      await page.evaluate(() => {
        const host = window.__sim, sim = host.match, state = window.__finalPacing;
        state.uploads = []; state.longTasks = [];
        window.__finalPacingPromise = new Promise((resolve, reject) => {
          const rows = []; let startedAt = 0, activationFrame = null, endedFrame = null;
          const stop = () => { host.manual(true); state.enabled = false; clearTimeout(timer); };
          const timer = setTimeout(() => { stop(); reject(new Error('Natural Final playback exceeded30seconds')); }, 30000);
          const observe = now => {
            try {
              const run = sim.finalSmashController.getActive(), draw = host.presentation(0), control = sim.p1.getFinalSmashControl();
              if (run && activationFrame === null) activationFrame = run.startedFrame;
              const arrows = sim.linkArticles.ancientArrows().map(arrow => arrow.state.phase);
              if (activationFrame !== null && !run && !arrows.length && endedFrame === null) endedFrame = host.frame;
              rows.push({ now, observedAt: performance.now(), frame: host.frame, phase: run?.phase ?? null, age: run?.phaseAge ?? null,
                captures: run?.captures.length ?? 0, damage: sim.p2.getDamagePercent(), arrows,
                control: control && { role: control.role, sheet: control.sheet, age: control.age },
                owner: draw && { key: draw.key, frame: draw.frame, visible: draw.visible, submitted: draw.submitted }, fault: host.fault });
              if (endedFrame !== null && host.frame >= endedFrame + 60) {
                stop(); resolve({ rows, startedAt, activationFrame, endedFrame, counters: state.counts(), uploads: state.uploads,
                  longTasks: state.longTasks, diagnostics: host.renderDiagnostics() });
              } else requestAnimationFrame(observe);
            } catch (error) { stop(); reject(error); }
          };
          requestAnimationFrame(() => { startedAt = performance.now(); state.enabled = true; host.manual(false); requestAnimationFrame(observe); });
        });
      });
      const code = row.setup.binding.keyCode; assert.ok(Number.isInteger(code));
      await page.keyboard.press(String.fromCharCode(code), { delay: 50 });
      const observation = await page.evaluate(() => window.__finalPacingPromise);
      const { diagnostics, ...observed } = observation; Object.assign(row, observed);
      row.resourcesAfter = resourceSummary(diagnostics);
      row.apiDelta = delta(row.setup.counters, row.counters);
      const active = row.rows.filter(sample => sample.phase !== null);
      const gaps = row.rows.slice(1).map((sample, index) => ({ ms: sample.now - row.rows[index].now,
        observedMs: sample.observedAt - row.rows[index].observedAt, fromFrame: row.rows[index].frame, toFrame: sample.frame,
        phase: sample.phase, age: sample.age }));
      row.summary = { observations: row.rows.length, wallMs: row.rows.at(-1).observedAt - row.startedAt,
        activeFixedTicks: row.endedFrame - row.activationFrame, rafGaps: quantiles(gaps.map(gap => gap.ms)),
        wallGaps: quantiles(gaps.map(gap => gap.observedMs)), largestGaps: [...gaps].sort((a, b) => b.ms - a.ms).slice(0, 5),
        missingOwner: active.filter(sample => !sample.owner?.visible || !sample.owner?.submitted).length,
        uniqueOwnerDrawings: new Set(active.map(sample => `${sample.owner?.key}:${sample.owner?.frame}`)).size,
        phases: [...new Set(active.map(sample => sample.phase))], maxCaptures: Math.max(...row.rows.map(sample => sample.captures)),
        maxDamage: Math.max(...row.rows.map(sample => sample.damage)) };
      assert.ok(row.activationFrame !== null && row.endedFrame !== null, 'actual Final starts and finishes');
      assert.equal(row.summary.missingOwner, 0); assert.ok(row.rows.every(sample => sample.fault === null));
      assert.deepEqual(row.resourcesAfter.pending, []); assert.deepEqual(row.resourcesAfter.failures, {});
      if (owner === 'pikachu') { assert.ok(row.summary.maxCaptures > 0); assert.ok(row.summary.maxDamage >= 20); }
      else assert.equal(row.summary.maxDamage, 0);
      console.log(JSON.stringify({ owner, activation, summary: row.summary, apiDelta: row.apiDelta })); await save();
    }
    await context.close(); context = null;
  }
  const compare = arg('compare', null);
  if (compare) {
    const before = JSON.parse(await readFile(compare, 'utf8'));
    report.comparison = { baseline: compare, observations: report.cases.map(row => {
      const old = before.cases.find(sample => sample.owner === row.owner && sample.activation === row.activation);
      assert.deepEqual(row.graphics, old.graphics, 'same GPU comparison');
      assert.deepEqual(row.setup.fighters, old.setup.fighters, 'same action-entry fixture');
      return { owner: row.owner, activation: row.activation, before: old.summary.rafGaps, after: row.summary.rafGaps,
        beforeApi: old.apiDelta, afterApi: row.apiDelta, beforeRgbaBytes: old.resourcesAfter.rgbaBytes,
        afterRgbaBytes: row.resourcesAfter.rgbaBytes, beforeDrawings: old.summary.uniqueOwnerDrawings, afterDrawings: row.summary.uniqueOwnerDrawings };
    }) };
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS_CORRECTNESS_PACING_RECORDED';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack ?? String(error); throw error; }
finally { await context?.close(); await browser.close(); report.cleanup = await edge.close(); await save(); }
