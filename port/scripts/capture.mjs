// Capture the port stage viewer headlessly and check the camera mapping.
// Usage: node scripts/capture.mjs <outDir> [stage=frame[:mood][:overlay]] ...
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [outDir = 'shots', ...specs] = process.argv.slice(2);
const BASE = process.env.PORT_URL ?? 'http://127.0.0.1:4210/';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const report = [];
for (const spec of specs.length ? specs : ['flat=0', 'lava=120']) {
  const [stage, rest = '0'] = spec.split('=');
  const [frame, mood = '', overlay = ''] = rest.split(':');
  const q = new URLSearchParams({ stage, frame, pause: '1', ui: '0', overlay: overlay ? '1' : '0', ...(mood ? { mood } : {}) });
  await page.goto(`${BASE}${process.env.PORT_PAGE ?? 'viewer.html'}?${q}`, { waitUntil: 'commit', timeout: 300000 });
  await page.waitForFunction(() => window.__port?.stage, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  // Camera check: design corners and centre must land on the canvas linearly.
  const check = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const pts = [[0, 0], [1920, 1080], [960, 540], [370, 800], [1550, 930]];
    return pts.map(([x, y]) => {
      const p = window.__port.project(x, y);
      return { x, y, dx: p.x - (x / 1920) * c.clientWidth, dy: p.y - (y / 1080) * c.clientHeight };
    });
  });
  const worst = Math.max(...check.map((p) => Math.max(Math.abs(p.dx), Math.abs(p.dy))));
  const file = path.join(outDir, `${stage}-f${frame}${mood ? '-' + mood : ''}${overlay ? '-overlay' : ''}.png`);
  // Whole page: the canvas plus HTML overlays (HUD).
  await page.screenshot({ path: file });
  report.push({ spec, file, worstProjectionErrorPx: Number(worst.toFixed(4)) });
}
await browser.close();
console.log(JSON.stringify({ report, errors }, null, 2));
if (errors.length) process.exit(1);
