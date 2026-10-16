/** Standalone dist qualification: direct files only, no Vite/source/private
 * middleware, response interception, renderer patches, or hazard clock edits. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
const dist = await realpath(arg('dist', 'dist'));
const out = arg('out', 'docs/review/2026-10-16/inferno-shipped-head/after');
const port = Number(arg('port', '4194'));
const base = '/platform-fighter/';
const url = `http://127.0.0.1:${port}${base}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(out, { recursive: true });
const report = { url, errors: [], networkFailures: [], samples: [],
  server: { kind: 'node:http direct immutable dist files', root: dist, base, sourceMiddleware: false, privateMiddleware: false },
  scope: 'The actual Inferno match runs genuine fixed ticks into rising and glare. Image request bytes/MIME are checked against the committed manifest asset. Screenshots require visual inspection for the actual head artwork, beyond network success. No physical-controller or hazard gameplay audit is claimed.' };
report.harnessSha256 = sha(await readFile(new URL(import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, url).pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = await realpath(path.resolve(dist, relative));
    if (!file.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
});
let edge, browser, context;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  const sourceBytes = await readFile('assets/stages/inferno-head.png');
  const shippedBytes = await readFile(path.join(dist, 'stages/inferno-head.png'));
  report.asset = { source: 'assets/stages/inferno-head.png', shipped: path.join(dist, 'stages/inferno-head.png'),
    bytes: shippedBytes.length, sourceSha256: sha(sourceBytes), shippedSha256: sha(shippedBytes) };
  assert.equal(report.asset.shippedSha256, report.asset.sourceSha256, 'dist ships the exact manifest PNG');
  report.privateRoutes = [];
  for (const relative of ['private/inferno-head.png', 'port/private/inferno-head.png']) {
    const response = await fetch(new URL(relative, url));
    report.privateRoutes.push({ url: response.url, status: response.status });
    assert.equal(response.status, 404, 'plain dist has no private image route');
  }

  edge = await launchWindowsEdgeCdp({ windowsPort: 9237, bridgePort: 9238 });
  browser = await chromium.connectOverCDP(edge.endpoint);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
  page.on('requestfailed', request => report.networkFailures.push({ url: request.url(), error: request.failure() }));
  report.browser = browser.version();
  report.script = await openMatchHost(page, url);
  await page.evaluate(() => window.__menu.go('title'));
  await page.waitForFunction(() => /^\d+ FPS$/.test(document.querySelector('.frame-rate-meter')?.textContent ?? ''));
  report.menuFrameRate = await page.locator('.frame-rate-meter').evaluate(node => ({
    text: node.textContent, pointerEvents: getComputedStyle(node).pointerEvents,
    connected: node.isConnected, screen: window.__menu.screen,
  }));
  assert.equal(report.menuFrameRate.pointerEvents, 'none');
  assert.equal(report.menuFrameRate.screen, 'title');
  await page.screenshot({ path: `${out}/fps-title.png` });
  report.bundleSha256 = sha(Buffer.from(await (await fetch(report.script)).arrayBuffer()));
  report.graphics = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  // Observe the unmodified TextureLoader request initiated by entering Inferno.
  const imageResponse = page.waitForResponse(response => response.url() === new URL('stages/inferno-head.png', url).href);
  await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'inferno', rngSeed: 161016,
    itemFrequency: 'off', linkIntroPolicy: 'none', finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
    players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] });
  const response = await imageResponse;
  const imageBytes = await response.body(), png = PNG.sync.read(imageBytes);
  report.imageRequest = { url: response.url(), status: response.status(), contentType: response.headers()['content-type'],
    resourceType: response.request().resourceType(), bytes: imageBytes.length, sha256: sha(imageBytes), width: png.width, height: png.height };
  assert.equal(report.imageRequest.status, 200);
  assert.equal(report.imageRequest.contentType, 'image/png');
  assert.equal(report.imageRequest.resourceType, 'image', 'actual TextureLoader image request');
  assert.equal(report.imageRequest.sha256, report.asset.sourceSha256);
  assert.equal(png.width, 1024); assert.equal(png.height, 1024);

  report.frameRatePlayback = await page.evaluate(async () => {
    const host = window.__sim, beforeFrame = host.frame;
    const observations = [];
    host.manual(false);
    await new Promise(resolve => {
      let started = null;
      const observe = now => {
        started ??= now;
        observations.push({ now, text: document.querySelector('.frame-rate-meter')?.textContent ?? null });
        if (now - started >= 2200) { host.manual(true); resolve(); }
        else requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    const comparisons = observations.flatMap((row, index) => {
      if (row.now - observations[0].now < 1200 || row.text === observations[index - 1]?.text) return [];
      const observedFps = observations.filter(sample => sample.now > row.now - 1000 && sample.now <= row.now).length;
      return [{ now: row.now, displayed: Number.parseInt(row.text), observedFps }];
    });
    // A steady cadence may retain the same rounded label throughout the window.
    const final = observations.at(-1);
    if (!comparisons.length) comparisons.push({ now: final.now, displayed: Number.parseInt(final.text),
      observedFps: observations.filter(sample => sample.now > final.now - 1000).length });
    return { beforeFrame, afterFrame: host.frame, durationMs: final.now - observations[0].now,
      observedRafFrames: observations.length, comparisons, fault: host.fault };
  });
  assert.ok(report.frameRatePlayback.afterFrame > report.frameRatePlayback.beforeFrame, 'normal RAF advances the match');
  assert.equal(report.frameRatePlayback.fault, null);
  for (const comparison of report.frameRatePlayback.comparisons)
    assert.ok(Math.abs(comparison.displayed - comparison.observedFps) <= 2, 'displayed FPS agrees with independently observed RAF cadence');

  for (const target of [1499, 1620, 1740, 1840]) {
    const sample = await page.evaluate(async target => {
      const host = window.__sim, sim = host.match;
      while (host.frame < target) host.step();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { frame: host.frame, buildIdentity: sim.buildIdentity, fault: host.fault,
        frameRateText: document.querySelector('.frame-rate-meter')?.textContent ?? null,
        gaze: sim.baseStage.gazeHazards.map(hazard => ({ frame: hazard.getFrame(), ...hazard.getPhase() })),
        actualImageResources: performance.getEntriesByType('resource').filter(entry => entry.name.includes('inferno-head')).map(entry => ({
          url: entry.name, initiatorType: entry.initiatorType, transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })),
        renderer: host.renderDiagnostics() };
    }, target);
    sample.screenshot = `${out}/inferno-frame${target}.png`;
    await page.screenshot({ path: sample.screenshot });
    report.samples.push(sample);
    assert.equal(sample.frame, target);
    assert.equal(sample.fault, null);
    assert.match(sample.frameRateText, /^\d+ FPS$/, 'FPS remains present in the real match');
    assert.equal(sample.gaze[0]?.phase, target < 1500 ? 'dormant' : target < 1740 ? 'rising' : 'glare');
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkFailures, []);
  report.result = 'PASS_NETWORK_AND_RUNTIME_AWAITING_VISUAL_REVIEW';
  console.log(JSON.stringify({ result: report.result, image: report.imageRequest, samples: report.samples.map(row => ({ frame: row.frame, gaze: row.gaze })) }));
} catch (error) { report.result = 'FAIL'; report.failure = error.stack ?? String(error); throw error; }
finally {
  await context?.close(); await browser?.close();
  if (edge) report.cleanup = await edge.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
