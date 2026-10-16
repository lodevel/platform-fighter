import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/ordinary';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], rows: [], scope: 'Actual fixed-step MatchScene neutral idle and partial-stick default-middle walk, both facings, source drawing/receiving normalization and true idle reentry after jab. Native rates and slow/middle/fast selector remain explicit beta adaptations.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__capturePikachuOrdinary', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4218/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 112,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.isActionHeld = () => false;
    let moveX = 0;
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? moveX : 0, y: 0 });
    const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const actor = scene.p1;
    const read = () => {
      const ordinary = actor.getOrdinaryPresentationState(), locomotion = actor.getLocomotionState();
      const sprite = scene.playerSlots[0].sprite;
      return { ordinary, locomotion, facing: actor.getFacing(), receiving: actor.getActiveHurtboxes(),
        texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
        scaleX: sprite.scaleX, grounded: actor.isGrounded(), hitlag: actor.getHitlagRemaining() };
    };
    const rows = [];
    for (const facing of [1, -1]) {
      moveX = 0;
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      actor.setFacing(facing);
      for (let n = 0; n < 20 && actor.getOrdinaryPresentationState()?.sheet !== 'idle'; n++) step();
      for (const target of [0, 26, 53, 79, 106, 150]) {
        for (let n = 0; n < 180 && (actor.getOrdinaryPresentationState()?.framesElapsed ?? -1) < target; n++) step();
        const observation = read(), screenshot = `idle-${facing}-${target}.png`;
        await window.__capturePikachuOrdinary(screenshot);
        rows.push({ sheet: 'idle', facing, target, observation, screenshot });
      }
      if (!actor.attemptAttack('pikachu.jab')) throw new Error('Ordinary acceptance jab entry failed');
      step();
      if (actor.getOrdinaryPresentationState()) throw new Error('Idle clock remained eligible during jab');
      for (let n = 0; n < 100 && !actor.getOrdinaryPresentationState(); n++) step();
      rows.push({ sheet: 'idle-reentry', facing, observation: read() });
      moveX = facing * 0.5;
      step();
      for (const target of [0, 8, 15, 23, 30, 45]) {
        for (let n = 0; n < 100 && (actor.getOrdinaryPresentationState()?.framesElapsed ?? -1) < target; n++) step();
        const observation = read(), screenshot = `walk-${facing}-${target}.png`;
        await window.__capturePikachuOrdinary(screenshot);
        rows.push({ sheet: 'walk', facing, target, observation, screenshot });
      }
    }
    return rows;
  });
  for (const row of report.rows) {
    const s = row.observation;
    if (row.sheet === 'idle-reentry') {
      assert.equal(s.ordinary?.sheet, 'idle');
      assert.ok(s.ordinary.framesElapsed <= 1, 'true idle reentry resets even if locomotion stayed standing');
      continue;
    }
    const age = s.ordinary?.framesElapsed;
    assert.ok(Number.isFinite(age) && age >= row.target);
    const clip = metadata.animations[row.sheet];
    const local = clip.loopDuration ? age % clip.loopDuration : Math.min(age, clip.frameWindows.at(-1).endFrame - 1);
    const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
    const expected = poses.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex);
    assert.equal(s.texture, `char.pikachu.${row.sheet}`);
    assert.equal(s.textureFrame, window.artFrameIndex);
    assert.deepEqual(s.receiving, expected.hurtboxes, `${row.sheet}/${row.facing}/${age}: same reviewed drawing and receiving clock`);
    assert.deepEqual(s.origin, [0.5, 0.8125]);
    assert.equal(s.facing, row.facing);
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.stack; throw error;
} finally {
  await writeFile(`${output}/ordinary-match-observations.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
