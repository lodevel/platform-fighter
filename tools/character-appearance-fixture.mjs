import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';
const value = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = value('url', 'http://127.0.0.1:4173/platform-fighter/appearance-fixture.html');
const out = value('out', '.tmp/appearance-fixture'); await mkdir(out, { recursive: true });
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9233, bridgePort: 9234 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint) : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const report = { url, browser: browser.version(), errors: [], cases: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(url); await page.waitForFunction(() => window.__appearanceFixture); await page.evaluate(() => window.__appearanceFixture.ready);
  report.scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src));
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
  });
  for (const facing of [1, -1]) for (const phase of ['stored', 'computed', 'mixed', 'stored']) {
    const row = await page.evaluate(({ phase, facing }) => window.__appearanceFixture.show(phase, facing, 24), { phase, facing });
    if (phase === 'stored') { assert.equal(row.draws.length, 1); assert.equal(row.nodes.filter(n => n.name.startsWith('computed') && n.visible).length, 0); }
    if (phase === 'computed') { assert.equal(row.draws.length, 0); assert.equal(row.nodes.filter(n => n.name.startsWith('computed') && n.visible).length, 2); }
    if (phase === 'mixed') {
      assert.equal(row.draws.length, 1);
      const hand = row.nodes.find(n => n.name === 'computed-attachment'); assert.ok(hand.visible);
      assert.ok(hand.order > row.nodes.find(n => !n.name && n.visible).order, 'accent geometry follows body sprite in same pass');
    }
    report.cases.push({ phase, facing, ...row });
    await page.screenshot({ path: `${out}/${phase}-${facing}.png` });
  }
  const frozen = await page.evaluate(() => { const f = window.__appearanceFixture; f.show('computed', 1, 12); return [f.show('computed', 1, 90, true), f.show('computed', 1, 90, true)]; });
  assert.equal(frozen[0].diagnostics.age, 12); assert.deepEqual(frozen[0].diagnostics, frozen[1].diagnostics);
  const restored = await page.evaluate(() => window.__appearanceFixture.restore(4)); assert.equal(restored.diagnostics.age, 4);
  const screen = await page.evaluate(() => window.__appearanceFixture.show('computed', 1, 4, false, 'screen'));
  assert.ok(screen.screenNodes.includes('fixture:computed')); assert.ok(!screen.nodes.some(n => n.name === 'computed-body'));
  const returnedToWorld = await page.evaluate(() => window.__appearanceFixture.show('computed', 1, 4, false, 'world'));
  assert.ok(returnedToWorld.nodes.some(n => n.name === 'computed-body'));
  assert.ok(!returnedToWorld.screenNodes.includes('fixture:computed'));
  const disposed = await page.evaluate(() => window.__appearanceFixture.dispose());
  assert.ok(!disposed.nodes.some(n => n.name.startsWith('computed'))); assert.equal(disposed.diagnostics, null);
  const repeated = await page.evaluate(() => window.__appearanceFixture.repeat(20));
  assert.equal(repeated.renderer.geometries, disposed.renderer.geometries);
  assert.equal(repeated.textures.rgbaBytes, disposed.textures.rgbaBytes);
  report.lifecycle = { frozen, restored, screen, returnedToWorld, disposed, repeated };
  report.previews = [];
  for (const phase of ['stored', 'computed', 'mixed']) {
    const preview = await page.evaluate(phase => window.__appearanceFixture.preview(phase), phase);
    assert.ok(preview.width > 0 && preview.height > 0 && preview.opaque > 0);
    await writeFile(`${out}/preview-${phase}.png`, Buffer.from(preview.png.split(',')[1], 'base64'));
    delete preview.png; report.previews.push({ phase, ...preview });
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await context.close(); await browser.close(); await edge?.close(); }
