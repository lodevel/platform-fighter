// Golden-replay state-hash harness (STEP5-DESIGN §5.1), run against the
// current Three host through window.__sim, or the frozen Phaser comparator
// through window.__game. Both use MatchSim/MatchScene.getSimDigest and
// setRecordedInputs. The digest is FNV-1a 64 of
// captureMatchHistoryEvidence() (src/match/simDigest.ts, STEP5-DESIGN 8.4 A),
// the same canonical whole-world record the history restore checks; the dumps
// are that evidence (JSON).
//
//   node sim-golden.mjs record <scenario|all> [--frames N]   CPU-vs-CPU match → golden/<scenario>.json
//   node sim-golden.mjs verify <golden.json> [--warmup N] [--hz H]
//
// record: plays the scenario with Hard CPUs, hashing the full simulation state
//   every frame (MatchScene.getSimDigest), and stores the recorded inputs, the per-frame
//   hashes and a full state dump every 300 frames.
// verify: replays the recorded inputs on a fresh page (the CPU controllers and
//   their Smash Ball / Final wrappers still run, as when recorded; the recorded
//   input of each live slot overrides their output) and compares hashes frame
//   by frame; on a mismatch it reports the first frame and the
//   differing fields of the nearest dump. --warmup plays a throwaway match
//   first (shifts Matter's body-id counter); --hz emulates a display rate.
//
// Env: PF_GAME_URL (default http://127.0.0.1:4173/platform-fighter/), PF_GOLDEN_DIR.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const GAME_URL = process.env.PF_GAME_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const OUT = process.env.PF_GOLDEN_DIR ?? path.resolve(import.meta.dirname, '../../../docs/review/2026-10-13/threejs-port/step5/golden');
const DUMP_EVERY = 300;
const BATCH = 300;

const [mode, target, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? Number(rest[i + 1]) : fallback; };

async function openGame() {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__sim?.startMatch || window.__game?.scene?.getScenes?.(true).length > 0, null, { timeout: 120000 });
  const build = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((src) => /(?:index|game)-.*\.js/.test(src)) ?? null);
  return { browser, page, errors, build };
}

/** Start MatchScene paused (never resize the game: stage geometry follows its size). */
const START = async ({ config, warmup }) => {
  if (window.__sim?.startMatch) {
    const launch = async (matchConfig) => {
      window.__sim.startMatch(matchConfig);
      window.__sim.manual(true);
      await window.__sim.ready;
      return window.__sim.match;
    };
    if (warmup > 0) {
      const previous = await launch({ ...config, rngSeed: 7 });
      for (let i = 0; i < warmup && !previous.isFinished; i++) previous.step();
    }
    const s = await launch(config);
    s.physicsEngine.pause();
    window.__g = { s, host: 'three', clock: 0, hashes: [], dumps: {} };
    return { start: s.physicsEngine.getFrame(), meta: s.getMatchStartMetadata(), slots: s.playerSlots.length };
  }
  const game = window.__game;
  const stopAll = () => { for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key); };
  if (warmup > 0) {
    stopAll();
    game.scene.start('MatchScene', { matchConfig: { ...config, rngSeed: 7 } });
    const w = game.scene.getScene('MatchScene');
    w.physicsEngine.pause();
    for (let i = 0; i < warmup; i++) { w.physicsEngine.resume(); w.update(0, w.physicsEngine.fixedTimestepMs); w.physicsEngine.pause(); }
    game.scene.stop('MatchScene');
  }
  stopAll();
  game.scene.start('MatchScene', { matchConfig: config });
  const s = game.scene.getScene('MatchScene');
  s.physicsEngine.pause();
  window.__g = { s, clock: 0, hashes: [], dumps: {} };
  return { start: s.physicsEngine.getFrame(), meta: s.getMatchStartMetadata?.() ?? null, slots: s.playerSlots.length };
};

/** Step `count` fixed frames at display rate `hz`, hashing after each. */
const STEP = ({ count, hz, dumpEvery }) => {
  const g = window.__g, s = g.s;
  const out = [];
  for (let n = 0; n < count; n++) {
    if (g.host === 'three' ? s.isFinished : !window.__game.scene.isActive('MatchScene')) return { out, ended: true };
    const frame = s.physicsEngine.getFrame();
    s.physicsEngine.resume();
    let guard = 0;
    while (s.physicsEngine.getFrame() === frame && guard++ < 40) { g.clock += 1000 / hz; if (g.host === 'three') s.advance(1000 / hz); else s.update(g.clock, 1000 / hz); }
    s.physicsEngine.pause();
    const { text, hash } = s.getSimDigest();
    const f = s.physicsEngine.getFrame();
    out.push([f, hash]);
    if (f % dumpEvery === 0) g.dumps[f] = text;
  }
  return { out, ended: false };
};

async function run(page, frames, hz) {
  const hashes = [];
  for (let done = 0; done < frames;) {
    const { out, ended } = await page.evaluate(STEP, { count: Math.min(BATCH, frames - done), hz, dumpEvery: DUMP_EVERY });
    hashes.push(...out);
    done += out.length;
    if (ended || out.length === 0) break;
  }
  const dumps = await page.evaluate(() => window.__g.dumps);
  return { hashes, dumps };
}

async function record(name, frames) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  const { browser, page, errors, build } = await openGame();
  const info = await page.evaluate(START, { config: scenario.config, warmup: 0 });
  const { hashes, dumps } = await run(page, frames ?? scenario.frames, 60);
  const inputs = await page.evaluate(() => window.__g.s.getInputCaptureBuffer().getEntries().map((e) => ({ frame: e.frame, inputs: e.inputs })));
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  const golden = { scenario: name, about: scenario.about, build, engineVersion: info.meta?.engineVersion ?? null, config: scenario.config, startFrame: info.start, inputs, hashes, dumps, pageErrors: errors };
  const file = path.join(OUT, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(golden));
  console.log(JSON.stringify({ recorded: name, file, frames: hashes.length, inputFrames: inputs.length, build, errors: errors.length }));
}

/** First differing leaf paths between two evidence records. */
function diffRecords(a, b, prefix = '', out = []) {
  if (out.length >= 12) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${prefix}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffRecords(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

async function verify(file, warmup, hz) {
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { browser, page, errors, build } = await openGame();
  await page.evaluate(() => { window.__rec = []; });
  for (let i = 0; i < golden.inputs.length; i += 2000) {
    await page.evaluate((chunk) => { window.__rec.push(...chunk); }, golden.inputs.slice(i, i + 2000));
  }
  await page.evaluate(START, { config: golden.config, warmup });
  // One recorded-input contract (STEP5-DESIGN 8.4 B): CPUs are still sampled, the recorded input wins.
  await page.evaluate(() => window.__g.s.setRecordedInputs(window.__rec));
  const { hashes, dumps } = await run(page, golden.hashes.length, hz);
  await browser.close();
  const want = new Map(golden.hashes);
  const mismatch = hashes.find(([f, h]) => want.get(f) !== h);
  const report = { golden: path.basename(file), warmup, hz, frames: hashes.length, expected: golden.hashes.length, build, goldenBuild: golden.build, pageErrors: errors };
  if (!mismatch && hashes.length === golden.hashes.length) {
    console.log(JSON.stringify({ ...report, result: 'IDENTICAL' }));
    return true;
  }
  const at = mismatch?.[0] ?? hashes.at(-1)?.[0];
  const dumpFrame = Object.keys(dumps).map(Number).filter((f) => f >= at).sort((x, y) => x - y)[0];
  const fields = dumpFrame !== undefined && golden.dumps[dumpFrame]
    ? diffRecords(JSON.parse(golden.dumps[dumpFrame]), JSON.parse(dumps[dumpFrame])) : [];
  console.log(JSON.stringify({ ...report, result: 'DIVERGED', firstFrame: at, nearestDump: dumpFrame ?? null, fields }, null, 1));
  return false;
}

if (mode === 'record') {
  for (const name of target === 'all' ? Object.keys(SCENARIOS) : [target]) await record(name, opt('frames', undefined));
} else if (mode === 'verify') {
  const ok = await verify(target, opt('warmup', 0), opt('hz', 60));
  process.exitCode = ok ? 0 : 1;
} else {
  console.log('usage: sim-golden.mjs record <scenario|all> [--frames N] | verify <golden.json> [--warmup N] [--hz H]');
  process.exitCode = 2;
}
