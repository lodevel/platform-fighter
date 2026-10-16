import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/jump-damage-interruption';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
const jumpAges = (process.env.PF_JUMP_AGES ?? '0,8,20').split(',').map(Number);
const shortHop = process.env.PF_SHORT_HOP === '1';
const jumpOnly = true;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], rows: [], scope: 'Real MatchScene grounded launch and injected explicit damage1/zero hitlag at actual launchage0, both faces/full or short hop. Observed damage interruption retires beta prelaunch-body route and pairs actual hurt_air receiving. Source native common selector/physics parity not claimed.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuLocomotion', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4219/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ jumpAges, shortHop, jumpOnly }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 841,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(b => b !== floor);
    const columns = [];
    for (let x = floor.bounds.min.x + 300; x <= floor.bounds.max.x - 300; x += 20)
      if (overhead.every(b => x + 25 < b.bounds.min.x || x - 25 > b.bounds.max.x)) columns.push(x);
    if (!columns.length) throw new Error('Need unobstructed actual launch column');
    const actor = scene.p1, start = { x: columns[Math.floor(columns.length / 2)], y: floor.bounds.min.y - 25 };
    const settle = facing => {
      actor.resetForRound(start.x, start.y); actor.setDamagePercent(0); actor.setFacing(facing);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      for (let n = 0; n < 12; n++) step();
      actor.setFacing(facing);
      if (!actor.isGrounded()) throw new Error('Actual launch fixture failed to settle');
    };
    const rows = [];
    const capture = async (sheet, facing, requestedAge, age) => {
      const sprite = scene.playerSlots[0].sprite, camera = scene.cameras.main;
      const observation = { age, facing: actor.getFacing(), position: actor.getPosition(), velocity: actor.getVelocity(),
        locomotion: actor.getLocomotionState(), jump: actor.getJumpPresentationState(), jumpsquat: actor.getJumpsquatRemaining(),
        receiving: actor.getActiveHurtboxes(), grounded: actor.isGrounded(), floorY: floor.bounds.min.y,
        texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
        bounds: sprite.getBounds(), camera: { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom,
          x: camera.x, y: camera.y, width: camera.width, height: camera.height } };
      const screenshot = `${sheet}-${facing}-${requestedAge}.png`;
      await window.__capturePikachuLocomotion(screenshot);
      rows.push({ sheet, facing, requestedAge, observation, screenshot });
    };
    for (const facing of [1,-1]) {
      settle(facing);step({jump:true});
      for(let n=0;n<4&&!actor.getJumpPresentationState();n++)step({jump:!shortHop});
      const before={jump:actor.getJumpPresentationState(),texture:scene.playerSlots[0].sprite.texture.key,receiving:actor.getActiveHurtboxes()};
      if(before.jump?.framesElapsed!==0)throw Error('Launch fixture not actual age0');
      actor.applyHit({damage:1,knockback:{x:facing*2,y:-3,scaling:0},facing,hitlagMultiplier:0});step();
      const after={jump:actor.getJumpPresentationState(),reaction:actor.getReactionPresentationState(),texture:scene.playerSlots[0].sprite.texture.key,receiving:actor.getActiveHurtboxes()};
      const screenshot=`launch-damage-${facing}.png`;await window.__capturePikachuLocomotion(screenshot);
      rows.push({facing,shortHop,before,after,captures:[{screenshot,observation:after}]});
    }
    return rows;
  }, { jumpAges, shortHop, jumpOnly });
  for(const row of report.rows){
    assert.equal(row.before.texture,'char.pikachu.jumpsquat');assert.equal(row.before.receiving.length,12);
    assert.equal(row.after.jump,null);assert.equal(row.after.texture,'char.pikachu.hurt_air');assert.equal(row.after.receiving.length,12);
    const expected=poses.find(p=>p.sheet==='hurt_air'&&p.artFrameIndex===0);assert.ok(expected);assert.deepEqual(row.after.receiving,expected.hurtboxes);
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/launch-damage-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
