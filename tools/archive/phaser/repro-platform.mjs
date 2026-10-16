/**
 * Headless reproduction probe for the "can't stand on platforms" bug.
 *
 * Boots the dev build in headless Chromium, jumps straight into the
 * dev-mode match (SHIFT+ENTER path), teleports P1 above a pass-through
 * float, and samples the simulation per frame: feet Y vs platform top,
 * velocity, grounded flag, and the platform's collision mask bit for
 * P1. Prints a frame-by-frame trace so the failure mode is visible.
 */
import { chromium } from 'playwright';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('[probe]')) console.log(t);
});
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
// Let Boot/Preload/MainMenu settle.
await page.waitForFunction(
  () => window.__game?.scene?.isActive?.('MainMenuScene'),
  null,
  { timeout: 20000 },
);
// SHIFT+ENTER → dev-mode MatchScene directly.
await page.keyboard.down('Shift');
await page.keyboard.press('Enter');
await page.keyboard.up('Shift');
await page.waitForFunction(
  () => window.__game?.scene?.isActive?.('MatchScene'),
  null,
  { timeout: 20000 },
);
await page.waitForTimeout(1500); // let the match spawn settle

const trace = await page.evaluate(async () => {
  const game = window.__game;
  const scene = game.scene.keys['MatchScene'];
  const p1 = scene.p1;
  const platforms = scene.baseStage?.rendered?.platformBodies ?? [];
  const all = platforms.map((b) => ({
    label: b.label,
    top: b.bounds?.min?.y,
    bottom: b.bounds?.max?.y,
    left: b.bounds?.min?.x,
    right: b.bounds?.max?.x,
    x: b.position.x,
    category: b.collisionFilter?.category,
    mask: b.collisionFilter?.mask,
  }));
  const float = platforms.find((b) => b.label === 'platform.passThrough');
  const ground = platforms.find((b) => b.label === 'platform.solid');

  const probeTarget = float ?? ground;
  const targetX = probeTarget.position.x;
  const targetTop = probeTarget.bounds.min.y;

  // Phase 1: report spawn-standing state for 30 frames untouched.
  const samples = [];
  const sample = (phase) =>
    samples.push({
      phase,
      feet: Math.round(p1.getBodyBottomY() * 10) / 10,
      relTop: Math.round((p1.getBodyBottomY() - targetTop) * 10) / 10,
      vy: Math.round(p1.getVelocity().y * 100) / 100,
      grounded: p1.isGrounded(),
      mask: probeTarget.collisionFilter.mask,
      slotBitsP1: p1.body.collisionFilter?.category,
    });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cycles = [];
  // Cycle test: drop from above, wait, then "jump" (upward velocity as
  // a jump would apply), rise above, fall back — repeat. Captures the
  // user's "works only with history" report.
  p1.setPosition(targetX, targetTop - 220);
  for (let c = 0; c < 6; c += 1) {
    let landed = false;
    for (let i = 0; i < 140; i += 1) {
      await wait(16);
      const feet = p1.getBodyBottomY();
      if (p1.isGrounded() && Math.abs(feet - targetTop) < 8) {
        landed = true;
        break;
      }
    }
    const feetEnd = Math.round((p1.getBodyBottomY() - targetTop) * 10) / 10;
    cycles.push({ cycle: c, landed, relTop: feetEnd, grounded: p1.isGrounded(), mask: probeTarget.collisionFilter.mask });
    if (!landed) {
      // Re-place above for the next attempt so failures don't cascade.
      p1.setPosition(targetX, targetTop - 220);
      continue;
    }
    await wait(300);
    // Jump straight up off the platform (matches the jump impulse).
    window.__game.scene.keys['MatchScene'].matter.body.setVelocity(p1.body, { x: 0, y: -13 });
    await wait(400); // rise + begin falling
  }
  // From-below test: place under the platform, launch up through it,
  // then fall back onto it.
  const below = [];
  p1.setPosition(targetX, targetTop + 120);
  window.__game.scene.keys['MatchScene'].matter.body.setVelocity(p1.body, { x: 0, y: -16 });
  for (let i = 0; i < 200; i += 1) {
    await wait(16);
    if (i % 10 === 0) {
      below.push({ relTop: Math.round((p1.getBodyBottomY() - targetTop) * 10) / 10, grounded: p1.isGrounded(), vy: Math.round(p1.getVelocity().y * 10) / 10, mask: probeTarget.collisionFilter.mask });
    }
  }
  samples.push({ phase: 'cycles', cycles, below });

  return {
    fighterBodyFilter: p1.body.collisionFilter,
    fighterSlotIndex: p1.slotIndex,
    targetPlatform: {
      label: probeTarget.label,
      top: targetTop,
      bottom: probeTarget.bounds.max.y,
      thickness: probeTarget.bounds.max.y - targetTop,
    },
    platforms: all,
    samples,
  };
});

console.log('=== target platform ===');
console.log(JSON.stringify(trace.targetPlatform));
console.log('=== fighter filter ===', JSON.stringify(trace.fighterBodyFilter), 'slot', trace.fighterSlotIndex);
console.log('=== platforms ===');
for (const p of trace.platforms) console.log(JSON.stringify(p));
const final = trace.samples[trace.samples.length - 1];
console.log('=== landing cycles (drop → land → jump off → re-land) ===');
for (const c of final.cycles) console.log(JSON.stringify(c));
console.log('=== from-below rise-through then re-land ===');
for (const b of final.below) console.log(JSON.stringify(b));
await browser.close();
