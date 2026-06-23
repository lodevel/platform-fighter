/* THROWAWAY — prove Link's run animation frames actually cycle (not stuck). */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__game && window.__game.textures && window.__game.textures.exists('char.link.run'), { timeout: 45000 });
  await page.evaluate(() => {
    const g = window.__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.scene.key);
    g.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 3, itemFrequency: 'off',
      players: [ { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'easy' }, { index: 2, characterId: 'wolf', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'easy' } ] } });
  });
  await page.waitForTimeout(1200);
  // pause the scene's update loop (freezes AI), then drive the run anim manually
  const seq = await page.evaluate(async () => {
    const g = window.__game;
    const sc = g.scene.getScene('MatchScene');
    // find the Link sprite
    let link = null;
    const walk = (o) => { if (!o) return; if (o.anims && o.texture && String(o.texture.key).startsWith('char.link')) link = o; if (o.list) o.list.forEach(walk); };
    (sc.children.list || []).forEach(walk);
    if (!link) return { error: 'link sprite not found' };
    sc.scene.pause(); // stop update() from re-issuing play() based on AI state
    link.anims.play('link.run.anim');
    const frames = [];
    const totalFrames = link.anims.currentAnim ? link.anims.currentAnim.frames.length : -1;
    for (let i = 0; i < 16; i++) {
      // manually advance the animation clock since the scene is paused
      link.anims.update(0, 60); // dt ~60ms -> at 12fps advances ~0.7 frame
      frames.push(link.anims.currentFrame ? link.anims.currentFrame.index : -1);
      await new Promise((r) => setTimeout(r, 20));
    }
    return { totalFrames, frames, animKey: link.anims.currentAnim && link.anims.currentAnim.key, textureKey: link.texture.key };
  });
  console.log('RUNCYCLE:', JSON.stringify(seq));
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 6)));
  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
