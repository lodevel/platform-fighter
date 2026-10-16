import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_REWORK_OUTPUT ?? 'docs/review/2026-09-14/physics';
const observeOnly = process.env.PF_OBSERVE_ONLY === '1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], observeOnly, notes: ['Automated browser simulation and presentation checks; not a human tactile or physical-controller playtest.'] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean));
  report.physics = await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1440, 1000);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 914,
      itemFrequency: 'off', players: [
        { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
      ] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    let input = {};
    s.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: player === 1 ? input.moveY ?? 0 : 0 });
    s.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const fighter = s.p1, floor = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
    const start = { x: floor.position.x, y: floor.bounds.min.y - fighter.getTuning().height / 2 };
    const read = () => ({ frame: s.physicsEngine.getFrame(), position: fighter.getPosition(), velocity: fighter.getVelocity(),
      grounded: fighter.isGrounded(), facing: fighter.getFacing(), jumps: fighter.getJumpsUsed(),
      lag: fighter.getAnimationActionState().landingRecoveryRemaining, squat: fighter.getJumpsquatRemaining(),
      shield: fighter.getShieldState().name, onLedge: fighter.isHangingOnLedge(),
      move: fighter.getActiveAttack()?.move.id ?? null, moveFrame: fighter.getActiveAttack()?.framesElapsed ?? null,
      pose: s.playerSlots[0].spriteAnimSm.current(), spriteFlip: s.playerSlots[0].sprite.flipX });
    const step = (next = {}) => {
      input = next; const before = s.physicsEngine.getFrame();
      s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
      if (s.physicsEngine.getFrame() !== before + 1) throw new Error('Input step did not advance exactly one simulation frame');
      return read();
    };
    const settle = () => {
      fighter.resetForRound(start.x, start.y); fighter.setFacing(1);
      s.p2.resetForRound(floor.bounds.max.x - 50, start.y);
      const settling = [read()];
      for (let i = 0; i < 20; i++) settling.push(step());
      if (!fighter.isGrounded()) throw new Error(JSON.stringify({ message: 'Fixture must begin on the actual floor', start, settling, floor: floor.bounds,
        bodyBounds: fighter.body.bounds, bodyImpulse: fighter.body.positionImpulse }));
    };
    const jumpToApex = () => {
      for (let frame = 1; frame < 90; frame++) {
        step({ jump: true });
        if (!fighter.isGrounded() && fighter.getVelocity().y >= 0) return;
      }
      throw new Error('Jump never reached its apex');
    };
    for (let i = 0; i < 100; i++) step();
    settle(); jumpToApex(); step();
    const airJumpOrigin = fighter.getPosition().y, airJumpTrace = [step({ jump: true })];
    for (let i = 0; i < 80 && fighter.getVelocity().y < 0; i++) airJumpTrace.push(step());
    const airJump = { height: airJumpOrigin - Math.min(...airJumpTrace.map(sample => sample.position.y)), trace: airJumpTrace };

    settle(); jumpToApex();
    const drift = [];
    for (let i = 0; i < 4; i++) drift.push(step({ moveX: -1 }));
    drift.push(step({ moveX: -1, attack: true }));

    // Natural full-hop descent supplies hard landing speed without setting an
    // internal landing flag. Keep neutral until physical floor contact.
    settle(); jumpToApex();
    let hardContact;
    for (let i = 0; i < 90; i++) { const sample = step(); if (sample.grounded) { hardContact = sample; break; } }
    if (!hardContact) throw new Error('Full hop never landed');
    const hardLanding = { contact: hardContact, recovery: [] };
    for (let i = 0; i < 9; i++) hardLanding.recovery.push(step({ jump: i >= 3 }));

    // A tiny free drop tests soft contact at a genuine low descent speed.
    settle(); fighter.setPosition(start.x, start.y - 1); s.matter.body.setVelocity(fighter.body, { x: 0, y: 0 });
    let softContact;
    const softApproach = [];
    for (let i = 0; i < 20; i++) {
      const sample = step(); softApproach.push(sample);
      if (sample.grounded) { softContact = sample; break; }
    }
    const softLanding = { approach: softApproach, contact: softContact, recovery: [] };
    for (let i = 0; i < 5; i++) softLanding.recovery.push(step());

    const hardActions = [];
    for (const action of ['attack', 'shield']) {
      settle(); jumpToApex();
      for (let i = 0; i < 90; i++) { if (step().grounded) break; }
      const recovery = [];
      for (let i = 0; i < 8; i++) recovery.push(step({ [action]: i >= 4 }));
      hardActions.push({ action, recovery });
    }

    // A round reset below a float is a discontinuity, not a swept landing from
    // the old position. This reproduced a 166px upward snap and endless hover.
    settle();
    const float = s.baseStage.bodies.platformBodies.find(body => body.label === 'platform.passThrough');
    const resetX = float.bounds.max.x - 20;
    fighter.resetForRound(resetX, float.bounds.min.y - fighter.getTuning().height / 2 - 40);
    step();
    const resetOrigin = { x: resetX, y: start.y };
    fighter.resetForRound(resetOrigin.x, resetOrigin.y);
    const resetUnderPlatform = { origin: resetOrigin, trajectory: [] };
    for (let i = 0; i < 20; i++) resetUnderPlatform.trajectory.push(step());

    // A normal falling crossing must still settle on the float after the
    // reset-history fix. This also checks contact recovery's visible pose.
    fighter.resetForRound(float.position.x, float.bounds.min.y - fighter.getTuning().height / 2 - 90);
    const platformLanding = [];
    for (let i = 0; i < 70; i++) platformLanding.push(step());

    settle();
    fighter.resetForRound(floor.bounds.max.x - fighter.getTuning().width / 2 - 2, start.y);
    for (let i = 0; i < 10; i++) step();
    const ledgeWalk = [];
    for (let i = 0; i < 35; i++) {
      const sample = step({ moveX: 1 }); ledgeWalk.push(sample);
      if (!sample.grounded) break;
    }
    // Holding down intentionally declines the automatic ledge catch so this
    // scenario isolates the air-jump budget after walking off the floor.
    ledgeWalk.push(step({ moveX: 1, moveY: 1 }));
    ledgeWalk.push(step({ moveX: 1, moveY: 1, jump: true }));
    ledgeWalk.push(step({ moveX: 1 }));
    ledgeWalk.push(step({ moveX: 1, jump: true }));

    settle(); jumpToApex();
    for (let i = 0; i < 90; i++) { if (step().grounded) break; }
    step(); // Show the simulation-owned landing pose after contact arbitration.
    return { tuning: fighter.getTuning(), airJump, drift, hardLanding, softLanding, hardActions,
      resetUnderPlatform, platformLanding, ledgeWalk, last: read() };
  });
  if (!observeOnly) {
    const p = report.physics;
    assert.ok(Math.abs(p.airJump.height - 145) < 0.1, `Air jump should reach 145px: ${p.airJump.height}`);
    assert.equal(p.airJump.trace[0].jumps, 2);
    assert.ok(p.airJump.trace[0].velocity.y < 0, 'Air jump starts immediately');
    assert.ok(p.drift.slice(0, 4).every(sample => sample.velocity.x < 0 && sample.facing === 1), 'Backwards drift preserves facing');
    assert.equal(p.drift.at(-1).move, 'link.bair');
    assert.equal(p.hardLanding.recovery[0].lag, 5);
    assert.equal(p.hardLanding.recovery[0].pose.state, 'landing');
    assert.deepEqual(p.hardLanding.recovery.slice(0, 5).map(sample => sample.lag), [5, 4, 3, 2, 1]);
    assert.ok(p.hardLanding.recovery.slice(0, 5).every(sample => sample.squat === 0 && sample.grounded));
    assert.equal(p.hardLanding.recovery[5].squat, 3, 'Buffered jump starts on first actionable step');
    assert.equal(p.softLanding.recovery[0].lag, 2);
    assert.deepEqual(p.softLanding.recovery.slice(0, 3).map(sample => sample.lag), [2, 1, 0]);
    for (const entry of p.hardActions) {
      assert.ok(entry.recovery.slice(0, 5).every(sample => sample.move === null && sample.shield !== 'active'), `${entry.action} cannot cancel landing`);
      if (entry.action === 'attack') assert.equal(entry.recovery[5].move, 'link.jab');
      else assert.equal(entry.recovery[5].shield, 'active');
    }
    assert.ok(p.resetUnderPlatform.trajectory.every(sample => Math.abs(sample.position.y - p.resetUnderPlatform.origin.y) < 2), 'Reset cannot snap upward through a pass-through float');
    assert.ok(p.resetUnderPlatform.trajectory.at(-1).grounded, 'Reset settles on the intended solid floor');
    assert.ok(p.platformLanding.slice(-10).every(sample => sample.grounded), 'Natural float landing remains stable');
    const offEdge = p.ledgeWalk.at(-4), firstJump = p.ledgeWalk.at(-3), secondPress = p.ledgeWalk.at(-1);
    assert.equal(offEdge.grounded, false); assert.equal(offEdge.jumps, 1);
    assert.equal(firstJump.jumps, 2); assert.ok(firstJump.velocity.y < 0);
    assert.equal(secondPress.jumps, 2); assert.ok(secondPress.velocity.y > firstJump.velocity.y, 'A second press after walking off cannot supply a third jump');
  }
  await page.screenshot({ path: `${output}/ordinary-landing.png` });
  await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scale.setGameSize(1920, 1080);
    game.scene.start('MainMenuScene');
  });
  await page.waitForFunction(() => window.__game.scene.isActive('MainMenuScene'));
  await page.screenshot({ path: `${output}/main-menu.png` });
  await page.keyboard.press('o');
  await page.waitForFunction(() => window.__game.scene.isActive('RebindingScene'));
  report.controls = await page.evaluate(() => window.__game.scene.getScene('RebindingScene').children.list
    .filter(child => child.visible && typeof child.text === 'string').map(child => ({ text: child.text, bounds: child.getBounds() })));
  await page.screenshot({ path: `${output}/controls.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('MainMenuScene'));
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__game.scene.isActive('CharacterEditorScene'));
  report.lab = await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').children.list
    .filter(child => child.visible && typeof child.text === 'string').map(child => ({ text: child.text, bounds: child.getBounds() })));
  await page.screenshot({ path: `${output}/character-lab.png` });
  for (let index = 0; index < 4; index++) {
    if (await page.evaluate(() => window.__game.scene.getScene('CharacterEditorScene').getPageFields().some(field => field.path[0] === 'hardLandingSpeedFrames'))) break;
    await page.keyboard.press('PageDown');
  }
  report.movementFields = await page.evaluate(() => {
    const s = window.__game.scene.getScene('CharacterEditorScene');
    return s.getPageFields().map((field, index) => {
      const labelBounds = s.fieldLabels[index].getBounds(), valueBounds = s.fieldValues[index].getBounds();
      return { field, label: s.fieldLabels[index].text,
        labelBounds: { left: labelBounds.left, right: labelBounds.right, y: labelBounds.y, height: labelBounds.height },
        valueBounds: { left: valueBounds.left, right: valueBounds.right, y: valueBounds.y, height: valueBounds.height } };
    });
  });
  if (!observeOnly) assert.ok(report.movementFields.some(row => row.field.path[0] === 'hardLandingSpeedFrames'), 'New landing controls are reachable in the Lab');
  for (const row of report.movementFields) assert.ok(row.labelBounds.right <= row.valueBounds.left, `${row.label} overlaps its value`);
  report.labPageHint = await page.evaluate(() => {
    const text = window.__game.scene.getScene('CharacterEditorScene').pageText, bounds = text.getBounds();
    return { text: text.text, left: bounds.left, right: bounds.right };
  });
  if (!observeOnly) assert.ok(report.labPageHint.text.includes('PGUP/PGDN PAGE'), 'Lab advertises how to reach later movement pages');
  assert.ok(report.labPageHint.left >= 945 && report.labPageHint.right <= 1845, 'Lab page hint fits its panel');
  await page.screenshot({ path: `${output}/landing-movement-fields.png` });
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ artifact: report.artifact, airJumpHeight: report.physics.airJump.height,
    drift: report.physics.drift.map(({ facing, move, velocity }) => ({ facing, move, velocity })),
    hardLanding: report.physics.hardLanding.recovery.map(({ lag, squat, pose }) => ({ lag, squat, pose: pose.state })),
    softLanding: report.physics.softLanding.recovery.map(({ lag, pose }) => ({ lag, pose: pose.state })), errors: report.errors }, null, 2));
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/physics-sep14.json`, `${JSON.stringify(report, null, 2)}\n`); await browser.close(); }
