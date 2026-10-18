// Phase 6 step 4 check in a fresh Windows Edge (real GPU): Final Smash effects and Link's articles drawn
// from legacy effect sheets and from character packages (`?packages=all`), same seeded scenarios, same frames.
// Every frame is stepped and drawn. Screenshots are taken where effects show; the pixel difference is
// measured inside boxes around the effects (fighters there are drawn from packages too in that variant).
// Usage: node tools/package-effects-probe.mjs --out <dir>
//   builds nothing: run `npm run build` first. Serves dist/ itself (vite preview, all interfaces).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { openMatchHost } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const out = arg('out');
if (!out) { console.error('usage: node tools/package-effects-probe.mjs --out <dir>'); process.exit(2); }
await mkdir(out, { recursive: true });
const PORT = 4181, BASE = `http://127.0.0.1:${PORT}/platform-fighter/`, W = 1920, H = 1080;
/** Captures per scenario: the first frames each effect action shows, two ticks in. */
const SHOTS_PER_SCENARIO = 6;

const SCENARIOS = [
  { name: 'dk-final', owner: 'donkeykong', victim: 'pikachu', final: true, script: [[{ special: true }, 1], [{}, 520]] },
  { name: 'pikachu-final', owner: 'pikachu', victim: 'donkeykong', final: true, script: [[{ special: true }, 1], [{}, 520]] },
  { name: 'link-final', owner: 'link', victim: 'donkeykong', final: true, script: [[{ special: true }, 1], [{}, 240]] },
  { name: 'link-articles', owner: 'link', victim: 'donkeykong', final: false,
    script: [[{ special: true }, 1], [{}, 80], [{ moveX: 1, special: true }, 1], [{}, 120]] },
];
const config = s => ({ mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1510, itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true },
  players: [{ index: 1, characterId: s.owner, paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: s.victim, paletteIndex: 1, inputType: 'keyboard_p2' }] });

/** In the page: the Final setup of displayEquivalence.test.ts (owner on the floor, victim 120 px ahead, ball granted). */
async function setup(page, scenario) {
  await page.evaluate(async ({ cfg, final }) => {
    window.__sim.startMatch(cfg); window.__sim.manual(true); await window.__sim.ready;
    const host = window.__sim, sim = host.match;
    const N = { moveX: 0, moveY: 0, jump: false, attack: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, dropThrough: false };
    for (let n = 0; n < 240; n++) host.step([N, N]);
    const floor = sim.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), top = floor.bounds.min.y;
    sim.p1.resetForRound(floor.position.x - 250, top - 25); sim.p1.setFacing(1);
    sim.p2.resetForRound(floor.position.x - 130 + (final ? 0 : 280), top - sim.p2.getTuning().height / 2); sim.p2.setFacing(-1);
    if (final) {
      const frame = sim.physicsEngine.getFrame();
      for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex,
        slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
      sim.consumeFinalEvents(sim.finalSmashController.grantBall(0, frame), frame);
    }
    for (let n = 0; n < 10; n++) { host.step([N, N]); host.draw(); }
    window.__effectsProbe = { N, step: 0 };
  }, { cfg: config(scenario), final: scenario.final });
}

/** Steps the script (drawing every frame) up to step `until`; returns per-step effect rows. */
function advance(page, script, until) {
  return page.evaluate(({ script, until }) => {
    const host = window.__sim, probe = window.__effectsProbe, inputs = script.flatMap(([input, n]) => Array.from({ length: n }, () => input)), rows = [];
    for (; probe.step < Math.min(until, inputs.length); probe.step++) {
      host.step([{ ...probe.N, ...inputs[probe.step] }, probe.N]); host.draw();
      const fx = host.presentationSprites().filter(s => s.art);
      rows.push({ step: probe.step, effects: fx.map(s => ({ action: s.art.action, tick: s.art.tick, fromPackage: s.fromPackage, submitted: s.submitted, visible: s.visible,
        u: s.onCanvas.u, v: s.onCanvas.v, du: s.onCanvas.designU, dv: s.onCanvas.designV,
        size: Math.max((s.frameWidth ?? 0) * Math.abs(s.scaleX ?? 1), (s.frameHeight ?? 0) * Math.abs(s.scaleY ?? 1)) })) });
    }
    return rows;
  }, { script, until });
}

const length = script => script.reduce((n, [, k]) => n + k, 0);
const report = { scenarios: {}, errors: [] };
const preview = spawn('npx', ['vite', 'preview', '--base', '/platform-fighter/', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 4000));
const edge = await launchWindowsEdgeCdp({ windowsPort: 9265, bridgePort: 9266 });
try {
  const browser = await chromium.connectOverCDP(edge.endpoint);
  for (const scenario of SCENARIOS) {
    const result = { variants: {}, shots: [] };
    let captureSteps = null;
    const images = {};
    for (const [variant, flag] of [['legacy', null], ['packages', 'all']]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push(`${scenario.name}/${variant}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') report.errors.push(`${scenario.name}/${variant}: ${m.text().slice(0, 300)}`); });
      await openMatchHost(page, flag ? `${BASE}?packages=${flag}` : BASE);
      await setup(page, scenario);
      const total = length(scenario.script), stats = { effectFrames: 0, perAction: {}, notSubmitted: 0, fromPackage: 0, legacy: 0 };
      const tally = rows => rows.forEach(row => { if (row.effects.length) stats.effectFrames++;
        for (const e of row.effects) { stats.perAction[e.action] = (stats.perAction[e.action] ?? 0) + 1;
          if (!e.visible) stats.notSubmitted++; if (e.fromPackage) stats.fromPackage++; else stats.legacy++; } });
      images[variant] = [];
      if (!captureSteps) {
        // Legacy pass: run once to choose the capture steps, then run again to capture them.
        const rows = await advance(page, scenario.script, total), firsts = new Map();
        for (const row of rows) for (const e of row.effects) if (!firsts.has(e.action)) firsts.set(e.action, row.step + 2);
        captureSteps = [...new Set(firsts.values())].sort((a, b) => a - b).slice(0, SHOTS_PER_SCENARIO);
        await setup(page, scenario);
      }
      for (const step of captureSteps) {
        const rows = await advance(page, scenario.script, step + 1);
        tally(rows);
        // Whole frames are kept for the first capture only; every capture keeps its crop.
        const shot = await page.screenshot(step === captureSteps[0] ? { path: `${out}/${scenario.name}-${variant}-${String(step).padStart(4, '0')}.png` } : {});
        images[variant].push({ step, png: PNG.sync.read(shot), effects: rows.at(-1)?.effects ?? [] });
      }
      tally(await advance(page, scenario.script, total));
      result.variants[variant] = stats;
      await context.close();
    }
    // Pixel difference inside boxes around each effect, legacy vs packages, same step.
    images.legacy.forEach((a, i) => {
      const b = images.packages[i], mask = new Uint8Array(W * H);
      let box = null;
      for (const e of a.effects) {
        const cx = e.u * W, cy = e.v * H, half = Math.max(40, e.size * Math.max(e.du * W, e.dv * H) / 2);
        const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W, Math.ceil(cx + half)), y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(H, Math.ceil(cy + half));
        for (let y = y0; y < y1; y++) mask.fill(1, y * W + x0, y * W + x1);
        if (x1 > x0 && y1 > y0) box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1];
      }
      let sum = 0, differing = 0, pixels = 0;
      for (let p = 0; p < W * H; p++) {
        if (!mask[p]) continue;
        const q = p * 4, d = (Math.abs(a.png.data[q] - b.png.data[q]) + Math.abs(a.png.data[q + 1] - b.png.data[q + 1]) + Math.abs(a.png.data[q + 2] - b.png.data[q + 2])) / 3;
        sum += d; pixels++; if (d > 24) differing++;
      }
      if (box) for (const [variant, image] of [['legacy', a.png], ['packages', b.png]]) {
        const [x0, y0, x1, y1] = box, crop = new PNG({ width: x1 - x0, height: y1 - y0 });
        PNG.bitblt(image, crop, x0, y0, x1 - x0, y1 - y0, 0, 0);
        writeFileSync(`${out}/${scenario.name}-${String(a.step).padStart(4, '0')}-crop-${variant}.png`, PNG.sync.write(crop));
      }
      result.shots.push({ step: a.step, effects: a.effects.map(e => `${e.action}@${e.tick}`), packageEffects: b.effects.map(e => `${e.action}@${e.tick}${e.fromPackage ? '' : ' (legacy)'}`),
        box, pixels, meanDiff: pixels ? +(sum / pixels).toFixed(3) : null, differingShare: pixels ? +(differing / pixels).toFixed(5) : null });
    });
    report.scenarios[scenario.name] = result;
  }
  await browser.close();
} finally {
  await edge.close?.();
  try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* stopped */ }
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
