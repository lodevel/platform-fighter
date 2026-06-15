/**
 * Headless replay analyzer — drives MatchScene with the inputs from a
 * saved .replay.json by swapping the scene's InputResolver for a
 * timeline-backed fake, then dumps the platform-driver diagnostic ring
 * buffer for offline analysis of platform fall-through reports.
 *
 * Fidelity note: the v3 capture records moveX/moveY/jump/attack/
 * dropThrough — shield/dodge/special/grab presses are NOT in the file
 * (pre-existing capture gap), so combat may diverge from the live
 * match; the MOVEMENT trajectory (which platform behaviour depends on)
 * replays faithfully.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const REPLAY_PATH = process.argv[2] ?? 'tools/user-replay.json';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf8'));
const entries = replay.inputTimeline.entries;
const lastFrame = entries[entries.length - 1].frame;
console.log(`replay: ${entries.length} frames, stage=${replay.matchConfig.stageId}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.scene?.isActive?.('MainMenuScene'), null, { timeout: 20000 });

await page.evaluate(({ matchConfig }) => {
  window.__game.scene.keys['MainMenuScene'].scene.start('MatchScene', { matchConfig });
}, { matchConfig: replay.matchConfig });
await page.waitForFunction(() => window.__game?.scene?.isActive?.('MatchScene'), null, { timeout: 20000 });
await page.waitForTimeout(800);

await page.evaluate(({ entries }) => {
  const scene = window.__game.scene.keys['MatchScene'];
  // Frame-indexed input table: bindingsSlot (1-based) → recorded input.
  const byFrame = entries; // dense, entries[i].frame === i
  const inputFor = (slot) => {
    const f = Math.min(scene.physicsEngine.getFrame(), byFrame.length - 1);
    return byFrame[f]?.inputs?.[slot - 1] ?? { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false };
  };
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'getMoveVector') {
        return (slot) => {
          const i = inputFor(slot);
          return { x: i.moveX, y: i.moveY };
        };
      }
      if (prop === 'isActionHeld') {
        return (slot, action) => {
          const i = inputFor(slot);
          if (action === 'jump') return i.jump;
          if (action === 'attack') return i.attack;
          if (action === 'moveDown') return i.moveY > 0.5;
          return false;
        };
      }
      // Every other resolver surface — return an inert function.
      return () => false;
    },
  });
  scene.inputResolver = fake;
}, { entries });

// Set lastFrame watcher separately (simpler than smuggling).
await page.evaluate((lf) => {
  const scene = window.__game.scene.keys['MatchScene'];
  window.__probeDone = false;
  const watch = setInterval(() => {
    const f = scene.physicsEngine?.getFrame?.() ?? 0;
    if (f >= lf || !window.__game.scene.isActive('MatchScene')) {
      clearInterval(watch);
      window.__probeDone = true;
    }
  }, 500);
}, lastFrame);

console.log('playing back…');
await page.waitForFunction(() => window.__probeDone === true, null, { timeout: 200000 });

const out = await page.evaluate(() => {
  const scene = window.__game.scene.keys['MatchScene'];
  return {
    endFrame: scene.physicsEngine?.getFrame?.() ?? -1,
    diag: scene.platformDiagLog ?? [],
  };
});
writeFileSync('tools/replay-diag-out.json', JSON.stringify(out));
console.log(`end frame ${out.endFrame}; diag entries: ${out.diag.length} → tools/replay-diag-out.json`);
await browser.close();
