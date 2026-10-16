/** Real menu consumers under a deterministic display clock. Match/result data
 * are explicit UI fixtures; this does not claim a played match or input audit. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const out = arg('out', '.tmp/character-rendering-menus');
await mkdir(out, { recursive: true });
const report = { url, scope: 'Actual stages/results screens with three-player configuration and result-payload fixtures; deterministic display clock. No played-match or DOM-input claim.',
  diagnosticLimit: 'Preserved build __menu.presentation returns selected draws with decoded resource status; candidate returns the last actual submitted textured quads. Exact common drawing fields are compared.',
  harnessSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), errors: [], rows: [] };
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9235, bridgePort: 9236 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint)
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const clock = { now: 0,
    async advance(ticks) {
      for (let n = 0; n < ticks; n++) {
        clock.now += 1000 / 60;
        await new Promise(resolve => raf(() => raf(resolve)));
      }
    },
  };
  // Native RAF still runs and paints normally; the game's supplied display
  // timestamp stays fixed while its asynchronous textures finish loading.
  Object.defineProperty(performance, 'now', { value: () => clock.now });
  window.requestAnimationFrame = callback => raf(() => callback(clock.now));
  window.__menuTestClock = clock;
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const players = ['donkeykong', 'pikachu', 'link'].map((characterId, i) => ({ index: i + 1, characterId,
  paletteIndex: i + 1, inputType: i ? 'ai' : 'keyboard_p1', ...(i ? { aiDifficulty: 'normal' } : {}) }));
const pending = { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 161026, itemFrequency: 'off', players };

async function sample(row, elapsed) {
  // Waiting never advances the game's fixed display clock.
  await page.waitForFunction(() => {
    const draws = window.__menu.presentation();
    return draws.length === 3 && draws.every(draw => draw.loaded && draw.frameWidth > 0 && draw.frameHeight > 0);
  }, null, { timeout: 300000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const draws = await page.evaluate(() => window.__menu.presentation());
  assert.equal(draws.length, 3, row.key + ' has three fighters');
  assert.deepEqual(draws.map(draw => draw.key.split('.')[1]), ['donkeykong', 'pikachu', 'link']);
  assert.ok(draws.every(draw => draw.loaded && (draw.alpha ?? 1) > 0), row.key + ' loaded visible drawings');
  const path = `${out}/${row.key}-${elapsed}.png`;
  await page.screenshot({ path });
  row.samples.push({ elapsed, draws: JSON.parse(JSON.stringify(draws)) }); row.screenshots.push(path);
}

try {
  report.browser = browser.version();
  report.script = await openMatchHost(page, url);
  report.graphics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  for (const stageId of ['flat', 'lava']) {
    await page.evaluate(pending => window.__menu.go('stages', { pending }), { ...pending, stageId });
    const row = { key: `stages-${stageId}`, samples: [], screenshots: [] };
    report.rows.push(row);
    await sample(row, 0);
    await page.evaluate(() => window.__menuTestClock.advance(40));
    await sample(row, 40);
    assert.equal(await page.evaluate(() => window.__menu.screen), 'stages');
    assert.ok(row.samples.every(sample => sample.draws.every(draw => draw.key.endsWith('.idle'))), 'stage lineup uses idle appearance');
    console.log(JSON.stringify({ key: row.key, samples: row.samples.length }));
  }
  for (const winnerIndex of [2, 0]) {
    const result = { mode: 'stocks', winnerIndex, winnerName: winnerIndex === 2 ? 'Link' : 'Donkey Kong',
      finalStocks: players.map((_, index) => index === winnerIndex ? 2 : 0),
      playerNames: ['Donkey Kong', 'Pikachu', 'Link'], endFrame: 3600, stageName: 'flat', playerStats: null };
    await page.evaluate(({ pending, result }) => window.__menu.go('results', { pending, result }), { pending, result });
    const row = { key: winnerIndex === 2 ? 'results-link-winner' : 'results-link-loser', samples: [], screenshots: [] };
    report.rows.push(row);
    await sample(row, 0);
    let previous = 0;
    for (const elapsed of [45, 190]) {
      await page.evaluate(ticks => window.__menuTestClock.advance(ticks), elapsed - previous);
      await sample(row, elapsed); previous = elapsed;
    }
    assert.equal(await page.evaluate(() => window.__menu.screen), 'results');
    assert.equal(await page.locator('.winner h2').textContent(), `${result.winnerName.toUpperCase()} WINS`);
    assert.ok(row.samples.every(sample => sample.draws.slice(0, 2).every(draw => draw.key.endsWith('.idle'))), 'other participants retain idle lineup');
    const linkKeys = row.samples.map(sample => sample.draws[2].key);
    if (winnerIndex === 2) {
      assert.ok(linkKeys.every(key => /^char\.link\.j02win/.test(key)), 'Link source victory drawings');
      assert.ok(linkKeys.at(-1).includes('wait'), 'Link victory enters wait loop');
    } else assert.ok(linkKeys.every(key => /lose/.test(key)), 'Link source loss drawings');
    console.log(JSON.stringify({ key: row.key, samples: row.samples.length, linkKeys }));
  }
  report.faults = await page.evaluate(() => window.__menu.faults);
  assert.deepEqual(report.faults, []); assert.deepEqual(report.errors, []);
  const compare = arg('compare', null);
  if (compare) {
    const baseline = JSON.parse(await readFile(compare, 'utf8'));
    assert.deepEqual(report.rows.map(row => row.key), baseline.rows.map(row => row.key));
    for (const [index, row] of report.rows.entries()) assert.deepEqual(row.samples, baseline.rows[index].samples, row.key + ' exact drawing fields');
    report.comparison = { baseline: compare, matchedLineupSamples: report.rows.reduce((count, row) => count + row.samples.length, 0),
      matchedFighterDraws: report.rows.reduce((count, row) => count + row.samples.length * 3, 0) };
  }
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close(); await edge?.close();
}
