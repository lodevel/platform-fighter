import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const out = process.env.PF_PROBE_OUT ?? 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/dashboard';
await mkdir(out, { recursive: true });
const report = { errors: [], failedResponses: [], controls: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) report.failedResponses.push(response.url()); });
try {
  await page.goto('http://localhost:4196/dk-motion-preview.html');
  await page.waitForFunction(() => document.querySelector('#viewer-status').textContent.includes('paused'), null, { timeout: 90000 });
  report.progress = await (await page.request.get('http://localhost:4196/dk-progress.json')).json();
  assert.equal(report.progress.total, report.progress.actions.length);
  const frame = page.frames().find(frame => frame.url().includes('/platform-fighter/'));
  const bundle = await frame.evaluate(() => [...document.scripts].find(script => /assets\/index-/.test(script.src))?.src);
  report.bundle = bundle;
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(bundle)).body()).digest('hex');
  if(process.env.PF_EXPECT_BUNDLE_SHA)assert.equal(report.bundleSha256,process.env.PF_EXPECT_BUNDLE_SHA);
  const cases = [
    { name: 'Jab 1', active: 'donkeykong.jab' },
    { name: 'Jab 2', active: 'donkeykong.jab2' },
    { name: 'Forward tilt up', active: 'donkeykong.tilt' },
    { name: 'Giant Punch · ground · full', active: 'donkeykong.neutral_special' },
    { name: 'Standing grab', grab: 'whiffStartup' },
    { name: 'Dash grab', grab: 'whiffStartup' },
    { name: 'Pivot grab', grab: 'whiffStartup' },
    { name: 'Pummel', grab: 'holding', pummel: true },
    { name: 'Normal back throw', grab: 'throwing', direction: 'back', cargo: false },
    { name: 'Cargo up throw', grab: 'throwing', direction: 'up', cargo: true },
    {name:'Heavy crate pickup',heavyAction:'pickup'},
    {name:'Heavy crate walk',heavyCarry:'walk'},
    {name:'Heavy crate jump',heavyCarry:'jump-squat'},
    ...[false,true].flatMap(air=>['forward','back','up','down'].flatMap(direction=>[false,true].map(strong=>({
      name:`Heavy ${direction} throw · ${air?'air':'ground'} · ${strong?'strong':'ordinary'}`,
      heavyAction:`throw-${direction}-${strong?'strong':'ordinary'}`
    })))),
  ];
  for (const expected of cases) {
    const { name } = expected;
    const option = await page.locator('#move option').filter({ hasText: name }).evaluateAll((options, name) => options.find(option => option.textContent === name)?.value, name);
    assert.ok(option !== undefined, name);
    await page.selectOption('#move', option);
    await page.click('#start');
    const before = JSON.parse(await page.locator('#action-state').textContent());
    await page.click('#step');
    const after = JSON.parse(await page.locator('#action-state').textContent());
    assert.equal(after.frame, before.frame + 1, name);
    if (expected.active) assert.equal(before.active, expected.active, name);
    if(expected.heavyAction)assert.equal(before.heavyAction?.plan.action,expected.heavyAction,name);
    if(expected.heavyCarry){assert.equal(before.heavyCarry?.phase,expected.heavyCarry,name);assert.equal(before.heldItem,'crate',name);}
    if (expected.grab) assert.equal(before.grab.name, expected.grab, name);
    if (expected.pummel) assert.ok(before.grab.active?.pummelCooldownRemaining > 0, name);
    if (expected.direction) {
      assert.equal(before.grab.active?.throwDirection, expected.direction, name);
      assert.equal(before.grab.active?.cargo, expected.cargo, name);
    }
    report.controls.push({ name, expected, before, after });
  }
  await page.click('#face');
  assert.equal(JSON.parse(await page.locator('#action-state').textContent()).facing, -1);
  await page.click('#overlay');
  assert.equal(await frame.evaluate(() => window.__game.scene.getScene('MatchScene').hitboxDebugLayer.isEnabled()), true);
  await page.click('#reset');
  report.grabPilotSamples = [];
  await page.selectOption('#grab-target', 'out');
  for (const face of [1, -1]) {
    const currentFace = JSON.parse(await page.locator('#action-state').textContent()).facing;
    if (currentFace !== face) await page.click('#face');
    for (const pilot of [
      { name: 'Standing grab', age: 7, nativeSample: 8, sheet: 'review_pilot_standing_grab_contact' },
      { name: 'Dash grab', age: 10, nativeSample: 11, sheet: 'review_pilot_dash_grab_contact' },
      { name: 'Pivot grab', age: 11, nativeSample: 12, sheet: 'review_pilot_pivot_grab_contact' },
    ]) {
      const option = await page.locator('#move option').evaluateAll((options, name) => options.find(o => o.textContent === name)?.value, pilot.name);
      await page.selectOption('#move', option);
      await page.click('#start');
      for (let n = 0; n < pilot.age; n++) await page.click('#step');
      const sample = await frame.evaluate(() => {
        const s = window.__game.scene.getScene('MatchScene'), a = s.p1, sp = s.playerSlots[0].sprite;
        return { presentation: a.getGrabPresentationState(), diagnostic: a.getDonkeyKongCatchCollisionDiagnostic(),
          grab: a.getGrabState(), receiving: a.getActiveHurtboxes(), targetCaptured: s.p2.isGrabbed(),
          sprite: { key: sp.texture.key, frame: Number(sp.frame.name), flipX: sp.flipX } };
      });
      assert.equal(sample.presentation.framesElapsed, pilot.age);
      assert.equal(sample.diagnostic.nativeSample, pilot.nativeSample);
      assert.equal(sample.diagnostic.reason, null);
      assert.equal(sample.sprite.key, `char.donkeykong.${pilot.sheet}`);
      assert.equal(sample.sprite.frame, 0);
      assert.equal(sample.targetCaptured, false);
      assert.ok(sample.receiving.length > 30);
      const screenshot = `preview-${pilot.sheet}-${face}.png`;
      await page.screenshot({ path: `${out}/${screenshot}`, fullPage: true });
      report.grabPilotSamples.push({ pilot, viewerFacing: face, sample, screenshot });
    }
    // Pivot input turns the actor. Reset returns to the selected viewer face.
    await page.click('#reset');
  }
  await page.selectOption('#grab-target', 'in');
  const standingOption = await page.locator('#move option').evaluateAll(options => options.find(o => o.textContent === 'Standing grab')?.value);
  await page.selectOption('#move', standingOption);
  await page.click('#start');
  for (let n = 0; n < 8; n++) await page.click('#step');
  report.inReachCapture = await frame.evaluate(() => window.__game.scene.getScene('MatchScene').p2.isGrabbed());
  assert.equal(report.inReachCapture, true);
  await page.selectOption('#grab-target', 'out');
  await page.click('#reset');
  await page.selectOption('#move', '0');
  await page.click('#start');
  await page.click('#step');
  await page.screenshot({ path: out + '/dashboard.png', fullPage: true });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedResponses, []);
  report.result = 'PASS_PREVIEW_CONTROLS';
  report.scope = 'Actual review-page controls and live evidence against the recorded bundle SHA. Preview fixtures do not establish physical keyboard control or complete action-row qualification.';
} finally {
  await writeFile(out + '/observations.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ result: report.result, controls: report.controls.length, errors: report.errors }));
