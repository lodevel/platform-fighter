// Real Three.js match host qualification, including DOM inputs, persisted
// profiles, pause controls, checkpoints, Link articles and result flow.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2] ?? '../docs/review/2026-10-15/takeover/port-live';
const base = process.env.PORT_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error.stack ?? error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => {
  const pad = { id: 'simulated pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  navigator.getGamepads = () => Array.from({ length: pad.index + 1 }, (_, index) => index === pad.index ? pad : null);
});
const config = (a = 'pikachu', b = 'donkeykong', stageId = 'flat') => ({ mode: 'stocks', stockCount: 3, stageId,
  rngSeed: 20261015, itemFrequency: 'off', linkIntroPolicy: 'none',
  finalSmashRules: { schemaVersion: 1, meterEnabled: true, smashBallEnabled: true },
  players: [{ index: 1, characterId: a, paletteIndex: 0, inputType: 'keyboard_p1' },
    { index: 2, characterId: b, paletteIndex: 1, inputType: 'keyboard_p2' }] });
const assert = (condition, name, detail) => { checks.push({ name, ok: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
async function start(c) { await page.evaluate(async c => { window.__sim.startMatch(c); window.__sim.manual(true); await window.__sim.ready; }, c); }
async function steps(count, inputs) { return page.evaluate(({ count, inputs }) => { let view; for (let i = 0; i < count; i++) view = window.__sim.step(inputs); return view; }, { count, inputs }); }
async function shot(name) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, `${name}.png`) }); }
let failure = null;
try {
  await page.goto(base, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__sim?.startMatch, null, { timeout: 300000 });
  const build = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(s => /assets\/.+\.js/.test(s)));
  checks.push({ name: 'exact build', build });
  await start(config());
  const identity = await page.evaluate(() => window.__sim.match.buildIdentity);
  assert(/^platform-fighter-sha256-[0-9a-f]{64}$/.test(identity), 'real simulation source identity', identity);
  await steps(90);
  const x0 = await page.evaluate(() => window.__sim.view().fighters[0].position.x);
  await page.keyboard.down('KeyD');
  const moved = await steps(12);
  await page.keyboard.up('KeyD');
  assert(moved.fighters[0].position.x > x0, 'DOM keyboard moves actual fighter', { x0, x1: moved.fighters[0].position.x });
  await page.keyboard.down('KeyF');
  const attacking = await steps(1);
  await page.keyboard.up('KeyF');
  assert(Boolean(attacking.fighters[0].animation.activeAttack), 'DOM keyboard starts actual attack', attacking.fighters[0].animation.activeAttack?.move?.id);
  await shot('01-live-keyboard');
  await page.keyboard.press('Escape');
  const pausedFrame = await page.evaluate(() => window.__sim.frame);
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => window.__sim.paused && window.__sim.frame) === pausedFrame, 'pause freezes actual simulation', { pausedFrame });
  await shot('02-pause');
  await page.getByRole('button', { name: /Controls.*K/ }).click();
  await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Attack$/ }) }).click();
  await page.keyboard.press('KeyK');
  await page.locator('.controls-row').filter({ has: page.locator('.label', { hasText: /^Save$/ }) }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('platformfighter.inputProfiles.v1') ?? 'null'));
  assert(saved?.profiles.some(p => p.bindings.attack.some(b => b.kind === 'keyboard' && b.keyCode === 75)), 'paused controls persist custom profile', saved?.profiles.map(p => p.id));
  await page.keyboard.press('Escape');
  await steps(90);
  await page.keyboard.down('KeyK');
  const rebound = await steps(1);
  await page.keyboard.up('KeyK');
  assert(Boolean(rebound.fighters[0].animation.activeAttack), 'saved rebind drives same running match', rebound.fighters[0].animation.activeAttack?.move?.id);
  await shot('03-rebound-match');
  await steps(90);
  const restored = await page.evaluate(() => {
    const checkpoint = window.__sim.checkpoint(), before = window.__sim.state();
    for (let i = 0; i < 10; i++) window.__sim.step();
    window.__sim.restore(checkpoint);
    return { equal: window.__sim.state() === before, frame: window.__sim.frame };
  });
  assert(restored.equal, 'browser checkpoint restores actual state', restored);
  const padConfig = config();
  padConfig.players[0] = { ...padConfig.players[0], inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: 0 }, bindingProfileId: 'gamepad-standard' };
  await start(padConfig); await steps(90);
  const padX = await page.evaluate(() => { window.__pad.axes[0] = 1; return window.__sim.view().fighters[0].position.x; });
  const padMoved = await steps(12);
  await page.evaluate(() => { window.__pad.axes[0] = 0; window.__pad.buttons[2].pressed = true; });
  const padAttack = await steps(1);
  await page.evaluate(() => { window.__pad.buttons[2].pressed = false; });
  assert(padMoved.fighters[0].position.x > padX, 'simulated gamepad moves actual fighter', { padX, x1: padMoved.fighters[0].position.x });
  assert(Boolean(padAttack.fighters[0].animation.activeAttack), 'simulated gamepad starts actual attack', padAttack.fighters[0].animation.activeAttack?.move?.id);
  const disconnected = await page.evaluate(() => {
    window.__pad.connected = false;
    const event = new Event('gamepaddisconnected');
    Object.defineProperty(event, 'gamepad', { value: window.__pad }); dispatchEvent(event);
    return { paused: window.__sim.paused, frame: window.__sim.frame };
  });
  assert(disconnected.paused, 'bound gamepad disconnect pauses actual match', disconnected);
  await page.evaluate(() => {
    window.__pad.connected = true; window.__pad.index = 2;
    const event = new Event('gamepadconnected');
    Object.defineProperty(event, 'gamepad', { value: window.__pad }); dispatchEvent(event);
  });
  const reconnected = await page.evaluate(() => window.__sim.config.players[0].inputDevice);
  assert(reconnected?.gamepadIndex === 2, 'same controller reconnect at new index updates match binding', reconnected);
  await page.keyboard.press('Escape'); await steps(90);
  const newPadX = await page.evaluate(() => { window.__pad.axes[0] = 1; return window.__sim.view().fighters[0].position.x; });
  const newPadMoved = await steps(12);
  assert(newPadMoved.fighters[0].position.x > newPadX, 'reconnected gamepad drives same live fighter', { newPadX, x1: newPadMoved.fighters[0].position.x });
  await page.evaluate(() => { window.__pad.axes[0] = 0; window.__pad.index = 0; });
  await start(config('link', 'donkeykong'));
  await steps(90);
  const neutral = { moveX: 0, moveY: 0, jump: false, attack: false, special: false };
  await steps(1, [{ ...neutral, moveY: 1, special: true }, neutral]);
  const bomb = await steps(22, [neutral, neutral]);
  assert(bomb.items.some(i => i.generatedKind === 'link-remote-bomb'), 'Remote Bomb generated by real down special', bomb.items.map(i => ({ type: i.type, generatedKind: i.generatedKind, rootPosition: i.rootPosition })));
  await shot('04-link-remote-bomb');
  await start(config('link', 'donkeykong')); await steps(90);
  await steps(1, [{ ...neutral, attackHeavy: true, attackStickX: 1 }, neutral]);
  let beam = null;
  for (let i = 0; i < 80; i++) {
    const v = await steps(1, [neutral, neutral]);
    if (v.projectiles.some(p => p.visualRecipe?.kind === 'sword-beam')) { beam = v; break; }
  }
  assert(Boolean(beam), 'Sword Beam generated by actual full-health forward smash', beam?.projectiles);
  await shot('05-link-sword-beam');
  for (const stage of ['flat', 'lava', 'wind', 'crumbling', 'moving-platform', 'inferno']) {
    const c = config('link', 'pikachu', stage);
    c.itemFrequency = 'high'; c.players = c.players.map(p => ({ ...p, inputType: 'ai', aiDifficulty: 'hard' }));
    await start(c); const v = await steps(240);
    assert(v.frame === 240 && v.fighters.length === 2, `live CPU match on ${stage}`, { frame: v.frame, damage: v.hud.players.map(p => p.damage) });
    await shot(`stage-${stage}`);
  }
  const endingConfig = { ...config('link', 'donkeykong'), mode: 'time', timeLimitSeconds: 1 };
  await start(endingConfig);
  // Scenario setup: one genuine boundary fall establishes a score leader,
  // so the timer reaches ordinary results instead of a tied Sudden Death.
  await page.evaluate(() => { const sim = window.__sim.match; sim.matter.body.setPosition(sim.playerSlots[1].character.body, { x: -2000, y: 100 }); });
  await steps(250);
  const result = await page.evaluate(() => ({ result: window.__sim.match.result, finished: window.__sim.match.isFinished }));
  assert(result.finished && result.result?.endFrame <= 60 && result.result?.winnerIndex === 0, 'real time-limit result payload after boundary fall', result);
  await page.evaluate(() => window.__sim.manual(false));
  await page.waitForFunction(() => window.__menu.screen === 'results', null, { timeout: 10000 });
  assert(!await page.getByText('Preview · sample numbers').count(), 'results show actual match stats');
  const resultArt = await page.evaluate(() => window.__menu.presentation());
  assert(resultArt.some(draw => /^char\.link\.j02win/.test(draw.key) && draw.loaded), 'actual Link winner uses loaded source result art', resultArt);
  await shot('06-real-results');
} catch (error) { failure = String(error.stack ?? error); }
await browser.close();
const report = { checks, errors, failure };
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failure || errors.length) process.exit(1);
