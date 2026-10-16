import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const target = process.argv[2] ?? 'donkeykong';
assert.ok(['donkeykong', 'pikachu'].includes(target));
const output = process.env.PF_PROBE_OUT ?? `docs/review/2026-10-06/dk-balance/keyboard/${target}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const report = { target, errors: [], checks: [], bundle: null };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4176/platform-fighter/');
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /index-.*\.js/.test(s)));
  await page.evaluate(target => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: {
      mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1006, itemFrequency: 'off',
      players: [
        { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: target, paletteIndex: 1, inputType: 'keyboard_p2' },
      ],
    } });
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause();
    const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const contacts = [];
    const apply = s.p2.applyHitDetailed.bind(s.p2);
    s.p2.applyHitDetailed = hit => { const result = apply(hit); contacts.push({ hit, result }); return result; };
    window.__balanceInput = {
      step(count) {
        const states = [];
        for (let i = 0; i < count; i++) {
          s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();
          states.push({ move: s.p1.getActiveAttack()?.move.id ?? null, storedCharge: s.p1.storedSpecialCharge,
            charging: s.p1.chargingSpecial, held: s.inputResolver.isActionHeld(1, 'special') });
        }
        return JSON.parse(JSON.stringify(states));
      },
      place() {
        s.p1.resetForRound(floor.position.x - 70, floor.bounds.min.y - s.p1.getTuning().height / 2);
        s.p2.resetForRound(floor.position.x + (target === 'pikachu' ? 40 : 70),
          floor.bounds.min.y - s.p2.getTuning().height / 2);
        s.p1.setFacing(1); s.p2.setFacing(-1); s.p2.setDamagePercent(150);
      },
      contacts: () => JSON.parse(JSON.stringify(contacts)),
    };
    window.__balanceInput.step(120); window.__balanceInput.place(); window.__balanceInput.step(2);
  }, target);
  const step = count => page.evaluate(count => window.__balanceInput.step(count), count);
  await page.focus('canvas');
  await page.keyboard.down('f');
  report.jab = await step(2);
  await page.keyboard.up('f');
  assert.ok(report.jab.some(s => s.move === 'donkeykong.jab'));
  report.checks.push('Real F keyboard event starts jab');
  await step(40);
  await page.evaluate(() => window.__balanceInput.place());
  await step(2);
  await page.keyboard.down('g');
  await page.waitForTimeout(40);
  report.charge = await step(120);
  assert.ok(report.charge.some(s => s.charging?.framesHeld === 111));
  report.checks.push('Real held G keyboard event reaches full charge');
  await page.keyboard.up('g');
  await step(100);
  report.contacts = await page.evaluate(() => window.__balanceInput.contacts());
  const punch = report.contacts.find(c => c.hit.knockback.reference?.base === 35);
  assert.ok(punch, 'Full punch must contact through the normal keyboard route');
  assert.equal(punch.hit.knockback.reference.growth, 73);
  report.checks.push('Releasing G fires full punch with sourced BKB35/KBG73');
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: `${output}/after-keyboard-punch.png` });
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ checks: report.checks, errors: report.errors, failure: report.failure }));
  await browser.close();
}
