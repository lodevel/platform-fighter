#!/usr/bin/env node
/** Captures the character lab's own canvases, tick by tick, in a disposable Windows Edge: the main pane
 * (a rig candidate) and the compare pane (today's package), at match zoom 1.4, without overlays. Also saves full-page
 * screenshots of chosen ticks. Frames feed strips.py. Probe only; changes no code or asset.
 *   node docs/review/2026-10-18/phase3/explore/rig/scripts/lab-capture.mjs --out DIR \
 *     --case donkeykong~rig:jab:0-23 --case donkeykong~rig:idle:0-139:4 [--shot donkeykong~rig:jab:9:skeleton,bounds] */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchWindowsEdgeCdp } from '../../../../../../../tools/windows-edge-cdp.mjs';

const values = name => process.argv.flatMap((arg, i) => (arg === name ? [process.argv[i + 1]] : []));
const out = resolve(values('--out')[0] ?? '.tmp/rig-lab-capture'), compareWith = values('--compare')[0] ?? 'donkeykong';
const DEV = 'http://127.0.0.1:5182/';
mkdirSync(out, { recursive: true });

const vite = spawn('npx', ['vite', '--config', 'vite.character-lab.config.ts', '--host', '0.0.0.0', '--port', '5182', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('lab did not start')), 60000);
  const watch = data => { if (String(data).includes('5182')) { clearTimeout(timer); ok(); } };
  vite.stdout.on('data', watch); vite.stderr.on('data', watch);
});
const edge = await launchWindowsEdgeCdp({ windowsPort: 9247, bridgePort: 9248 });
const errors = [];
try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const open = async (pkg, action, options = []) => {
    await page.goto(`${DEV}?package=${encodeURIComponent(pkg)}&action=${action}&compare=${encodeURIComponent(compareWith)}`);
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('revision'), null, { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('reference-note')?.textContent?.startsWith('Loading'), null, { timeout: 60000 });
    await page.click('#play');
    for (const option of options) {
      if (option === 'left') await page.check('input[name="facing"][value="-1"]');
      else if (option === 'clean') { await page.uncheck('#ov-root'); await page.uncheck('#ov-sockets'); }
      else if (option.startsWith('costume')) await page.selectOption('#costume', option.slice(7));
      else await page.check(`#ov-${option}`);
    }
    await page.waitForTimeout(500);
  };
  const seek = async tick => { await page.fill('#seek', String(tick)); await page.dispatchEvent('#seek', 'input'); await page.waitForTimeout(60); };
  const canvas = id => page.evaluate(id => document.getElementById(id).toDataURL('image/png').split(',')[1], id);
  for (const spec of values('--case')) {
    const [pkg, action, range, step = '1'] = spec.split(':'), [first, last] = range.split('-').map(Number);
    await open(pkg, action, ['clean']);
    for (let tick = first; tick <= last; tick += Number(step)) {
      await seek(tick);
      for (const [id, name] of [['stage', 'rig'], ['compare', 'today']])
        writeFileSync(resolve(out, `${action}-${String(tick).padStart(3, '0')}-${name}.png`), Buffer.from(await canvas(id), 'base64'));
    }
    console.log(spec, 'captured');
  }
  for (const spec of values('--shot')) {
    const [pkg, action, tick, options = ''] = spec.split(':');
    await open(pkg, action, options ? options.split(',') : []);
    await seek(Number(tick));
    const name = `lab-${action}-${tick}${options ? `-${options.replace(/,/g, '-')}` : ''}.png`;
    await page.screenshot({ path: resolve(out, name) });
    const facts = await page.evaluate(() => ({ tick: document.getElementById('tick').textContent,
      problems: [...document.querySelectorAll('#problems li')].map(li => li.textContent),
      memory: document.getElementById('memory').innerText }));
    writeFileSync(resolve(out, name.replace('.png', '.json')), JSON.stringify(facts, null, 1));
    console.log(name, facts.tick);
  }
  await context.close(); await browser.close();
} finally { await edge.close(); try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* stopped */ } }
console.log('errors', errors.length, errors.slice(0, 5));
process.exit(0);
