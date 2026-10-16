#!/usr/bin/env node
/* Mechanics-fixes-3 qualification: (A) DK jump-opening velocity leak, (B/C) hit during the dodge vulnerable tail.
 *
 *   node tools/dk-mechanics-fixes-3-probe.mjs <outDir> [--url URL]
 *
 * Reuses installProbe() from tools/dk-rework-family-probe.mjs (extracted from its source text, so there is a single
 * implementation of the in-page match harness). Input is real keyboard events (P2 Numpad attack via CDP, as in the family probe);
 * the sim is stepped one fixed 60 Hz step at a time. Wrap in `flock .tmp/dk-heavy.lock`.
 *
 * A) DK full hop (W held through jumpsquat), then at post-takeoff step k (k = steps after the first airborne record) one
 *    chord: neutral special (G), down special (S+G), side special (fwd+G), air dodge (R); plus a plain hop. Peak = max
 *    height of the body bottom above the floor top, until landing. Two stick modes (see caseA).
 * B/C) Spot dodge (H+S), roll (H+fwd), back roll (H+back) for DK and Pikachu; P2 jabs (real Numpad1) on a swept step so hits land
 *    in the intangible window and in the vulnerable tail; after a hit on P1 the next steps' dodge/hitstun/sheet are recorded.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? true); };
const outDir = argv.find((a, i) => !a.startsWith('--') && !['--url', '--only-dodge'].includes(argv[i - 1]));
if (!outDir) { console.error('usage: node tools/dk-mechanics-fixes-3-probe.mjs <outDir> [--url URL]'); process.exit(2); }
const onlyDodge = flag('--only-dodge');
const url = flag('--url') ?? 'http://127.0.0.1:4173/platform-fighter/';
await mkdir(outDir, { recursive: true });

const familySrc = await readFile(new URL('./dk-rework-family-probe.mjs', import.meta.url), 'utf8');
const installStart = familySrc.indexOf('async function installProbe');
const installProbe = (0, eval)(`(${familySrc.slice(installStart, familySrc.indexOf('\n}\n', installStart) + 2)})`);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { url, probe: 'dk-mechanics-fixes-3-probe', errors: [], A: [], B: [] };

/** Opens a fresh page with a keyboard driver; fn gets { meta, press, reset, step, shot }. */
async function withMatch(p1, p2, seed, fn) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => report.errors.push(e.message));
  const cdp = await page.context().newCDPSession(page);
  const held = new Set();
  const keyEvent = (type, k) => /^Numpad\d$/.test(k)
    ? cdp.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 96 + Number(k.slice(6)), code: k, key: k.slice(6), location: 3 })
    : page.keyboard[type === 'keyUp' ? 'up' : 'down'](k);
  const press = async keys => {
    for (const k of [...held]) if (!keys.includes(k)) { await keyEvent('keyUp', k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await keyEvent('rawKeyDown', k); held.add(k); }
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
    if (!report.bundle) {
      report.bundle = await page.evaluate(() => [...document.scripts].find(s => /assets\/index-/.test(s.src))?.src ?? null);
      report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
    }
    const meta = await page.evaluate(installProbe, { p1, p2, seed });
    report.engineVersion ??= meta.engineVersion;
    const reset = opponent => page.evaluate(a => window.__fam.reset(...a), [0.3, 1, opponent, null, 0]);
    const step = async (simulatedTilt = null) => (await page.evaluate(t => window.__fam.step(1, { simulatedTilt: t }), simulatedTilt))[0];
    const shot = async name => { const file = `${name}.png`; await page.screenshot({ path: `${outDir}/${file}` }); return file; };
    const faceP2 = f => page.evaluate(v => window.__game.scene.getScene('MatchScene').p2.setFacing(v), f);   // probe setup, not input
    return await fn({ meta, press, reset, step, shot, faceP2 });
  } finally { await page.close(); }
}

// ---------------------------------------------------------------- A
const SPECIAL_KEYS = { none: [], neutral: ['g'], down: ['s', 'g'], side: ['d', 'g'], dodge: ['r'] };
const stickKeys = (keys, stick) => stick === 'sim' ? keys.filter(x => x !== 'd' && x !== 's') : keys;
const stickTilt = (stick, kind, pressing) => stick === 'sim' ? { x: pressing && kind === 'side' ? 1 : 0, y: pressing && kind === 'down' ? 1 : 0 } : null;
/** The input for step i of an A run: W until takeoff, the special chord on post-takeoff step k, then nothing. */
const inputA = (kind, k, stick, i, takeoff) => {
  const pressing = takeoff !== null && i === takeoff + k;
  return { pressing, keys: stickKeys(takeoff === null ? ['w'] : pressing ? SPECIAL_KEYS[kind] : [], stick), tilt: stickTilt(stick, kind, pressing) };
};
/** stick='real': W/D/S are real keys (W doubles as up, so the 4-step directional window reads a post-jump G as up special).
 *  stick='sim': W (jump), G, R are real keys; the analog stick is a SIMULATED neutral (x only for the side special, y only for down). */
async function caseA(ctx, kind, k, stick) {
  const { meta, press, reset, step } = ctx;
  await press([]); await reset(null);
  const records = []; let takeoff = null, pressed = null, landed = false;
  for (let i = 0; i < 400; i++) {
    const { pressing, keys, tilt } = inputA(kind, k, stick, i, takeoff);
    if (pressing) pressed = i;
    await press(keys);
    const r = await step(tilt); records.push(r);
    if (takeoff === null && !r.p1.grounded) takeoff = i;
    if (takeoff !== null && i > takeoff && r.p1.grounded) { landed = true; break; }
  }
  await press([]);
  const heights = records.map(r => meta.floorTop - r.p1.body.bottom);
  const peakIdx = heights.indexOf(Math.max(...heights));
  return { stick, kind, k, peakPx: Math.round(heights[peakIdx] * 100) / 100, takeoffStep: takeoff, pressStep: pressed, landed,
    sheetsAfterPress: [...new Set(records.slice(pressed ?? 0).map(r => r.p1.sheet))],
    screenshot: k === 1 ? await replayToShot(ctx, kind, k, stick, peakIdx) : null };
}
/** Deterministic re-run of the same inputs, screenshot at the apex step. */
async function replayToShot(ctx, kind, k, stick, peakIdx) {
  const { press, reset, step, shot } = ctx;
  await press([]); await reset(null);
  let takeoff = null, file = null;
  for (let i = 0; i <= peakIdx; i++) {
    const { keys, tilt } = inputA(kind, k, stick, i, takeoff);
    await press(keys);
    const r = await step(tilt);
    if (takeoff === null && !r.p1.grounded) takeoff = i;
    if (i === peakIdx) file = await shot(`A-${stick}-${kind}-k${k}-apex`);
  }
  await press([]);
  return file;
}

// ---------------------------------------------------------------- B/C
const DODGES = [
  { name: 'spot-dodge', keys: ['h', 's'], opponents: [62], tail: [18, 26] },
  { name: 'roll', keys: ['h', 'd'], opponents: [62], tail: [16, 30] },
  { name: 'back-roll', keys: ['h', 'a'], opponents: [62, 45, -150, -200, -250], tail: [17, 35] },
];
/** Resets the dodge scenario; a negative opponent distance puts P2 behind DK (where a back roll slides to), turned to face DK. */
const setupB = async (ctx, dodge) => {
  await ctx.press([]); await ctx.reset(dodge.opponent);
  if (dodge.opponent < 0) await ctx.faceP2(1);
};
const keysB = (dodge, at, i) => [...(i === 0 ? dodge.keys : []), ...(i >= at && i < at + 3 ? ['Numpad1'] : [])];
async function caseB(ctx, dodge, at) {
  const { press, step } = ctx;
  await setupB(ctx, dodge);
  const records = []; let hitAt = null;
  for (let i = 0; i < 90; i++) {
    await press(keysB(dodge, at, i));
    const r = await step(); records.push(r);
    if (hitAt === null && r.hitsOnP1.length) hitAt = i;
    if (hitAt !== null && i >= hitAt + 8) break;
  }
  await press([]);
  if (hitAt === null) return { at, hit: false, trace: records.slice(0, 16).map(r => ({ dodge: r.p1.dodge.name, p1x: r.p1.position.x, p2x: r.p2.position.x, p2attack: r.p2.attack && `${r.p2.attack.id}@${r.p2.attack.age}`, p2sheet: r.p2.sheet })) };
  const h = records[hitAt], pre = records[hitAt - 1];
  return { at, hit: true, outcome: h.hitsOnP1[0].outcome, damageApplied: h.hitsOnP1[0].damageApplied,
    dodgeAgeBeforeHit: pre.p1.dodge.age, dodgeNameBeforeHit: pre.p1.dodge.name, iframesBeforeHit: pre.p1.dodge.iframesRemaining,
    after: records.slice(hitAt, hitAt + 8).map(r => ({ dodge: r.p1.dodge.name, age: r.p1.dodge.age, hitstun: r.p1.hitstun, sheet: r.p1.sheet, vx: r.p1.velocity.x })), hitAtIndex: hitAt };
}
/** Re-run the same inputs and screenshot `offset` steps after the hit step. */
async function shotCase(ctx, dodge, at, hitAt, offset, label) {
  const { press, step, shot } = ctx;
  await setupB(ctx, dodge);
  let file = null;
  for (let i = 0; i <= hitAt + offset; i++) {
    await press(keysB(dodge, at, i));
    await step();
    if (i === hitAt + offset) file = await shot(label);
  }
  await press([]);
  return file;
}

try {
  const casesA = [['none', 1], ...['neutral', 'down', 'side', 'dodge'].flatMap(kind => [1, 2, 3].map(k => [kind, k]))];
  if (!onlyDodge) await withMatch('donkeykong', 'pikachu', 810201, async ctx => {
    for (const stick of ['sim', 'real']) for (const [kind, k] of casesA) report.A.push(await caseA(ctx, kind, k, stick));
  });

  for (const dkChar of ['donkeykong', 'pikachu']) for (const base of DODGES.filter(d => !onlyDodge || d.name === onlyDodge)) for (const opponent of base.opponents) {
    const dodge = { ...base, opponent };
    const row = { character: dkChar, dodge: dodge.name, opponent, tailWindow: dodge.tail, sweep: [], shots: {} };
    // A fresh page per chunk of sweep steps: a long-lived probe match eventually ends and its physics world goes null.
    for (const ats of [[4, 14], [15, 25], [26, 36]]) await withMatch(dkChar, 'pikachu', 810202, async ctx => {
      for (let at = ats[0]; at <= ats[1]; at++) {
        const res = await caseB(ctx, dodge, at);
        row.sweep.push(res);
        const tag = `B-${dkChar}-${dodge.name}-d${opponent}`;
        if (res.hit && !row.shots.tail && res.iframesBeforeHit === 0 && res.dodgeAgeBeforeHit !== null)
          row.shots.tail = { at, hitstunFrame: await shotCase(ctx, dodge, at, res.hitAtIndex, 8, `${tag}-tailhit-at${at}-plus8`), hitlagFrame: await shotCase(ctx, dodge, at, res.hitAtIndex, 2, `${tag}-tailhit-at${at}-plus2`) };
        if (res.hit && !row.shots.iframe && res.iframesBeforeHit > 0)
          row.shots.iframe = { at, file: await shotCase(ctx, dodge, at, res.hitAtIndex, 2, `${tag}-iframehit-at${at}`) };
      }
    });
    report.B.push(row);
    console.error('done', dkChar, dodge.name, opponent);
  }
} finally {
  await browser.close();
  await writeFile(`${outDir}/dk-mechanics-fixes-3-probe.json`, `${JSON.stringify(report, null, 1)}\n`);
}
for (const a of report.A) console.log(`A ${a.stick} ${a.kind} k${a.k}: peak ${a.peakPx} px  sheets=${a.sheetsAfterPress.join('>')}`);
for (const b of report.B) {
  const hits = b.sweep.filter(s => s.hit);
  console.log(`B ${b.character} ${b.dodge} d${b.opponent}: ${hits.length} hit sweeps`);
  for (const s of hits) console.log(`   at${s.at}: dodge ${s.dodgeNameBeforeHit}@${s.dodgeAgeBeforeHit} iframes ${s.iframesBeforeHit} ${s.outcome} -> ${s.after.slice(1, 2).map(x => `${x.dodge}/${x.sheet}`).join('')} then ${s.after.at(-1).dodge}/hs${s.after.at(-1).hitstun}/${s.after.at(-1).sheet}`);
}
