// Phase 6 match check in a fresh Windows Edge (real GPU): the same seeded four-CPU match drawn
// from legacy sheets and from character packages (`?packages=all`). Every frame is drawn, so the
// game's art selector sees every tick; each fighter's package diagnostics are read every frame.
// Usage: node tools/package-match-probe.mjs --out <dir> [--frames 3600] [--every 600]
//   builds nothing: run `npm run build` first. Serves dist/ itself (vite preview, all interfaces).
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { openMatchHost } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const out = arg('out'), FRAMES = Number(arg('frames', 3600)), EVERY = Number(arg('every', 600));
if (!out) { console.error('usage: node tools/package-match-probe.mjs --out <dir> [--frames 3600] [--every 600]'); process.exit(2); }
await mkdir(out, { recursive: true });
const BASE = 'http://127.0.0.1:4179/platform-fighter/';
const config = { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 20261019, itemFrequency: 'off', linkIntroPolicy: 'none',
  players: [['donkeykong', 0], ['link', 0], ['pikachu', 0], ['donkeykong', 2]].map(([characterId, paletteIndex], i) =>
    ({ index: i + 1, characterId, paletteIndex, inputType: 'ai', aiDifficulty: 'hard' })) };

const preview = spawn('npx', ['vite', 'preview', '--base', '/platform-fighter/', '--host', '0.0.0.0', '--port', '4179', '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 4000));
const edge = await launchWindowsEdgeCdp({ windowsPort: 9255, bridgePort: 9256 });
const report = { frames: FRAMES, config, variants: {}, comparisons: [], errors: [] };
try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  const shots = {};
  for (const [name, flag] of [['legacy', null], ['packages', 'all']]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${name}: ${m.text().slice(0, 300)}`); });
    await openMatchHost(page, flag ? `${BASE}?packages=${flag}` : BASE);
    const started = Date.now();
    await page.evaluate(async c => { window.__sim.startMatch(c); window.__sim.manual(true); await window.__sim.ready; }, config);
    const stats = { readyMs: Date.now() - started, frames: 0, fighterFrames: 0, missing: {}, invisible: 0, actions: {}, shots: [] };
    shots[name] = [];
    for (let done = 0; done < FRAMES; done += EVERY) {
      const chunk = await page.evaluate(([count, packaged]) => {
        const out = { frames: 0, fighterFrames: 0, missing: {}, invisible: 0, actions: {}, ended: false };
        for (let i = 0; i < count; i++) {
          if (window.__sim.view().phase === 'ended') { out.ended = true; break; }
          window.__sim.step(); window.__sim.draw(); out.frames++;
          if (!packaged) continue;
          for (const f of window.__sim.view().fighters) {
            if (!f.visible && f.visible !== undefined) continue;
            const p = window.__sim.presentation(f.playerIndex);
            out.fighterFrames++;
            if (!p || !p.submitted) { out.invisible++; continue; }
            if (p.missingAction) out.missing[`${f.characterId}:${p.missingAction}`] = (out.missing[`${f.characterId}:${p.missingAction}`] ?? 0) + 1;
            out.actions[`${f.characterId}:${p.action}`] = 1;
          }
        }
        return out;
      }, [EVERY, Boolean(flag)]);
      stats.frames += chunk.frames; stats.fighterFrames += chunk.fighterFrames; stats.invisible += chunk.invisible;
      for (const [k, v] of Object.entries(chunk.missing)) stats.missing[k] = (stats.missing[k] ?? 0) + v;
      Object.assign(stats.actions, chunk.actions);
      const file = `${out}/${name}-${String(stats.frames).padStart(5, '0')}.png`;
      shots[name].push(await page.screenshot({ path: file }));
      stats.shots.push(file);
      if (chunk.ended) break;
    }
    stats.actions = Object.keys(stats.actions).length;
    stats.memory = await page.evaluate(() => ({ packages: window.__menu.packages?.(), renderer: window.__sim.renderDiagnostics().renderer.memory }));
    report.variants[name] = stats;
    await context.close();
  }
  // Same seed, same frames: compare the screenshots pixel by pixel over the whole frame.
  shots.legacy.forEach((a, i) => {
    const b = shots.packages[i]; if (!b) return;
    const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
    let sum = 0, differing = 0;
    for (let p = 0; p < pa.data.length; p += 4) {
      const d = (Math.abs(pa.data[p] - pb.data[p]) + Math.abs(pa.data[p + 1] - pb.data[p + 1]) + Math.abs(pa.data[p + 2] - pb.data[p + 2])) / 3;
      sum += d; if (d > 24) differing++;
    }
    report.comparisons.push({ shot: i, meanDiff: +(sum / (pa.data.length / 4)).toFixed(3), differingShare: +(differing / (pa.data.length / 4)).toFixed(5) });
  });
  await browser.close();
} finally {
  await edge.close?.();
  try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* stopped */ }
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ variants: Object.fromEntries(Object.entries(report.variants).map(([k, v]) => [k, { ...v, shots: v.shots.length }])),
  comparisons: report.comparisons, errors: report.errors.slice(0, 5), errorCount: report.errors.length }, null, 1));
