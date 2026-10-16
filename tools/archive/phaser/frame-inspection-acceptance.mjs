import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-23/frame-inspection/browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [], loadErrors: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) report.loadErrors.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto(process.env.PF_FRAME_URL ?? 'http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await page.evaluate(() => {
    const game = window.__game;
    game.scene.stop('PasswordGateScene'); game.scene.start('CharacterEditorScene');
  });
  await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
  const inspect = async (key, frame) => page.evaluate(({ key, frame }) => {
    const s = window.__game.scene.getScene('CharacterEditorScene');
    s.moveIndex = s.getMoveKeys().indexOf(key);
    if (s.moveIndex < 0) throw new Error(`Missing move ${key}`);
    s.inspectedFrame = 0; s.refreshPreview();
    s.inspectedFrame = frame; s.refreshPreview();
    const sprite = s.collisionSprite;
    return { text: s.timelineText.text, caption: s.portraitCaption.text,
      pose: sprite ? { frame: sprite.frame.name, x: sprite.x, y: sprite.y,
        width: sprite.displayWidth, height: sprite.displayHeight, flipX: sprite.flipX } : null,
      dirty: s.editState.isDirty() };
  }, { key, frame });
  const first = await inspect('fair', 15);
  const gap = await inspect('fair', 17);
  const second = await inspect('fair', 23);
  assert.match(first.text, /FRAME 16\/51 · ACTIVE/);
  assert.match(gap.text, /FRAME 18\/51 · GAP/);
  assert.match(second.text, /FRAME 24\/51 · ACTIVE/);
  assert.equal(first.pose.width, gap.pose.width);
  assert.equal(first.pose.x, gap.pose.x);
  assert.equal(first.pose.y, second.pose.y);
  assert.notEqual(first.pose.frame, gap.pose.frame);
  assert.equal(first.dirty, false);
  report.checks.push({ name: 'fair contacts, gap, stable viewport and no draft mutation', first, gap, second });
  await page.screenshot({ path: `${output}/fair-active.png` });
  const front = await inspect('downSmash', 11);
  const rear = await inspect('downSmash', 23);
  assert.notEqual(front.pose.flipX, rear.pose.flipX);
  assert.equal(front.pose.x, rear.pose.x);
  report.checks.push({ name: 'rear strike mirrors sprite', front, rear });
  await page.screenshot({ path: `${output}/down-smash-rear.png` });
  await inspect('jab', 0);
  await page.keyboard.press('.');
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').inspectedFrame), 1);
  // Real pointer click into the frame timeline (logical canvas -> viewport).
  const point = await page.evaluate(() => {
    const game = window.__game, rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + 520 * rect.width / game.scale.gameSize.width,
      y: rect.top + 876 * rect.height / game.scale.gameSize.height };
  });
  await page.mouse.click(point.x, point.y);
  const clicked = await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').inspectedFrame);
  assert.equal(clicked, 6);
  report.checks.push({ name: 'keyboard stepping and pointer timeline', clicked });
  await page.screenshot({ path: `${output}/jab-contact.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/narrow.png` });
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, errors: report.errors }));
} catch (error) {
  report.failure = error.message;
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report));
  throw error;
} finally { await browser.close(); }
