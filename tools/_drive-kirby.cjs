/* THROWAWAY — verify kirby renders + per-move clips play in-engine. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(
    () => window.__game && window.__game.textures && window.__game.textures.exists('char.kirby.neutral_special'),
    { timeout: 45000 },
  );
  await page.evaluate(() => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
    g.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 5, itemFrequency: 'off',
      players: [
        { index: 1, characterId: 'kirby', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'hard' },
        { index: 2, characterId: 'wolf', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'hard' },
      ] } });
  });
  await page.waitForTimeout(1200);
  const registered = await page.evaluate(() => {
    const a = window.__game.anims;
    const moves = ['idle','run','jump','attack','crouch','jab','tilt','smash','nair','fair','bair','neutral_special','side_special','up_special','down_special'];
    return moves.filter((m) => a.exists(`kirby.${m}.anim`));
  });
  const seen = {};
  for (let i = 0; i < 70; i++) {
    const k = await page.evaluate(() => {
      const sc = window.__game.scene.getScene('MatchScene');
      let key = null;
      const walk = (o) => { if (!o) return; if (o.anims && o.texture && String(o.texture.key).startsWith('char.kirby') && o.anims.currentAnim) key = o.anims.currentAnim.key; if (o.list) o.list.forEach(walk); };
      (sc.children.list || []).forEach(walk);
      return key;
    });
    if (k) seen[k] = (seen[k] || 0) + 1;
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: 'assets/gen/_spike/kirby-ingame.png' });
  console.log('REGISTERED:', JSON.stringify(registered));
  console.log('OBSERVED_PLAYING:', JSON.stringify(seen));
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 8)));
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
