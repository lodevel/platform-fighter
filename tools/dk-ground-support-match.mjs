/** Real DK knockdown/ground-support qualification. Run under .tmp/dk-heavy.lock. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';

const value = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const baseline = process.argv.includes('--baseline');
const out = value('out', `docs/review/2026-10-16/donkeykong-ground-support/runtime-${baseline ? 'before' : 'after'}`);
const url = value('url', 'http://127.0.0.1:4173/platform-fighter/');
const review = JSON.parse(await readFile('docs/review/2026-10-16/donkeykong-ground-support/support-registration.json', 'utf8'));
const installed = JSON.parse(await readFile('assets/characters/donkeykong/frames.json', 'utf8')).animations.down_wait_face_down;
const clip = baseline ? review.originalClip : installed;
await mkdir(out, { recursive: true });
const report = { url, baseline, input: 'Injected launch/placement from the existing DK knockdown physics regression; real saved keyboard getup input; actual MatchSim and MatchView', rows: [], errors: [], result: 'RUNNING' };
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9243, bridgePort: 9244 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint) : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', e => report.errors.push(e.message));
try {
  report.script = await openMatchHost(page, url);
  report.scriptSha256 = createHash('sha256').update(await (await context.request.get(report.script)).body()).digest('hex');
  for (const facing of [1, -1]) {
    await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161026, itemFrequency: 'off', linkIntroPolicy: 'none',
      finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false }, players: [
        { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2' }] });
    const setup = await page.evaluate(({ facing, review, clip }) => {
      const sim = window.__sim.match;
      for (let n = 0; n < 180; n++) window.__sim.step();
      const floor = sim.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
      sim.p1.resetForRound(floor.position.x, floor.bounds.min.y - sim.p1.getTuning().height / 2); sim.p1.setFacing(facing);
      sim.p2.resetForRound(floor.position.x - facing * 450, floor.bounds.min.y - sim.p2.getTuning().height / 2);
      for (let n = 0; n < 8; n++) window.__sim.step();
      sim.p1.applyHit({ damage: 18.9, knockback: { x: 12, y: -10, scaling: 0 }, facing, minHitstunFrames: 45, hitlagMultiplier: 0 });
      window.__dkSupportSample = () => {
        window.__sim.draw();
        const actor = sim.p1, pose = window.__sim.presentation(0), support = actor.getSourceSupportPresentationObservation();
        let contact = null;
        if (pose?.key === 'char.donkeykong.down_wait_face_down') {
          const row = review.rows[pose.frame], trim = clip.trims[pose.frame], pixel = row.atlasContactPixel;
          const x = pixel[0] - trim[0] + trim[4] + .5, y = pixel[1] - trim[1] + trim[5] + .5;
          contact = { x: pose.x + (x - clip.root[0]) * pose.scaleX * (pose.flipX ? -1 : 1),
            y: pose.y + (y - pose.originY * pose.frameHeight) * pose.scaleY };
        }
        return { frame: sim.physicsEngine.getFrame(), position: actor.getPosition(), velocity: actor.getVelocity(),
          grounded: actor.isGrounded(), knockedDown: actor.isKnockedDown(), sourceRoot: actor.getSourceRootPosition(),
          reaction: actor.getReactionPresentationState(), support, contact, gap: contact && support ? support.floorY - contact.y : null,
          pose, fault: window.__sim.fault };
      };
      const slot = sim.playerSlots[0].bindingsSlot;
      const jump = window.__sim.inputResolver.dispatcher.bindings.get(slot).bindings.jump.find(b => b.kind === 'keyboard');
      return { jump, floor: { left: floor.bounds.min.x, right: floor.bounds.max.x, y: floor.bounds.min.y } };
    }, { facing, review, clip });
    const row = { facing, setup, trace: [], screenshots: [], frames: [] };
    report.rows.push(row);
    let proneStart = null, airborne = false;
    const seen = new Set();
    for (let tick = 0; tick < 300; tick++) {
      const sample = await page.evaluate(() => { window.__sim.step(); return window.__dkSupportSample(); });
      row.trace.push(sample);
      assert.equal(sample.fault, null);
      airborne ||= !sample.grounded;
      if (sample.contact) {
        assert.ok(sample.support && sample.grounded && sample.knockedDown);
        assert.ok(sample.pose.visible && sample.pose.submitted && sample.pose.textureResident);
        assert.ok(sample.contact.x >= sample.support.left && sample.contact.x <= sample.support.right);
        assert.equal(sample.pose.frameHeight, clip.frameHeight);
        if (proneStart === null) proneStart = tick;
        seen.add(sample.pose.frame);
      }
      const shot = tick === 5 ? 'launch' : sample.contact && !row.screenshots.some(s => s.kind === 'prone') ? 'prone'
        : sample.contact && sample.pose.frame === 5 && !row.screenshots.some(s => s.kind === 'prone-middle') ? 'prone-middle' : null;
      if (shot) {
        await page.evaluate(() => window.__sim.draw());
        const path = `${out}/facing-${facing}-${shot}.png`;
        await page.screenshot({ path }); row.screenshots.push({ kind: shot, path, frame: sample.frame });
      }
      if (proneStart !== null && tick - proneStart >= 85) break;
    }
    assert.ok(airborne && proneStart !== null, 'actual launch and face-down landing observed');
    row.frames = [...seen];
    assert.ok(row.frames.length >= 9, 'whole reachable prone loop sampled');
    row.maxGap = Math.max(...row.trace.filter(s => s.contact).map(s => Math.abs(s.gap)));
    if (baseline) assert.ok(row.maxGap > 30, 'old tie registration reproduces visible hover');
    else assert.ok(row.maxGap <= review.worldTolerance, 'actual anatomical contact lies on finite floor');
    const keyCode = setup.jump.keyCode ?? setup.jump.code;
    await page.keyboard.down(String.fromCharCode(keyCode));
    row.getup = await page.evaluate(() => { window.__sim.step(); return window.__dkSupportSample(); });
    await page.keyboard.up(String.fromCharCode(keyCode));
    for (let n = 0; n < 50; n++) row.getupEnd = await page.evaluate(() => { window.__sim.step(); return window.__dkSupportSample(); });
    assert.equal(row.getupEnd.knockedDown, false);
    await page.evaluate(() => window.__sim.draw());
    await page.screenshot({ path: `${out}/facing-${facing}-getup-end.png` });
    row.authoritySha256 = createHash('sha256').update(JSON.stringify(row.trace.map(({ pose, contact, gap, ...physics }) => physics))).digest('hex');
    console.log(JSON.stringify({ facing, frames: row.frames, maxGap: row.maxGap, authoritySha256: row.authoritySha256 }));
  }
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await context.close(); await browser.close();
  if (edge) await writeFile(`${out}/cleanup.json`, JSON.stringify(await edge.close(), null, 2) + '\n');
}
