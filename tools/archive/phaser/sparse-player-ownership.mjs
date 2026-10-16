import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_SPARSE_OUTPUT ?? 'docs/review/2026-09-23/profile-ownership/sparse-production';
const url = process.env.PF_SPARSE_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const expectedArtifact = process.env.PF_SPARSE_EXPECT_ARTIFACT;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { url, expectedArtifact, setup: 'Only the password gate is bypassed. Sparse roster, picks, palettes, Controls/stage-back, restart/rematch and movement use DOM keyboard/mouse and browser Gamepad API input. A read-only physics observer samples held input and releases the keyboard through a DOM keyup or neutralizes the browser pad after 24px travel (18 active physics steps maximum), avoiding wall-clock holds under load. Results setup teleports opponents beyond the blast zone, then ordinary KO/stock/results handling completes the match. No fighter input override or slot/config injection.', cases: [], errors: [] };
async function frames(page, n = 4) {
  const start = await page.evaluate(() => window.__game.loop.frame);
  await page.waitForFunction(({ start, n }) => window.__game.loop.frame >= start + n, { start, n });
}
async function scene(page, name) {
  await page.waitForFunction(name => window.__game?.scene.isActive(name), name, { timeout: 60000 });
  await frames(page);
}
async function key(page, name) { await page.keyboard.press(name); await frames(page); }
async function inputPad(page, axes = [0, 0], button = null) {
  await page.evaluate(({ axes, button }) => {
    window.__pad.axes = [...axes, 0, 0];
    window.__pad.buttons.forEach((value, index) => { value.pressed = index === button; value.value = index === button ? 1 : 0; });
    window.__pad.timestamp = performance.now();
  }, { axes, button });
}
async function pulse(page, button = 0) { await inputPad(page, [0, 0], button); await frames(page); await inputPad(page); await frames(page); }
async function bounds(page, kind, slot) {
  return page.evaluate(({ kind, slot }) => {
    const game = window.__game, s = game.scene.getScene('CharacterSelectScene');
    const b = kind === 'link' || kind === 'pikachu' ? s.portraitTiles.find(tile => new RegExp(`\\b${kind}\\b`, 'i').test(tile.nameLabel.text)).bounds
      : kind === 'palette' ? s.cards[slot - 1].swatchBounds[slot === 2 ? 1 : 2]
      : kind === 'cpu' ? s.cards[slot - 1].cpuButtonBounds : s.cards[slot - 1].leaveButtonBounds;
    const canvas = game.canvas.getBoundingClientRect();
    return { x: b.centerX, y: b.centerY,
      clientX: canvas.left + b.centerX * canvas.width / game.scale.gameSize.width,
      clientY: canvas.top + b.centerY * canvas.height / game.scale.gameSize.height };
  }, { kind, slot });
}
async function click(page, kind, slot) { const b = await bounds(page, kind, slot); await page.mouse.click(b.clientX, b.clientY); await frames(page); }
async function movePadToLink(page) {
  const target = await bounds(page, 'link');
  for (let i = 0; i < 180; i++) {
    const position = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[2].cursor);
    const dx = target.x - position.x, dy = target.y - position.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) break;
    await inputPad(page, [Math.abs(dx) < 10 ? 0 : Math.sign(dx), Math.abs(dy) < 10 ? 0 : Math.sign(dy)]);
    await frames(page, 1);
    if (i === 179) throw new Error('Controller cursor did not reach Link');
  }
  await inputPad(page); await frames(page); await pulse(page);
}
async function freshPage(page, padIndex = 0) {
  page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
  await page.addInitScript(padIndex => {
    window.__pad = { id: 'Sparse regression pad', index: padIndex, connected: true, mapping: 'standard', timestamp: 1,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    const pads = Array.from({ length: padIndex + 1 }, (_, index) => index === padIndex ? window.__pad : null);
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    window.__sparseSnapshot = () => {
      const s = window.__game.scene.getScene('MatchScene');
      return s.playerSlots.map((slot, i) => ({ runtime: i, lobby: s.matchParticipants[i].slot.index,
        id: slot.character.id, palette: slot.paletteSwap, tint: slot.sprite?.tintTopLeft,
        texture: slot.sprite?.texture.key, frame: slot.sprite?.frame.name,
        pipeline: slot.sprite?.pipeline?.name, pipelineData: slot.sprite?.pipelineData,
        tints: slot.sprite ? [slot.sprite.tintTopLeft, slot.sprite.tintTopRight, slot.sprite.tintBottomLeft, slot.sprite.tintBottomRight] : [],
        device: s.matchParticipants[i].slot.inputDevice,
        profile: s.matchParticipants[i].slot.bindingProfileIndex,
        input: s.inputResolver.getMoveVector(slot.bindingsSlot),
        position: slot.character.getPosition(), velocity: slot.character.getVelocity() }));
    };
  }, padIndex);
  await page.goto(url);
  await scene(page, 'PasswordGateScene');
  const artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/index-[^/]+\.js/.test(src))?.split('/').pop());
  report.artifact ??= artifact;
  assert.equal(artifact, report.artifact);
  if (expectedArtifact) assert.equal(artifact, expectedArtifact);
  await page.evaluate(() => { const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key); game.scene.start('MainMenuScene'); });
  await scene(page, 'MainMenuScene'); await key(page, 'Enter'); await scene(page, 'ModeSelectScene');
  await key(page, 'ArrowDown');
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.__game.scene.getScene('ModeSelectScene').getState().stockIndex === 0)) break;
    await key(page, 'ArrowLeft');
  }
  await key(page, 'ArrowDown'); await key(page, 'ArrowLeft'); await key(page, 'ArrowLeft');
  await key(page, 'Enter'); await scene(page, 'CharacterSelectScene');
  await click(page, 'cpu', 1);
  await key(page, '2'); await key(page, 'Space'); await click(page, 'link');
  await pulse(page); // P1 CPU and P2 keyboard make the first vacant slot P3.
  await movePadToLink(page);
  await key(page, '3'); // Exercise mouse edits while the controller-owned hand has focus.
  await click(page, 'palette', 2); await click(page, 'palette', 3);
  return page;
}
async function snapshot(page) {
  return page.evaluate(() => window.__sparseSnapshot());
}
async function boundedMovement(page, lobby, direction, keyboard) {
  await page.evaluate(({ lobby, direction, keyboard }) => {
    const s = window.__game.scene.getScene('MatchScene');
    const index = s.matchParticipants.findIndex(participant => participant.slot.index === lobby);
    const slot = s.playerSlots[index], initialX = slot.character.getPosition().x;
    window.__sparseMovement = null;
    let physicsSteps = 0;
    const observe = () => {
      if (s.inputResolver.getMoveVector(slot.bindingsSlot).x !== direction) return;
      physicsSteps++;
      const displacement = direction * (slot.character.getPosition().x - initialX);
      if (displacement < 24 && physicsSteps < 18) return;
      const sample = window.__sparseSnapshot();
      s.matter.world.off('afterupdate', observe);
      if (keyboard) window.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true,
      }));
      else { window.__pad.axes = [0, 0, 0, 0]; window.__pad.timestamp = performance.now(); }
      window.__sparseMovement = { initialX, physicsSteps, displacement, sample };
    };
    s.matter.world.on('afterupdate', observe);
  }, { lobby, direction, keyboard });
  if (keyboard) await page.keyboard.down('ArrowLeft');
  else await inputPad(page, [direction, 0]);
  try {
    await page.waitForFunction(() => window.__sparseMovement !== null);
    const result = await page.evaluate(() => window.__sparseMovement);
    assert.ok(result.displacement > 5 && result.displacement < 80, 'Bounded real input must move the fighter without walking off the stage');
    assert.ok(result.physicsSteps > 0 && result.physicsSteps <= 18);
    return result;
  } finally {
    // Release the automation driver's own key state too; the DOM release above
    // already stopped the actual game input without waiting for another RPC.
    if (keyboard) await page.keyboard.up('ArrowLeft'); else await inputPad(page);
  }
}
async function run(name, action, padIndex = 0) {
  const item = { name }; report.cases.push(item); let page;
  try { page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); await freshPage(page, padIndex); await action(page, item); item.pass = true; console.log(`PASS ${name}`); }
  catch (error) { item.pass = false; item.error = error.stack; console.log(`FAIL ${name}: ${error.message}`); if (page) await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {}); }
  finally { await page?.close(); await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
}
async function resultsRematch(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => window.__game.scene.isActive('ResultsScene'))) break;
    await page.evaluate(() => {
      const game = window.__game;
      if (!game.scene.isActive('MatchScene')) return;
      const s = game.scene.getScene('MatchScene');
      for (const participant of s.matchParticipants) {
        if (participant.slot.index === 2) continue;
        const index = participant.runtimePlayerIndex;
        if (!s.stockTracker.isRespawning(index) && !s.stockTracker.isEliminated(index)) {
          s.matter.body.setPosition(s.playerSlots[index].character.body, { x: 100000, y: 100000 });
        }
      }
    });
    await frames(page, 3);
  }
  await scene(page, 'ResultsScene'); await key(page, 'Enter'); await scene(page, 'MatchScene');
}
function assertRendering(item, sample, padIndex) {
  assert.equal(sample.find(fighter => fighter.lobby === 2).tint, 0x2b7ad9, 'P2 Link keeps its blue palette');
  assert.equal(sample.find(fighter => fighter.lobby === 3).tint, 0xc23a3a, 'P3 Link keeps its red palette');
  assert.deepEqual(sample.find(fighter => fighter.lobby === 2).device, { kind: 'keyboard', layout: 'keyboard_p2' });
  assert.equal(sample.find(fighter => fighter.lobby === 3).device.gamepadIndex, padIndex);
  for (const preview of item.preview) {
    const fighter = sample.find(value => value.lobby === preview.lobby);
    // Movement and landing switch idle/run/jump/crouch atlases. Preserve the raw
    // texture/frame in evidence while checking the character/skin family.
    const atlasFamily = texture => texture.replace(/^char\.link\.(idle|run|jump|hurt|crouch)(?=\.|$)/, 'char.link');
    assert.equal(atlasFamily(fighter.texture), atlasFamily(preview.texture), 'Animation changes retain the selected character/skin atlas family');
    assert.deepEqual({ pipeline: fighter.pipeline, pipelineData: fighter.pipelineData, tints: fighter.tints },
      { pipeline: preview.pipeline, pipelineData: preview.pipelineData, tints: preview.tints }, 'Selected preview and corresponding sparse fighter use the same skin rendering');
  }
}
try {
  for (const padIndex of [0, 1]) for (const cpu of [false, true]) await run(`P1-${cpu ? 'cpu' : 'empty'}-P2-keyboard-P3-pad${padIndex}`, async (page, item) => {
    if (!cpu) await click(page, 'leave', 1);
    item.roster = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterSelectScene'); return { slots: s.state.slots, pads: [...s.padAssignments] }; });
    item.preview = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').cards.slice(1, 3).map(card => ({
      lobby: card.slotIndex, texture: card.bodySprite.texture.key, pipeline: card.bodySprite.pipeline?.name,
      pipelineData: card.bodySprite.pipelineData,
      tints: [card.bodySprite.tintTopLeft, card.bodySprite.tintTopRight, card.bodySprite.tintBottomLeft, card.bodySprite.tintBottomRight],
    })));
    await page.screenshot({ path: `${output}/${item.name}-selection.png` });
    assert.deepEqual(item.roster.slots.slice(1, 3).map(slot => [slot.mode, slot.inputType, slot.pickedCharacterId, slot.paletteIndex]),
      [['human', 'keyboard_p2', 'link', 1], ['human', 'gamepad', 'link', 2]]);
    await key(page, 'r'); await scene(page, 'RebindingScene'); await key(page, 'Escape'); await scene(page, 'CharacterSelectScene');
    await key(page, 'Enter'); await scene(page, 'StageSelectScene'); await key(page, 'Escape'); await scene(page, 'CharacterSelectScene');
    item.returnedRoster = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterSelectScene'); return { slots: s.state.slots, pads: [...s.padAssignments] }; });
    assert.deepEqual(item.returnedRoster.slots.slice(1, 3).map(slot => [slot.mode, slot.inputType, slot.pickedCharacterId, slot.paletteIndex]),
      [['human', 'keyboard_p2', 'link', 1], ['human', 'gamepad', 'link', 2]]);
    assert.deepEqual(item.returnedRoster.pads, item.roster.pads, 'Controls profile visit and stage Back preserve physical ownership');
    await key(page, 'Enter'); await scene(page, 'StageSelectScene'); await key(page, 'Enter'); await scene(page, 'MatchScene'); await frames(page, 8);
    item.initial = await snapshot(page);
    item.keyboardMotion = await boundedMovement(page, 2, -1, true); item.keyboard = item.keyboardMotion.sample; await frames(page, 4);
    item.beforeGamepad = await snapshot(page);
    item.gamepadMotion = await boundedMovement(page, 3, 1, false); item.gamepad = item.gamepadMotion.sample; await frames(page);
    for (const sample of [item.initial, item.keyboard, item.gamepad]) assertRendering(item, sample, padIndex);
    assert.deepEqual(item.keyboard.filter(f => f.lobby >= 2).map(f => [f.lobby, f.input.x]), [[2, -1], [3, 0]]);
    assert.deepEqual(item.gamepad.filter(f => f.lobby >= 2).map(f => [f.lobby, f.input.x]), [[2, 0], [3, 1]]);
    assert.ok(item.keyboard.find(f => f.lobby === 2).position.x < item.initial.find(f => f.lobby === 2).position.x - 5, 'Real keyboard input moves P2');
    assert.ok(item.gamepad.find(f => f.lobby === 3).position.x > item.beforeGamepad.find(f => f.lobby === 3).position.x + 5, 'Real controller input moves P3');
    item.beforePause = await page.evaluate(() => {
      const game = window.__game, s = game.scene.getScene('MatchScene');
      return { active: game.scene.isActive('MatchScene'), humans: s.matchParticipants
        .filter(participant => participant.slot.index >= 2).map(participant => ({
          lobby: participant.slot.index,
          eliminated: s.stockTracker.isEliminated(participant.runtimePlayerIndex),
          respawning: s.stockTracker.isRespawning(participant.runtimePlayerIndex),
        })) };
    });
    assert.equal(item.beforePause.active, true);
    assert.deepEqual(item.beforePause.humans, [2, 3].map(lobby => ({ lobby, eliminated: false, respawning: false })));
    await page.screenshot({ path: `${output}/${item.name}.png` });
    await key(page, 'Escape'); await scene(page, 'PauseMenuScene'); await key(page, 'r'); await scene(page, 'MatchScene');
    item.restarted = await snapshot(page); assertRendering(item, item.restarted, padIndex);
    await page.screenshot({ path: `${output}/${item.name}-restart.png` });
    await resultsRematch(page); item.rematched = await snapshot(page); assertRendering(item, item.rematched, padIndex);
    await page.screenshot({ path: `${output}/${item.name}-rematch.png` });
  }, padIndex);
  await run('mouse-does-not-move-controller-hand', async (page, item) => {
    await key(page, '3'); // Explicit mouse focus on an occupied controller slot.
    item.before = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[2]);
    await click(page, 'palette', 2);
    item.after = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots[2]);
    assert.deepEqual(item.after.cursor, item.before.cursor, 'Clicking a card control cannot reposition the controller-owned hand');
    assert.equal(item.after.pickedCharacterId, item.before.pickedCharacterId);
  });
  await run('nondefault-Pikachu-preview-to-idle-match', async (page, item) => {
    await click(page, 'leave', 1);
    await key(page, '2'); await click(page, 'pikachu'); await click(page, 'palette', 2);
    item.preview = await page.evaluate(() => {
      const s = window.__game.scene.getScene('CharacterSelectScene'), sprite = s.cards[1].bodySprite;
      return { lobby: 2, selection: s.state.slots[1], texture: sprite.texture.key,
        pipeline: sprite.pipeline?.name, pipelineData: sprite.pipelineData,
        tints: [sprite.tintTopLeft, sprite.tintTopRight, sprite.tintBottomLeft, sprite.tintBottomRight] };
    });
    assert.equal(item.preview.selection.pickedCharacterId, 'pikachu');
    assert.equal(item.preview.selection.paletteIndex, 1);
    await page.screenshot({ path: `${output}/${item.name}-selection.png` });
    await key(page, 'Enter'); await scene(page, 'StageSelectScene'); await key(page, 'Enter'); await scene(page, 'MatchScene');
    await page.waitForFunction(texture => {
      const s = window.__game.scene.getScene('MatchScene');
      const index = s.matchParticipants.findIndex(participant => participant.slot.index === 2);
      return s.playerSlots[index].sprite.texture.key === texture && s.playerSlots[index].character.isGrounded();
    }, item.preview.texture);
    item.match = (await snapshot(page)).find(value => value.lobby === 2);
    assert.equal(item.match.id, 'pikachu');
    assert.equal(item.match.palette.paletteIndex, 1);
    assert.equal(item.match.texture, item.preview.texture, 'Pikachu preview and neutral match use exactly the same texture');
    assert.deepEqual(item.match.tints, item.preview.tints);
    assert.equal(item.match.pipeline, item.preview.pipeline);
    assert.deepEqual(item.match.pipelineData, item.preview.pipelineData);
    await page.screenshot({ path: `${output}/${item.name}.png` });
  });
} finally {
  report.passed = report.cases.filter(item => item.pass).length; report.failed = report.cases.filter(item => !item.pass).length;
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); await browser.close();
}
if (report.failed || report.errors.length) process.exitCode = 1;
