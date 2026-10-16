import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/crouch-shield';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual MatchScene down-stick eligible crouch hold/reentry and neutral shield, both facings. Crouch nonloop final59 holds, neutral shield native0 is explicitly indefinite. Native start/end/angle/crawl/status rates remain unqualified. InputResolver controls are injected; physical keyboard has separate evidence.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuHold', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4222/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 832,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    const reset = facing => { actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing); };
    const capture = async (sheet, facing, target, age) => {
      const sprite = scene.playerSlots[0].sprite, observation = { age, facing: actor.getFacing(),
        crouch: actor.getCrouchPresentationState(), locomotion: actor.getLocomotionState(), shield: actor.getShieldState(),
        receiving: actor.getActiveHurtboxes(), texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
        origin: [sprite.originX, sprite.originY], grounded: actor.isGrounded() };
      const screenshot = `${sheet}-${facing}-${target}.png`; await window.__capturePikachuHold(screenshot);
      rows.push({ sheet, facing, target, observation, screenshot });
    };
    for (const facing of [1, -1]) {
      reset(facing); step({ moveY: 1 });
      for (const target of [0, 15, 30, 45, 59, 90]) {
        for (let n = 0; n < 100 && (actor.getCrouchPresentationState()?.framesElapsed ?? -1) < target; n++) step({ moveY: 1 });
        await capture('crouch', facing, target, actor.getCrouchPresentationState()?.framesElapsed);
      }
      if (!actor.attemptAttack('pikachu.down-tilt')) throw new Error('Crouch source attack failed to enter');
      step({ moveY: 1 });
      if (actor.getCrouchPresentationState()) throw new Error('Eligible hold presentation survived a committed attack');
      for (let n = 0; n < 100 && !actor.getCrouchPresentationState(); n++) step({ moveY: 1 });
      rows.push({ sheet: 'crouch-reentry', facing, observation: { crouch: actor.getCrouchPresentationState(),
        receiving: actor.getActiveHurtboxes(), textureFrame: Number(scene.playerSlots[0].sprite.frame.name) } });
      reset(facing); step({ shield: true });
      await capture('shield', facing, 0, 0);
      for (let n = 0; n < 90; n++) step({ shield: true });
      await capture('shield', facing, 90, 90);
    }
    return rows;
  });
  for (const row of report.rows) {
    const o = row.observation;
    if (row.sheet === 'crouch-reentry') { assert.equal(o.crouch.framesElapsed, 0); assert.equal(o.textureFrame, 0); continue; }
    const clip = metadata.animations[row.sheet], end = clip.frameWindows.at(-1).endFrame;
    const local = end === null ? o.age : Math.min(o.age, end - 1);
    const window = clip.frameWindows.find(w => w.startFrame <= local && (w.endFrame === null || local < w.endFrame));
    assert.ok(Number.isFinite(o.age) && o.age >= row.target); assert.equal(o.grounded, true);
    assert.equal(o.texture, `char.pikachu.${row.sheet}`); assert.equal(o.textureFrame, window.artFrameIndex);
    assert.deepEqual(o.receiving, poses.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes);
    assert.deepEqual(o.origin, [0.5, 0.8125]); assert.equal(o.facing, row.facing);
    if (row.sheet === 'shield') assert.equal(o.shield.name, 'active');
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/crouch-shield-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
