import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_CONTROLLER_OUTPUT ?? 'docs/review/2026-09-23/controller-session-regressions/production';
const expectedArtifact = process.env.PF_CONTROLLER_EXPECT_ARTIFACT;
const url = process.env.PF_CONTROLLER_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { url, expectedArtifact, setup: 'Only the password gate is bypassed. Menus, captures, device selection, restart and rematch use real keyboard/mouse/gamepad input. The Results setup moves P2 beyond the blast zone; normal KO/stock/results handling completes the match.', cases: [], errors: [] };

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.__probePads = [0, 1].map(index => ({ id: `Regression Controller ${index + 1}`, index, connected: true, mapping: 'standard', timestamp: 1,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__probePads });
    window.__spriteIds = new WeakMap(); window.__nextSpriteId = 1;
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  const artifact = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/index-[^/]+\.js/.test(src))?.split('/').pop());
  report.artifact ??= artifact;
  assert.equal(artifact, report.artifact);
  if (expectedArtifact) assert.equal(artifact, expectedArtifact);
  await page.evaluate(() => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MainMenuScene');
  });
  await scene(page, 'MainMenuScene');
  await key(page, 'Enter'); await scene(page, 'ModeSelectScene');
  // Stock count one, items off: menu input rather than changing match configuration.
  await key(page, 'ArrowDown');
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.__game.scene.getScene('ModeSelectScene').getState().stockIndex === 0)) break;
    await key(page, 'ArrowLeft');
  }
  await key(page, 'ArrowDown'); await key(page, 'ArrowLeft'); await key(page, 'ArrowLeft');
  await key(page, 'Enter'); await scene(page, 'CharacterSelectScene');
  return page;
}
async function frames(page, count = 6) {
  const frame = await page.evaluate(() => window.__game.loop.frame);
  await page.waitForFunction(({ frame, count }) => window.__game.loop.frame >= frame + count, { frame, count }, { timeout: 10000 });
}
async function scene(page, name) { await page.waitForFunction(name => window.__game?.scene.isActive(name), name, { timeout: 20000 }); await frames(page, 3); }
async function key(page, value) { await page.keyboard.press(value); await frames(page, 3); }
async function pad(page, index, { button, value = 0, axis, amount = 0 } = {}) {
  await page.evaluate(({ index, button, value, axis, amount }) => {
    const p = window.__probePads[index]; p.timestamp = performance.now();
    if (button !== undefined) p.buttons[button] = { pressed: value > 0.5, touched: value > 0, value };
    if (axis !== undefined) p.axes[axis] = amount;
  }, { index, button, value, axis, amount });
  await frames(page, 6);
}
async function pulse(page, index, button) { await pad(page, index, { button, value: 1 }); await pad(page, index, { button }); }
async function click(page, target) {
  const point = await page.evaluate(target => {
    const game = window.__game;
    let bounds;
    if (target.kind === 'portrait') {
      const s = game.scene.getScene('CharacterSelectScene');
      const tile = s.portraitTiles.find(tile => /\blink\b/i.test(tile.nameLabel.text));
      if (!tile) throw new Error(`Link portrait absent: ${s.portraitTiles.map(tile => tile.nameLabel.text).join(', ')}`);
      bounds = tile.bounds;
    } else if (target.kind === 'palette') {
      bounds = game.scene.getScene('CharacterSelectScene').cards[target.slot - 1].swatchBounds[target.palette];
    } else {
      const s = game.scene.getScene('RebindingScene'), panel = s.screen.panels.find(p => p.slot === target.slot);
      bounds = target.kind === 'device' ? panel.deviceText.getBounds()
        : panel.bindingTexts[panel.actionsByRow.indexOf(target.action)].getBounds();
    }
    const canvas = game.canvas.getBoundingClientRect();
    return { x: canvas.left + bounds.centerX * canvas.width / game.scale.gameSize.width,
      y: canvas.top + bounds.centerY * canvas.height / game.scale.gameSize.height };
  }, target);
  await page.mouse.click(point.x, point.y); await frames(page, 3);
}
async function joinLinks(page) {
  for (const slot of [1, 2]) { await key(page, String(slot)); await key(page, 'Space'); await click(page, { kind: 'portrait' }); }
  // Both selected colors are non-canonical: the raw green sprite legitimately uses clearTint.
  for (const [slot, palette] of [[1, 1], [2, 2]]) await click(page, { kind: 'palette', slot, palette });
  const state = await page.evaluate(() => window.__game.scene.getScene('CharacterSelectScene').state.slots.slice(0, 2));
  assert.deepEqual(state.map(s => s.pickedCharacterId), ['link', 'link']);
  assert.deepEqual(state.map(s => s.paletteIndex), [1, 2]);
  return state;
}
async function startMatch(page) { await key(page, 'Enter'); await scene(page, 'StageSelectScene'); await key(page, 'Enter'); await scene(page, 'MatchScene'); await frames(page, 30); }
async function renderSnapshot(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    return s.playerSlots.slice(0, 2).map((slot, i) => {
      const sprite = slot.sprite;
      if (!window.__spriteIds.has(sprite)) window.__spriteIds.set(sprite, window.__nextSpriteId++);
      return { player: i + 1, spriteId: window.__spriteIds.get(sprite), texture: sprite.texture.key, frame: sprite.frame.name,
        pipeline: sprite.pipeline?.name, pipelineData: sprite.pipelineData, visible: sprite.visible, alpha: sprite.alpha,
        tints: [sprite.tintTopLeft, sprite.tintTopRight, sprite.tintBottomLeft, sprite.tintBottomRight],
        paletteIndex: slot.paletteSwap.paletteIndex, paletteSwap: slot.paletteSwap,
        inputDevice: s.matchParticipants[i].slot.inputDevice, bindings: s.matchParticipants[i].bindings };
    });
  });
}
async function restart(page) { await key(page, 'Escape'); await scene(page, 'PauseMenuScene'); await key(page, 'r'); await scene(page, 'MatchScene'); await frames(page, 20); }
async function resultsRematch(page) {
  // Arrange an ordinary blast-zone exit. The scene's own watcher/rules create Results.
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => window.__game.scene.isActive('ResultsScene'))) break;
    await page.evaluate(() => {
      const game = window.__game;
      if (!game.scene.isActive('MatchScene')) return;
      const s = game.scene.getScene('MatchScene');
      if (!s.stockTracker.isRespawning(1) && !s.stockTracker.isEliminated(1)) s.matter.body.setPosition(s.p2.body, { x: 100000, y: 100000 });
    });
    await frames(page, 3);
  }
  await scene(page, 'ResultsScene'); await page.screenshot({ path: `${output}/results.png` });
  await key(page, 'Enter'); await scene(page, 'MatchScene'); await frames(page, 20);
}
async function captureSnapshot(page) {
  return page.evaluate(() => {
    const game = window.__game, active = game.scene.isActive('RebindingScene');
    if (!active) return { active };
    const s = game.scene.getScene('RebindingScene');
    return { active, capture: s.screen.getActiveCapture(), panel: s.screen.getPanelSnapshot(1), profile: s.screen.store.get(1) };
  });
}
async function controlsLayout(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('RebindingScene');
    const bounds = object => { const b = object.getBounds(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return { panels: s.screen.panels.map(panel => ({ slot: panel.slot, header: panel.header.text,
      device: panel.deviceText.text, headerBounds: bounds(panel.header), deviceBounds: bounds(panel.deviceText) })),
      topText: s.children.list.filter(object => typeof object.text === 'string' && object.y < 260).map(object => ({ text: object.text, bounds: bounds(object) })) };
  });
}
async function assign(page, slot, device) {
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(({ slot, device }) => window.__game.scene.getScene('RebindingScene').screen.getPanelSnapshot(slot).device === device, { slot, device })) return;
    await click(page, { kind: 'device', slot });
  }
  throw new Error(`Could not select ${device} for player ${slot}`);
}
async function inputSample(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    return [1, 2].map(player => ({ player, input: s.inputResolver.getMoveVector(player), velocity: s.playerSlots[player - 1].character.getVelocity(),
      device: s.matchParticipants[player - 1].slot.inputDevice, profile: s.matchParticipants[player - 1].slot.bindingProfileIndex }));
  });
}
async function test(name, run) {
  if (process.env.PF_CONTROLLER_CASE && process.env.PF_CONTROLLER_CASE !== name) return;
  const result = { name, checks: [] }; report.cases.push(result);
  let page;
  try { page = await freshPage(); await run(page, result); result.pass = true; console.log(`PASS ${name}`); }
  catch (error) { result.pass = false; result.failure = error.stack; console.log(`FAIL ${name}: ${error.message}`); if (page) await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {}); }
  finally { await page?.close(); await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); }
}
try {
  await test('physical-pad-join', async (page, result) => {
    await pulse(page, 1, 0); // Controller 2 joins first as Player 1.
    await pulse(page, 0, 9); // Controller 1 joins second via Start.
    result.joined = await page.evaluate(() => { const s = window.__game.scene.getScene('CharacterSelectScene'); return { slots: s.state.slots.slice(0, 2), pads: [...s.padAssignments].sort((a, b) => a[0] - b[0]) }; });
    assert.deepEqual(result.joined.slots.map(s => [s.mode, s.inputType]), [['human', 'gamepad'], ['human', 'gamepad']]);
    assert.deepEqual(result.joined.pads, [[0, 2], [1, 1]], 'Physical pad identity follows join order, independently of player number');
  });
  await test('capture-B', async (page, result) => {
    await joinLinks(page); await key(page, 'r'); await scene(page, 'RebindingScene');
    await assign(page, 1, 'gamepad_0');
    // Free B from its default Dodge binding, then capture Special=B without
    // introducing a conflict that would correctly block saving the profile.
    await click(page, { kind: 'binding', slot: 1, action: 'special' }); await key(page, 'j');
    await click(page, { kind: 'binding', slot: 1, action: 'taunt' }); await pulse(page, 0, 3);
    await click(page, { kind: 'binding', slot: 1, action: 'special' });
    result.before = await captureSnapshot(page); assert.equal(result.before.capture?.action, 'special');
    assert.ok(result.before.profile.bindings.special.some(b => b.kind === 'keyboard' && b.keyCode === 74));
    await pad(page, 0, { button: 1, value: 1 }); result.afterB = await captureSnapshot(page);
    await frames(page, 20); result.heldB = await captureSnapshot(page);
    await page.screenshot({ path: `${output}/capture-B-held.png` });
    await pad(page, 0, { button: 1 });
    assert.equal(result.afterB.active, true); assert.equal(result.afterB.capture, null);
    assert.ok(result.afterB.profile.bindings.special.some(b => b.kind === 'gamepad' && b.gamepadIndex === 0 && b.source.type === 'button' && b.source.buttonIndex === 1), 'B must become the Special binding');
    assert.ok(result.afterB.panel.rows.every(row => !row.hasConflict), 'The captured profile must be valid for persistence');
    result.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('platformfighter.bindings.v1.snapshot')));
    assert.equal(result.saved.kind, 'bindingsSnapshot');
    assert.deepEqual(result.saved.data['1'].bindings.special, result.afterB.profile.bindings.special, 'Local storage must contain the captured Special=B binding');
    assert.ok(result.saved.data['1'].bindings.taunt.some(b => b.kind === 'gamepad' && b.gamepadIndex === 0 && b.source.type === 'button' && b.source.buttonIndex === 3), 'Local storage must contain Dodge=Y so B has no conflict');
    assert.equal(result.heldB.active, true, 'The captured B must not immediately navigate Back');
    await click(page, { kind: 'binding', slot: 1, action: 'jump' }); await pulse(page, 0, 9);
    result.startCancelled = await captureSnapshot(page); assert.equal(result.startCancelled.capture, null); assert.equal(result.startCancelled.active, true);
    await click(page, { kind: 'binding', slot: 1, action: 'jump' }); await key(page, 'Escape');
    result.escapeCancelled = await captureSnapshot(page); assert.equal(result.escapeCancelled.capture, null); assert.equal(result.escapeCancelled.active, true);
    await pulse(page, 0, 1); await scene(page, 'CharacterSelectScene');
    await key(page, 'r'); await scene(page, 'RebindingScene');
    result.reopened = await captureSnapshot(page);
    assert.deepEqual(result.reopened.profile.bindings.special, result.afterB.profile.bindings.special, 'Captured B must survive leaving and reopening Controls');
    await key(page, 'Escape'); await scene(page, 'CharacterSelectScene'); await startMatch(page);
    await pad(page, 0, { button: 1, value: 1 });
    result.specialHeld = await page.evaluate(() => { const s = window.__game.scene.getScene('MatchScene'); return { p1Charge: s.p1.getChargeProgress(), p2Charge: s.p2.getChargeProgress() }; });
    await pad(page, 0, { button: 1 });
    assert.ok(result.specialHeld.p1Charge !== null && result.specialHeld.p1Charge > 0, 'The captured physical B must start Link bow charging');
    assert.equal(result.specialHeld.p2Charge, null);
  });
  await test('device-assignment', async (page, result) => {
    await joinLinks(page); await key(page, 'r'); await scene(page, 'RebindingScene');
    await assign(page, 1, 'gamepad_1'); await assign(page, 2, 'gamepad_0');
    result.selected = await page.evaluate(() => [1, 2].map(slot => window.__game.scene.getScene('RebindingScene').screen.getPanelSnapshot(slot)));
    result.layout = await controlsLayout(page);
    await page.screenshot({ path: `${output}/device-assignment-controls.png` });
    await key(page, 'Escape'); await scene(page, 'CharacterSelectScene');
    result.roster = await page.evaluate(() => ({ slots: window.__game.scene.getScene('CharacterSelectScene').state.slots.slice(0, 2), pads: [...window.__game.scene.getScene('CharacterSelectScene').padAssignments] }));
    await startMatch(page);
    for (const transition of ['initial', 'midmatch-controls', 'restart', 'rematch']) {
      if (transition === 'midmatch-controls') {
        await key(page, 'Escape'); await scene(page, 'PauseMenuScene'); await key(page, 'k'); await scene(page, 'RebindingScene');
        // Choosing the occupied pad swaps the two players, exercising live Match WAKE.
        await assign(page, 2, 'gamepad_1');
        result.midmatchSelected = await page.evaluate(() => [1, 2].map(slot => window.__game.scene.getScene('RebindingScene').screen.getPanelSnapshot(slot)));
        await page.screenshot({ path: `${output}/device-assignment-midmatch.png` });
        await key(page, 'Escape'); await scene(page, 'PauseMenuScene'); await key(page, 'Escape'); await scene(page, 'MatchScene');
      }
      if (transition === 'restart') await restart(page);
      if (transition === 'rematch') await resultsRematch(page);
      const samples = [];
      for (const physical of [0, 1]) { await pad(page, physical, { axis: 0, amount: 1 }); samples.push({ physical, players: await inputSample(page) }); await pad(page, physical, { axis: 0 }); }
      result.checks.push({ transition, samples });
    }
    for (const check of result.checks) for (const sample of check.samples) {
      const swapped = check.transition === 'initial';
      const owner = swapped ? (sample.physical === 0 ? 2 : 1) : sample.physical + 1;
      for (const player of sample.players) { assert.equal(player.input.x, player.player === owner ? 1 : 0, `${check.transition}: Controller ${sample.physical + 1} must drive only Player ${owner}`); assert.equal(player.device.kind, 'gamepad'); assert.equal(player.device.gamepadIndex, swapped ? (player.player === 1 ? 1 : 0) : player.player - 1); }
    }
  });
  await test('mirror-palettes', async (page, result) => {
    await joinLinks(page); await startMatch(page);
    result.initial = await renderSnapshot(page); await page.screenshot({ path: `${output}/palettes-initial.png` });
    await restart(page); result.restarted = await renderSnapshot(page); await page.screenshot({ path: `${output}/palettes-restarted.png` });
    await resultsRematch(page); result.rematched = await renderSnapshot(page); await page.screenshot({ path: `${output}/palettes-rematched.png` });
    for (const [stage, snapshots] of Object.entries({ initial: result.initial, restarted: result.restarted, rematched: result.rematched })) snapshots.forEach((sprite, i) => {
      assert.equal(sprite.paletteIndex, i + 1); assert.deepEqual(sprite.tints, Array(4).fill([0x2b7ad9, 0xc23a3a][i]), `${stage}: rendered Link ${i + 1} must retain its selected palette`);
      assert.equal(sprite.visible, true); assert.equal(sprite.pipeline, result.initial[i].pipeline); assert.deepEqual(sprite.pipelineData, result.initial[i].pipelineData);
      assert.equal(sprite.texture, result.initial[i].texture);
      if (stage !== 'initial') assert.notEqual(sprite.spriteId, result.initial[i].spriteId, 'The transition must create a new sprite');
    });
    result.rematched.forEach((sprite, i) => assert.notEqual(sprite.spriteId, result.restarted[i].spriteId));
  });
} finally {
  report.passed = report.cases.filter(c => c.pass).length; report.failed = report.cases.filter(c => !c.pass).length;
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); await browser.close();
}
if (report.failed || report.errors.length) process.exitCode = 1;
