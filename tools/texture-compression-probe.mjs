#!/usr/bin/env node
/** KTX2 (UASTC) vs PNG comparison through the production sprite renderer.
 * Prerequisites: `assets/characters/<id>/compressed/index.json` from `npm run assets:compress`, and a
 * Vite dev server (`npx vite --port 5191`). Run under .tmp/dk-heavy.lock:
 *   node tools/texture-compression-probe.mjs [--edge] [--url http://127.0.0.1:5191] [--out dir]
 * Writes report.json plus PNG/KTX2/diff(x8) crops of the worst drawings. Probe only:
 * no production module, asset or setting changes. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const root = resolve(import.meta.dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('--url', 'http://127.0.0.1:5191');
const out = resolve(arg('--out', 'docs/review/2026-10-16/texture-compression-probe'));
const fsUrl = path => `${url}/@fs${path}`;

const cases = [
  { characterId: 'donkeykong', sheet: 'smash', zooms: [1.4] },
  { characterId: 'donkeykong', sheet: 'final_attack', zooms: [1.4, 2.8] },
  { characterId: 'link', sheet: 'smash', zooms: [1.4] },
  { characterId: 'link', sheet: 'idle', zooms: [1.4] },
  { characterId: 'pikachu', sheet: 'idle', zooms: [1.4] },
].map(c => {
  const index = JSON.parse(readFileSync(resolve(root, `assets/characters/${c.characterId}/compressed/index.json`), 'utf8'));
  const row = index.sheets[`animations/${c.sheet}.png`];
  if (!row) throw new Error(`No encoded sheet for ${c.characterId}/${c.sheet}`);
  return { ...c, row: { ...row, ktx2Path: `/characters/${c.characterId}/${row.url}` } };
});

const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9241, bridgePort: 9242 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint) : await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
mkdirSync(out, { recursive: true });
const report = { schema: 'texture-compression-probe/1', browser: edge ? 'Windows Edge (hardware)' : 'Playwright Chromium', url, errors, results: [] };
try {
  await page.goto(`${url}/texture-compression-probe.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__textureProbe, null, { timeout: 300000 });
  await page.evaluate(path => window.__textureProbe.setTranscoderPath(path), fsUrl(resolve(root, 'node_modules/three/examples/jsm/libs/basis')) + '/');
  report.gpu = await page.evaluate(() => window.__textureProbe.gpu());
  report.compressedExtensions = await page.evaluate(() => window.__textureProbe.extensions());
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  for (const c of cases) for (const zoom of c.zooms) {
    const started = Date.now();
    const result = await page.evaluate(request => window.__textureProbe.compare(request), {
      characterId: c.characterId, sheet: c.sheet, ktx2Url: url + c.row.ktx2Path,
      paddedWidth: c.row.width, paddedHeight: c.row.height,
      paletteIndices: [0, 1, 2, 3, 4, 5, 6, 7], zoom, thresholds: [8, 16, 32], exportWorst: 3,
    });
    const label = `${c.characterId}-${c.sheet}-z${zoom}`;
    result.worst = result.worst.map((w, i) => {
      const files = {};
      for (const kind of ['png', 'ktx2', 'diff']) {
        const file = `${label}-worst${i + 1}-p${w.paletteIndex}-f${w.frame}-${kind}.png`;
        writeFileSync(resolve(out, file), Buffer.from(w[kind].split(',')[1], 'base64'));
        files[kind] = file;
      }
      return { frame: w.frame, paletteIndex: w.paletteIndex, files };
    });
    const rows = result.rows, n = rows.length, sumPixels = rows.reduce((a, r) => a + r.pixels, 0);
    result.summary = {
      drawings: n, wallSeconds: (Date.now() - started) / 1000,
      worstMaxChannelDiff: Math.max(...rows.map(r => r.maxChannelDiff)),
      minPsnr: Math.min(...rows.map(r => r.psnr)),
      meanPsnr: rows.reduce((a, r) => a + (Number.isFinite(r.psnr) ? r.psnr : 99), 0) / n,
      pixelShareOver: Object.fromEntries(['>8', '>16', '>32'].map(k => [k, rows.reduce((a, r) => a + r.over[k], 0) / sumPixels])),
      worstDrawingShareOver16: Math.max(...rows.map(r => r.over['>16'] / r.pixels)),
      clippedDrawings: rows.filter(r => r.clipped).length,
      controlMaxChannelDiff: Math.max(...rows.map(r => r.control.maxChannelDiff)),
      byCostume: Object.fromEntries([...new Set(rows.map(r => r.paletteIndex))].map(p => {
        const own = rows.filter(r => r.paletteIndex === p), px = own.reduce((a, r) => a + r.pixels, 0);
        return [p, { shareOver16: own.reduce((a, r) => a + r.over['>16'], 0) / px, shareOver32: own.reduce((a, r) => a + r.over['>32'], 0) / px,
          maxChannelDiff: Math.max(...own.map(r => r.maxChannelDiff)) }];
      })),
    };
    report.results.push({ characterId: c.characterId, sheet: c.sheet, encode: c.row, ...result });
    console.log(label, JSON.stringify(result.texture), JSON.stringify(result.summary));
  }
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`Report: ${relative(process.cwd(), resolve(out, 'report.json'))}; page errors: ${errors.length}`);
  await context.close(); await browser.close(); await edge?.close();
}
