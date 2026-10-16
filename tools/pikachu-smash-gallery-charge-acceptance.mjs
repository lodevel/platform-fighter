/** Visible app charge poses and preview controls; inputs are preview-simulated. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.PF_SMASH_CHARGE_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/smash-gallery-charge';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.setDefaultTimeout(30000);
// Camera smoothing may continue while the physics/action clock is paused.
const simulationState = ({ camera, ...state }) => state;
const report = { scope: 'Exact application MatchScene charge bodies, release and contacts, all three smashes in both facings. Real browser button/keyboard events control preview-simulated resolver input, not hardware match bindings. Special regression checks cover starts and the first60 fixed steps. Extended Quick recovery is verified separately in integration/touchdown-thunder/gallery-observations.json; the historical end-pose failure is retained in integration/smash-gallery-charge/extended-quick-recovery-probe.json. This probe does not change character fidelity/completion.', errors: [], failedResponses: [], cases: [], specials: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) report.failedResponses.push({ url: response.url(), status: response.status() }); });
try {
  await page.goto(process.env.PF_GALLERY_URL ?? 'http://localhost:4195/pikachu-motion-preview.html');
  await page.locator('[data-page="pikachu-smash-packed-preview.html"]').click();
  await page.locator('#motion').scrollIntoViewIfNeeded();
  const frame = await (await page.locator('#motion').elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.__pikachuSmashPreview?.ready, null, { timeout: 45000 });
  const game = await (await frame.locator('#game').elementHandle()).contentFrame();
  assert.equal(await frame.locator('#release').isDisabled(), true);
  for (const action of ['forward-smash', 'up-smash', 'down-smash']) for (const facing of [1, -1]) {
    await frame.locator('#action').selectOption(action);
    await frame.evaluate(facing => window.__pikachuSmashPreview.setFacing(facing), facing);
    const ready = await frame.evaluate(() => window.__pikachuSmashPreview.state());
    assert.equal(ready.elapsed, 0);
    assert.deepEqual(ready.origin, [.5, 416 / 512]);
    assert.equal(await frame.locator('#release').isDisabled(), true);
    await frame.evaluate(() => window.__pikachuSmashPreview.beginCharge());
    const poses = [];
    const sheet = { 'forward-smash': 'smash', 'up-smash': 'usmash', 'down-smash': 'dsmash' }[action];
    for (const held of [0, 15, 30, 45]) {
      const state = await frame.evaluate(held => {
        const api = window.__pikachuSmashPreview;
        for (let i = 0; i < 90; i++) {
          const state = api.state();
          if (state.texture?.endsWith('_charge') && state.chargeHeldFrames >= held) return state;
          api.step();
        }
        throw new Error('Charge pose was not reached');
      }, held);
      assert.equal(state.charging, true);
      assert.equal(state.texture, `char.pikachu.${sheet}_charge`);
      assert.equal(state.textureFrame, held / 15);
      assert.equal(state.receiving.length, 12);
      assert.deepEqual(state.origin, [.5, .75]);
      assert.ok(state.receiving.every(box => box.id.includes(`${action}-charge`)));
      assert.equal(Number(await frame.locator('#charge-progress').getAttribute('value')), state.chargeProgress);
      if (action === 'forward-smash') {
        state.screenshot = `${action}-${facing}-charge-${held}.png`;
        await game.locator('canvas').screenshot({ path: `${output}/${state.screenshot}` });
      }
      poses.push(state);
    }
    const before = await frame.evaluate(() => window.__pikachuSmashPreview.state());
    await page.waitForTimeout(100);
    const after = await frame.evaluate(() => window.__pikachuSmashPreview.state());
    assert.deepEqual(simulationState(after), simulationState(before));
    assert.equal(await frame.locator('#release').isDisabled(), false);
    const trace = await frame.evaluate(() => {
      const api = window.__pikachuSmashPreview;
      api.release();
      const trace = [api.state()];
      for (let i = 0; i < 100; i++) { api.step(); trace.push(api.state()); }
      return trace;
    });
    assert.equal(trace[0].charging, false);
    assert.equal(trace[0].chargedReleaseFrames, before.chargeHeldFrames);
    assert.ok(trace.some(state => state.texture === `char.pikachu.${sheet}`));
    assert.ok(trace.some(state => state.damage > 0));
    report.cases.push({ action, facing, ready, poses, release: trace[0], damage: Math.max(...trace.map(state => state.damage)) });
  }
  await frame.locator('#action').selectOption('forward-smash');
  await frame.locator('#charge').click();
  await frame.waitForFunction(() => window.__pikachuSmashPreview.state().texture === 'char.pikachu.smash_charge', null, { timeout: 10000 });
  await frame.locator('#play').click();
  const paused = await frame.evaluate(() => window.__pikachuSmashPreview.state());
  assert.equal(paused.playing, false);
  assert.equal(paused.charging, true);
  await page.waitForTimeout(150);
  assert.deepEqual(simulationState(await frame.evaluate(() => window.__pikachuSmashPreview.state())), simulationState(paused));
  await frame.locator('#step').click();
  const stepped = await frame.evaluate(() => window.__pikachuSmashPreview.state());
  assert.equal(stepped.elapsed, paused.elapsed + 1);
  await frame.locator('#release').click();
  assert.equal((await frame.evaluate(() => window.__pikachuSmashPreview.state())).charging, false);
  await frame.locator('#play').click();
  report.buttons = { paused, stepped, release: await frame.evaluate(() => window.__pikachuSmashPreview.state()) };
  await frame.locator('#reset').click();
  await frame.press('body', 'c');
  assert.equal((await frame.evaluate(() => window.__pikachuSmashPreview.state())).playing, true);
  await frame.press('body', 'r');
  assert.equal((await frame.evaluate(() => window.__pikachuSmashPreview.state())).charging, false);
  await frame.locator('#reset').click();
  await frame.locator('#attack').click();
  const tap = await frame.evaluate(() => { const api = window.__pikachuSmashPreview; for (let i = 0; i < 100; i++) api.step(); return api.state(); });
  assert.ok(tap.damage > 0);
  report.uncharged = tap;
  await page.locator('[data-page="pikachu-special-preview.html?action=thunder"]').click();
  await frame.waitForFunction(() => window.__pikachuSpecialPreview?.ready, null, { timeout: 45000 });
  for (const selected of ['thunder', 'jolt', 'skull', 'quick']) {
    await page.locator(`[data-page="pikachu-special-preview.html?action=${selected}"]`).click();
    await frame.locator('#attack').click();
    const trace = await frame.evaluate(() => { const api = window.__pikachuSpecialPreview; const trace = [api.state()]; for (let i = 0; i < 60; i++) { api.step(); trace.push(api.state()); } return trace; });
    assert.equal(trace[0].special.kind, { thunder: 'thunder', jolt: 'thunderJolt', skull: 'skullBash', quick: 'quickAttack' }[selected]);
    if (selected === 'thunder') for (const kind of ['cloud', 'bolt', 'burst']) assert.ok(trace.some(state => state.objects.some(object => object.kind === kind)));
    report.specials.push({ selected, entry: trace[0], end: trace.at(-1) });
  }
  report.build = await (await page.request.get(new URL('/launch-scope.json', page.url()).href)).json();
  const bundle = await page.request.get(new URL(`/platform-fighter/assets/${report.build.gameBuild.bundle}`, page.url()).href);
  assert.equal(createHash('sha256').update(await bundle.body()).digest('hex'), report.build.gameBuild.bundleSha256);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedResponses, []);
  report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, chargeCases: report.cases.length, specials: report.specials.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
