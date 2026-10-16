// Production loading/recovery lifecycle with passive WebGL observation and bounded fault injection.
// Run against an already built preview. Coordinate the browser slot via .tmp/dk-heavy.lock.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {MATCH_URL, openMatchHost} from './browser-match-host.mjs';
import {browserGPUConfiguration, inspectMatchGPU} from './browser-gpu.mjs';

const value = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = value('out', '.tmp/match-shader-preparation-acceptance');
const url = value('url', MATCH_URL);
const cdp = value('cdp', null);
const launch = browserGPUConfiguration('software');
const report = {
  createdAt: new Date().toISOString(), url,
  launch: cdp ? {mode: 'external-windows-edge-cdp', endpoint: cdp,
    ownership: 'Only a newly created dedicated browser context; existing contexts and process lifecycle belong to the external bridge'} : launch.evidence,
  toolSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  scope: 'Real production browser host, fresh page per lifecycle case in an owned dedicated context. WebGL wrappers preserve native calls; only explicitly armed KHR completion results and one selected program link result are overridden. Natural RAF; no screenshots, forced draws, manual simulation steps or shader/texture eviction. Requires native KHR for pending-preparation injection; no extension is fabricated. These tests establish lifecycle correctness, not hardware performance.',
  rows: [], errors: [], consoleErrors: [], networkFailures: [],
};
await mkdir(out, {recursive: true});
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch(launch.launch);
const context = await browser.newContext({viewport: {width: 1280, height: 800}});
report.browserVersion = browser.version();
const config = {
  mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 223016,
  itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: {schemaVersion: 1, meterEnabled: false, smashBallEnabled: false},
  players: [
    {index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1'},
    {index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'ai', aiDifficulty: 'hard'},
  ],
};

function installObservation() {
  const p = window.__shaderLifecycle = {
    armed: false, hold: false, injectLinkFailure: false, failedProgram: null,
    extensionSupported: false, contexts: [], events: [], programs: [],
    readyState: 'not-started', readySnapshot: null, readyError: null,
  };
  const programs = new WeakMap(), shaders = new WeakMap(), current = new WeakMap(), completion = new WeakMap();
  let sequence = 0;
  const program = object => {
    if (!object) return null;
    let row = programs.get(object);
    if (!row) {
      row = {id: ++sequence, shape: false, sources: [], queries: 0, heldQueries: 0,
        completed: false, linked: false, uses: 0, draws: 0};
      programs.set(object, row); p.programs.push(row);
    }
    return row;
  };
  const event = (name, row, detail = {}) => {
    if (p.armed) p.events.push({name, program: row?.id ?? null, shape: row?.shape ?? false,
      at: performance.now(), frame: window.__sim?.frame ?? null, ...detail});
  };
  p.snapshot = () => ({at: performance.now(), frame: window.__sim?.frame ?? null,
    readyState: p.readyState, readyError: p.readyError,
    hold: p.hold, extensionSupported: p.extensionSupported,
    programs: p.programs.map(row => ({...row, sources: [...row.sources]})), events: [...p.events]});
  // WebGL2 inherits some WebGL methods in some browser versions; wrap each own method once.
  for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Constructor) continue;
    for (const name of ['getExtension', 'shaderSource', 'attachShader', 'linkProgram',
      'getProgramParameter', 'useProgram', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      if (!Object.hasOwn(Constructor.prototype, name)) continue;
      const original = Constructor.prototype[name];
      Constructor.prototype[name] = function (...args) {
        const native = original.apply(this, args);
        if (name === 'getExtension' && args[0] === 'KHR_parallel_shader_compile') {
          if (native) {
            completion.set(this, native.COMPLETION_STATUS_KHR);
            p.extensionSupported = true;
            if (!p.contexts.includes(this)) p.contexts.push(this);
          }
        } else if (name === 'shaderSource') {
          const source = String(args[1]);
          shaders.set(args[0], {shape: /uniform\s+int\s+shape\s*;/.test(source) && source.includes('starDistance'), length: source.length});
        } else if (name === 'attachShader') {
          const row = program(args[0]), source = shaders.get(args[1]);
          if (source) { row.shape ||= source.shape; row.sources.push(source); }
        } else if (name === 'linkProgram') {
          event(name, program(args[0]));
        } else if (name === 'getProgramParameter') {
          const row = program(args[0]);
          let returned = native, kind = null;
          if (args[1] === completion.get(this)) {
            kind = 'completion'; row.queries++;
            if (p.armed && p.hold) { returned = false; row.heldQueries++; }
            if (returned === true) row.completed = true;
          } else if (args[1] === this.LINK_STATUS) {
            kind = 'link';
            if (p.armed && p.injectLinkFailure && row.shape &&
                (p.failedProgram === null || p.failedProgram === row.id)) {
              p.failedProgram = row.id; returned = false;
            }
            if (returned === true) row.linked = true;
          }
          if (kind) event(kind, row, {native, returned});
          return returned;
        } else if (name === 'useProgram') {
          current.set(this, args[0]);
          const row = program(args[0]);
          if (row) { row.uses++; if (row.shape) event(name, row); }
        } else if (name.startsWith('draw')) {
          const row = program(current.get(this));
          if (row) { row.draws++; if (row.shape) event(name, row); }
        }
        return native;
      };
    }
  }
}

async function startPending(page) {
  const nativeKHR = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    return Boolean(gl?.getExtension('KHR_parallel_shader_compile'));
  });
  assert.ok(nativeKHR,
    'Actual renderer lacks native KHR_parallel_shader_compile; pending-completion injection cannot run. The production no-KHR synchronous path is valid. Use --cdp <Windows Edge endpoint> with native KHR support for these lifecycle cases.');
  await page.evaluate(config => {
    const p = window.__shaderLifecycle;
    p.armed = true; p.hold = true;
    window.__sim.startMatch(config);
    const probe = window.__sim;
    window.__pendingShaderMatch = probe;
    p.readyState = 'pending';
    probe.ready.then(() => {
      p.readyState = 'resolved'; p.readySnapshot = p.snapshot();
    }, error => {
      p.readyState = 'rejected'; p.readyError = String(error?.message ?? error);
      p.readySnapshot = p.snapshot();
    });
  }, config);
  await page.waitForFunction(() => window.__shaderLifecycle.programs.some(row => row.shape && row.heldQueries >= 2),
    null, {timeout: 30000});
  // Observe several real host frames while native completion is explicitly held.
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({...window.__shaderLifecycle.snapshot(),
    fault: window.__sim.fault, buildIdentity: window.__sim.match.buildIdentity,
    advanceGate: (() => { try { window.__sim.advance(1000 / 60); return 'accepted'; }
      catch (error) { return error.message; } })()}));
  assert.equal(held.readyState, 'pending', 'ready stays pending while KHR is held');
  assert.equal(held.frame, 0, 'natural RAF must not advance the loading match');
  assert.equal(held.fault, null, 'holding shader completion does not fault the match');
  assert.match(held.advanceGate, /Wait for __sim.ready/, 'probe advancement observes the same loading gate');
  assert.ok(held.extensionSupported, 'the actual renderer must support KHR_parallel_shader_compile');
  const shapes = held.programs.filter(row => row.shape);
  assert.ok(shapes.length > 0, 'real hidden shape shader source was linked during loading');
  assert.ok(shapes.every(row => row.draws === 0), 'reserved shape programs are compiled without warm-up draws');
  return held;
}

async function awaitRunning(page) {
  await page.waitForFunction(() => window.__sim?.frame > 10 && !window.__sim.fault, null, {timeout: 300000});
  return page.evaluate(() => ({frame: window.__sim.frame, fault: window.__sim.fault,
    buildIdentity: window.__sim.match.buildIdentity, diagnostics: window.__sim.renderDiagnostics()}));
}

async function assertPollingStopped(page, ids) {
  // Allow the current callback to finish, then compare queries across many poll intervals.
  await page.waitForTimeout(100);
  const count = () => page.evaluate(ids => window.__shaderLifecycle.events.filter(event =>
    event.name === 'completion' && ids.includes(event.program)).length, ids);
  const before = await count();
  await page.waitForTimeout(250);
  const after = await count();
  assert.equal(after, before, 'cancelled shader preparation must stop KHR polling');
  return {programs: ids, before, after, observationMs: 250};
}

async function runCase(name, test, expectedConsole = []) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const row = {case: name, errors: [], consoleErrors: [], networkFailures: [],
    expectedConsole: expectedConsole.map(pattern => pattern.source)};
  report.rows.push(row);
  page.on('pageerror', error => {
    const entry = String(error.stack ?? error); row.errors.push(entry); report.errors.push({case: name, error: entry});
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      const location = message.location();
      let expectedReason = null;
      try {
        const resource = new URL(location.url);
        if (resource.origin === new URL(url).origin && resource.pathname === '/favicon.ico' &&
            /Failed to load resource: the server responded with a status of 404\b/.test(message.text())) {
          expectedReason = 'browser-requested optional favicon';
        }
      } catch {}
      const entry = {text: message.text(), location, expectedReason,
        expected: expectedReason !== null || expectedConsole.some(pattern => pattern.test(message.text()))};
      row.consoleErrors.push(entry); report.consoleErrors.push({case: name, ...entry});
    }
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const entry = {url: response.url(), status: response.status(), statusText: response.statusText(),
      resourceType: response.request().resourceType()};
    row.networkFailures.push(entry); report.networkFailures.push({case: name, ...entry});
  });
  page.on('requestfailed', request => {
    const entry = {url: request.url(), failure: request.failure(), resourceType: request.resourceType()};
    row.networkFailures.push(entry); report.networkFailures.push({case: name, ...entry});
  });
  try {
    await page.addInitScript(installObservation);
    row.bundleUrl = await openMatchHost(page, url);
    assert.ok(row.bundleUrl, 'production bundle URL is observable');
    const response = await page.request.get(row.bundleUrl);
    assert.ok(response.ok(), 'the recorded bundle is retrievable');
    row.bundleSha256 = createHash('sha256').update(await response.body()).digest('hex');
    const expectedBundle = value('expected-bundle', null);
    if (expectedBundle) assert.equal(new URL(row.bundleUrl).pathname.split('/').at(-1), expectedBundle);
    if (report.rows.length > 1) {
      assert.equal(row.bundleUrl, report.rows[0].bundleUrl, 'all lifecycle cases use the same bundle URL');
      assert.equal(row.bundleSha256, report.rows[0].bundleSha256, 'all lifecycle cases use the same exact bundle bytes');
    }
    row.gpu = await inspectMatchGPU(page, 'software');
    row.userAgent = await page.evaluate(() => navigator.userAgent);
    row.gpu.parallelShaderCompile = await page.evaluate(() =>
      Boolean(document.querySelector('canvas')?.getContext('webgl2')?.getExtension('KHR_parallel_shader_compile')));
    if (cdp) {
      assert.match(row.userAgent, /Windows NT/, 'CDP lifecycle qualification requires actual Windows');
      assert.match(row.userAgent, /Edg\/[\d.]+/, 'CDP lifecycle qualification requires actual Edge');
      assert.match(row.gpu.unmaskedRenderer ?? '', /D3D(?:11|12)/i, 'CDP qualification requires an actual D3D context');
      assert.match(row.gpu.unmaskedRenderer ?? '', /Intel|Iris|NVIDIA|GeForce|AMD|Radeon/i);
      assert.doesNotMatch(row.gpu.unmaskedRenderer ?? '', /SwiftShader|llvmpipe|softpipe|lavapipe|Software/i);
    } else {
      assert.match(row.gpu.unmaskedRenderer ?? row.gpu.renderer, /SwiftShader|llvmpipe|softpipe|lavapipe|Software/i,
        'default lifecycle launch requires software rendering');
    }
    await test(page, row);
    const expectedIdentity = value('expected-identity', null);
    if (expectedIdentity) assert.equal(row.held.buildIdentity, expectedIdentity);
    if (report.rows.length > 1) assert.equal(row.held.buildIdentity, report.rows[0].held.buildIdentity);
    assert.deepEqual(row.errors, [], 'no uncaught browser errors');
    assert.deepEqual(row.consoleErrors.filter(entry => !entry.expected), [], 'no unexpected console errors');
    row.result = 'PASS';
  } catch (error) {
    row.result = 'FAIL'; row.failure = String(error.stack ?? error); throw error;
  } finally {
    if (!page.isClosed()) row.observation = await page.evaluate(() => window.__shaderLifecycle?.snapshot()).catch(() => null);
    await page.close();
  }
}

try {
  await runCase('loading-holds-until-real-program-completion', async (page, row) => {
    row.held = await startPending(page);
    await page.evaluate(() => { window.__shaderLifecycle.hold = false; });
    await page.waitForFunction(() => window.__shaderLifecycle.readyState === 'resolved', null, {timeout: 300000});
    row.ready = await page.evaluate(() => window.__shaderLifecycle.readySnapshot);
    const shapes = row.ready.programs.filter(program => program.shape);
    assert.ok(shapes.every(program => program.completed && program.linked), 'shape completion and link validation finish before ready');
    assert.ok(shapes.every(program => program.draws === 0), 'hidden shapes require no warm-up draw before ready');
    assert.equal(row.ready.frame, 0, 'ready resolves before simulation advancement');
    row.running = await awaitRunning(page);
  });

  await runCase('leave-during-pending-preparation', async (page, row) => {
    row.held = await startPending(page);
    const ids = row.held.programs.filter(program => program.heldQueries > 0).map(program => program.id);
    await page.evaluate(() => window.__menu.go('title'));
    await page.waitForFunction(() => window.__menu.screen === 'title');
    row.polling = await assertPollingStopped(page, ids);
    row.afterLeave = await page.evaluate(() => ({screen: window.__menu.screen, faults: window.__menu.faults,
      oldFrame: window.__pendingShaderMatch.frame, readyState: window.__shaderLifecycle.readyState,
      readyError: window.__shaderLifecycle.readyError, dialogCount: document.querySelectorAll('[role="alertdialog"]').length}));
    assert.equal(row.afterLeave.oldFrame, 0);
    assert.equal(row.afterLeave.readyState, 'rejected');
    assert.match(row.afterLeave.readyError, /cancelled/i);
    assert.deepEqual(row.afterLeave.faults, [], 'leaving pending preparation stays out of the fault path');
    assert.equal(row.afterLeave.dialogCount, 0);
    await page.evaluate(config => { window.__shaderLifecycle.hold = false; window.__menu.startMatch(config); }, config);
    row.running = await awaitRunning(page);
  });

  await runCase('simulated-program-link-failure-and-restart', async (page, row) => {
    row.held = await startPending(page);
    await page.evaluate(() => { const p = window.__shaderLifecycle; p.injectLinkFailure = true; p.hold = false; });
    await page.waitForFunction(() => window.__sim.fault !== null);
    assert.ok(await page.getByRole('alertdialog', {name: 'Match stopped', exact: true}).isVisible());
    row.failure = await page.evaluate(() => ({fault: window.__sim.fault, frame: window.__sim.frame,
      failedProgram: window.__shaderLifecycle.failedProgram, readyState: window.__shaderLifecycle.readyState}));
    assert.match(row.failure.fault.message, /shader program failed to link/i);
    assert.equal(row.failure.frame, 0);
    assert.equal(row.failure.readyState, 'rejected');
    assert.ok(row.failure.failedProgram !== null, 'a real shape program link result was overridden');
    row.polling = await assertPollingStopped(page, row.held.programs.filter(program => program.heldQueries > 0).map(program => program.id));
    await page.evaluate(() => { window.__shaderLifecycle.injectLinkFailure = false; });
    await page.getByRole('button', {name: 'Restart match', exact: true}).click();
    row.running = await awaitRunning(page);
    assert.equal(await page.getByRole('alertdialog', {name: 'Match stopped', exact: true}).count(), 0);
  }, [/^THREE\.WebGLProgram: Shader Error/, /^Game screen stopped on match: Could not prepare match: Match shader program failed to link/]);

  await runCase('real-context-loss-during-pending-preparation', async (page, row) => {
    row.held = await startPending(page);
    row.contextLossSupported = await page.evaluate(() => {
      const gl = window.__shaderLifecycle.contexts.find(gl => gl.canvas === document.querySelector('canvas'));
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      window.__shaderContextLoss = extension;
      window.__shaderContextRestored = false;
      gl.canvas.addEventListener('webglcontextrestored', () => { window.__shaderContextRestored = true; }, {once: true});
      extension.loseContext(); return true;
    });
    if (!row.contextLossSupported) {
      row.contextLossResult = 'SKIP: actual renderer does not expose WEBGL_lose_context';
      await page.evaluate(() => { window.__shaderLifecycle.hold = false; });
      row.running = await awaitRunning(page); return;
    }
    await page.waitForFunction(() => window.__sim.fault !== null);
    assert.ok(await page.getByRole('alertdialog', {name: 'Match stopped', exact: true}).isVisible());
    row.lost = await page.evaluate(() => ({fault: window.__sim.fault, frame: window.__sim.frame,
      readyState: window.__shaderLifecycle.readyState, diagnostics: window.__sim.renderDiagnostics()}));
    // Native isContextLost may become true before the asynchronous DOM event.
    // Either observer can own the first fault; both must describe the real loss.
    if (row.lost.fault.phase === 'screen') {
      assert.equal(row.lost.fault.message, 'Could not prepare match: Graphics context lost while preparing match shaders');
    } else {
      assert.equal(row.lost.fault.phase, 'renderer');
      assert.equal(row.lost.fault.message, 'The graphics connection was lost. Wait for it to recover, then restart the match.');
    }
    assert.equal(row.lost.frame, 0);
    assert.equal(row.lost.readyState, 'rejected');
    assert.equal(row.lost.diagnostics.contextLost, true);
    row.polling = await assertPollingStopped(page, row.held.programs.filter(program => program.heldQueries > 0).map(program => program.id));
    await page.evaluate(() => { window.__shaderLifecycle.hold = false; window.__shaderContextLoss.restoreContext(); });
    await page.waitForFunction(() => window.__shaderContextRestored, null, {timeout: 30000});
    assert.ok(await page.getByRole('alertdialog', {name: 'Match stopped', exact: true}).isVisible(),
      'restoration retains the recoverable stopped match until the user restarts');
    await page.getByRole('button', {name: 'Restart match', exact: true}).click();
    row.running = await awaitRunning(page);
    assert.equal(row.running.diagnostics.contextLost, false);
    row.contextLossResult = 'PASS';
  }, [/^Game renderer stopped on match: The graphics connection was lost\. Wait for it to recover, then restart the match\.(?:\s|$)/,
    /^Game screen stopped on match: Could not prepare match: Graphics context lost while preparing match shaders(?:\s|$)/]);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = String(error.stack ?? error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await context.close();
  report.cleanup = {ownedContextClosed: true,
    browserAction: cdp ? 'Disconnected CDP transport; external browser process is not closed' : 'Closed owned Chromium process'};
  await browser.close();
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({result: report.result, report: out + '/report.json',
  cases: report.rows.map(row => ({case: row.case, result: row.result})), failure: report.failure ?? null}, null, 2));
