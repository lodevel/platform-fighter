import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/charge';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], rows: [], scope: 'Actual keyboard V-held Pikachu smashes both facings: sourced full-power cap60, optional commitment through179 and forced release180, reviewed charge endpoint body and12 receiving capsules. No preview fighter slots or move replacement.' };
page.on('pageerror', e => report.errors.push(e.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4217/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.evaluate(() => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 106,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    window.__chargeStep = (count = 1) => {
      for (let n = 0; n < count; n++) { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); }
      const action = scene.p1.getAnimationActionState(), active = scene.p1.getActiveAttack(), sprite = scene.playerSlots[0].sprite;
      return { charging: action.chargingMove?.id ?? null, held: action.chargeHeldFrames,
        startup: action.chargeStartupElapsed, active: active ? { id: active.move.id, frame: active.framesElapsed, held: active.chargeHeldFrames } : null,
        receiving: scene.p1.getActiveHurtboxes(), texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
        origin: [sprite.originX, sprite.originY], facing: scene.p1.getFacing() };
    };
    window.__chargeReset = facing => {
      const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
      scene.p1.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      window.__chargeStep(12); scene.p1.setFacing(facing);
    };
  });
  for (const [id, sheet, direction] of [['forward-smash', 'smash', null], ['up-smash', 'usmash', 'w'], ['down-smash', 'dsmash', 's']]) {
    for (const facing of [1, -1]) {
      await page.evaluate(facing => window.__chargeReset(facing), facing);
      if (direction) await page.keyboard.down(direction);
      await page.keyboard.down('v');
      let state = await page.evaluate(() => window.__chargeStep());
      assert.equal(state.charging, `pikachu.${id}`, 'physical keyboard selected source smash');
      const observations = [];
      for (const held of [60, 100, 179]) {
        state = await page.evaluate(target => {
          let current = window.__chargeStep(0);
          for (let n = 0; n < 220 && current.held < target && current.charging; n++) current = window.__chargeStep();
          return current;
        }, held);
        assert.equal(state.charging, `pikachu.${id}`, `keeps full-power ${id} optional hold beyond60`);
        assert.equal(state.held, held);
        assert.equal(state.texture, `char.pikachu.${sheet}_charge`);
        assert.equal(state.textureFrame, 4, 'native nonloop charge body holds endpoint');
        assert.equal(state.receiving.length, 12);
        assert.deepEqual(state.origin, [0.5, 0.75]);
        observations.push({ held, state });
      }
      const screenshot = `${sheet}-${facing}-held179.png`;
      await page.screenshot({ path: `${output}/${screenshot}` });
      state = await page.evaluate(() => window.__chargeStep());
      assert.equal(state.charging, null, 'forced release at total hold180');
      assert.equal(state.active?.id, `pikachu.${id}`);
      assert.equal(state.active.held, 180);
      report.rows.push({ id, facing, observations, forcedRelease: state, screenshot });
      await page.keyboard.up('v');
      if (direction) await page.keyboard.up(direction);
      await page.evaluate(() => window.__chargeStep(100));
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally {
  await writeFile(`${output}/charge-match-observations.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
