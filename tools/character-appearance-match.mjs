/** Real MatchSim/MatchView capability qualification. Run under dk-heavy.lock. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const value = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = value('url', 'http://127.0.0.1:4173/platform-fighter/appearance-match-fixture.html');
const out = value('out', '.tmp/appearance-real-match');
const cdp = value('cdp', null);
assert.ok(!(cdp && process.argv.includes('--edge')), 'Choose --edge or --cdp, not both');
await mkdir(out, { recursive: true });
const report = { url, errors: [], screenshots: [], result: 'RUNNING' };
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9233, bridgePort: 9234 }) : null;
const browser = edge || cdp ? await chromium.connectOverCDP(cdp ?? edge.endpoint)
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', error => report.errors.push(error.message));
try {
  report.browser = browser.version();
  if (edge) await writeFile(`${out}/bridge.json`, JSON.stringify({ endpoint: edge.endpoint, launch: edge.launch, bridge: edge.bridge }, null, 2) + '\n');
  await page.goto(url);
  await page.waitForFunction(() => window.__appearanceMatchFixture);
  await page.evaluate(() => window.__appearanceMatchFixture.ready);
  report.renderer = await page.evaluate(() => window.__appearanceMatchFixture.renderer());
  report.scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src));
  report.scriptHashes = [];
  for (const script of report.scripts) {
    const response = await context.request.get(script);
    assert.equal(response.status(), 200);
    report.scriptHashes.push({ url: script, sha256: createHash('sha256').update(await response.body()).digest('hex') });
  }
  for (const frame of [15, 70, 120, 190, 240, 270, 350, 450]) {
    const observation = await page.evaluate(target => window.__appearanceMatchFixture.runTo(target), frame);
    await page.screenshot({ path: `${out}/frame-${String(frame).padStart(3, '0')}-${observation.mode}.png` });
    report.screenshots.push({ frame, mode: observation.mode, facing: observation.facing });
    if (frame === 270) await page.evaluate(() => window.__appearanceMatchFixture.restore());
  }
  const fixture = await page.evaluate(() => window.__appearanceMatchFixture.report);
  assert.equal(fixture.result, 'PASS');
  assert.equal(fixture.comparison.hashes, 450);
  assert.equal(fixture.comparison.authoritativeFrames, 450);
  assert.equal(fixture.comparison.sourceSocketFrames, 450);
  assert.ok(fixture.modes.stored > 0 && fixture.modes.computed > 0 && fixture.modes.mixed > 0);
  assert.deepEqual([...fixture.facings].sort(), [-1, 1]);
  assert.ok(fixture.maximumAttachmentError < 1e-8 && fixture.maximumRootError < 1e-8);
  assert.equal(fixture.restores.length, 1);
  assert.equal(fixture.pauses.length, 2);
  assert.ok(fixture.pauses.every(row => row.frozen && row.stable));
  report.fixture = fixture;
  report.cleanup = await page.evaluate(() => window.__appearanceMatchFixture.dispose());
  assert.equal(report.cleanup.remainingGeometry, 0);
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = error.stack;
  report.fixture = await page.evaluate(() => window.__appearanceMatchFixture?.report).catch(() => null);
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await context.close();
  await browser.close();
  if (edge) await writeFile(`${out}/cleanup.json`, JSON.stringify(await edge.close(), null, 2) + '\n');
}
