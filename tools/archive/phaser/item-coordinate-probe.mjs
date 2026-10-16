import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-09/gameplay';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.result = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 731, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    let input = {};
    s.inputResolver.getMoveVector = player => player === 1 ? { x: input.moveX ?? 0, y: input.moveY ?? 0 } : { x: 0, y: 0 };
    s.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const step = (next = {}) => { input = next; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); };
    const frames = count => { for (let i = 0; i < count; i++) step(); };
    const p = s.activeStage.platforms.find(p => !p.passThrough);
    const anchor = { x: p.x, y: p.y - p.height / 2 - 60 };
    const spawnPosition = { x: anchor.x, y: anchor.y - 150 };
    const transform = s.baseStage.transform;
    const physicalX = transform.offsetX + spawnPosition.x * transform.viewportScale;
    const physicalTop = transform.offsetY + (p.y - p.height / 2) * transform.viewportScale;
    s.p1.setPosition(physicalX, physicalTop - s.p1.getTuning().height / 2);
    s.p2.setPosition(150, 200);
    let pending = true;
    s.itemSpawnManager.step = frame => {
      if (!pending) return [];
      pending = false;
      return [{ frame, anchorIndex: 0, anchor, spawnPosition }];
    };
    step();
    const entity = s.itemRegistry.getActive()[0];
    const visual = s.itemVisuals.get(entity.id);
    const spawn = { physical: entity.getPosition(), visual: { x: visual.x, y: visual.y } };
    frames(60);
    const grounded = { state: entity.getSnapshot().state, physical: entity.getPosition(), visual: { x: visual.x, y: visual.y }, top: physicalTop };
    step({ attack: true }); step();
    const held = { state: entity.getSnapshot().state, physical: entity.getPosition(), visual: { x: visual.x, y: visual.y } };
    let swing = null;
    if (entity.isHeld()) {
      step({ attack: true });
      for (let i = 0; i < 6; i++) {
        step();
        const a = s.p1.getActiveAttack(), f = s.swingFlashes[0]?.container;
        if (a?.phase === 'active' && f && !swing) swing = {
          art: [f.x, f.y, f.width, f.height],
          physical: [a.hitboxBody.position.x, a.hitboxBody.position.y, a.move.hitbox.width, a.move.hitbox.height],
        };
      }
      frames(25);
      step({ grab: true, moveX: 1 });
    }
    let thrown = null;
    if (s.thrownItems[0]) {
      const t = s.thrownItems[0];
      thrown = { physical: [t.x, t.y], entity: Object.values(entity.getPosition()), visual: [visual.x, visual.y] };
    }
    frames(55);
    const landed = { state: entity.getSnapshot().state, physical: entity.getPosition(), visual: { x: visual.x, y: visual.y }, flying: s.thrownItems.length, top: physicalTop };
    const platform = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    s.matter.body.setPosition(platform, { x: platform.position.x, y: platform.position.y - 50 });
    const movedTop = platform.bounds.min.y;
    const freeItem = (x, y) => {
      const item = s.itemRegistry.spawn(entity.definition, { x, y }, s.physicsEngine.getFrame(), entity.constructor);
      const art = s.add.container(x, y); s.itemVisuals.set(item.id, art);
      return { item, art };
    };
    const fallback = freeItem(physicalX - 100, movedTop - 25);
    frames(6);
    const liveFallback = { state: fallback.item.getSnapshot().state, physical: fallback.item.getPosition(),
      visual: { x: fallback.art.x, y: fallback.art.y }, movedTop, originalTop: physicalTop };
    const savedMask = platform.collisionFilter.mask; platform.collisionFilter.mask = 0;
    const unsupported = freeItem(physicalX - 150, movedTop - 10);
    frames(5);
    const disabled = { state: unsupported.item.getSnapshot().state, physical: unsupported.item.getPosition(),
      visual: { x: unsupported.art.x, y: unsupported.art.y }, top: movedTop };
    platform.collisionFilter.mask = savedMask;
    return { transform, spawn, grounded, held, swing, thrown, landed, liveFallback, disabled };
  });
  const r = report.result;
  assert.notEqual(r.transform.viewportScale, 1);
  assert.deepEqual(r.spawn.physical, r.spawn.visual);
  assert.deepEqual(r.grounded.physical, r.grounded.visual);
  assert.equal(r.grounded.physical.y, r.grounded.top);
  assert.equal(r.held.state, 'held');
  assert.deepEqual(r.held.physical, r.held.visual);
  assert.deepEqual(r.swing.art, r.swing.physical);
  assert.deepEqual(r.thrown.visual, r.thrown.physical);
  assert.deepEqual(r.thrown.entity, r.thrown.physical);
  assert.equal(r.landed.flying, 0);
  assert.deepEqual(r.landed.physical, r.landed.visual);
  assert.equal(r.landed.physical.y, r.landed.top);
  assert.equal(r.liveFallback.state, 'grounded');
  assert.equal(r.liveFallback.physical.y, r.liveFallback.movedTop);
  assert.deepEqual(r.liveFallback.physical, r.liveFallback.visual);
  assert.notEqual(r.liveFallback.movedTop, r.liveFallback.originalTop);
  assert.equal(r.disabled.state, 'falling');
  assert.ok(r.disabled.physical.y > r.disabled.top);
  assert.deepEqual(r.disabled.physical, r.disabled.visual);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/item-coordinate-probe${process.env.PROBE_SUFFIX ?? ''}.json`, JSON.stringify(report, null, 2)); await browser.close(); }
