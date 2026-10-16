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
  await page.waitForFunction(() => window.__game?.scene.getScenes(true).some(s => s.scene.key !== 'BootScene'), null, { timeout: 60000 });
  report.result = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 842, itemFrequency: 'off', linkIntroPolicy: 'none',
      players: [{ index: 2, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p2' },
        { index: 4, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p1' }] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    let inputs = [{}, {}];
    s.inputResolver.getMoveVector = player => ({ x: inputs[player - 1]?.moveX ?? 0, y: inputs[player - 1]?.moveY ?? 0 });
    s.inputResolver.isActionHeld = (player, action) => inputs[player - 1]?.[action] === true;
    const step = (first = {}, second = {}) => {
      inputs = [first, second]; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
    };
    const frames = count => { for (let i = 0; i < count; i++) step(); };
    const platform = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const top = platform.bounds.min.y;
    const set = (fighter, x) => {
      // Move the fixture body without invoking Character's respawn/reset API.
      s.matter.body.setPosition(fighter.body, { x, y: top - fighter.getTuning().height / 2 });
      s.matter.body.setVelocity(fighter.body, { x: 0, y: 0 });
    };
    // Link's Remote Bomb is an item (LinkRemoteBombItem); its fuse and holder live in the scene's Link articles
    // (src/match/linkArticles.ts). null once it has exploded.
    const bombOf = () => {
      const row = s.linkArticles.snapshot().bombs.find(b => b.ownerIndex === s.playerSlots[0].playerIndex);
      const entity = row && s.itemRegistry.getActive().find(e => e.id === row.itemId);
      return entity ? { ...row, held: row.holderIndex !== null, x: entity.getPosition().x, y: entity.getPosition().y } : null;
    };
    const center = platform.position.x;
    set(s.p1, center - 150); set(s.p2, platform.bounds.max.x - 50); frames(12);
    const charge = { moveY: -1, special: true };
    step(charge); for (let i = 0; i < 33; i++) step(charge);
    // The Spin charge is an intrinsic action without a live hitbox.
    const charging = { progress: s.p1.getChargeProgress(), grounded: s.p1.isGrounded(), active: s.p1.getActiveAttack()?.hitboxBody ? s.p1.getActiveAttack().move.id : null };
    step(); frames(3);
    const released = { damage: s.p1.getActiveAttack()?.hitboxBody?.plugin.damage, elapsed: s.p1.getActiveAttack()?.framesElapsed };
    frames(85);

    step({ moveY: 1, special: true }); frames(45);
    const item = s.getInventory(0).getHeldItem();
    const held = { type: item?.definition.type, holder: item?.getHolderPlayerIndex(), bomb: bombOf(), itemPosition: item?.getPosition() };
    // Drawn by the generic held-item renderer at the hand.
    const rendering = { genericVisual: s.itemVisuals.has(item.id), visible: s.itemVisuals.get(item.id)?.visible ?? false };
    step({ grab: true }); frames(35);
    const grounded = { state: item.getSnapshot().state, bomb: bombOf(), top };
    set(s.p1, platform.bounds.min.x + 50); set(s.p2, item.getPosition().x); frames(3);
    // Pickup is an item action (ItemLightGet, 7 frames) committed on its event frame; a throw press is
    // only read once that action has ended, so wait it out instead of pressing inside it.
    step({}, { attack: true });
    for (let i = 0; i < 4; i++) step({}, { attack: true });
    const picked = { holder: item.getHolderPlayerIndex(), inventory: s.getInventory(1).getHeldItem()?.id, id: item.id };
    for (let i = 0; i < 20 && s.p2.getItemActionState() !== null; i++) step();
    const pickupHold = s.getInventory(1).getHeldItem() === item && s.p2.getItemActionState() === null;
    step(); const throwFrom = bombOf();
    if (!throwFrom) throw new Error(JSON.stringify({ held, grounded, picked, pickupHold, platform: platform.bounds, owner: s.p1.getPosition(), ownerStocks: s.stockTracker.getStocks?.(0), entity: item.getSnapshot(), participants: s.playerSlots.map(p => ({ index: p.playerIndex, binding: p.bindingsSlot, charPosition: p.character.getPosition(), active: p.character.getActiveAttack()?.move.id, traps: p.character.getRemoteBombs() })) }));
    step({}, { moveX: 1, attack: true });
    // Stick toward +x while facing -x is a back throw: it releases on its item-action event frame
    // (the hand first carries the bomb behind), then the bomb flies toward +x.
    for (let i = 0; i < 20 && s.getInventory(1).isHolding(); i++) step();
    const releasedAt = bombOf().x; frames(8);
    const thrown = { held: s.getInventory(1).isHolding(), x: bombOf().x, from: releasedAt, heldFrom: throwFrom.x, count: s.thrownItems.length };
    for (let i = 0; i < 4; i++) step({}, { attack: true });
    const noAttackLeak = s.p2.getActiveAttack() === null;
    frames(36);
    // Put the other fighter in the blast, while the original owner stays distant.
    set(s.p2, bombOf().x); frames(4);
    const damageBefore = s.p2.getDamagePercent();
    step({ moveY: 1, special: true }); frames(11);
    const detonated = { bombAfter: bombOf(), damage: s.p2.getDamagePercent() - damageBefore, despawned: item.isDespawned(), ownerHitlag: s.p1.getHitlagRemaining() };
    frames(20);
    return { transform: s.baseStage.transform, charging, released, held, rendering, grounded, picked, pickupHold, thrown, noAttackLeak, detonated,
      finalBombCount: s.linkArticles.snapshot().bombs.length, finalItemCount: s.itemRegistry.getActive().length };
  });
  const r = report.result;
  assert.notEqual(r.transform.viewportScale, 1);
  assert.deepEqual(r.charging, { progress: 0.5, grounded: true, active: null });
  // Release-local frame 4 (age 3) is the first clean Spin frame after a charge, damage 14 × (1 + 0.6 × 30/60)
  // (SmashWiki Link (SSBU)/Up special: charged hitboxes 4-5, multiplier 1 + 0.6 × charge/60; UFD "Startup is 4
  // from charge state").
  assert.equal(r.released.elapsed, 3); assert.ok(Math.abs(r.released.damage - 18.2) < 1e-6);
  assert.equal(r.held.type, 'link-remote-bomb'); assert.equal(r.held.holder, 0); assert.equal(r.held.bomb.held, true);
  assert.deepEqual(r.rendering, { genericVisual: true, visible: true });
  assert.equal(r.grounded.state, 'grounded'); assert.equal(r.grounded.bomb.held, false);
  assert.equal(r.picked.holder, 1); assert.equal(r.picked.inventory, r.picked.id); assert.equal(r.pickupHold, true);
  assert.equal(r.thrown.held, false); assert.ok(r.thrown.x > r.thrown.from);
  // In flight it is an ordinary thrown item (SmashWiki Link (SSBU): Remote Bomb 1% (throw)).
  assert.equal(r.thrown.count, 1); assert.equal(r.noAttackLeak, true);
  assert.equal(r.detonated.bombAfter, null); assert.equal(r.detonated.despawned, true); assert.ok(r.detonated.damage > 0);
  assert.equal(r.detonated.ownerHitlag, 0);
  assert.equal(r.finalBombCount, 0); assert.equal(r.finalItemCount, 0);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/link-bomb-charge-probe.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
