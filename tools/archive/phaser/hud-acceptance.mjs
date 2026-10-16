import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'docs/review/2026-09-09/hud';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
const players = [
  { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
  { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
  { index: 3, characterId: 'donkeykong', paletteIndex: 1, inputType: 'ai', aiDifficulty: 'easy' },
  { index: 4, characterId: 'pikachu', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'easy' },
];
async function open(config) {
  await page.evaluate(() => { for (const scene of window.__game.scene.getScenes(true)) window.__game.scene.stop(scene.scene.key); });
  await page.waitForTimeout(60);
  await page.evaluate(config => {
    window.__game.scene.start('MatchScene', { matchConfig: config });
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.pause();
  }, config);
  await page.waitForFunction(() => window.__game.scene.isActive('MatchScene'));
}
async function read() {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'), hud = s.damageHud;
    const bounds = object => { const b = object.getBounds(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
    return { timer: s.stockText.text, timerBounds: bounds(s.stockText), recordingVisible: s.recordingHud.visible,
      worldViewportBottom: s.cameras.main.y + s.cameras.main.height,
      viewport: { width: s.scale.gameSize.width, height: s.scale.gameSize.height },
      panels: hud.players.map((_, i) => ({ label: hud.getLabelTexts()[i].text, percent: hud.getPercentTexts()[i].text,
        status: hud.getStatusTexts()[i].text, labelBounds: bounds(hud.getLabelTexts()[i]), percentBounds: bounds(hud.getPercentTexts()[i]),
        statusBounds: bounds(hud.getStatusTexts()[i]), panelBounds: bounds(hud.panels[i].background) })) };
  });
}
function assertLayout(result) {
  for (let i = 0; i < result.panels.length; i++) {
    const p = result.panels[i], b = p.panelBounds;
    for (const text of [p.labelBounds, p.percentBounds, p.statusBounds]) {
      assert.ok(text.x >= b.x && text.right <= b.right, `horizontal fit ${p.label}`);
      assert.ok(text.y >= b.y && text.bottom <= b.bottom, `vertical fit ${p.label}`);
    }
    assert.ok(p.labelBounds.bottom <= p.percentBounds.y, `name/percent separate ${p.label}`);
    assert.ok(p.percentBounds.bottom <= p.statusBounds.y, `percent/status separate ${p.label}`);
    assert.ok(b.x >= 0 && b.y >= 0 && b.right <= result.viewport.width && b.bottom <= result.viewport.height);
    if (i) assert.ok(result.panels[i - 1].panelBounds.right < b.x);
  }
  assert.equal(result.recordingVisible, false);
  assert.ok(result.worldViewportBottom < Math.min(...result.panels.map(p => p.panelBounds.y)), 'world viewport leaves HUD strip clear');
}
try {
  await page.goto(process.env.PF_HUD_URL ?? 'http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  const base = { mode: 'stocks', stockCount: 1, stageId: 'flat', rngSeed: 12345, itemFrequency: 'off', players };
  await open(base);
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    [0, 49, 152, 999].forEach((value, i) => s.playerSlots[i].character.setDamagePercent(value));
    s.update(0, 0);
  });
  const four = await read(); assertLayout(four);
  assert.deepEqual(four.panels.map(p => p.percent), ['0%', '49%', '152%', '999%']);
  assert.deepEqual(four.panels.map(p => p.status), ['1 STOCK', '1 STOCK', '1 STOCK', '1 STOCK']);
  report.checks.push({ name: 'four players including long roster names and 999 percent fit separate cards', result: four });
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
    for (let i = 0; i < 90; i++) s.update(0, s.physicsEngine.fixedTimestepMs);
    s.physicsEngine.pause();
  });
  await page.waitForTimeout(60);
  const feet = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'), camera = s.cameras.main;
    return s.playerSlots.map(slot => {
      const b = slot.sprite.getBounds();
      const point = camera.matrix.transformPoint(b.centerX - camera.scrollX, b.bottom - camera.scrollY);
      return { player: slot.playerIndex, screenY: point.y, viewportBottom: camera.y + camera.height };
    });
  });
  assert.ok(feet.every(f => f.screenY < f.viewportBottom), 'fighters remain above the reserved HUD strip after settling');
  report.checks.push({ name: 'settled fighters remain visible above reserved player HUD area', feet });
  await page.screenshot({ path: `${output}/four-player-stocks.png` });

  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
    s.playerSlots[2].character.setPosition(5000, 300); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
  });
  const eliminated = await read(); assertLayout(eliminated);
  assert.equal(eliminated.panels[2].percent, 'OUT'); assert.equal(eliminated.panels[2].status, 'ELIMINATED');
  report.checks.push({ name: 'real stock elimination retains player identity and replaces active percent', result: eliminated });
  await page.screenshot({ path: `${output}/eliminated-player.png` });

  await open({ ...base, mode: 'time', timeLimitSeconds: 120, players: [players[0], { ...players[1], index: 3 }] });
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene'); s.physicsEngine.resume();
    s.p2.setPosition(5000, 300); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
  });
  const timed = await read(); assertLayout(timed);
  assert.ok(timed.timer.startsWith('TIME  2:00'));
  assert.ok(timed.panels[0].label.startsWith('P1 ')); assert.ok(timed.panels[1].label.startsWith('P3 '));
  assert.equal(timed.panels[0].status, 'SCORE +0'); assert.ok(timed.panels[1].status.startsWith('SCORE -1'));
  report.checks.push({ name: 'Time score and countdown retain sparse original lobby labels after real fall', result: timed });
  await page.screenshot({ path: `${output}/sparse-time-match.png` });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ checks: report.checks.map(c => c.name), errors: report.errors }));
} finally {
  await writeFile(`${output}/runtime-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
