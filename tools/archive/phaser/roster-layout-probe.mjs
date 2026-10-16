import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-09/gameplay';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4174/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  await page.evaluate(() => {
    for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key);
    window.__game.scene.start('CharacterSelectScene');
  });
  await page.keyboard.press('Space'); await page.keyboard.press('c');
  await page.waitForTimeout(150);
  const result = await page.evaluate(() => {
    const s = window.__game.scene.getScene('CharacterSelectScene');
    return { columns: s.portraitColumns, tiles: s.portraitTiles.map(tile => {
      const label = tile.nameLabel.getBounds(), bounds = tile.bounds;
      return { name: tile.nameLabel.text, width: bounds.width, labelWidth: label.width,
        containsLabel: label.left >= bounds.left && label.right <= bounds.right && label.top >= bounds.top && label.bottom <= bounds.bottom,
        labelBottom: label.bottom, chipsTop: tile.container.y + tile.slotChips[0].y - 4 };
    }), bannerBottom: s.bannerBand.getBounds().bottom,
    cardsTop: Math.min(...s.cards.map(card => card.cardBounds.top)) };
  });
  assert.equal(result.columns, 7);
  assert.equal(result.tiles.length, 13);
  for (const tile of result.tiles) { assert.ok(tile.containsLabel, tile.name); assert.ok(tile.labelBottom < tile.chipsTop, tile.name); }
  assert.ok(result.bannerBottom < result.cardsTop);
  await page.screenshot({ path: `${output}/roster-readable.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: `${output}/roster-landscape.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/roster-layout.json`, JSON.stringify({ result, errors }, null, 2));
  console.log('PASS roster tile names, selection chips, banner and cards fit without overlap');
} finally { await browser.close(); }
