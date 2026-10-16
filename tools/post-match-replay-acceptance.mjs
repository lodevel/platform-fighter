/** Real match → results → browser download → Node replay → fresh rematch.
 * Run with node --import tsx under .tmp/dk-heavy.lock. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', 'docs/review/2026-10-16/post-match-replay');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const config = { mode: 'stocks', stockCount: 1, stageId: 'flat', rngSeed: 161016, itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
  players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] };
await mkdir(out, { recursive: true });
const report = { url, method: 'One-stock matches end through normal DOM movement and actual blast-zone stock loss, driven by the normal RAF loop. No positions, damage, velocities, result, stock count after start, simulation step, or recording payload is injected. Results Save Replay triggers a real Chromium file download; Node replays those exact bytes.',
  harnessSha256: sha(await readFile(new URL(import.meta.url))), config, errors: [], cases: [] };
let edge, browser, context, browserCdp;
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

async function downloaded(page, directory, label) {
  const completed = new Promise((resolve, reject) => {
    let begun;
    const cleanup = () => { clearTimeout(timer); browserCdp.off('Browser.downloadWillBegin', onBegin); browserCdp.off('Browser.downloadProgress', onProgress); };
    const onBegin = event => { begun = event; };
    const onProgress = event => {
      if (event.guid !== begun?.guid) return;
      if (event.state === 'completed') { cleanup(); resolve({ ...begun, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes }); }
      else if (event.state === 'canceled') { cleanup(); reject(new Error('Browser canceled replay download')); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Replay download timed out')); }, 30000);
    browserCdp.on('Browser.downloadWillBegin', onBegin); browserCdp.on('Browser.downloadProgress', onProgress);
  });
  completed.catch(() => {});
  await page.getByRole('button', { name: 'Save Replay', exact: true }).click();
  const receipt = await completed;
  const bytes = await readFile(path.join(directory, receipt.guid));
  const destination = path.join(out, label + '.replay.json');
  await writeFile(destination, bytes);
  assert.match(receipt.suggestedFilename, /\.replay\.json$/);
  assert.equal(receipt.receivedBytes, bytes.length);
  return { path: destination, suggestedFilename: receipt.suggestedFilename, bytes: bytes.length, sha256: sha(bytes), file: JSON.parse(bytes.toString()) };
}

async function runNaturalMatch(page, direction, rematch) {
  if (rematch) {
    await page.getByRole('button', { name: 'REMATCH', exact: true }).click();
    await page.waitForFunction(() => window.__sim?.ready);
    await page.evaluate(async () => { window.__sim.manual(true); await window.__sim.ready; });
  } else await launchMatch(page, config);
  const initial = await page.evaluate(direction => {
    const host = window.__sim, sim = host.match;
    const bindings = host.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings;
    const binding = bindings[direction === 1 ? 'right' : 'left'].find(row => row.kind === 'keyboard');
    const observed = { sim, initialFrame: host.frame, initialRecording: sim.getRecordingController().getStatus(),
      config: sim.getActiveMatchConfig(), buildIdentity: sim.buildIdentity, deciding: null, lastFault: null };
    window.__postMatchReplayObservation = observed;
    const observe = () => {
      if (window.__sim?.match !== sim) return;
      observed.lastFault = host.fault;
      if (!observed.deciding && sim.matchEndDetector.isMatchOver()) {
        const digest = sim.getSimDigest();
        observed.deciding = { observedFrame: host.frame, endFrame: sim.matchEndDetector.getResultPayload()?.endFrame,
          digest: digest.hash, evidence: digest.text, recording: sim.getRecordingController().getStatus() };
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
    return { initialFrame: observed.initialFrame, initialRecording: observed.initialRecording,
      config: observed.config, buildIdentity: observed.buildIdentity, binding };
  }, direction);
  assert.equal(initial.initialRecording.phase, 'recording');
  assert.ok(initial.initialRecording.frameCount < 12, 'new match starts with a fresh recording');
  const key = String.fromCharCode(initial.binding.keyCode);
  await page.keyboard.down(key);
  await page.evaluate(() => window.__sim.manual(false));
  try {
    await page.waitForFunction(() => window.__postMatchReplayObservation.deciding !== null, null, { timeout: 45000 });
  } finally { await page.keyboard.up(key); }
  await page.getByRole('button', { name: 'Save Replay', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  const live = await page.evaluate(() => {
    const observed = window.__postMatchReplayObservation;
    return { deciding: observed.deciding, result: observed.sim.result, fault: observed.lastFault,
      screen: window.__menu.screen, simulationDisposed: !window.__sim?.match,
      buttonDisabled: document.querySelector('button[aria-describedby="results-replay-status"]')?.disabled ?? null,
      status: document.querySelector('#results-replay-status')?.textContent,
      headline: document.querySelector('.winner h2')?.textContent };
  });
  report.currentMatch = { initial, live };
  console.log(JSON.stringify({ event: 'natural-results', direction, result: live.result }));
  assert.equal(live.screen, 'results'); assert.equal(live.simulationDisposed, true); assert.equal(live.fault, null);
  assert.ok(live.result && live.result.winnerIndex !== null, 'actual stock match has a winner');
  assert.ok(live.result.playerStats.some(player => player.deaths > 0), 'actual stock loss ended the match');
  assert.equal(live.deciding.recording.phase, 'stopped');
  return { direction, initial, live };
}

async function verifyReplay(row, download) {
  // Select Chromium's exact libm trig before gameplay module initializers.
  await import('./node-libm-trig.ts');
  const { deserializeReplayFromString } = await import('../src/replay/ReplayFile.ts');
  const { MatchSim } = await import('../src/sim/MatchSim.ts');
  const file = deserializeReplayFromString((await readFile(download.path)).toString());
  assert.equal(file.format, 'platform-fighter-replay');
  assert.equal(file.rngSeed, config.rngSeed); assert.equal(file.matchConfig.rngSeed, config.rngSeed);
  assert.deepEqual(file.matchConfig, row.initial.config);
  assert.equal(file.metadata.engineVersion, row.initial.buildIdentity);
  assert.equal(file.inputTimeline.playerCount, 2); assert.equal(file.metadata.playerCount, 2);
  const entries = file.inputTimeline.entries;
  assert.ok(entries.length > 30); assert.equal(entries[0].frame, 0);
  assert.ok(entries.some(entry => entry.inputs[0].moveX * row.direction > 0));
  assert.ok(entries.every(entry => entry.inputs[0].moveX * row.direction >= 0));
  assert.equal(file.metadata.durationFrames, entries.at(-1).frame + 1);
  assert.equal(entries.length, row.live.deciding.recording.frameCount);
  const sim = new MatchSim({ matchConfig: file.matchConfig, buildIdentity: file.metadata.engineVersion });
  sim.setRecordedInputs(entries);
  try {
    while (sim.physicsEngine.getFrame() < row.live.deciding.observedFrame) {
      assert.ok(!sim.isFinished, 'replay reaches observed live end frame'); sim.step();
    }
    const actual = sim.getSimDigest();
    if (actual.hash !== row.live.deciding.digest) {
      await writeFile(path.join(out, row.key + '-expected-world.json'), row.live.deciding.evidence);
      await writeFile(path.join(out, row.key + '-replayed-world.json'), actual.text);
    }
    assert.equal(actual.hash, row.live.deciding.digest, 'download reconstructs exact live world digest');
    for (let guard = 0; !sim.isFinished && guard < 600; guard++) sim.step();
    assert.equal(sim.isFinished, true, 'normal ending delay completes');
    assert.deepEqual(JSON.parse(JSON.stringify(sim.result)), row.live.result);
    return { result: 'IDENTICAL', observedFrame: row.live.deciding.observedFrame, decidingFrame: row.live.deciding.endFrame,
      liveDigest: row.live.deciding.digest, replayDigest: actual.hash, replayResult: sim.result,
      inputFrames: entries.length, firstInputFrame: entries[0].frame, lastInputFrame: entries.at(-1).frame,
      metadata: file.metadata, seed: file.rngSeed, version: file.version };
  } finally { sim.dispose(); }
}

try {
  edge = await launchWindowsEdgeCdp({ windowsPort: 9261, bridgePort: 9262 });
  browser = await chromium.connectOverCDP(edge.endpoint);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
  report.browser = browser.version(); report.script = await openMatchHost(page, url);
  report.bundleSha256 = sha(Buffer.from(await (await fetch(report.script)).arrayBuffer()));
  report.graphics = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  const windowsDownloads = edge.launch.profile + '\\replay-downloads';
  const { stdout } = await promisify(execFile)('wslpath', ['-u', windowsDownloads]);
  const downloads = stdout.trim(); await mkdir(downloads, { recursive: true });
  browserCdp = await browser.newBrowserCDPSession();
  const pageCdp = await context.newCDPSession(page);
  const { targetInfo } = await pageCdp.send('Target.getTargetInfo');
  await browserCdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: windowsDownloads,
    eventsEnabled: true, browserContextId: targetInfo.browserContextId });

  for (const [index, direction] of [1, -1].entries()) {
    const key = index ? 'rematch-left' : 'first-right';
    const row = { key, ...await runNaturalMatch(page, direction, index > 0) }; report.cases.push(row);
    delete report.currentMatch;
    const download = await downloaded(page, downloads, key);
    row.download = { ...download, file: undefined };
    row.replay = await verifyReplay(row, download);
    if (index === 0) {
      const repeated = await downloaded(page, downloads, key + '-repeat');
      assert.equal(repeated.sha256, download.sha256, 'repeat saves preserve completed replay bytes');
      row.repeatDownload = { ...repeated, file: undefined };
    } else assert.notEqual(download.sha256, report.cases[0].download.sha256, 'rematch exports its own different inputs');
    row.afterSaveStatus = await page.locator('#results-replay-status').textContent();
    assert.match(row.afterSaveStatus, /Replay download started:/);
    row.screenshot = path.join(out, key + '-results.png');
    await page.screenshot({ path: row.screenshot });
    delete row.live.deciding.evidence;
    console.log(JSON.stringify({ key, result: row.live.result, inputFrames: row.replay.inputFrames, digest: row.replay.replayDigest,
      download: row.download.suggestedFilename }));
    await save();
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack ?? String(error); throw error; }
finally {
  await context?.close(); await browser?.close(); if (edge) report.cleanup = await edge.close();
  await save();
}
