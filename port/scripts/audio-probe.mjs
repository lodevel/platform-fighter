// Sound probe: loads the real CPU match host, records every audio buffer
// the page starts (clip duration, loop) over 600 actual CPU-match frames.
// Usage: node port/scripts/audio-probe.mjs (PORT_URL, default root preview on :4173)
import { chromium } from 'playwright';

const BASE = process.env.PORT_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  window.__started = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__started.push({ t: Math.round(performance.now()), duration: Number(this.buffer?.duration.toFixed(2)), loop: this.loop });
    return start.apply(this, args);
  };
});
await page.goto(`${BASE}sandbox.html`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__sim?.config, null, { timeout: 300000 });
await page.evaluate(async () => {
  // A timed match guarantees the observation window remains active even if
  // CPUs repeatedly fall; these are the actual normal match rules.
  window.__sim.startMatch({ ...window.__sim.config, mode: 'time', timeLimitSeconds: 120 });
  await window.__sim.ready;
});
await page.keyboard.press('Space'); // the user gesture that unlocks audio
const from = await page.evaluate(() => window.__sim.frame);
await page.waitForFunction((f) => window.__sim.frame >= f + 600, from, { timeout: 300000, polling: 200 });
const started = await page.evaluate(() => window.__started);
const build = await page.evaluate(() => ({ scripts: [...document.scripts].map(script => script.src).filter(src => /assets\/game-/.test(src)), identity: window.__sim.match.buildIdentity }));
console.log(JSON.stringify({ build, framesPlayed: 600, starts: started.length, loops: started.filter((s) => s.loop).length, clips: started, errors }, null, 1));
await browser.close();
