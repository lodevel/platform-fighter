import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_PROFILES_OUTPUT ?? 'docs/review/2026-09-23/input-profiles/production';
const url = process.env.PF_PROFILES_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const expectedArtifact = process.env.PF_PROFILES_EXPECT_ARTIFACT;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { url, expectedArtifact, checks: [], errors: [], setup: 'One synthetic standard controller at browser index 0. Only the password gate is bypassed. All joins, selections, captures, profile operations and match transitions use normal mouse/keyboard/gamepad events. Results are arranged by moving the second fighter beyond the blast zone; normal stock/rules processing performs the transition.' };
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__profilePad = { id: 'Profile Regression Controller', index: 0, connected: true, mapping: 'standard', timestamp: 1,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__profilePad] });
});

async function frames(count = 3) {
  const frame = await page.evaluate(() => window.__game.loop.frame);
  await page.waitForFunction(({ frame, count }) => window.__game.loop.frame >= frame + count, { frame, count }, { timeout: 15000 });
}
async function scene(name) { await page.waitForFunction(name => window.__game?.scene.isActive(name), name, { timeout: 30000 }); await frames(); }
async function key(value) { await page.keyboard.press(value); await frames(); }
async function pad({ buttons = {}, axes = {} } = {}, count = 4) {
  await page.evaluate(({ buttons, axes }) => {
    const pad = window.__profilePad; pad.timestamp = performance.now();
    for (const [index, pressed] of Object.entries(buttons)) pad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
    for (const [index, value] of Object.entries(axes)) pad.axes[index] = value;
  }, { buttons, axes });
  await frames(count);
}
async function pulse(button) { await pad({ buttons: { [button]: true } }); await pad({ buttons: { [button]: false } }); }
async function click(kind, slot = 1, action) {
  const point = await page.evaluate(({ kind, slot, action }) => {
    const game = window.__game;
    let bounds;
    if (kind === 'portrait') bounds = game.scene.getScene('CharacterSelectScene').portraitTiles.find(tile => /\blink\b/i.test(tile.nameLabel.text)).bounds;
    else if (kind === 'cpu') bounds = game.scene.getScene('CharacterSelectScene').cards[slot - 1].cpuButtonBounds;
    else {
      const panel = game.scene.getScene('RebindingScene').screen.panels.find(panel => panel.slot === slot);
      const object = kind === 'profile' ? panel.deviceText : kind === 'new' ? panel.newProfileButton
        : kind === 'rename' ? panel.renameProfileButton : kind === 'confirm' ? panel.confirmButton
          : kind === 'reset' ? panel.resetButton : panel.bindingTexts[panel.actionsByRow.indexOf(action)];
      bounds = object.getBounds();
    }
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.left + bounds.centerX * rect.width / game.scale.gameSize.width,
      y: rect.top + bounds.centerY * rect.height / game.scale.gameSize.height };
  }, { kind, slot, action });
  await page.mouse.click(point.x, point.y); await frames();
}
async function controls(slot = 3) {
  return page.evaluate(slot => {
    const scene = window.__game.scene.getScene('RebindingScene');
    return { active: window.__game.scene.isActive('RebindingScene'), capture: scene.screen.getActiveCapture(),
      focusedRow: scene.screen.getFocusedRowIndex(), panels: scene.screen.getAllPanelSnapshots(),
      bindings: scene.screen.store.get(slot).bindings, feedback: scene.screen.getSaveFeedback(),
      selections: scene.profileSession.snapshot(), saved: JSON.parse(localStorage.getItem('platformfighter.inputProfiles.v1')) };
  }, slot);
}
async function roster() { return page.evaluate(() => {
  const scene = window.__game.scene.getScene('CharacterSelectScene'); return { slots: scene.state.slots, pads: [...scene.padAssignments] };
}); }
async function aimAtLink(slot) {
  for (let i = 0; i < 80; i++) {
    const delta = await page.evaluate(slot => {
      const scene = window.__game.scene.getScene('CharacterSelectScene');
      const box = scene.portraitTiles.find(tile => /\blink\b/i.test(tile.nameLabel.text)).bounds;
      const hand = scene.state.slots[slot - 1].cursor;
      return { x: box.centerX - hand.x, y: box.centerY - hand.y, inside: box.contains(hand.x, hand.y) };
    }, slot);
    if (delta.inside) { await pad({ axes: { 0: 0, 1: 0 } }); await pulse(0); return; }
    await pad({ axes: { 0: Math.abs(delta.x) < 12 ? 0 : Math.sign(delta.x) * (Math.abs(delta.x) < 80 ? 0.35 : 1),
      1: Math.abs(delta.y) < 12 ? 0 : Math.sign(delta.y) * (Math.abs(delta.y) < 80 ? 0.35 : 1) } }, 2);
  }
  throw new Error('Controller cursor did not reach Link');
}
async function rename(slot, name) {
  const dialog = page.waitForEvent('dialog').then(dialog => dialog.accept(name));
  await click('rename', slot); await dialog; await frames();
}
async function selectProfile(slot, id) {
  for (let i = 0; i < 20; i++) {
    if ((await controls(slot)).panels[slot - 1].profileId === id) return;
    await click('profile', slot);
  }
  throw new Error(`Profile ${id} unavailable for player ${slot}`);
}
// RebindingScreen rows: -1 device, 0–10 actions (LOGICAL_ACTIONS, smash last),
// then Confirm, Reset, New, Rename.
const CONFIRM_ROW = 11;
async function focusRow(slot, row) {
  for (let i = 0; i < 4; i++) {
    if ((await controls(slot)).panels[slot - 1].focused) break;
    await key('ArrowRight');
  }
  for (let i = 0; i < 16; i++) {
    if ((await controls(slot)).focusedRow === row) return;
    await key('ArrowDown');
  }
  throw new Error('Could not focus requested control');
}
async function matchState() { return page.evaluate(() => {
  const scene = window.__game.scene.getScene('MatchScene');
  return scene.matchParticipants.map(participant => ({ index: participant.slot.index, device: participant.slot.inputDevice,
    profileId: participant.slot.bindingProfileId, move: scene.inputResolver.getMoveVector(participant.slot.index) }));
}); }
async function screenshot(name) { await page.screenshot({ path: `${output}/${name}.png` }); }
function checked(name, detail) { report.checks.push({ name, detail }); console.log(`PASS ${name}`); }

try {
  await page.goto(url);
  await scene('PasswordGateScene');
  report.artifact = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/index-[^/]+\.js/.test(src))?.split('/').pop());
  if (expectedArtifact) assert.equal(report.artifact, expectedArtifact);
  await page.evaluate(() => { const game = window.__game; for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key); game.scene.start('MainMenuScene'); });
  await scene('MainMenuScene'); await key('Enter'); await scene('ModeSelectScene');
  await key('ArrowDown');
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.__game.scene.getScene('ModeSelectScene').getState().stockIndex === 0)) break;
    await key('ArrowLeft');
  }
  await key('ArrowDown'); await key('ArrowLeft'); await key('ArrowLeft'); await key('Enter'); await scene('CharacterSelectScene');
  await click('cpu', 1); await key('2'); await key('Space'); await click('portrait');
  await pulse(0); await aimAtLink(3);
  const initialRoster = await roster();
  assert.equal(initialRoster.slots[0].mode, 'bot'); assert.equal(initialRoster.slots[1].inputType, 'keyboard_p2');
  assert.equal(initialRoster.slots[2].inputType, 'gamepad'); assert.deepEqual(initialRoster.pads, [[0, 3]]);
  checked('one-controller-user-layout', initialRoster);
  await key('r'); await scene('RebindingScene');
  await click('profile', 3);
  assert.match((await controls()).feedback, /only profile.*New/);
  await click('new', 3); await rename(3, 'Shared Directional Profile'); await click('confirm', 3);
  const created = await controls(); const sharedId = created.panels[2].profileId;
  assert.equal(created.panels[2].profileName, 'Shared Directional Profile'); assert.match(created.feedback, /Saved profile/);
  assert.ok(created.saved.profiles.some(profile => profile.id === sharedId && profile.name === 'Shared Directional Profile'));
  checked('new-rename-confirm-persistence', created);

  for (const kind of ['dpad', 'axis']) {
    await click('binding', 3, 'left'); await key('Escape');
    await pad({ buttons: { 0: true, ...(kind === 'dpad' ? { 14: true } : {}) }, axes: kind === 'axis' ? { 0: -1 } : {} });
    const activation = await controls(); assert.deepEqual(activation.capture, { slot: 3, action: 'left' });
    assert.equal(activation.panels[2].focused, true);
    await frames(22); assert.notEqual((await controls()).capture, null, 'Activation inputs must not bind themselves');
    await pad({ buttons: { 0: false, 14: false }, axes: { 0: 0 } });
    await pad(kind === 'dpad' ? { buttons: { 14: true } } : { axes: { 0: -1 } });
    const captured = await controls(); assert.equal(captured.capture, null); assert.equal(captured.panels[2].focused, true);
    assert.equal(captured.bindings.left[0].source.type, kind === 'dpad' ? 'button' : 'axis');
    if (kind === 'axis') await pad({ axes: { 0: -0.6 } });
    await frames(30); const held = await controls(); assert.equal(held.panels[2].focused, true); assert.equal(held.focusedRow, 0);
    await pad({ buttons: { 14: false }, axes: { 0: 0 } });
    checked(`${kind}-left-capture-consumes-navigation`, { activation, captured, held });
  }
  await focusRow(3, CONFIRM_ROW); await pulse(0); assert.match((await controls()).feedback, /Saved profile.*PLAYER 3/);
  checked('controller-confirm-visible', (await controls()).feedback);

  // Force a real conflicting draft, then recover through a valid capture.
  await click('binding', 3, 'special'); await pulse(0); await focusRow(3, CONFIRM_ROW); await pulse(0);
  const conflict = await controls(); assert.match(conflict.feedback, /not saved.*Rebind/);
  let unexpectedRenameDialogs = 0;
  const dismissRename = async dialog => { unexpectedRenameDialogs++; await dialog.dismiss(); };
  page.on('dialog', dismissRename);
  await click('rename', 3);
  page.off('dialog', dismissRename);
  const afterRejectedRename = await controls();
  assert.equal(unexpectedRenameDialogs, 0, 'Rename must explain conflicts before opening a prompt');
  assert.deepEqual(afterRejectedRename.bindings, conflict.bindings, 'Rename must preserve the invalid working draft');
  checked('rename-preserves-conflicting-draft', afterRejectedRename.feedback);
  await click('binding', 3, 'special'); await pulse(16); await click('confirm', 3);
  const repaired = await controls(); assert.match(repaired.feedback, /Saved profile/);
  checked('confirm-conflict-and-recovery', { conflict: conflict.feedback, repaired: repaired.feedback });
  await page.evaluate(() => { window.__profileOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('Probe storage failure'); }; });
  let failedSave;
  try { await click('confirm', 3); failedSave = await controls(); assert.match(failedSave.feedback, /could not be saved/); }
  finally { await page.evaluate(() => { Storage.prototype.setItem = window.__profileOriginalSetItem; delete window.__profileOriginalSetItem; }); }
  await click('confirm', 3); assert.match((await controls()).feedback, /Saved profile/);
  checked('confirm-storage-failure-and-retry', { failed: failedSave.feedback, retried: (await controls()).feedback });

  report.layout = await page.evaluate(() => {
    const scene = window.__game.scene.getScene('RebindingScene');
    return scene.screen.panels.map(panel => ({ slot: panel.slot, header: panel.header.text, profile: panel.deviceText.text,
      device: panel.connectedDeviceText.text, profileBounds: panel.deviceText.getBounds(), panelBounds: panel.background.getBounds() }));
  });
  for (const panel of report.layout) {
    assert.ok(panel.profileBounds.x >= panel.panelBounds.x && panel.profileBounds.x + panel.profileBounds.width <= panel.panelBounds.x + panel.panelBounds.width, 'Full profile label must fit its panel');
  }
  await screenshot('named-profiles-controls');
  const p2Device = (await controls(2)).panels[1].device; await click('profile', 2);
  assert.equal((await controls(2)).panels[1].device, p2Device); assert.equal(p2Device, 'keyboard_p2');
  checked('keyboard-profile-keeps-keyboard-owner', await controls(2));
  await selectProfile(2, 'keyboard-arrows');
  await key('Escape'); await scene('CharacterSelectScene'); assert.deepEqual((await roster()).pads, [[0, 3]]);

  await key('Enter'); await scene('StageSelectScene'); await key('Enter'); await scene('MatchScene'); await frames(25);
  await pad({ axes: { 0: 1 } }); const sparsePad = await matchState(); await pad({ axes: { 0: 0 } });
  await page.keyboard.down('ArrowRight'); await frames(5); const sparseKeyboard = await matchState(); await page.keyboard.up('ArrowRight'); await frames();
  assert.equal(sparsePad.find(player => player.index === 3).profileId, sharedId);
  assert.equal(sparsePad.find(player => player.index === 3).device.gamepadIndex, 0);
  assert.equal(sparsePad.find(player => player.index === 3).move.x, 1);
  assert.equal(sparsePad.find(player => player.index === 2).move.x, 0);
  assert.equal(sparseKeyboard.find(player => player.index === 2).move.x, 1);
  assert.equal(sparseKeyboard.find(player => player.index === 3).move.x, 0);
  checked('p3-profile-drives-only-owned-controller', { sparsePad, sparseKeyboard });
  await key('Escape'); await scene('PauseMenuScene'); await key('c'); await scene('CharacterSelectScene');

  // Deliberately leave/rejoin through the roster so the same physical pad owns P1.
  // Reusing a profile itself must not make that ownership change.
  await pulse(1); await key('1'); await key('Backspace'); await pulse(0); await aimAtLink(1);
  assert.deepEqual((await roster()).pads, [[0, 1]]);
  await key('r'); await scene('RebindingScene'); await selectProfile(1, sharedId); await click('confirm', 1);
  assert.equal((await controls(1)).panels[0].device, 'gamepad_0');
  assert.equal((await controls(1)).panels[0].profileId, sharedId);
  await key('Escape'); await scene('CharacterSelectScene'); const reused = await roster(); assert.deepEqual(reused.pads, [[0, 1]]);
  checked('reuse-p3-profile-on-p1-with-one-controller', reused);
  await key('Enter'); await scene('StageSelectScene'); await key('Enter'); await scene('MatchScene'); await frames(25);
  assert.equal((await matchState()).find(player => player.index === 1).profileId, sharedId);

  await key('Escape'); await scene('PauseMenuScene'); await key('k'); await scene('RebindingScene');
  await click('new', 1); await rename(1, 'Match Profile'); await click('confirm', 1);
  const matchProfileId = (await controls(1)).panels[0].profileId;
  await screenshot('midmatch-profile-save');
  await key('Escape'); await scene('PauseMenuScene'); await key('Escape'); await scene('MatchScene');
  for (const transition of ['resume', 'restart', 'rematch']) {
    if (transition === 'restart') { await key('Escape'); await scene('PauseMenuScene'); await key('r'); await scene('MatchScene'); await frames(20); }
    if (transition === 'rematch') {
      for (let i = 0; i < 200; i++) {
        if (await page.evaluate(() => window.__game.scene.isActive('ResultsScene'))) break;
        await page.evaluate(() => { const s = window.__game.scene.getScene('MatchScene');
          if (window.__game.scene.isActive('MatchScene') && !s.stockTracker.isRespawning(1) && !s.stockTracker.isEliminated(1)) s.matter.body.setPosition(s.p2.body, { x: 100000, y: 100000 }); });
        await frames(3);
      }
      await scene('ResultsScene'); await key('Enter'); await scene('MatchScene'); await frames(20);
    }
    await pad({ axes: { 0: 1 } }); const padState = await matchState(); await pad({ axes: { 0: 0 } });
    await page.keyboard.down('ArrowRight'); await frames(5); const keyboardState = await matchState(); await page.keyboard.up('ArrowRight'); await frames(3);
    const p1 = padState.find(player => player.index === 1), p2 = padState.find(player => player.index === 2);
    assert.equal(p1.profileId, matchProfileId); assert.equal(p1.device.gamepadIndex, 0); assert.equal(p1.move.x, 1); assert.equal(p2.move.x, 0);
    assert.equal(keyboardState.find(player => player.index === 1).move.x, 0); assert.equal(p2.device.kind, 'keyboard');
    assert.equal(keyboardState.find(player => player.index === 2).move.x, 1, 'P2 keeps the selected arrow-key profile');
    checked(`${transition}-retains-profile-and-pad-owner`, { padState, keyboardState });
  }
  await key('Escape'); await scene('PauseMenuScene'); await key('m'); await scene('MainMenuScene'); await key('o'); await scene('RebindingScene');
  const library = await controls();
  assert.deepEqual(library.selections, [], 'Library-only editing must not assign profiles to a previous roster');
  const libraryLabels = await page.evaluate(() => window.__game.scene.getScene('RebindingScene').screen.panels.map(panel => ({ header: panel.header.text, device: panel.connectedDeviceText.text })));
  assert.ok(libraryLabels.every(panel => panel.header.includes('(PRESET)') && panel.device.includes('Not playing')));
  await screenshot('main-menu-profile-library');
  checked('main-menu-library-has-no-player-assignments', { library, labels: libraryLabels });
  assert.equal(report.errors.length, 0); report.pass = true;
} catch (error) { report.pass = false; report.failure = error.stack; console.error(error); await screenshot('failure').catch(() => {}); process.exitCode = 1; }
finally { await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ pass: report.pass, artifact: report.artifact, checks: report.checks.length, errors: report.errors.length, output }));
