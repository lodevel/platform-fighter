import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/normals';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Real MatchScene/Matter contact and registered render poses for thirteen canonical normals and both angled forward tilts in both facings. Moves start through public attemptAttack; separate keyboard evidence covers physical input. Receiver positioned at the first source strike; this checks contact execution, not neutral spacing or native balance.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__pikachuCaptureNormal', async filename => {
  await page.screenshot({ path: `${output}/${filename}` });
});
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4211/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.renderer = await page.evaluate(() => {
    const game = window.__game, gl = game.renderer.gl;
    return { type: game.renderer.type, maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : null,
      textures: game.textures.getTextureKeys().filter(key => key.startsWith('char.pikachu.')).flatMap(key =>
        game.textures.get(key).source.map(source => ({ key, width: source.width, height: source.height }))) };
  });
  report.rows = await page.evaluate(async () => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 817,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
    scene.inputResolver.isActionHeld = () => false;
    const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const rows = [];
    const moves = [...scene.p1.attacks.values()].filter(move => ['jab', 'tilt', 'smash', 'aerial'].includes(move.type)
      && !/getup|trip|ledge/i.test(move.id));
    const angled = scene.p1.attacks.get('pikachu.forward-tilt').angledVariants;
    const descriptors = [...moves.map(move => ({ move })),
      { move: angled.up, angleY: -0.5 }, { move: angled.down, angleY: 0.5 }];
    for (const { move, angleY } of descriptors) for (const facing of [1, -1]) {
      const airborne = move.type === 'aerial';
      const y = floor.bounds.min.y - (airborne ? 500 : 25);
      scene.p1.resetForRound(floor.position.x, y);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let frame = 0; frame < 12; frame++) step();
      scene.p1.setFacing(facing);
      if (angleY !== undefined) {
        scene.inputResolver.getMoveVector = () => ({ x: facing * 0.5, y: angleY });
        step();
        scene.inputResolver.isActionHeld = (slot, action) => action === 'attack';
        step();
        scene.inputResolver.isActionHeld = () => false;
        scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
        if (scene.p1.getActiveAttack()?.move.id !== move.id) throw new Error(`Source diagonal input failed ${move.id}/${facing}`);
      } else if (!scene.p1.attemptAttack(move.id)) throw new Error(`Failed to begin ${move.id}/${facing}`);
      const firstStrike = move.hitWindows?.find(window => window.collisionHits?.length)?.collisionHits?.[0]
        ?? move.collisionHits?.[0];
      const contact = firstStrike?.capsule;
      if (!contact) throw new Error(`Missing source contact ${move.id}`);
      const local = { x: (contact.start.x + contact.end.x) / 2, y: (contact.start.y + contact.end.y) / 2 };
      let hit = null;
      for (let frame = 0; frame < 160; frame++) {
        const p = scene.p1.getPosition();
        scene.matter.body.setPosition(scene.p2.body, { x: p.x + facing * local.x,
          y: Math.min(p.y + local.y, floor.bounds.min.y - scene.p2.getTuning().height / 2) });
        scene.matter.body.setVelocity(scene.p2.body, { x: 0, y: 0 });
        step();
        if (scene.p2.getDamagePercent() > 0) {
          const attack = scene.p1.getActiveAttack();
          const sprite = scene.playerSlots[0].sprite;
          hit = { step: frame, actionFrame: attack?.framesElapsed, damage: scene.p2.getDamagePercent(),
            sourceElectric: firstStrike.electricCollision === true,
            attackerHitlag: scene.p1.getHitlagRemaining(), receiverHitlag: scene.p2.getHitlagRemaining(),
            receivingCapsules: scene.p1.getActiveHurtboxes().length,
            texture: sprite?.texture.key, textureFrame: sprite?.frame.name,
            spriteOrigin: sprite ? [sprite.originX, sprite.originY] : null,
            attacker: scene.p1.getPosition(), receiver: scene.p2.getPosition() };
          hit.screenshot = `${move.id.replace(/[^a-z0-9_-]/gi, '-')}-${facing === 1 ? 'right' : 'left'}.png`;
          await window.__pikachuCaptureNormal(hit.screenshot);
          break;
        }
        if (!scene.p1.getActiveAttack()) break;
      }
      rows.push({ id: move.id, facing, airborne, hit });
    }
    return rows;
  });
  assert.equal(report.rows.length, 30);
  for (const row of report.rows) {
    assert.ok(row.hit, `${row.id}/${row.facing} must damage its real receiver`);
    assert.ok(row.hit.receivingCapsules >= 12, `${row.id} must consume authored receiving geometry`);
    assert.ok(row.hit.texture?.startsWith('char.pikachu.'), `${row.id} must render dedicated accepted art`);
  }
  report.contactResult = 'PASS';
  if (report.renderer.maxTextureSize !== null) assert.ok(report.renderer.textures.every(texture =>
    texture.width <= report.renderer.maxTextureSize && texture.height <= report.renderer.maxTextureSize),
    'Every actual Pikachu sheet must fit the running renderer MAX_TEXTURE_SIZE');
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.message; throw error;
} finally {
  await writeFile(`${output}/normal-contact-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
