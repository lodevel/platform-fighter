// Character package renderer probe (Phase 6): the same match drawn from legacy sheets and from
// character packages (`?packages=` opt-in), with the package library's GPU accounting and its
// release after the match. No input: fighters stand through their entry and idle.
// Usage: node tools/package-renderer-probe.mjs --out <dir> [--url http://127.0.0.1:4173/platform-fighter/]
//   needs a running preview (npm run preview). Writes <dir>/report.json and PNGs.
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { openMatchHost } from './browser-match-host.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const out = arg('out');
if (!out) { console.error('usage: node tools/package-renderer-probe.mjs --out <dir> [--url <url>]'); process.exit(2); }
const base = arg('url', 'http://127.0.0.1:4173/platform-fighter/');
const FRAMES = 200;
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { base, frames: FRAMES, variants: {}, comparisons: {}, errors: [] };
const config = { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 20261019, itemFrequency: 'off', linkIntroPolicy: 'none',
  players: [{ index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] };

/** One match at `?packages=<flag>`: screenshots of each fighter after FRAMES idle frames, diagnostics, then release. */
async function variant(name, flag, players = config.players) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => report.errors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`${name}: ${message.text().slice(0, 300)}`); });
  await openMatchHost(page, flag === null ? base : `${base}?packages=${flag}`);
  const started = Date.now();
  await page.evaluate(async c => { window.__sim.startMatch(c); window.__sim.manual(true); await window.__sim.ready; }, { ...config, players });
  const readyMs = Date.now() - started;
  const result = await page.evaluate(frames => {
    for (let i = 0; i < frames; i++) window.__sim.step();
    window.__sim.draw();
    const fighters = window.__sim.view().fighters.map(f => ({ playerIndex: f.playerIndex, characterId: f.characterId, position: f.position,
      screen: window.__sim.project(f.position.x, f.position.y), presentation: window.__sim.presentation(f.playerIndex) }));
    const diagnostics = window.__sim.renderDiagnostics();
    return { fighters, packages: window.__menu.packages(), rendererMemory: diagnostics.renderer.memory,
      legacyTextureBytes: diagnostics.textures.textureBytes, legacyResident: diagnostics.textures.resident.length };
  }, FRAMES);
  await page.waitForTimeout(200);
  const shot = await page.screenshot({ path: `${out}/${name}.png` });
  const crops = {};
  for (const fighter of result.fighters) {
    const { x, y } = fighter.screen, clip = { x: Math.max(0, Math.round(x - 160)), y: Math.max(0, Math.round(y - 220)), width: 320, height: 320 };
    crops[fighter.characterId] = clip;
    await page.screenshot({ path: `${out}/${name}-${fighter.characterId}.png`, clip });
  }
  // Leave the match: its lease and appearances release the packages, which unload after the grace period.
  await page.evaluate(() => window.__menu.go('title'));
  await page.waitForTimeout(3500);
  const afterRelease = await page.evaluate(() => window.__menu.packages());
  await page.close();
  report.variants[name] = { flag, readyMs, ...result, crops, afterRelease };
  return { shot, crops };
}

/** Mean absolute RGB difference (0–255) and share of pixels differing by more than 24 over a crop of two screenshots. */
function compare(a, b, clip) {
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  let sum = 0, differing = 0, n = 0;
  for (let y = clip.y; y < clip.y + clip.height; y++) for (let x = clip.x; x < clip.x + clip.width; x++) {
    const i = (y * pa.width + x) * 4, d = (Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2])) / 3;
    sum += d; n++; if (d > 24) differing++;
  }
  return { meanDiff: +(sum / n).toFixed(2), differingShare: +(differing / n).toFixed(4) };
}

const legacy = await variant('legacy', null);
const packaged = await variant('packages-all', 'all');
await variant('mixed-link', 'link');
await variant('dk-costume-2', 'all', [{ ...config.players[0], characterId: 'donkeykong', paletteIndex: 2 }, config.players[1]]);
for (const id of ['link', 'pikachu']) report.comparisons[id] = compare(legacy.shot, packaged.shot, legacy.crops[id]);
await browser.close();
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ comparisons: report.comparisons, errors: report.errors.length,
  packages: Object.fromEntries(Object.entries(report.variants).map(([k, v]) => [k, { readyMs: v.readyMs, gpuBytes: v.packages.gpuBytes,
    resident: v.packages.packages.map(p => `${p.id}:${p.gpuBytes}/${p.estimatedGpuBytes}`), afterRelease: v.afterRelease.packages.length,
    textures: v.rendererMemory.textures, legacyTextureBytes: v.legacyTextureBytes }]) ) }, null, 1));
