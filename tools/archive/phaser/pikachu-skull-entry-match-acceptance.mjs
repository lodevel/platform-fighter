import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/skull-entry';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Public actual source attack entry in production Match, actual Matter inherited velocities; neutral and opposite air STOP motion bothfacings through startup/hold. Native common STOP algorithm/frame scheduling remains outside this fixed-step adapter proof.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureEntry', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4232/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async () => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 858, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 }); scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && action === 'special';
    const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    for (const facing of [1, -1]) for (const inherited of [0, -3]) {
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 550); scene.p2.resetForRound(floor.position.x - 180, floor.bounds.min.y - 50);
      actor.setFacing(facing); scene.matter.body.setVelocity(actor.body, { x: inherited * facing, y: 0 });
      if (!actor.attemptAttack('pikachu.side_special')) throw new Error('Public source Skull entry failed');
      const trace = [], captures = [];
      for (let n = 0; n <= 25; n++) {
        const sprite = scene.playerSlots[0].sprite;
        const observation = { state: actor.getPikachuSpecialState(), position: actor.getPosition(), velocity: actor.getVelocity(), grounded: actor.isGrounded(),
          texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), receiving: actor.getActiveHurtboxes() };
        trace.push(observation);
        // Entry0 has not passed through a render update yet; later boundaries
        // are actual production frame consumers.
        if ([1, 8, 12, 13, 20].includes(n)) { const screenshot = `skull-entry-${facing}-${inherited}-${n}.png`;
          await window.__captureEntry(screenshot); captures.push({ screenshot, observation }); }
        step();
      }
      rows.push({ facing, inherited, trace, captures });
    }
    return rows;
  });
  for (const row of report.rows) {
    const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} versus ${expected}`);
    close(row.trace[0].velocity.x, row.inherited * row.facing * .8);
    for (const o of row.trace) {
      assert.equal(o.grounded, false); const age = o.state.frame;
      close(o.velocity.x, age <= 12 ? row.facing * (row.inherited * .8 - age * .1) : 0);
      if (age >= 13) {
        close(o.position.x, row.trace[13].position.x);
        assert.equal(o.texture, 'char.pikachu.side_special_air_hold');
        assert.equal(o.textureFrame, Math.floor(((o.state.heldFrames - 1) % 6) / 2));
        assert.equal(o.receiving.length, 12);
      }
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS'; console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length }));
} catch (e) { report.result = 'FAIL'; report.assertionFailure = e.stack; throw e; }
finally { await writeFile(`${output}/skull-entry-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
