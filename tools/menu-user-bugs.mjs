/** Real DOM/Gamepad regression journey; --baseline records the old failures. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const baseline = process.argv.includes('--baseline');
const url = process.env.PF_GAME_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const out = path.resolve('docs/review/2026-10-15/user-bugs/menus', process.env.PF_MENU_EVIDENCE_SUBDIR ?? (baseline ? 'before' : 'after'));
fs.mkdirSync(out, { recursive: true });
const report = { baseline, url, build: null, identity: null, checks: {}, pageErrors: [], faults: [], completedMatch: null };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', error => report.pageErrors.push(String(error)));
await page.addInitScript(() => {
  window.__testPads = [0, 2].map(index => ({ index, id: `Menu regression controller ${index}`, connected: true,
    mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null }));
  Object.defineProperty(navigator, 'getGamepads', { value: () => {
    const result = Array(4).fill(null);
    for (const pad of window.__testPads) if (pad.connected) result[pad.index] = pad;
    return result;
  } });
});
const frames = count => page.evaluate(count => new Promise(resolve => {
  let left = count; const next = () => --left <= 0 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next);
}), count);
async function padButton(index, button) {
  await page.evaluate(({ index, button }) => { const pad = window.__testPads.find(pad => pad.index === index); pad.buttons[button] = { pressed: true, touched: true, value: 1 }; }, { index, button });
  await frames(3);
  await page.evaluate(({ index, button }) => { const pad = window.__testPads.find(pad => pad.index === index); pad.buttons[button] = { pressed: false, touched: false, value: 0 }; }, { index, button });
  await frames(3);
}
async function screen(name) { await page.waitForFunction(name => window.__menu?.screen === name, name, { timeout: 300000 }); }
async function slots() {
  return page.locator('.card').evaluateAll(cards => cards.map((card, i) => ({ slot: i + 1,
    mode: card.querySelector('.mode-btn')?.textContent, fighter: card.querySelector('.fighter-name')?.textContent,
    palette: [...card.querySelectorAll('.swatch')].findIndex(button => button.classList.contains('on')),
    controls: [...card.querySelectorAll('.card-controls button, .meta button')].map(button => button.textContent),
  })));
}
async function movePadTo(index, slot, target) {
  const box = await target.boundingBox();
  return page.evaluate(async ({ index, slot, x, y }) => {
    const pad = window.__testPads.find(pad => pad.index === index);
    const hand = document.querySelectorAll('.hand')[slot - 1];
    let remaining;
    for (let frame = 0; frame < 240; frame++) {
      const matrix = new DOMMatrix(hand.style.transform);
      const dx = x - matrix.m41, dy = y - matrix.m42;
      remaining = Math.hypot(dx, dy);
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) { pad.axes[0] = pad.axes[1] = 0; return { frame, remaining }; }
      const axis = delta => Math.abs(delta) < 5 ? 0 : Math.sign(delta) * Math.max(0.2, Math.min(0.8, Math.abs(delta) / 45));
      pad.axes[0] = axis(dx); pad.axes[1] = axis(dy);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    pad.axes[0] = pad.axes[1] = 0;
    throw new Error(`Could not move pad${index} to exact palette target; ${remaining}px remain`);
  }, { index, slot, x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.__menu?.go, null, { timeout: 300000 });
  report.build = await page.evaluate(() => [...document.scripts].find(script => /assets\/(?:index|game)-/.test(script.src))?.src ?? 'Vite development source');
  await page.evaluate(() => window.__menu.go('rules'));
  report.checks.defaultMeter = await page.locator('.rule').nth(3).locator('.value').textContent();
  if (!baseline) assert.equal(report.checks.defaultMeter, 'On');
  // Explicit Off must remain an intentional match setting when backing out.
  if (report.checks.defaultMeter === 'On') await page.locator('.rule').nth(3).getByLabel('Next', { exact: true }).click();
  await page.getByRole('button', { name: 'Choose fighters', exact: true }).click();
  await page.keyboard.press('Escape'); await screen('rules');
  report.checks.explicitMeterOffRetained = await page.locator('.rule').nth(3).locator('.value').textContent() === 'Off';
  assert(report.checks.explicitMeterOffRetained);
  // One stock makes an actual result payload quick to produce through normal KO detection.
  await page.locator('.rule').nth(1).getByLabel('Previous', { exact: true }).click({ clickCount: 2 });
  await page.getByRole('button', { name: 'Choose fighters', exact: true }).click(); await screen('fighters');
  await page.keyboard.press('Space');
  await page.locator('.portrait').first().click();
  await padButton(0, 0); await padButton(0, 15); await padButton(0, 0);
  await padButton(2, 0); await padButton(2, 0);
  report.checks.initialSlots = await slots();
  await page.screenshot({ path: path.join(out, '01-three-players.png') });

  // Pointer movement between press/release must leave the same swatch alive.
  const swatch = page.locator('.card').nth(0).locator('.swatch').nth(5);
  const box = await swatch.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => { window.__pressedSwatch = document.querySelectorAll('.card')[0].querySelectorAll('.swatch')[5]; });
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
  await page.mouse.up();
  report.checks.pointerTargetRetained = await page.evaluate(() => window.__pressedSwatch.isConnected);
  report.checks.pointerPalette = (await slots())[0].palette;
  if (!baseline) assert.equal(report.checks.pointerPalette, 5);

  // A held stick must generate one smooth displacement per rendered frame.
  report.checks.analog = await page.evaluate(async () => {
    const pad = window.__testPads.find(pad => pad.index === 0);
    const hand = document.querySelectorAll('.hand')[1];
    const positions = [];
    const read = () => { const matrix = new DOMMatrix(hand.style.transform); positions.push({ x: matrix.m41, y: matrix.m42 }); };
    read(); pad.axes[0] = 0.8;
    for (let i = 0; i < 14; i++) await new Promise(resolve => requestAnimationFrame(() => { read(); resolve(); }));
    pad.axes[0] = 0;
    const jumps = positions.slice(1).map((p, i) => Math.hypot(p.x - positions[i].x, p.y - positions[i].y));
    return { positions, maxJump: Math.max(...jumps), jumps };
  });
  if (!baseline) assert(report.checks.analog.maxJump <= 36.01, `stick jump ${report.checks.analog.maxJump}`);

  // Y works even over a portrait/empty area, rather than silently cycling one preset.
  await padButton(0, 3);
  report.checks.padYOpensControls = await page.locator('.controls.overlay').count() === 1;
  if (!baseline) {
    assert(report.checks.padYOpensControls);
    const attack = page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Attack$/ }) });
    await attack.click(); await frames(2); await padButton(0, 6);
    report.checks.padBindingFeedback = await attack.textContent();
    assert.match(report.checks.padBindingFeedback, /LT/);
    await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Save$/ }) }).click();
    await page.waitForFunction(() => !document.querySelector('.controls.overlay'));
    // Keyboard Y gets its own editor and save; the pad's profile stays attached.
    await page.keyboard.press('v');
    await page.waitForSelector('.controls.overlay');
    await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Attack$/ }) }).click();
    await page.keyboard.press('q');
    assert.match(await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Attack$/ }) }).textContent(), /Q/);
    await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Save$/ }) }).click();
    await page.waitForFunction(() => !document.querySelector('.controls.overlay'));
    report.checks.savedProfiles = await page.evaluate(() => JSON.parse(localStorage.getItem('platformfighter.inputProfiles.v1')));
    assert.equal(report.checks.savedProfiles.profiles.length, 2);
    report.checks.padExactPaletteMovement = await movePadTo(0, 2, page.locator('.card').nth(1).locator('.swatch').nth(6));
    await padButton(0, 0);
    report.checks.padExactPalette = (await slots())[1].palette;
    assert.equal(report.checks.padExactPalette, 6);
    await padButton(0, 14); await padButton(0, 0);
    assert.equal((await slots())[1].palette, 5);
    await padButton(0, 15); await padButton(0, 0);
    assert.equal((await slots())[1].palette, 6);
    report.checks.dpadExactPalette = true;
  }
  report.checks.beforeMatch = await slots();
  if (baseline) await page.keyboard.press('Enter'); else await padButton(0, 9);
  await screen('stages');
  // Back from stage select also keeps all hands and their physical device identities.
  if (!baseline) {
    await padButton(2, 1); await screen('fighters');
    report.checks.stageBackHands = await page.locator('.hand').evaluateAll(hands => hands.map((hand, i) => ({ slot: i + 1, visible: !hand.hidden, device: hand.dataset.device })));
    assert.equal(report.checks.stageBackHands.filter(hand => hand.visible).length, 3);
    await padButton(2, 9); await screen('stages');
  }
  if (baseline) await page.locator('.stage-row').first().click(); else await padButton(0, 0);
  await screen('match');
  await page.evaluate(() => window.__sim.manual(true));
  await page.evaluate(async () => { await window.__sim.ready; });
  report.identity = await page.evaluate(() => window.__sim.match.buildIdentity);
  report.checks.firstMatchPlayers = await page.evaluate(() => window.__sim.config.players);
  if (!baseline) {
    assert.deepEqual(report.checks.firstMatchPlayers.map(player => [player.index, player.inputDevice.kind, player.inputDevice.gamepadIndex]),
      [[1, 'keyboard', undefined], [2, 'gamepad', 0], [3, 'gamepad', 2]]);
    assert.equal(report.checks.firstMatchPlayers[0].paletteIndex, 5);
    assert.equal(report.checks.firstMatchPlayers[0].bindingProfileId, 'custom-2');
    assert.equal(report.checks.firstMatchPlayers[1].bindingProfileId, 'custom-1');
    await page.evaluate(() => {
      const sim = window.__sim.match;
      for (let i = 0; i < 600 && sim.getSourceIntroSnapshot(); i++) sim.step();
      for (let i = 0; i < 120; i++) sim.step();
      window.__sim.step();
    });
    await page.keyboard.down('q');
    await page.evaluate(() => { window.__testPads.find(pad => pad.index === 0).buttons[6] = { pressed: true, touched: true, value: 1 }; });
    report.checks.savedBindingsDriveMatch = await page.evaluate(() => {
      window.__sim.step();
      return [1, 2, 3].map(index => window.__sim.inputResolver.getAction(index, 'attack'));
    });
    assert.deepEqual(report.checks.savedBindingsDriveMatch.map(action => action.held), [true, true, false]);
    await page.keyboard.up('q');
    await page.evaluate(() => { window.__testPads.find(pad => pad.index === 0).buttons[6] = { pressed: false, touched: false, value: 0 }; window.__sim.step(); });
  }
  report.completedMatch = await page.evaluate(() => {
    const sim = window.__sim.match;
    for (let i = 0; i < 600 && sim.getSourceIntroSnapshot(); i++) sim.step();
    for (let i = 0; i < 120; i++) sim.step();
    for (const slot of sim.playerSlots.slice(1)) sim.matter.body.setPosition(slot.character.body, { x: -100000, y: 100000 });
    for (let i = 0; i < 900 && !sim.isFinished; i++) sim.step();
    window.__sim.draw(); window.__sim.manual(false);
    return sim.result;
  });
  assert(report.completedMatch, 'actual match must complete');
  await screen('results');
  await page.screenshot({ path: path.join(out, '02-actual-results.png') });
  if (baseline) await page.keyboard.press('Escape'); else await padButton(2, 1);
  await screen('fighters');
  report.checks.returnedHands = await page.locator('.hand').evaluateAll(hands => hands.map((hand, i) => ({ slot: i + 1, visible: !hand.hidden, device: hand.dataset.device })));
  report.checks.returnedSlots = await slots();
  // Every original device presses A again: it must edit its card, never join P4.
  await padButton(0, 0); await padButton(2, 0);
  report.checks.afterReturningPadA = await slots();
  await page.screenshot({ path: path.join(out, '03-returned-fighters.png') });
  if (!baseline) {
    assert.deepEqual(report.checks.returnedHands.filter(hand => hand.visible).map(hand => [hand.slot, hand.device]), [[1, 'keyboard'], [2, 'pad0'], [3, 'pad2']]);
    assert.equal(report.checks.afterReturningPadA[3].mode, 'Off');
    assert.deepEqual(report.checks.afterReturningPadA.map(player => player.palette), report.checks.returnedSlots.map(player => player.palette));
    // The same devices, profiles and palettes must launch again.
    await page.keyboard.press('Enter'); await screen('stages'); await page.locator('.stage-row').first().click(); await screen('match');
    await page.evaluate(() => window.__sim.manual(true)); await page.evaluate(async () => { await window.__sim.ready; });
    report.checks.secondMatchPlayers = await page.evaluate(() => window.__sim.config.players);
    assert.deepEqual(report.checks.secondMatchPlayers.map(player => [player.index, player.inputDevice, player.bindingProfileId, player.paletteIndex]),
      report.checks.firstMatchPlayers.map(player => [player.index, player.inputDevice, player.bindingProfileId, player.paletteIndex]));
    await page.getByRole('button', { name: 'Pause match', exact: true }).click();
    await page.locator('.pause-opt').filter({ has: page.locator('b', { hasText: /Character select/i }) }).click();
    await screen('fighters');
    await page.setViewportSize({ width: 480, height: 900 });
    await frames(2);
    const phoneSwatch = await page.locator('.card').first().locator('.swatch').first().boundingBox();
    report.checks.phoneSwatch = phoneSwatch;
    assert(phoneSwatch.width >= 26 && phoneSwatch.height >= 26);
    await page.screenshot({ path: path.join(out, '04-phone-palettes.png') });
  }
  report.faults = await page.evaluate(() => window.__menu.faults ?? []);
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.faults, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = String(error.stack ?? error);
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, failure: report.failure, pageErrors: report.pageErrors }, null, 2));
