// Probe: character select shows only the active fighters; a masked id in a saved config falls back.
import { chromium } from 'playwright';
const out = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-10-11/ultimate-items';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4194/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
await page.evaluate(() => { const g = window.__game; for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key); g.scene.start('CharacterSelectScene'); });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/roster-mask-select.png` });
await page.evaluate(() => { const g = window.__game; for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
  g.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 1, itemFrequency: 'off', players: [
    { index: 1, characterId: 'wolf', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' }] } }); });
await page.waitForTimeout(2000);
const ids = await page.evaluate(() => window.__game.scene.getScene('MatchScene').activeMatchConfig.players.map(p => p.characterId));
console.log(JSON.stringify({ matchPlayers: ids, errors }));
await browser.close();
