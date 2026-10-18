// Phase 6 step 2 check in a fresh Windows Edge (real GPU): fighter art loads when a player picks
// a fighter on the select screen and unloads when nobody has it. Everything goes through the real
// menus with real DOM input (mouse clicks, key presses): Options → Fighter art, Versus, picks, CPU
// cycling, deselect, stage, match, results. The same flow runs with Classic art for comparison.
// Frame times come from a requestAnimationFrame log, each pick over the same 2 s window.
// With Compact art it also drops a pick within the grace period (loading must stop) and loses
// the WebGL context in a match (WEBGL_lose_context): pages are decoded again and drawn after restore.
// Usage: node tools/package-load-on-select-probe.mjs --out <dir>
//   builds nothing: run `npm run build` first. Serves dist/ itself (vite preview, all interfaces).
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const out = arg('out');
if (!out) { console.error('usage: node tools/package-load-on-select-probe.mjs --out <dir>'); process.exit(2); }
await mkdir(out, { recursive: true });
const BASE = 'http://127.0.0.1:4181/platform-fighter/';
const GRACE_MS = 3000, WINDOW_MS = 2000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const preview = spawn('npx', ['vite', 'preview', '--base', '/platform-fighter/', '--host', '0.0.0.0', '--port', '4181', '--strictPort'], { stdio: 'ignore', detached: true });
await pause(4000);
const edge = await launchWindowsEdgeCdp({ windowsPort: 9257, bridgePort: 9258 });
const report = { windowMs: WINDOW_MS, runs: {}, errors: [] };

/** rAF timestamps and long tasks from page start. */
const RECORDER = () => {
  window.__frameLog = [];
  window.__longTasks = [];
  const tick = t => { window.__frameLog.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* no long task API */ }
};

function frameStats(times, longTasks) {
  const deltas = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const q = p => deltas.length ? +deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))].toFixed(1) : null;
  return { frames: deltas.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: deltas.length ? +deltas.at(-1).toFixed(1) : null,
    over20ms: deltas.filter(d => d > 20).length, over33ms: deltas.filter(d => d > 33.4).length,
    longTasks: longTasks.length, longestTaskMs: longTasks.length ? Math.max(...longTasks.map(t => Math.round(t.duration))) : 0 };
}

async function newPage(browser, name, settings) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${name}: ${m.text().slice(0, 300)}`); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${name}: HTTP ${r.status()} ${r.url()}`); });
  await page.addInitScript(RECORDER);
  // Only the quick-start run presets the setting; the main runs choose it in the Options menu.
  if (settings) await page.addInitScript(s => localStorage.setItem('platformfighter.settings.v1', s), JSON.stringify(settings));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

const centre = async (page, selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const click = async (page, selector) => { const c = await centre(page, selector); await page.mouse.click(c.x, c.y); };
const screen = page => page.evaluate(() => window.__menu.screen);
const diag = page => page.evaluate(() => window.__menu.packages());
const now = page => page.evaluate(() => performance.now());
const cards = page => page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.querySelector('.fighter-name')?.textContent));
const portraitsPainted = page => page.waitForFunction(() => [...document.querySelectorAll('.portrait .art')]
  .every(n => n.style.backgroundImage.startsWith('url(')), null, { timeout: 30000 });

async function unlock(page) {
  await page.waitForFunction(() => window.__menu?.screen);
  if (await screen(page) === 'gate') {
    await page.keyboard.type('changeme');
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.__menu.screen === 'title');
}

async function toFighters(page) {
  await click(page, 'button.mode:has-text("Versus")');
  await page.waitForFunction(() => window.__menu.screen === 'rules');
  await click(page, 'button.btn.primary:has-text("Choose fighters")');
  await page.waitForFunction(() => window.__menu.screen === 'fighters');
}

/** Wait until `test(diagnostics)` holds; returns the page time when it did. */
async function until(page, test, timeoutMs = 60000) {
  const started = Date.now();
  for (;;) {
    const d = await diag(page);
    if (test(d)) return { at: await now(page), diagnostics: d };
    if (Date.now() - started > timeoutMs) throw new Error(`timed out: ${JSON.stringify(d.packages.map(p => [p.id, p.refs, p.progress]))}`);
    await pause(25);
  }
}

async function framesBetween(page, t0, t1) {
  const { times, tasks } = await page.evaluate(([a, b]) => ({ times: window.__frameLog.filter(t => t >= a && t <= b),
    tasks: window.__longTasks.filter(t => t.start >= a && t.start <= b) }), [t0, t1]);
  return frameStats(times, tasks);
}

const loaded = id => d => d.packages.some(p => p.id === id && !p.loading);
const gone = id => d => !d.packages.some(p => p.id === id);
const memory = d => ({ resident: d.packages.map(p => p.id), gpuBytes: d.gpuBytes, cpuBytes: d.cpuBytes, rendererTextures: d.rendererTextures, loads: d.loads,
  ...(d.restoredPages ? { restoredPages: d.restoredPages } : {}) });
const progressOf = (d, id) => { const p = d.packages.find(row => row.id === id); return p && { ...p.progress, paused: p.paused, refs: p.refs }; };

/** Share of pixels whose channels differ by more than 24 between two screenshots of the same size. */
async function pixelDiff(a, b) {
  const [x, y] = await Promise.all([a, b].map(async file => PNG.sync.read(await readFile(file))));
  let differ = 0;
  for (let i = 0; i < x.data.length; i += 4) if ([0, 1, 2].some(c => Math.abs(x.data[i + c] - y.data[i + c]) > 24)) differ++;
  return +(differ / (x.width * x.height)).toFixed(4);
}
const heap = page => page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);

/** The real menus, picks and match, with the Fighter art option set to `display` in the Options menu. */
async function flow(browser, display) {
  const packaged = display === 'packages', run = { steps: [] }, shot = name => `${out}/${display}-${name}.png`;
  report.runs[display] = run;
  const log = step => { run.steps.push(step); console.log(display, JSON.stringify(step)); };
  const { context, page } = await newPage(browser, display);
  const cdp = await context.newCDPSession(page);
  /** JS heap after a full collection (the page copies of package pages live there). */
  const heapNow = async () => { await cdp.send('HeapProfiler.collectGarbage'); return heap(page); };

  /** Frames over the pick window; with packages also the load time of `id`. */
  async function pick(name, id, act) {
    const t0 = await now(page);
    await act();
    const done = packaged ? await until(page, loaded(id)) : null;
    const end = Math.max(t0 + WINDOW_MS, done?.at ?? 0);
    while (await now(page) < end) await pause(50);
    const row = done?.diagnostics.packages.find(p => p.id === id);
    const step = { step: name, ...(row ? { loadMs: Math.round(row.loadMs), clickToLoadedMs: Math.round(done.at - t0), pages: row.pages } : {}),
      frames: await framesBetween(page, t0, end), after: memory(await diag(page)), heapBytes: await heapNow(), cards: await cards(page) };
    log(step);
    return t0;
  }
  /** With packages: time from the input that dropped `id` until it is unloaded. */
  async function unload(name, id, since) {
    if (!packaged) return;
    const done = await until(page, gone(id), GRACE_MS + 10000);
    log({ step: name, unloadAfterMs: Math.round(done.at - since), after: memory(done.diagnostics), heapBytes: await heapNow() });
  }

  await unlock(page);
  await click(page, 'button.mode:has-text("Options")');
  await page.waitForFunction(() => window.__menu.screen === 'options');
  const option = '.rule:has(.label:text-is("Fighter art"))';
  if (packaged) await click(page, `${option} button[aria-label="Next"]`);
  run.option = { value: await page.locator(`${option} .value`).textContent(),
    saved: await page.evaluate(() => localStorage.getItem('platformfighter.settings.v1')) };
  await page.screenshot({ path: shot('options') });
  await click(page, 'button.btn:has-text("Back")');
  await page.waitForFunction(() => window.__menu.screen === 'title');
  await toFighters(page);
  await portraitsPainted(page);
  await pause(2000);
  const idleFrom = await now(page);
  await pause(WINDOW_MS);
  run.idle = { frames: await framesBetween(page, idleFrom, await now(page)), memory: memory(await diag(page)), heapBytes: await heapNow() };
  console.log(display, JSON.stringify({ idle: run.idle }));
  await page.screenshot({ path: shot('select-empty') });

  // Joining picks a default fighter (slot 1 DK, slot 2 Pikachu, slot 3 Link), so a join is a pick.
  await pick('P1 joins and picks DK (click portrait)', 'donkeykong', () => click(page, '.portrait[aria-label="Donkey Kong"]'));
  await pick('CPU P2 joins on Pikachu (C key)', 'pikachu', () => page.keyboard.press('KeyC'));
  const linkAt = await pick('CPU P2 changes to Link (click ›)', 'link', () => click(page, '[data-target="next:2"]'));
  await unload('Pikachu no longer picked: unloaded', 'pikachu', linkAt);
  if (packaged) {
    // A pick dropped within the grace period stops loading pages, then unloads.
    const pickedAt = await now(page);
    await click(page, '[data-target="prev:2"]');
    await pause(250);
    const cardsWhilePicked = await cards(page);
    await click(page, '[data-target="next:2"]');
    const droppedAt = await now(page), atDrop = progressOf(await diag(page), 'pikachu');
    await pause(1500);
    const later = progressOf(await diag(page), 'pikachu');
    const done = await until(page, gone('pikachu'), GRACE_MS + 10000);
    log({ step: 'CPU P2 on Pikachu for 250 ms, back to Link: loading stops, then unloads', cardsWhilePicked, atDrop, after1500ms: later,
      unloadAfterMs: Math.round(done.at - droppedAt), frames: await framesBetween(page, pickedAt, droppedAt + 1500), after: memory(done.diagnostics) });
  }
  const before = await diag(page);
  await page.keyboard.press('KeyC');
  await pause(500);
  const shared = await diag(page);
  log({ step: 'CPU P3 joins on Link too: shared', loadsBefore: before.loads, ...memory(shared),
    linkRefs: shared.packages.find(p => p.id === 'link')?.refs, cards: await cards(page) });
  await page.screenshot({ path: shot('select-picked') });
  await click(page, '[data-target="mode:3"]');
  const escAt = await now(page);
  await page.keyboard.press('Escape');
  await unload('P1 deselects DK (Esc): unloaded', 'donkeykong', escAt);
  await pick('P1 picks DK again (click portrait)', 'donkeykong', () => click(page, '.portrait[aria-label="Donkey Kong"]'));
  await page.waitForFunction(() => [...document.querySelectorAll('.card .art')].filter(n => n.style.backgroundImage.startsWith('url(')).length >= 2, null, { timeout: 30000 });
  await page.screenshot({ path: shot('select-ready') });
  const beforeMatch = await diag(page);

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__menu.screen === 'stages');
  await pause(1500);
  await page.screenshot({ path: shot('stages-lineup') });
  const stageAt = await now(page);
  await click(page, '.stage-row');
  await page.waitForFunction(() => window.__menu.screen === 'match' && window.__sim?.ready);
  await page.evaluate(() => window.__sim.ready);
  const readyAt = await now(page), inMatch = await diag(page);
  run.matchStart = { stageClickToReadyMs: Math.round(readyAt - stageAt), loadsBefore: beforeMatch.loads, ...memory(inMatch),
    refs: inMatch.packages.map(p => [p.id, p.refs]), heapBytes: await heapNow() };
  console.log(display, JSON.stringify({ matchStart: run.matchStart }));
  await pause(5000);
  // Frames before the screenshot, which can itself hold a frame.
  run.matchFrames = { first: await framesBetween(page, readyAt, readyAt + 1000), after: await framesBetween(page, readyAt + 1000, await now(page)) };
  await page.screenshot({ path: shot('match') });
  run.matchPresentation = await page.evaluate(() => window.__sim.view().fighters.map(f => {
    const p = window.__sim.presentation(f.playerIndex);
    return { characterId: f.characterId, capability: p?.capability, action: p?.action, drawing: p?.drawing, visible: p?.visible };
  }));
  run.matchRenderer = await page.evaluate(() => window.__sim.renderDiagnostics().renderer.memory);
  if (packaged) run.contextLoss = await contextLoss(page, shot);
  // Play the match out fast (probe stepping), then let the screen move to results itself.
  await page.evaluate(() => {
    window.__sim.manual(true);
    for (let i = 0; i < 40000 && !window.__sim.match.isFinished; i++) window.__sim.step();
    window.__sim.manual(false);
  });
  await page.waitForFunction(() => window.__menu.screen === 'results', null, { timeout: 30000 });
  await pause(1500);
  await page.screenshot({ path: shot('results') });
  run.results = memory(await diag(page));
  await click(page, 'button.btn:has-text("Back to lobby")');
  await page.waitForFunction(() => window.__menu.screen === 'fighters');
  await pause(1000);
  run.backToFighters = memory(await diag(page));
  // Leave the select screen with its own back action: P1 drops its pick (Esc), Esc again → rules.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__menu.screen === 'rules');
  if (packaged) {
    const left = await until(page, d => d.packages.length === 0, GRACE_MS + 10000);
    run.afterLeaving = { ...memory(left.diagnostics), heapBytes: await heapNow() };
    console.log(display, JSON.stringify({ afterLeaving: run.afterLeaving }));
  }
  // The costume page with the same saved setting.
  await page.goto(new URL('costumes.html', BASE).href, { waitUntil: 'domcontentloaded' });
  await pause(8000);
  await page.screenshot({ path: shot('costumes') });
  await context.close();
}

/** The same match frame drawn from a fresh start, then after a lost and restored WebGL context. */
async function contextLoss(page, shot) {
  const frameAt = async (name, frame = 90) => {
    await page.evaluate(() => window.__sim.ready);
    await page.evaluate(f => { window.__sim.manual(true); while (window.__sim.frame < f) window.__sim.step(); window.__sim.draw(); }, frame);
    await pause(300);
    await page.screenshot({ path: shot(name) });
    return page.evaluate(() => window.__sim.view().fighters.map(f => {
      const p = window.__sim.presentation(f.playerIndex);
      return { characterId: f.characterId, capability: p?.capability, drawing: p?.drawing, visible: p?.visible };
    }));
  };
  await page.evaluate(() => window.__sim.startMatch(window.__sim.config));
  await page.waitForFunction(() => window.__menu.screen === 'match' && window.__sim?.ready);
  const before = { presentation: await frameAt('context-before'), ...memory(await diag(page)) };
  const lost = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__loseContext = extension;
    window.__restoredAt = null;
    canvas.addEventListener('webglcontextrestored', () => { window.__restoredAt = performance.now(); }, { once: true });
    extension.loseContext();
    return true;
  });
  if (!lost) return { skipped: 'WEBGL_lose_context unavailable' };
  await page.waitForFunction(() => window.__sim.fault?.phase === 'renderer');
  const whileLost = memory(await diag(page));
  await pause(300);
  await page.evaluate(() => window.__loseContext.restoreContext());
  await page.waitForFunction(() => window.__restoredAt !== null);
  const pages = before.resident.length && (await diag(page)).packages.reduce((sum, p) => sum + (p.pages ?? 0), 0);
  const restored = await until(page, d => d.restoredPages >= pages && d.pendingUploads === 0, 30000);
  const restoredAt = await page.evaluate(() => window.__restoredAt);
  await page.getByRole('button', { name: 'Restart match', exact: true }).click();
  await page.waitForFunction(() => window.__menu.screen === 'match' && window.__sim?.ready && !window.__sim.fault);
  const after = { presentation: await frameAt('context-restored'), ...memory(await diag(page)) };
  await page.evaluate(() => window.__sim.manual(false));
  const result = { pages, before, whileLost, restoredMs: Math.round(restored.at - restoredAt), restored: memory(restored.diagnostics), after,
    pixelsDiffering: await pixelDiff(shot('context-before'), shot('context-restored')) };
  console.log('packages', JSON.stringify({ contextLoss: result }));
  return result;
}

try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  await flow(browser, 'packages');
  await flow(browser, 'legacy');

  // Start right after picking: the match waits only for what is not loaded yet.
  {
    const { context, page } = await newPage(browser, 'quick', { textureQuality: 'full', fighterDisplay: 'packages' });
    await unlock(page);
    await toFighters(page);
    await portraitsPainted(page);
    const t0 = await now(page);
    await click(page, '.portrait[aria-label="Donkey Kong"]');
    await page.keyboard.press('KeyC');
    await click(page, '[data-target="next:2"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__menu.screen === 'stages');
    await click(page, '.stage-row');
    const clickedAt = await now(page), atStart = await diag(page);
    await page.waitForFunction(() => window.__menu.screen === 'match' && window.__sim?.ready);
    await page.evaluate(() => window.__sim.ready);
    const ready = await now(page), inMatch = await diag(page);
    report.quickStart = { pickToStageClickMs: Math.round(clickedAt - t0), stageClickToReadyMs: Math.round(ready - clickedAt),
      atStageClick: atStart.packages.map(p => ({ id: p.id, progress: p.progress })), ...memory(inMatch) };
    console.log(JSON.stringify({ quickStart: report.quickStart }));
    await context.close();
  }
  await browser.close();
} catch (error) {
  report.errors.push(`probe: ${error.stack ?? error}`);
  console.error(error);
} finally {
  await edge.close?.();
  try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* stopped */ }
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ errors: report.errors.slice(0, 8), errorCount: report.errors.length }));
