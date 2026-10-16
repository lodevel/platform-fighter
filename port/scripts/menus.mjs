// Walk the menu flows headlessly with the keyboard and a SIMULATED gamepad
// (a fake navigator.getGamepads injected before load), screenshotting each
// screen. Usage: node scripts/menus.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [outDir = 'menus'] = process.argv.slice(2);
const BASE = process.env.PORT_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const log = [];
const errors = [];

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const pad = { id: 'simulated pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
  });
  await page.goto(BASE, { waitUntil: 'commit', timeout: 300000 });
  await page.waitForFunction(() => window.__menu, null, { timeout: 300000 });
  return page;
}
const screen = (page) => page.evaluate(() => window.__menu.screen);
async function shot(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  log.push({ shot: name, screen: await screen(page) });
}
async function key(page, k, times = 1) { for (let i = 0; i < times; i++) { await page.keyboard.press(k); await page.waitForTimeout(60); } }
async function pad(page, button) {
  await page.evaluate((b) => { window.__pad.buttons[b].pressed = true; }, button);
  // Held across several frames: headless SwiftShader frames can take ~100 ms.
  await page.waitForTimeout(300);
  await page.evaluate((b) => { window.__pad.buttons[b].pressed = false; }, button);
  await page.waitForTimeout(300);
}
const expect = async (page, name) => {
  const s = await screen(page);
  if (s !== name) throw new Error(`expected screen ${name}, got ${s}`);
};

// ---- desktop journey ----
const page = await open({ width: 1920, height: 1080 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'commit' });
await page.waitForFunction(() => window.__menu);
await expect(page, 'gate');
await shot(page, '01-gate');
await page.keyboard.type('wrong');
await key(page, 'Enter');
await shot(page, '02-gate-wrong');
await page.keyboard.type('changeme');
await key(page, 'Enter');
await expect(page, 'title');
await shot(page, '03-title');
await key(page, 'Space');
await expect(page, 'rules');
await key(page, 'ArrowDown'); await key(page, 'ArrowLeft', 2); // three stocks -> one
await key(page, 'ArrowDown'); await key(page, 'ArrowRight'); // items high
await key(page, 'ArrowDown'); await key(page, 'ArrowRight'); // meter on
await key(page, 'ArrowDown'); await key(page, 'ArrowRight', 2); await key(page, 'Space'); // switch off item 3
await shot(page, '05-rules');
await key(page, 'Enter');
await expect(page, 'fighters');
await shot(page, '06-fighters-empty');
await key(page, 'Space'); // keyboard joins P1, hand on first portrait
await key(page, 'Space'); // pick first fighter
await key(page, 'KeyC'); // add a CPU
await pad(page, 0); // simulated pad joins
await pad(page, 15); // d-pad right: next portrait
await pad(page, 0); // pick
await shot(page, '07-fighters-picked');
await page.locator('.swatches').first().locator('.swatch').nth(4).click({ force: true }); // P1 picks costume 4 (the hand cursor overlays it)
await page.waitForTimeout(600);
await shot(page, '07b-fighters-costume');
await key(page, 'Enter');
await expect(page, 'stages');
await shot(page, '08-stages-flat');
await key(page, 'ArrowDown');
await shot(page, '09-stages-lava');
await key(page, 'Space');
await expect(page, 'match');
log.push({ build: await page.evaluate(() => ({ scripts: [...document.scripts].map(script => script.src).filter(src => /assets\/game-/.test(src)), identity: window.__sim.match.buildIdentity })) });
await shot(page, '10-match');
await key(page, 'Enter');
await shot(page, '11-pause');
await key(page, 'Escape');
// Complete this exact UI-launched one-stock match; keep its saved hand/roster.
const completedMatch = await page.evaluate(async () => {
  window.__sim.manual(true);
  await window.__sim.ready;
  const match = window.__sim.match;
  while (match.getSourceIntroSnapshot()) window.__sim.step();
  // This journey has three joined players. Give every opponent one real
  // boundary fall so the actual one-stock rule produces a unique winner.
  for (const slot of match.playerSlots.slice(1))
    match.matter.body.setPosition(slot.character.body, { x: -2000, y: 100 });
  for (let i = 0; i < 1000 && !match.isFinished; i++) window.__sim.step();
  const completed = { config: window.__sim.config, result: match.result, identity: match.buildIdentity };
  window.__sim.manual(false);
  return completed;
});
log.push({ completedMatch });
await page.waitForFunction(() => window.__menu.screen === 'results', null, { timeout: 30000 });
await expect(page, 'results');
await shot(page, '12-results');
await key(page, 'ArrowRight');
await key(page, 'Space');
await expect(page, 'fighters');
await key(page, 'Escape'); // keyboard leaves its slot
await key(page, 'Escape'); // pad? no: keyboard now unassigned -> back to rules
await expect(page, 'rules');
await key(page, 'Escape');
await expect(page, 'title');
log.push({ journey: 'gate→title→rules→fighters→stages→match→pause→results→fighters→rules→title ok' });

// ---- controls: rebind Attack on the WASD keyboard profile and save a copy ----
await key(page, 'ArrowRight');
await key(page, 'Space');
await expect(page, 'controls');
await shot(page, '16-controls');
await key(page, 'Space'); // edit "Keyboard · WASD side"
await page.waitForTimeout(300);
const attackRow = await page.evaluate(() => [...document.querySelectorAll('.controls-row .label')].findIndex((n) => n.textContent === 'Attack'));
await key(page, 'ArrowDown', attackRow);
await key(page, 'Enter'); // start capturing
await page.waitForTimeout(200);
await shot(page, '17-controls-capturing');
await key(page, 'KeyK');
await page.waitForTimeout(200);
const saveRow = await page.evaluate(() => [...document.querySelectorAll('.controls-row .label')].findIndex((n) => n.textContent === 'Save'));
await key(page, 'ArrowDown', saveRow - attackRow);
await shot(page, '18-controls-rebound');
await key(page, 'Enter'); // save (a built-in profile is saved as a new copy)
await page.waitForTimeout(300);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('platformfighter.inputProfiles.v1') ?? 'null'));
const custom = stored?.profiles?.find((p) => p.id.startsWith('custom-'));
log.push({ controlsSaved: Boolean(custom), customProfile: custom ? { id: custom.id, name: custom.name, attack: custom.bindings.attack } : null,
  status: await page.evaluate(() => document.querySelector('.screen > div > .status')?.textContent) });
await key(page, 'Escape');
await expect(page, 'title');
// The saved profile is offered on a player's card in character select.
await key(page, 'Space'); await key(page, 'Enter'); // title focus starts on Versus
await expect(page, 'fighters');
await key(page, 'Space');
const chip = await page.evaluate(() => [...document.querySelectorAll('.card .mode-btn')].find((b) => !b.hidden && b.title === 'Controls profile')?.textContent);
await page.mouse.click(...(await page.evaluate(() => { const b = [...document.querySelectorAll('.card .mode-btn')].find((x) => !x.hidden && x.title === 'Controls profile'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })));
const chipAfter = await page.evaluate(() => [...document.querySelectorAll('.card .mode-btn')].find((b) => !b.hidden && b.title === 'Controls profile')?.textContent);
await shot(page, '19-fighters-profile');
log.push({ profileChip: chip, profileChipAfterClick: chipAfter });

// ---- phone width ----
const phone = await open({ width: 390, height: 844 });
await phone.evaluate(() => window.__menu.go('title'));
await shot(phone, '13-phone-title');
await phone.evaluate(() => window.__menu.go('rules'));
await shot(phone, '14-phone-rules');
await phone.evaluate(() => window.__menu.go('fighters'));
await shot(phone, '15-phone-fighters');
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
log.push({ phoneHorizontalOverflow: overflow });

await browser.close();
const report = { log, errors };
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
