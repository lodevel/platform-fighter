import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(process.env.GAME_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.scene?.isActive?.('MainMenuScene'), null, { timeout: 20000 });
await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
await page.waitForFunction(() => window.__game?.scene?.isActive?.('MatchScene'), null, { timeout: 20000 });
await page.waitForTimeout(1200);
const out = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const scene = window.__game.scene.keys['MatchScene'];
  const float = scene.baseStage.rendered.platformBodies.find((b) => b.label === 'platform.passThrough');
  const top = float.bounds.min.y, x = float.position.x;
  // THE DEATH SCENARIO: park BOTH fighters on the ground directly
  // under the float for a second (all slots phased simultaneously).
  scene.p1.setPosition(x - 30, top + 150);
  scene.p2.setPosition(x + 30, top + 150);
  await wait(1000);
  const maskWhileBothUnder = float.collisionFilter.mask;
  // Now land P1 on it from above.
  scene.p1.setPosition(x, top - 200);
  let landed = false;
  for (let i = 0; i < 160; i += 1) {
    await wait(16);
    if (scene.p1.isGrounded() && Math.abs(scene.p1.getBodyBottomY() - top) < 8) { landed = true; break; }
  }
  return { maskWhileBothUnder, landed, relTop: Math.round((scene.p1.getBodyBottomY() - top) * 10) / 10, grounded: scene.p1.isGrounded() };
});
console.log(JSON.stringify(out));
await browser.close();
