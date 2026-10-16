import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/textures';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const requestedGpuSheets = process.env.PF_GPU_SHEETS ? new Set(process.env.PF_GPU_SHEETS.split(',')) : null;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], requestedGpuSheets: requestedGpuSheets ? [...requestedGpuSheets] : 'all multirow atlases', scope: 'Actual production Phaser/WebGL texture upload constraints and all authored cell extraction/counts, plus paused-Match first/last GPU draw samples of the selected sheets. Forced texture samples are visual inspection, not proof of legal gameplay clocks.', rows: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4217/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(animations => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 338,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    game.scene.pause('MatchScene');
    const gl = game.renderer.gl, limit = gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null;
    return Object.entries(animations).map(([sheet, clip]) => {
      const route = sheet === 'ftilt' ? 'tilt' : sheet;
      const key = `char.pikachu.${route}`, texture = game.textures.get(key);
      const animation = game.anims.get(`pikachu.${route}.anim`);
      return { sheet, key, frameCount: clip.frameCount, maxTextureSize: limit,
        sourceWidth: texture.source[0].width, sourceHeight: texture.source[0].height,
        loadedFrames: texture.getFrameNames().length, animationFrames: animation?.frames.length,
        frames: Array.from({ length: clip.frameCount }, (_, index) => {
          const frame = texture.get(index), cell = clip.sourceCells[index];
          return { index, cut: [frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight],
            expected: [cell[0] * clip.frameWidth, cell[1] * clip.frameHeight, clip.frameWidth, clip.frameHeight] };
        }) };
    });
  }, metadata.animations);
  for (const row of report.rows) {
    assert.equal(row.loadedFrames, row.frameCount, `${row.sheet}: padding must not become loaded frames`);
    assert.equal(row.animationFrames, row.frameCount, `${row.sheet}: animation must contain only authored cells`);
    assert.ok(row.sourceWidth <= 4096 && row.sourceHeight <= 4096, `${row.sheet}: portable atlas bounds`);
    if (row.maxTextureSize !== null) assert.ok(row.sourceWidth <= row.maxTextureSize && row.sourceHeight <= row.maxTextureSize);
    for (const frame of row.frames) assert.deepEqual(frame.cut, frame.expected, `${row.sheet}/${frame.index}: actual row-major extraction`);
  }
  report.gpuSamples = [];
  for (const row of report.rows.filter(row => requestedGpuSheets ? requestedGpuSheets.has(row.sheet)
    : row.sourceHeight > metadata.animations[row.sheet].frameHeight)) {
    const clip = metadata.animations[row.sheet];
    for (const index of [0, row.frameCount - 1]) {
      await page.evaluate(({ key, index, clip }) => {
        const game = window.__game, scene = game.scene.getScene('MatchScene');
        const sprite = scene.playerSlots[0].sprite, camera = scene.cameras.main;
        sprite.anims.pause(); sprite.setTexture(key, index).setVisible(true).setAlpha(1);
        sprite.setOrigin(clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight);
        sprite.setScale(clip.scaleToWorld);
        sprite.setPosition(camera.worldView.centerX, camera.worldView.centerY + 70);
      }, { key: row.key, index, clip });
      const screenshot = `${row.sheet}-cell${index}.png`;
      await page.screenshot({ path: `${output}/${screenshot}` });
      report.gpuSamples.push({ sheet: row.sheet, index, screenshot });
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ strips: report.rows.length, cells: report.rows.reduce((sum, row) => sum + row.frameCount, 0), gpuSamples: report.gpuSamples.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.message; throw error;
} finally {
  await writeFile(`${output}/texture-match-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
