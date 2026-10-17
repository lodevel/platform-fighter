#!/usr/bin/env node
/** Full-character match comparison of the two texture qualities ('full' PNG vs
 * 'compressed' KTX2) on the production preview, one fresh disposable Windows Edge
 * per quality. Records match preparation time, texture store bytes/formats/
 * fallbacks, Edge process memory (working set, private bytes, GPU dedicated/shared
 * from Windows counters) and per-frame step+draw CPU time over AI play.
 * Run under .tmp/dk-heavy.lock with `npm run preview` serving dist/:
 *   node tools/texture-quality-match-probe.mjs [--frames 1200] [--out dir]
 * Probe only; it changes no game code, asset or setting outside its own profile. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';
import { MATCH_URL, openMatchHost } from './browser-match-host.mjs';

const execute = promisify(execFile);
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const frames = Number(arg('--frames', '1200'));
const out = resolve(arg('--out', 'docs/review/2026-10-16/texture-quality-match'));
const config = {
  mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 20261016, itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false },
  players: [
    { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'hard' },
    { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'ai', aiDifficulty: 'hard' },
    { index: 3, characterId: 'pikachu', paletteIndex: 2, inputType: 'ai', aiDifficulty: 'hard' },
  ],
};

/** Edge processes owned by this launch's disposable profile, with Windows memory counters. */
async function edgeMemory(profile) {
  const script = `$ErrorActionPreference='Stop';$p='${profile.replaceAll("'", "''")}';
    $procs=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($p) });
    $gpu=@{}; try { (Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage','\\GPU Process Memory(*)\\Shared Usage' -ErrorAction Stop).CounterSamples |
      ForEach-Object { if ($_.InstanceName -match '^pid_(\\d+)_') { $k=$matches[1]+'|'+($(if($_.Path -match 'dedicated'){'dedicated'}else{'shared'})); $gpu[$k]=($gpu[$k]+$_.CookedValue) } } } catch {}
    @($procs | ForEach-Object { $type=if($_.CommandLine -match '--type=([a-z-]+)'){$matches[1]}else{'browser'};
      [pscustomobject]@{pid=$_.ProcessId;type=$type;workingSet=[int64]$_.WorkingSetSize;privateBytes=[int64]$_.PrivatePageCount;
        gpuDedicated=[int64]$gpu["$($_.ProcessId)|dedicated"];gpuShared=[int64]$gpu["$($_.ProcessId)|shared"]} }) | ConvertTo-Json -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 1 << 22, timeout: 60000 });
  const rows = [].concat(JSON.parse(stdout.trim() || '[]'));
  const sum = (field, filter = () => true) => rows.filter(filter).reduce((n, row) => n + row[field], 0);
  return { processes: rows.length, workingSet: sum('workingSet'), privateBytes: sum('privateBytes'),
    gpuProcessPrivateBytes: sum('privateBytes', row => row.type === 'gpu-process'),
    rendererPrivateBytes: sum('privateBytes', row => row.type === 'renderer'),
    gpuDedicated: sum('gpuDedicated'), gpuShared: sum('gpuShared'), rows };
}

function textureSummary(diagnostics) {
  const t = diagnostics.textures, formats = {};
  for (const row of t.resident.filter(row => row.key.startsWith('char.'))) {
    const f = formats[row.format] ??= { sheets: 0, textureBytes: 0 };
    f.sheets++; f.textureBytes += row.textureBytes;
  }
  return { textureQuality: t.textureQuality, resident: t.resident.length, characterFormats: formats,
    textureBytes: t.textureBytes, rgbaBytes: t.rgbaBytes, fallbacks: Object.keys(t.fallbacks ?? {}).length,
    fallbackSample: Object.entries(t.fallbacks ?? {}).slice(0, 5), pending: t.pending.length, renderer: diagnostics.renderer.memory };
}

async function run(quality) {
  const edge = await launchWindowsEdgeCdp({ windowsPort: 9243, bridgePort: 9244 });
  const browser = await chromium.connectOverCDP(edge.endpoint);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  await context.addInitScript(q => localStorage.setItem('platformfighter.settings.v1', JSON.stringify({ textureQuality: q })), quality);
  try {
    const script = await openMatchHost(page);
    const preparation = await page.evaluate(async config => {
      const started = performance.now();
      window.__sim.startMatch(config); window.__sim.manual(true); await window.__sim.ready;
      return { ms: performance.now() - started };
    }, config);
    const afterLoad = { textures: textureSummary(await page.evaluate(() => window.__sim.renderDiagnostics())), process: await edgeMemory(edge.launch.profile) };
    const timing = await page.evaluate(async frames => {
      const times = [];
      for (let i = 0; i < frames; i++) {
        const t = performance.now(); window.__sim.step(); window.__sim.draw(); times.push(performance.now() - t);
        if (i % 120 === 119) await new Promise(r => setTimeout(r, 0));
      }
      const sorted = [...times].sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      return { frames, meanMs: times.reduce((a, b) => a + b, 0) / frames, p50: q(.5), p95: q(.95), p99: q(.99), max: sorted.at(-1),
        over16ms: times.filter(t => t > 1000 / 60).length, over33ms: times.filter(t => t > 1000 / 30).length,
        worst: times.map((ms, frame) => ({ frame, ms })).sort((a, b) => b.ms - a.ms).slice(0, 8) };
    }, frames);
    const afterPlay = { textures: textureSummary(await page.evaluate(() => window.__sim.renderDiagnostics())), process: await edgeMemory(edge.launch.profile) };
    const jsHeap = await page.evaluate(() => performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null);
    const gpu = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'), x = gl?.getExtension('WEBGL_debug_renderer_info');
      return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : null; });
    const fault = await page.evaluate(() => window.__sim.fault ?? null);
    // Evidence that the AI actually played (sheets beyond idle were exercised).
    const play = await page.evaluate(() => window.__sim.match.playerSlots.map(slot => ({ characterId: slot.character.characterId ?? null, damage: slot.character.getDamagePercent(), stocks: slot.stocks ?? null })));
    return { quality, script, gpu, preparation, afterLoad, timing, afterPlay, jsHeap, play, fault, errors };
  } finally { await context.close(); await browser.close(); await edge.close(); }
}

mkdirSync(out, { recursive: true });
const report = { schema: 'texture-quality-match/1', url: MATCH_URL, frames, config, runs: [] };
try {
  for (const quality of ['full', 'compressed', 'compressed', 'full']) {
    const result = await run(quality);
    report.runs.push(result);
    const mib = n => (n / 1048576).toFixed(1);
    console.log(quality, `prep ${result.preparation.ms.toFixed(0)} ms`, `tex ${mib(result.afterPlay.textures.textureBytes)} MiB`,
      `formats ${JSON.stringify(Object.fromEntries(Object.entries(result.afterPlay.textures.characterFormats).map(([k, v]) => [k, v.sheets])))}`,
      `fallbacks ${result.afterPlay.textures.fallbacks}`, `edge private ${mib(result.afterPlay.process.privateBytes)} MiB`,
      `gpu-proc ${mib(result.afterPlay.process.gpuProcessPrivateBytes)} MiB`, `gpu ded ${mib(result.afterPlay.process.gpuDedicated)} shared ${mib(result.afterPlay.process.gpuShared)} MiB`,
      `frame p99 ${result.timing.p99.toFixed(1)} max ${result.timing.max.toFixed(1)} ms over16 ${result.timing.over16ms}`, `errors ${result.errors.length}`);
  }
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`Report: ${relative(process.cwd(), resolve(out, 'report.json'))}`);
}
