import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/skull-slope';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(process.env.PF_PIKACHU_PHASE_LEAF ?? new URL('../src/characters/pikachuSpecialPhaseHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual inclined Matter floor; both-facing Skull body, native joint pivot, all12 receiving capsules and current-owner contact. Source-ground touch adapter is observed; native common kinetics remain separate.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__captureSlope', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4231/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async () => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 858, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {}; scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    for (const facing of [1, -1]) {
      const angle = -facing * Math.PI / 6;
      scene.matter.body.setAngle(floor, angle);
      // This replay changes the real collision floor. The normal flat-stage
      // artwork remains flat, so explicitly outline the altered polygon.
      // Diagnostic overlays do not relocate the sprite or change physics.
      const overlay = scene.add.graphics().setDepth(80);
      overlay.lineStyle(3, 0x33ffbb, 1).strokePoints(floor.vertices, true);
      const x = floor.position.x, y = floor.position.y - 25 / Math.cos(angle) - 25;
      actor.resetForRound(x, y); scene.p2.resetForRound(x - facing * 400, y - 80);
      for (let n = 0; n < 25; n++) step(); actor.setFacing(facing);
      const entry = { position: actor.getPosition(), grounded: actor.isGrounded() };
      step({ moveX: facing * .5, special: true });
      const trace = [], captures = [];
      for (let n = 0; n < 40; n++) {
        const state = actor.getPikachuSpecialState(); if (!state) break;
        const sprite = scene.playerSlots[0].sprite, active = actor.getActiveAttack();
        const observation = { state, facing: actor.getFacing(), position: actor.getPosition(), grounded: actor.isGrounded(), velocity: actor.getVelocity(),
          texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY], spritePosition: { x: sprite.x, y: sprite.y },
          rotation: sprite.rotation, receiving: actor.getActiveHurtboxes(), sensorPosition: active?.hitboxBody ? { ...active.hitboxBody.position } : null,
          contactRows: active?.hitboxBody?.plugin?.collisionHits ?? null };
        trace.push(observation);
        if ([13, 14, 15, 17, 20, 30].includes(state.normalizedFrame)) {
          overlay.clear().lineStyle(3, 0x33ffbb, 1).strokePoints(floor.vertices, true);
          overlay.lineStyle(1, 0xff6688, .6);
          for (const box of observation.receiving) {
            const cap = box.capsule;
            for (const p of [cap.start, cap.end]) overlay.strokeCircle(observation.position.x + p.x * facing, observation.position.y + p.y, cap.radius);
          }
          if (observation.sensorPosition) overlay.lineStyle(2, 0xffff00, 1).strokeCircle(observation.sensorPosition.x, observation.sensorPosition.y, 4);
          const screenshot = `skull-slope-${facing}-${state.normalizedFrame}.png`; await window.__captureSlope(screenshot); captures.push({ screenshot, observation });
        }
        step();
      }
      rows.push({ facing, floorAngle: angle, entry, trace, captures });
      overlay.destroy();
    }
    return rows;
  });
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} versus ${expected}`);
  for (const row of report.rows) {
    assert.equal(row.entry.grounded, true, 'source incline must be actual grounded contact');
    const release = row.trace.filter(o => o.state.normalizedFrame >= 13 && o.state.normalizedFrame <= 51 && !o.state.holding);
    assert.ok(release.some(o => Math.abs(o.state.bodyRotation) > .01), 'actual slope produces native joint rotation');
    for (const o of release) {
      const theta = o.state.bodyRotation, local = o.state.normalizedFrame - 13, clip = metadata.animations.side_special;
      const w = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(o.texture, 'char.pikachu.side_special'); assert.equal(o.textureFrame, w.artFrameIndex); close(o.rotation, theta, 'sprite angle');
      const pivot = { x: 0, y: .2500009536743164 };
      close(o.spritePosition.x, o.position.x, 'source pivot world x'); close(o.spritePosition.y, o.position.y + pivot.y, 'source pivot world y');
      close(o.origin[0], .5, 'pivot origin x');
      // The fixed art root is25 world pixels BELOW the physics body centre.
      close(o.origin[1], (clip.root[1] + (pivot.y - 25) / clip.scaleToWorld) / clip.frameHeight, 'pivot origin y');
      const rotate = p => { const x = p.x * row.facing, y = p.y - pivot.y; return { x: (x * Math.cos(theta) - y * Math.sin(theta)) * row.facing, y: pivot.y + x * Math.sin(theta) + y * Math.cos(theta) }; };
      const source = poses.find(p => p.sheet === 'side_special' && p.artFrameIndex === w.artFrameIndex);
      assert.equal(o.receiving.length, 12);
      for (let i = 0; i < 12; i++) for (const endpoint of ['start', 'end']) {
        const expected = rotate(source.hurtboxes[i].capsule[endpoint]), actual = o.receiving[i].capsule[endpoint];
        close(actual.x, expected.x, `receiving${i} ${endpoint} x`); close(actual.y, expected.y, `receiving${i} ${endpoint} y`);
      }
      if (o.state.normalizedFrame >= 17) {
        const neck = rotate({ x: 15, y: 3.7500009536743164 });
        close(o.sensorPosition.x, o.position.x + neck.x * row.facing, 'current contact x'); close(o.sensorPosition.y, o.position.y + neck.y, 'current contact y');
      }
    }
    close(release[0].velocity.x, row.facing * 8 * .7, 'native uphill speed factor');
    close(release[0].state.bodyRotation, row.facing * -3 * Math.PI / 180, 'native first slope step');
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS'; console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/skull-slope-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
