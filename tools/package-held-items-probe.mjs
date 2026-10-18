// Phase 6 held-item check in a fresh Windows Edge (real GPU): each fighter holding an item during a held
// package drawing, drawn from legacy sheets and from character packages (`?packages=all`), same seeded CPU
// match, same frame. The frames come from tools/held-item-drift.ts (its `shots`: the worst bat or sword frame
// per fighter, else the worst with any item). Each crop is saved raw and with the gameplay grip (red) and the
// package grip (green) marked; the item's bottom should sit on red in legacy and on green with packages.
// Usage: node tools/package-held-items-probe.mjs --drift <drift.json> --out <dir> [--only pikachu,link]
//   builds nothing: run `npm run build` first. Serves dist/ itself (vite preview, all interfaces).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { openMatchHost } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const out = arg('out'), drift = arg('drift');
if (!out || !drift) { console.error('usage: node tools/package-held-items-probe.mjs --drift <drift.json> --out <dir>'); process.exit(2); }
await mkdir(out, { recursive: true });
const PORT = 4183, BASE = `http://127.0.0.1:${PORT}/platform-fighter/`, W = 1920, H = 1080, HALF = 160;
const only = arg('only')?.split(',');
const shots = Object.fromEntries(Object.entries(JSON.parse(readFileSync(drift, 'utf8')).shots).filter(([id]) => !only || only.includes(id)));

/** In the page: run the match to `frame` (stepping updates the view and its art selectors every tick), draw it. */
const reach = (page, shot) => page.evaluate(async ({ shot }) => {
  window.__sim.startMatch(shot.config);
  const host = window.__sim; // the match screen's own probe
  host.manual(true); await host.ready;
  while (host.frame < shot.frame) host.step();
  host.draw();
  const view = host.view(), item = view.items.find(i => i.held?.playerIndex === shot.playerIndex);
  const point = p => host.project(p.x, p.y);
  return { frame: view.frame, item: item && { type: item.type, legacyRoot: item.rootPosition }, presentation: host.presentation(shot.playerIndex),
    effects: host.presentationSprites().map(e => `${e.art?.action ?? e.key}${e.space === 'screen' ? ' (screen)' : ''}${e.fromPackage ? ' (package)' : ''}`),
    centre: point(shot.centre), legacy: point(shot.legacyRoot), package: point(shot.packageRoot) };
}, { shot });

function crop(png, [cx, cy], marks) {
  const x0 = Math.max(0, Math.round(cx - HALF)), y0 = Math.max(0, Math.round(cy - HALF));
  const w = Math.min(W, x0 + 2 * HALF) - x0, h = Math.min(H, y0 + 2 * HALF) - y0, raw = new PNG({ width: w, height: h });
  PNG.bitblt(png, raw, x0, y0, w, h, 0, 0);
  const marked = new PNG({ width: w, height: h });
  raw.data.copy(marked.data);
  for (const [p, rgb] of marks) for (let d = -6; d <= 6; d++) for (const [x, y] of [[p.x - x0 + d, p.y - y0], [p.x - x0, p.y - y0 + d]]) {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const q = (py * w + px) * 4; marked.data[q] = rgb[0]; marked.data[q + 1] = rgb[1]; marked.data[q + 2] = rgb[2]; marked.data[q + 3] = 255;
  }
  return { raw, marked, box: [x0, y0, w, h] };
}

const report = { drift, shots: {}, errors: [] };
const preview = spawn('npx', ['vite', 'preview', '--base', '/platform-fighter/', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 4000));
const edge = await launchWindowsEdgeCdp({ windowsPort: 9275, bridgePort: 9276 });
try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  for (const [fighter, shot] of Object.entries(shots)) {
    const result = { item: shot.item, seed: shot.seed, frame: shot.frame, state: shot.state, driftPx: shot.distance, driftDeg: shot.angle, variants: {} };
    for (const [variant, flag] of [['legacy', 'none'], ['packages', 'all']]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push(`${fighter}/${variant}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') report.errors.push(`${fighter}/${variant}: ${m.text().slice(0, 300)}`); });
      await openMatchHost(page, `${BASE}?packages=${flag}`);
      const at = await reach(page, shot), png = PNG.sync.read(await page.screenshot());
      const cut = crop(png, [at.centre.x, at.centre.y], [[at.legacy, [255, 40, 40]], [at.package, [40, 255, 80]]]);
      const name = `${out}/${fighter}-${shot.item}-${variant}`;
      writeFileSync(`${name}.png`, PNG.sync.write(cut.raw));
      writeFileSync(`${name}-frame.png`, PNG.sync.write(png));
      writeFileSync(`${name}-marked.png`, PNG.sync.write(cut.marked));
      const p = at.presentation ?? {};
      result.variants[variant] = { frame: at.frame, item: at.item?.type ?? null,
        sameState: Boolean(at.item) && Math.hypot(at.item.legacyRoot.x - shot.legacyRoot.x, at.item.legacyRoot.y - shot.legacyRoot.y) < 1e-6,
        fighterArt: p.capability ?? null, action: p.action ?? p.display?.action ?? null, drawing: p.drawing ?? null, tick: p.display?.tick ?? null,
        effects: at.effects, legacyGripPx: at.legacy, packageGripPx: at.package, crop: cut.box };
      await context.close();
    }
    report.shots[fighter] = result;
  }
  await browser.close();
} finally {
  await edge.close?.();
  try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* stopped */ }
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
