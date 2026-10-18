#!/usr/bin/env node
/** Character lab check in a fresh disposable Windows Edge: the dev lab over exported packages
 * (both reference fighters, facings, zooms, stages, costumes, Ultimate recordings side by side), then the
 * static lab build opening a package folder through its picker.
 * Needs `npm run character:export` first. Run under .tmp/dk-heavy.lock:
 *   node tools/character-lab-probe.mjs [--out docs/review/2026-10-18/character-lab]
 * Probe only; it changes no code or asset. */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const out = resolve(arg('--out', 'docs/review/2026-10-18/character-lab'));
const DEV = 'http://127.0.0.1:5180/', STATIC = 'http://127.0.0.1:5181/';
const CASES = [
  { package: 'donkeykong', action: 'jab', tick: 6, shot: 'dk-jab-right' },
  { package: 'donkeykong', action: 'smash', tick: 16, facing: '-1', shot: 'dk-smash-left' },
  { package: 'donkeykong', action: 'up_special_air', tick: 30, stage: 'light', shot: 'dk-spinning-kong-light' },
  { package: 'donkeykong', action: 'final_attack', tick: 40, zoom: '2.8', shot: 'dk-final-zoom-2.8' },
  { package: 'donkeykong', action: 'item_bat_swing_4', tick: 21, bounds: true, shot: 'dk-bat-socket' },
  { package: 'link', action: 'jab', tick: 8, shot: 'link-jab-right' },
  { package: 'link', action: 'd02specialairhi', tick: 20, facing: '-1', shot: 'link-spin-attack-left' },
  { package: 'link', action: 'h04swing4', tick: 18, stage: 'light', shot: 'link-bat-light' },
  { package: 'pikachu', action: 'final', tick: 30, shot: 'pikachu-final-display' },
  { package: 'donkeykong', action: 'jab', tick: 6, costume: '2', shot: 'dk-jab-costume-2' },
  { package: 'link', action: 'jab', tick: 8, costume: '2', stage: 'light', shot: 'link-jab-costume-2' },
  { package: 'pikachu', action: 'jab', tick: 4, costume: '1', facing: '-1', shot: 'pikachu-jab-costume-1' },
];

function server(args, url) {
  const child = spawn('npx', ['vite', ...args, '--config', 'vite.character-lab.config.ts', '--host', '0.0.0.0'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ } };
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`server did not start: ${url}`)), 60000);
    const watch = data => { if (String(data).includes(new URL(url).port)) { clearTimeout(timer); ok(child); } };
    child.stdout.on('data', watch); child.stderr.on('data', watch);
  });
}

async function check(page, c) {
  await page.goto(`${DEV}?package=${c.package}&action=${c.action}`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('revision'), null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('reference-note')?.textContent?.startsWith('Loading'), null, { timeout: 60000 });
  await page.click('#play'); // the lab starts playing; pause it
  for (const [name, value] of [['facing', c.facing], ['zoom', c.zoom], ['stage', c.stage]]) if (value) await page.check(`input[name="${name}"][value="${value}"]`);
  if (c.bounds) await page.check('#ov-bounds');
  await page.fill('#seek', String(c.tick));
  await page.dispatchEvent('#seek', 'input');
  await page.waitForTimeout(400);
  const pixels = () => page.evaluate(() => { const c = document.getElementById('stage'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });
  // A costume is judged against the same pose as drawn: how many pixels it changed.
  let asDrawn = null;
  if (c.costume) { asDrawn = await pixels(); await page.selectOption('#costume', c.costume); await page.waitForTimeout(300); }
  const facts = await page.evaluate(asDrawn => {
    const canvas = document.getElementById('stage'), ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height), bg = data.slice(0, 4);
    let drawn = 0, recoloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) drawn++;
      if (asDrawn && Math.abs(data[i] - asDrawn[i]) + Math.abs(data[i + 1] - asDrawn[i + 1]) + Math.abs(data[i + 2] - asDrawn[i + 2]) > 24) recoloured++;
    }
    const costume = document.getElementById('costume');
    return { tick: document.getElementById('tick').textContent, reference: document.getElementById('reference-note').textContent,
      problems: [...document.querySelectorAll('#problems li')].map(li => li.textContent), drawnPixels: drawn,
      ...(asDrawn ? { costume: costume.selectedOptions[0]?.textContent, recolouredPixels: recoloured, status: document.getElementById('status').textContent } : {}) };
  }, asDrawn);
  await page.screenshot({ path: resolve(out, `${c.shot}.png`) });
  return { ...c, ...facts };
}

/** A small copy of an exported package holding only its Phase 1 reference actions, for the folder picker. */
function referenceFolder(id) {
  const source = resolve('.tmp/character-packages', id), target = resolve('.tmp/character-lab-probe', id);
  const pkg = JSON.parse(readFileSync(resolve(source, 'character.json'), 'utf8'));
  const keep = JSON.parse(readFileSync('character/lab/references.json', 'utf8')).fighters[id].referenceSet;
  const actions = Object.fromEntries(keep.map(name => [name, pkg.actions[name]]));
  const drawingIds = new Set(Object.values(actions).flatMap(a => a.drawings.windows.map(w => w.drawing)));
  const drawings = Object.fromEntries([...drawingIds].map(d => [d, pkg.drawings[d]]));
  const pages = Object.fromEntries([...new Set(Object.values(drawings).map(d => d.page))].map(p => [p, pkg.pages[p]]));
  rmSync(target, { recursive: true, force: true }); mkdirSync(resolve(target, 'pages'), { recursive: true });
  for (const page of Object.values(pages)) copyFileSync(resolve(source, page.file), resolve(target, page.file));
  writeFileSync(resolve(target, 'character.json'), JSON.stringify({ ...pkg, revision: '', actions, drawings, pages }));
  return target;
}

mkdirSync(out, { recursive: true });
const report = { schema: 'character-lab-probe/1', dev: [], static: null, errors: [] };
const dev = await server([], DEV);
const edge = await launchWindowsEdgeCdp({ windowsPort: 9245, bridgePort: 9246 });
try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
  for (const c of CASES) { report.dev.push(await check(page, c)); console.log(c.shot, report.dev.at(-1).drawnPixels, 'px', report.dev.at(-1).recolouredPixels ?? ''); }

  // The static build alone, opening a package through the folder picker.
  dev.stop();
  const build = spawn('npx', ['vite', 'build', '--config', 'vite.character-lab.config.ts'], { stdio: 'inherit' });
  await new Promise((ok, fail) => build.on('exit', code => code ? fail(new Error(`lab build ${code}`)) : ok()));
  const preview = await server(['preview', '--port', '5181', '--strictPort'], STATIC);
  await new Promise(ok => setTimeout(ok, 1500));
  try {
    await page.goto(STATIC);
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('No served packages'), null, { timeout: 30000 });
    let picker = 'not attempted';
    try {
      // setInputFiles cannot upload a directory through the Windows CDP bridge, so the probe hands the
      // same files to the real input with a DataTransfer, keeping each file's folder-relative path.
      const folder = referenceFolder('link'), files = ['character.json', ...readdirSync(resolve(folder, 'pages')).map(f => `pages/${f}`)]
        .map(file => ({ path: `link/${file}`, data: readFileSync(resolve(folder, file)).toString('base64') }));
      await page.evaluate(files => {
        const transfer = new DataTransfer();
        for (const { path, data } of files) {
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
          const file = new File([bytes], path.split('/').at(-1), { type: path.endsWith('.json') ? 'application/json' : 'image/png' });
          Object.defineProperty(file, 'webkitRelativePath', { value: path });
          transfer.items.add(file);
        }
        const input = document.getElementById('folder');
        input.files = transfer.files;
        // DataTransfer copies may drop the defined path; re-attach it on the input's own File objects.
        [...input.files].forEach((file, i) => { if (!file.webkitRelativePath) Object.defineProperty(file, 'webkitRelativePath', { value: files[i].path }); });
        input.dispatchEvent(new Event('change'));
      }, files);
      await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('revision'), null, { timeout: 120000 });
      await page.waitForTimeout(800);
      picker = await page.evaluate(() => document.getElementById('status').textContent);
      await page.screenshot({ path: resolve(out, 'static-build-folder-link.png') });
    } catch (error) { picker = `folder upload unavailable over this connection: ${error.message.split('\n')[0]}`; }
    report.static = { url: STATIC, picker };
  } finally { preview.stop(); }
  await context.close(); await browser.close();
} finally { await edge.close(); dev.stop(); }
writeFileSync(resolve(out, 'lab-probe.json'), JSON.stringify(report, null, 1) + '\n');
console.log('errors', report.errors.length, report.errors.slice(0, 5), 'static', report.static);
process.exit(0);
