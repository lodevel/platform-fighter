// Record a stage clip frame by frame (deterministic sim frames) into an
// animated WebP. Usage: node scripts/clip.mjs <stage> <fromFrame> <toFrame> <step> <out.webp>
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [stage, from, to, step = '4', out = 'clip.webp'] = process.argv.slice(2);
const BASE = process.env.PORT_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
// Frames go to the system temp folder and are removed even if the run is interrupted.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'port-clip-'));
const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
process.on('SIGINT', () => { cleanup(); process.exit(130); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`${BASE}viewer.html?stage=${stage}&frame=${from}&pause=1&ui=0`, { waitUntil: 'commit', timeout: 300000 });
await page.waitForFunction(() => window.__port?.stage, null, { timeout: 300000 });
await page.waitForTimeout(2000);
let n = 0;
for (let f = Number(from); f <= Number(to); f += Number(step), n++) {
  await page.evaluate((x) => window.__port.setFrame(x), f);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(dir, `${String(n).padStart(4, '0')}.png`) });
}
await browser.close();
execFileSync('python3', ['-c', `
import glob, sys
from PIL import Image
frames = [Image.open(p).convert('RGB') for p in sorted(glob.glob(sys.argv[1] + '/*.png'))]
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=int(1000 * ${Number(step)} / 60), loop=0, quality=80)
`, dir, path.resolve(out)]);
cleanup();
console.log(`${n} frames -> ${out}`);
