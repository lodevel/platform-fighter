import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/thunder';
const airborne = process.env.PF_THUNDER_AIR === '1';
const facing = Number(process.env.PF_FACING ?? 1);
const airStartHeight = Number(process.env.PF_THUNDER_START_HEIGHT ?? 275);
const airStartVelocityY = Number(process.env.PF_THUNDER_START_VY ?? -8);
assert.ok(facing === -1 || facing === 1);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], fixture: { airborne, facing, airStartHeight, airStartVelocityY }, scope: 'Actual fixed-step MatchScene Thunder call, visible sky cloud and descending bolt, owner self-hit branch and real opponent contact. Public attemptAttack starts the source special; physical directional special input remains a separate gate.', frames: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4212/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.evaluate(({ airborne, facing, airStartHeight, airStartVelocityY }) => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 2819,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
    scene.inputResolver.isActionHeld = () => false;
    const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    // A clear sky column avoids the standard stage's floating platforms
    // intercepting the descending source object before it reaches the owner.
    const overhead = scene.baseStage.bodies.platformBodies.filter(body => body !== floor);
    let x;
    for (let candidate = floor.bounds.min.x + 150; candidate < floor.bounds.max.x - 150; candidate += 20) {
      if (overhead.every(body => candidate + 50 < body.bounds.min.x || candidate - 50 > body.bounds.max.x)) { x = candidate; break; }
    }
    if (x === undefined) throw new Error('Thunder fixture needs a clear sky column');
    scene.p1.resetForRound(x, floor.bounds.min.y - 25);
    scene.p2.resetForRound(x + 55, floor.bounds.min.y - scene.p2.getTuning().height / 2);
    window.__pikachuThunderStep = (steps = 1) => {
      for (let i = 0; i < steps; i++) { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); }
      const sprite = scene.playerSlots[0].sprite;
      const camera = scene.cameras.main;
      return { state: scene.p1.getPikachuSpecialState(), objects: scene.p1.getPikachuSpecialVisuals(),
        position: scene.p1.getPosition(), damage: scene.p2.getDamagePercent(), receiving: scene.p1.getActiveHurtboxes(),
        texture: sprite?.texture.key, textureFrame: sprite?.frame.name,
        origin: sprite ? [sprite.originX, sprite.originY] : null,
        camera: { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom,
          width: camera.width, height: camera.height, worldView: {
            x: camera.worldView.x, y: camera.worldView.y,
            width: camera.worldView.width, height: camera.worldView.height } } };
    };
    window.__pikachuThunderStep(12);
    // A rising aerial owner lets the descending object catch him before
    // ordinary source gravity brings him back to the floor. Matter velocity
    // seeds the real-physics fixture; the move never teleports its owner.
    if (airborne) {
      scene.p1.resetForRound(x, floor.bounds.min.y - airStartHeight);
      scene.matter.body.setVelocity(scene.p1.body, { x: 0, y: airStartVelocityY });
    }
    scene.p1.setFacing(facing);
    scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
    if (!scene.p1.attemptAttack('pikachu.down_special')) throw new Error('Thunder did not start');
  }, { airborne, facing, airStartHeight, airStartVelocityY });
  const capture = async (label, steps) => {
    const frame = await page.evaluate(steps => window.__pikachuThunderStep(steps), steps);
    report.frames.push({ label, ...frame });
    await page.screenshot({ path: `${output}/${label}.png` });
  };
  await capture('call-frame1', 1);
  await capture('sky-frame12', 11);
  await capture('descending-frame16', 4);
  await capture('descending-frame20', 4);
  await capture('descending-frame24', 4);
  await capture('impact-frame28', 4);
  await capture('impact-frame36', 8);
  await capture('recovery-frame70', 34);
  assert.equal(report.frames[0].texture, airborne ? 'char.pikachu.down_special_air' : 'char.pikachu.down_special');
  if (airborne) assert.equal(report.frames[0].state.bornGrounded, false);
  assert.deepEqual(report.frames[0].origin, [0.5, 416 / 512]);
  assert.equal(report.frames[0].receiving.length, 12);
  assert.ok(report.frames.some(frame => frame.objects.some(object => object.kind === 'cloud')), 'sky cloud must be present');
  assert.ok(report.frames.some(frame => frame.objects.some(object => object.kind === 'cloud'
    && (object.y - frame.camera.worldView.y) * frame.camera.zoom >= 40
    && (object.y - frame.camera.worldView.y) * frame.camera.zoom < frame.camera.height - 40)),
    'production camera must show the sky cloud above its caller');
  assert.ok(report.frames.some(frame => frame.objects.some(object => object.kind === 'bolt')), 'descending bolt must be present');
  assert.ok(report.frames.some(frame => frame.state?.branchFrame !== null && frame.state?.branchFrame !== undefined), 'bolt must reach its owner and enter the conditional self-hit branch');
  if (process.env.PF_EXPECT_GROUND_HIT === '1' || process.env.PF_EXPECT_AIR_HIT === '1') {
    const sheet = airborne ? 'char.pikachu.down_special_air_hit' : 'char.pikachu.down_special_hit';
    const branch = report.frames.filter(frame => frame.state?.branchFrame !== null && frame.state?.branchFrame !== undefined);
    assert.ok(branch.length > 0);
    assert.ok(branch.every(frame => frame.texture === sheet), 'accepted entered self-hit body must render on the actual branch');
    assert.ok(branch.every(frame => frame.receiving.length === 12), 'actual self-hit branch consumes12 reviewed receiving capsules');
  }
  if (!airborne) assert.ok(report.frames.some(frame => frame.damage > 0), 'conditional Thunder attack must damage the actual opponent');
  report.scope += airborne ? ` Air call qualification: owner body bottom begins${airStartHeight - 25}px above floor, velocityY${airStartVelocityY}px/step; no aerial opponent contact assertion.` : '';
  assert.deepEqual(report.errors, []);
  report.facing = facing;
  report.result = 'PASS';
  console.log(JSON.stringify({ frames: report.frames.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL';
  report.assertionFailure = error.message;
  throw error;
} finally {
  await writeFile(`${output}/thunder-match-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
