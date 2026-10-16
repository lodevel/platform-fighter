import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Editor rows (src/input/playerControlsRows.ts): 0 profile, 1–11 actions in
// LOGICAL_ACTIONS order (left … taunt/Dodge = 10, smash = 11), then the footer.
const ROW = { jump: 5, special: 7, dodge: 10, copy: 13, done: 14, cancel: 15 };
const output = process.env.PF_PLAYER_CONTROLS_OUTPUT ?? 'docs/review/2026-09-23/player-controls/production';
const url = process.env.PF_PLAYER_CONTROLS_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const expectedArtifact = process.env.PF_PLAYER_CONTROLS_EXPECT_ARTIFACT;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { url, expectedArtifact, checks: [], errors: [], setup: 'Only the password gate is bypassed. P1 CPU, P2 arrow keyboard, P3 browser pad index 1, and P4 browser pad index 5 join through real roster inputs. The Gamepad API retains null holes. Editor operations use mouse, DOM keyboard, or the owning pad. Runtime sessions and profiles are observed, never edited directly. Match movement uses real input, released by a read-only physics observer after bounded travel.' };
page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
await page.addInitScript(() => {
  window.__acceptancePads = new Map([1, 5].map(index => [index, { id: `Player controls pad ${index}`, index,
    connected: true, mapping: 'standard', timestamp: 1, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }]));
  Object.defineProperty(navigator, 'getGamepads', { configurable: true,
    value: () => Array.from({ length: 6 }, (_, index) => window.__acceptancePads.get(index) ?? null) });
});

async function frames(count = 3) {
  const frame = await page.evaluate(() => window.__game.loop.frame);
  await page.waitForFunction(({ frame, count }) => window.__game.loop.frame >= frame + count,
    { frame, count }, { timeout: 20000 });
}
async function scene(name) {
  await page.waitForFunction(name => window.__game?.scene.isActive(name), name, { timeout: 60000 });
  await frames();
}
async function key(value) { await page.keyboard.press(value); await frames(); }
async function pad(index, buttons = [], axes = [0, 0], count = 3) {
  await page.evaluate(({ index, buttons, axes }) => {
    const value = window.__acceptancePads.get(index);
    value.axes = [...axes, 0, 0]; value.timestamp = performance.now();
    value.buttons.forEach((button, i) => { button.pressed = buttons.includes(i); button.touched = button.pressed; button.value = button.pressed ? 1 : 0; });
  }, { index, buttons, axes });
  await frames(count);
}
async function pulse(index, button) { await pad(index, [button]); await pad(index); }
async function snapshot() {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('CharacterSelectScene');
    return { active: window.__game.scene.isActive('CharacterSelectScene'), slots: s.state.slots,
      assignments: [...s.padAssignments], focusedMouseSlot: s.focusedMouseSlotIndex,
      editors: [...s.controlsEditors].map(([slot, editor]) => ({ slot, focusedRow: editor.focusedRow,
        capture: editor.capture, feedback: editor.feedback, closed: editor.closed,
        profileId: editor.session.profileId, profileName: editor.session.profileName,
        device: editor.session.device, bindings: editor.session.bindings.get(slot).bindings,
        options: editor.session.profileOptions(), rows: editor.panel.rowBounds })),
      saved: JSON.parse(localStorage.getItem('platformfighter.inputProfiles.v1') ?? 'null') };
  });
}
function editor(state, slot) { return state.editors.find(value => value.slot === slot); }
function check(name, detail) { report.checks.push({ name, detail }); console.log(`PASS ${name}`); }
async function point(kind, slot, row) {
  return page.evaluate(({ kind, slot, row }) => {
    const game = window.__game, s = game.scene.getScene('CharacterSelectScene');
    let p;
    if (kind === 'row') p = s.controlsEditors.get(slot).panel.rowCenter(row);
    else {
      const b = kind === 'portrait' ? s.portraitTiles.find(tile => /\blink\b/i.test(tile.nameLabel.text)).bounds
        : kind === 'cpu' ? s.cards[slot - 1].cpuButtonBounds
          : kind === 'controls' ? s.cards[slot - 1].controlsButtonBounds : s.cards[slot - 1].cardBounds;
      p = { x: b.centerX, y: b.centerY };
    }
    if (!p) throw new Error(`Missing ${kind} bounds for P${slot} row ${row}`);
    const c = game.canvas.getBoundingClientRect();
    return { x: p.x, y: p.y, clientX: c.left + p.x * c.width / game.scale.gameSize.width,
      clientY: c.top + p.y * c.height / game.scale.gameSize.height };
  }, { kind, slot, row });
}
async function click(kind, slot, row) {
  const p = await point(kind, slot, row); await page.mouse.click(p.clientX, p.clientY); await frames();
}
async function aim(index, slot, kind = 'portrait') {
  const target = await point(kind, slot);
  await page.evaluate(({ index, slot, target }) => new Promise((resolve, reject) => {
    const pad = window.__acceptancePads.get(index), started = performance.now();
    const tick = () => {
      const position = window.__game.scene.getScene('CharacterSelectScene').state.slots[slot - 1].cursor;
      const dx = target.x - position.x, dy = target.y - position.y;
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) { pad.axes = [0, 0, 0, 0]; resolve(); return; }
      if (performance.now() - started > 20000) { pad.axes = [0, 0, 0, 0]; reject(new Error(`P${slot} cursor failed to reach ${target.x},${target.y}`)); return; }
      const speed = delta => Math.abs(delta) < 7 ? 0 : Math.sign(delta) * (Math.abs(delta) < 60 ? 0.3 : 1);
      pad.axes = [speed(dx), speed(dy), 0, 0]; pad.timestamp = performance.now(); requestAnimationFrame(tick);
    }; tick();
  }), { index, slot, target });
  await frames();
}
async function focus(index, slot, row) {
  for (let i = 0; i < 20; i++) {
    const current = editor(await snapshot(), slot);
    assert.ok(current, `P${slot} editor must remain open`);
    if (current.focusedRow === row) return;
    await pulse(index, current.focusedRow < row ? 13 : 12);
  }
  throw new Error(`P${slot} did not focus row ${row}`);
}
async function activate(index, slot, row) { await focus(index, slot, row); await pulse(index, 0); }
async function captureButton(index, slot, row, button) {
  await activate(index, slot, row); assert.ok(editor(await snapshot(), slot).capture);
  await pad(index, [button]); const result = await snapshot();
  assert.equal(editor(result, slot).capture, null); await pad(index); return result;
}
async function selectProfile(index, slot, id) {
  await focus(index, slot, 0);
  for (let i = 0; i < 20; i++) {
    if (editor(await snapshot(), slot).profileId === id) return;
    await pulse(index, 0);
  }
  throw new Error(`P${slot} could not select ${id}`);
}
async function screenshot(name) { await page.screenshot({ path: `${output}/${name}.png` }); }
async function matchSnapshot() {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('MatchScene');
    return s.matchParticipants.map((participant, index) => {
      const slot = s.playerSlots[index];
      return { lobby: participant.slot.index, device: participant.slot.inputDevice,
        profileId: participant.slot.bindingProfileId, bindings: participant.bindings?.bindings,
        input: s.inputResolver.getMoveVector(slot.bindingsSlot),
        position: slot.character.getPosition(), velocity: slot.character.getVelocity() };
    });
  });
}
async function movement(lobby, padIndex) {
  await page.evaluate(({ lobby, padIndex }) => {
    const s = window.__game.scene.getScene('MatchScene');
    const index = s.matchParticipants.findIndex(value => value.slot.index === lobby), slot = s.playerSlots[index];
    const initialX = slot.character.getPosition().x; let steps = 0;
    window.__playerControlsMovement = null;
    const observer = () => {
      if (s.inputResolver.getMoveVector(slot.bindingsSlot).x !== -1) return;
      steps++;
      const displacement = initialX - slot.character.getPosition().x;
      if (displacement < 14 && steps < 18) return;
      const inputs = s.matchParticipants.map((participant, i) => ({ lobby: participant.slot.index,
        input: s.inputResolver.getMoveVector(s.playerSlots[i].bindingsSlot) }));
      s.matter.world.off('afterupdate', observer);
      if (padIndex === null) window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true }));
      else { const pad = window.__acceptancePads.get(padIndex); pad.axes = [0, 0, 0, 0]; pad.timestamp = performance.now(); }
      window.__playerControlsMovement = { initialX, displacement, steps, inputs };
    };
    s.matter.world.on('afterupdate', observer);
  }, { lobby, padIndex });
  if (padIndex === null) await page.keyboard.down('ArrowLeft'); else await pad(padIndex, [], [-1, 0], 1);
  try {
    await page.waitForFunction(() => window.__playerControlsMovement !== null, null, { timeout: 20000 });
    const result = await page.evaluate(() => window.__playerControlsMovement);
    assert.ok(result.displacement > 1 && result.displacement < 90, `P${lobby} must move under its own input`);
    assert.equal(result.inputs.find(value => value.lobby === lobby).input.x, -1);
    for (const other of result.inputs.filter(value => value.lobby !== lobby && value.lobby !== 1)) assert.equal(other.input.x, 0);
    return result;
  } finally { if (padIndex === null) await page.keyboard.up('ArrowLeft'); else await pad(padIndex); }
}

try {
  await page.goto(url); await scene('PasswordGateScene');
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/index-[^/]+\.js/.test(src))?.split('/').pop());
  if (expectedArtifact) assert.equal(report.artifact, expectedArtifact);
  await page.evaluate(() => { const game = window.__game; for (const value of game.scene.getScenes(true)) game.scene.stop(value.scene.key); game.scene.start('MainMenuScene'); });
  await scene('MainMenuScene'); await key('Enter'); await scene('ModeSelectScene'); await key('Enter'); await scene('CharacterSelectScene');
  await click('cpu', 1); await key('2'); await key('Space'); await click('portrait', 2);
  await pulse(1, 0); await aim(1, 3); await pulse(1, 0);
  let state = await snapshot();
  assert.equal(state.slots[0].mode, 'bot'); assert.equal(state.slots[1].inputType, 'keyboard_p2');
  assert.deepEqual(state.assignments, [[1, 3]]); assert.equal(state.slots[2].pickedCharacterId, 'link');
  check('sparse-player-ownership', state);

  await pulse(1, 2); state = await snapshot(); assert.ok(editor(state, 3));
  await key('Enter'); assert.equal((await snapshot()).active, true, 'An open editor blocks match start');
  await click('controls', 2); assert.ok(editor(await snapshot(), 2));
  await click('row', 2, ROW.jump); assert.ok(editor(await snapshot(), 2).capture);
  await pulse(5, 0); await aim(5, 4); await pulse(5, 0);
  await key('u'); state = await snapshot();
  assert.equal(editor(state, 2).capture, null); assert.equal(editor(state, 2).bindings.jump[0].keyCode, 85);
  assert.equal(state.slots[3].pickedCharacterId, 'link'); assert.deepEqual(state.assignments, [[1, 3], [5, 4]]);
  check('keyboard-capture-while-another-controller-joins-and-chooses', state);
  await pulse(5, 2); assert.equal((await snapshot()).editors.length, 3);
  await screenshot('three-independent-editors');
  await click('row', 2, ROW.done); state = await snapshot(); assert.equal(editor(state, 2), undefined);
  const keyboardProfileId = state.slots[1].bindingProfileId; assert.match(keyboardProfileId, /^custom-/);

  const ownership = await snapshot();
  assert.ok(editor(ownership, 3)); assert.ok(editor(ownership, 4));
  await click('row', 3, ROW.special); state = await snapshot();
  assert.deepEqual(editor(state, 3), editor(ownership, 3), 'Mouse cannot edit controller-owned panel');
  await focus(5, 4, ROW.special); state = await snapshot();
  assert.equal(editor(state, 3).focusedRow, editor(ownership, 3).focusedRow);
  assert.equal(editor(state, 3).capture, null); assert.equal(editor(state, 4).focusedRow, ROW.special);
  check('simultaneous-editor-device-isolation', state);

  await focus(1, 3, 1); const beforeLeft = await snapshot();
  await pad(1, [0], [-1, 0]); assert.ok(editor(await snapshot(), 3).capture);
  await frames(18); assert.ok(editor(await snapshot(), 3).capture, 'Activation chord must not capture itself');
  await pad(1); await pad(1, [], [-1, 0]); const capturedLeft = await snapshot();
  assert.equal(editor(capturedLeft, 3).capture, null);
  assert.deepEqual(editor(capturedLeft, 3).bindings.left[0].source, { type: 'axis', axisIndex: 0, direction: -1, threshold: 0.5 });
  await frames(20); const heldLeft = await snapshot();
  assert.deepEqual(heldLeft.slots[2].cursor, beforeLeft.slots[2].cursor);
  assert.equal(editor(heldLeft, 3).focusedRow, editor(capturedLeft, 3).focusedRow); await pad(1);
  check('left-capture-consumes-activation-and-held-navigation', { before: beforeLeft, captured: capturedLeft, held: heldLeft });

  await captureButton(1, 3, ROW.dodge, 16);
  await activate(1, 3, ROW.dodge); await pad(1, [1]); const capturedB = await snapshot();
  assert.equal(editor(capturedB, 3).capture, null); assert.equal(editor(capturedB, 3).bindings.taunt[0].source.buttonIndex, 1);
  await frames(20); const heldB = await snapshot();
  assert.equal(heldB.slots[2].mode, 'human'); assert.ok(editor(heldB, 3)); assert.deepEqual(heldB.slots[2].cursor, capturedB.slots[2].cursor);
  await pad(1); check('B-is-assignable-without-removing-player', { capturedB, heldB });

  await activate(1, 3, ROW.special); const beforeCancel = editor(await snapshot(), 3).bindings;
  await pulse(5, 16); assert.equal(editor(await snapshot(), 3).capture, 'special', 'Another controller cannot supply a capture');
  await pad(1, [9]); assert.equal(editor(await snapshot(), 3).capture, null);
  await frames(12); assert.equal((await snapshot()).active, true); await pad(1);
  assert.deepEqual(editor(await snapshot(), 3).bindings, beforeCancel);
  check('Start-cancels-capture-without-starting-match', await snapshot());

  await activate(1, 3, ROW.copy); state = await snapshot();
  const sharedId = editor(state, 3).profileId; assert.match(sharedId, /^custom-/);
  const savedOriginal = state.saved.profiles.find(value => value.id === sharedId); assert.ok(savedOriginal);
  await selectProfile(5, 4, sharedId); await activate(5, 4, ROW.done); await pulse(5, 2);
  assert.equal(editor(await snapshot(), 4).profileId, sharedId);
  await activate(1, 3, ROW.done); await pulse(1, 2);
  const sharedBefore = await snapshot(); assert.equal(editor(sharedBefore, 3).profileId, sharedId);
  await captureButton(1, 3, ROW.jump, 16); await activate(1, 3, ROW.done); state = await snapshot();
  const copiedId = state.slots[2].bindingProfileId;
  assert.notEqual(copiedId, sharedId); assert.match(copiedId, /^custom-/);
  assert.equal(editor(state, 4).profileId, sharedId); assert.equal(editor(state, 4).bindings.jump[0].source.buttonIndex, 0);
  assert.deepEqual(state.saved.profiles.find(value => value.id === sharedId), savedOriginal);
  const copied = state.saved.profiles.find(value => value.id === copiedId);
  assert.equal(copied.bindings.jump[0].source.buttonIndex, 16);
  for (const value of [savedOriginal, copied]) for (const bindings of Object.values(value.bindings)) for (const binding of bindings) assert.equal(binding.gamepadIndex, null);
  check('editing-a-shared-profile-copies-without-changing-other-player', { sharedBefore, after: state });

  await key('2'); await key('r'); state = await snapshot(); assert.ok(editor(state, 2)); assert.equal(editor(state, 2).profileId, keyboardProfileId);
  await screenshot('concurrent-keyboard-and-controller-editors');
  const keyboardSaved = state.saved.profiles.find(value => value.id === keyboardProfileId);
  await click('row', 2, ROW.jump); await key('i'); await click('row', 2, ROW.cancel);
  assert.deepEqual((await snapshot()).saved.profiles.find(value => value.id === keyboardProfileId), keyboardSaved);
  check('keyboard-R-opens-own-editor-and-Cancel-discards-draft', await snapshot());
  await activate(5, 4, ROW.done); assert.equal((await snapshot()).editors.length, 0);

  await click('controls', 3); assert.equal((await snapshot()).editors.length, 0, 'Mouse cannot open a controller player editor');
  await aim(1, 3, 'controls'); await pulse(1, 0); assert.ok(editor(await snapshot(), 3));
  await activate(1, 3, ROW.done); check('controller-A-opens-own-card-controls', await snapshot());
  await key('Enter'); await scene('StageSelectScene'); await key('Enter'); await scene('MatchScene'); await frames(10);
  const participants = await matchSnapshot();
  assert.equal(participants.find(value => value.lobby === 2).profileId, keyboardProfileId);
  assert.equal(participants.find(value => value.lobby === 3).profileId, copiedId);
  assert.equal(participants.find(value => value.lobby === 4).profileId, sharedId);
  assert.deepEqual(participants.find(value => value.lobby === 2).device, { kind: 'keyboard', layout: 'keyboard_p2' });
  assert.equal(participants.find(value => value.lobby === 3).device.gamepadIndex, 1);
  assert.equal(participants.find(value => value.lobby === 4).device.gamepadIndex, 5);
  check('saved-profiles-and-sparse-device-ownership-reach-match', participants);
  for (const [slot, device] of [[2, null], [3, 1], [4, 5]]) check(`P${slot}-only-its-own-device-moves-fighter`, await movement(slot, device));
  await screenshot('sparse-four-player-match');
  assert.deepEqual(report.errors, []);
  report.pass = true;
} catch (error) {
  report.pass = false; report.failure = error.stack; console.error(error.stack);
  await screenshot('failure').catch(() => {}); process.exitCode = 1;
} finally { await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ pass: report.pass, artifact: report.artifact, checks: report.checks.length, errors: report.errors.length, output }));
