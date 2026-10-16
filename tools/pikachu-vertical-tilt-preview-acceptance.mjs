import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed=process.argv.includes('--packed');
const build = JSON.parse(readFileSync(path.join(base, packed?'vertical-tilt-packed-preview-build.json':'vertical-tilt-preview-build.json')));
const candidates = JSON.parse(readFileSync(path.join(base, 'vertical-tilts/hurtbox-preparation/candidates.json'))).rows;
const upContacts = JSON.parse(readFileSync(path.join(base, 'sources/posed-resources/up-tilt-contact-candidates.json'))).frames;
const out = path.join(base, packed?'vertical-tilts/packed-browser':'vertical-tilts/browser'); mkdirSync(out, { recursive: true });
const report = { scope: 'Isolated grounded rough vertical tilts, authored2D geometry and shared40x50body; direct and shared Wolf saved-move factory fixtures; no full Pikachu Lab/match/native qualification',
  url: `http://127.0.0.1:${build.previewPort??4188}/${packed?'pikachu-vertical-tilt-packed-preview.html':'pikachu-vertical-tilt-preview.html'}`, build: build.buildIdentity,
  input: 'Simulated browser U/D/F/N keyboard and pointer controls. U/D establish held vertical direction for one fixed step before Character light attack; shared Wolf smash slots remain present in saved fixture.', cases: [], freeze: [], incoming: [], errors: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
const state = () => page.evaluate(() => window.__pikachuVerticalTiltPreview.state());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-8;
function ready(s, facing) {
  assert(s.elapsed === null && s.pose === 'neutral' && s.texture === (packed?'pikachu-packed-idle':'pikachu-neutral'), 'Neutral/return drawing wrong');
  assert(s.regions.length === 0 && s.flipped === (facing === -1) && s.grounded, 'Grounded/clear/mirror ready state wrong');
  assert(s.spriteScale === 70 / 600*(packed?4:1) && s.spriteOrigin.x === .5 && s.spriteOrigin.y === (packed?.75:880/1024), 'Neutral registration wrong');
  assert(s.hurtboxes.length === 1 && !s.hurtboxes[0].capsule, 'Reset/end retained posed vulnerability');
  assert(Math.abs(s.root.y - s.floorTop) < .25, `Shared movement body root ${s.root.y} differs from floor ${s.floorTop}`);
}
function check(s, action) {
  const e = s.elapsed, total = action === 'up-tilt' ? 26 : 18;
  assert(Number.isInteger(e) && e >= 0 && e < total && s.moveId === `pikachu.${action}`, 'Wrong action route/clock');
  const row = build.poseSchedule[action].find(row => e >= row.startElapsed && e < row.endElapsed);
  assert(row && s.pose === row.pose && s.sourceIndex === row.sourceIndex && s.file === row.file, 'Drawing clock disagrees with reviewed mapping');
  assert(s.texture === (packed?(action==='up-tilt'?'pikachu-packed-utilt':'pikachu-packed-dtilt'):`pikachu-${action}.${row.pose}`) && s.spriteScale === 70 / 600*(packed?4:1) && s.spriteOrigin.x === .5 && s.spriteOrigin.y === 1152 / 1536, 'Drawing root/scale wrong');
  if(packed)assert(s.packedArt&&s.presentationAlias==='donkeykong'&&s.driver?.key===(action==='up-tilt'?'donkeykong.utilt.anim':'donkeykong.dtilt.anim')&&s.driver.frameIndex===build.poseSchedule[action].indexOf(row)&&Number(s.spriteFrame)===s.driver.frameIndex,'Shared Match driver vertical-tilt frame mismatch');
  const expected = candidates.find(candidate => candidate.action === action && candidate.pose === row.pose);
  assert(same(s.hurtboxes, expected.hurtboxes), 'Receiving geometry did not follow drawing clock');
  const active = e >= 6 && e < (action === 'up-tilt' ? 13 : 8);
  assert(s.regions.length === (active ? action === 'up-tilt' ? 3 : 1 : 0), `Wrong contact/clear count at ${action}/${e}`);
  if (active && action === 'up-tilt') {
    const frame = upContacts.find(frame => frame.gameFrame === e + 1);
    for (const region of frame.regions) {
      const hit = s.regions.find(hit => hit.id === region.id);
      assert(hit && hit.damage === 5 && near(hit.capsule.radius, region.radius)
        && same(hit.capsule.start, region.start) && same(hit.capsule.end, region.end), 'Up-tail projection/source damage changed');
      assert(hit.knockback.reference.angle === (region.id === 2 ? 110 : 105) && hit.knockback.reference.base === (region.id === 0 ? 40 : 45)
        && hit.knockback.reference.growth === 120, 'Up-tail source launch changed');
    }
  }
  if (active && action === 'down-tilt') {
    const hit = s.regions[0];
    assert(hit.id === 0 && hit.damage === 6 && hit.capsule.radius === 16
      && same(hit.capsule.start, { x: 25, y: 2.5 }) && same(hit.capsule.end, { x: 55, y: 12.5 }), 'Down-tail source capsule changed');
  }
}
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pikachuVerticalTiltPreview?.ready);
  const bundle = (await page.content()).match(/src="([^\"]*\/assets\/pikachu-vertical-tilt-(?:packed-)?preview-[^\"]+\.js)"/)?.[1];
  assert(bundle, 'Missing exact bundle'); report.bundle = bundle;
  report.bundleSha256 = sha(new Uint8Array(await (await fetch(new URL(bundle, report.url))).arrayBuffer()));
  assert(report.bundleSha256 === build.files[bundle.replace(/^\//, '')], 'Served bundle differs from reviewed build');
  report.servedArt = {};
  for (const [file, expected] of Object.entries(build.files).filter(([file]) => file.endsWith('.png'))) {
    const response = await fetch(new URL(file, report.url)); assert(response.ok, 'Missing served art');
    const actual = sha(new Uint8Array(await response.arrayBuffer())); assert(actual === expected, 'Changed served art'); report.servedArt[file] = actual;
  }
  assert(Object.keys(report.servedArt).length === (build.servedPngCount??19) && Object.keys(build.art).length === 19, 'Missing one of19reviewed drawings');
  for (const saved of [false, true]) for (const action of ['up-tilt', 'down-tilt']) for (const facing of [1, -1])
    for (const automatic of [false, true]) for (const probe of ['near', 'late', 'edge', 'miss']) {
      await page.evaluate(({ saved, action, facing, automatic, probe }) => {
        const p = window.__pikachuVerticalTiltPreview; p.setSaved(saved); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(automatic); p.setProbe(probe);
      }, { saved, action, facing, automatic, probe });
      ready(await state(), facing); await page.keyboard.press(action === 'up-tilt' ? 'u' : 'd');
      assert((await state()).elapsed === 0, 'Keyboard did not enter tilt at elapsed0');
      const timeline = [], captured = new Set();
      for (let physical = 0; physical < 120; physical++) {
        const s = await state(); if (s.elapsed === null) break; check(s, action); timeline.push(s);
        if (!saved && !automatic && probe === 'miss' && !captured.has(s.pose)) {
          await page.screenshot({ clip: await page.locator('#game').boundingBox(), path: path.join(out, `${action}-${s.pose}-${facing === 1 ? 'right' : 'left'}.png`) }); captured.add(s.pose);
        }
        await page.keyboard.press('n');
      }
      const s = await state(); ready(s, facing);
      assert(s.contacts.length === (probe === 'miss' ? 0 : 1), `Wrong strike dedup/hit/miss ${saved}/${action}/${facing}/${automatic}/${probe}`);
      assert(s.contacts.every(hit => hit.damage === (action === 'up-tilt' ? 5 : 6)), 'Changed sourced damage');
      if (probe === 'near') assert(s.contacts[0].elapsed === 6, 'Near target missed first source active frame');
      if (probe === 'late') assert(s.contacts[0].elapsed === (action === 'up-tilt' ? 12 : 7), 'Late target hit outside chosen last active frame');
      if (!automatic) assert(timeline.length === (action === 'up-tilt' ? 26 : 18), 'Action duration changed');
      if (automatic && probe !== 'miss') assert(timeline.some((s, i) => i > 0 && s.elapsed === timeline[i - 1].elapsed && s.hitlag > 0), 'Contact did not freeze clock');
      console.log(JSON.stringify({ action, saved, facing, automatic, probe, contacts: s.contacts, physicalSteps: timeline.length }));
      report.cases.push({ saved, action, facing, automaticHitlag: automatic, probe, passed: true, contacts: s.contacts, damage: s.damage, physicalSteps: timeline.length, timeline });
    }
  for (const action of ['up-tilt', 'down-tilt']) for (const facing of [1, -1]) {
    await page.evaluate(({ action, facing }) => { const p = window.__pikachuVerticalTiltPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { action, facing });
    await page.keyboard.press('f'); for (let i = 0; i < 6; i++) await page.keyboard.press('n'); const before = await state();
    await page.click('#freeze');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('n'); const s = await state(); assert(s.elapsed === before.elapsed && s.pose === before.pose && same(s.regions, before.regions) && same(s.hurtboxes, before.hurtboxes), 'Manual freeze changed attack geometry/drawing'); }
    await page.keyboard.press('n'); assert((await state()).elapsed === 7, 'Clock did not resume'); report.freeze.push({ action, facing, passed: true });
  }
  for (const facing of [1, -1]) for (const row of candidates) {
    await page.evaluate(({ facing, action }) => { const p = window.__pikachuVerticalTiltPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { facing, action: row.action });
    await page.keyboard.press('f'); for (let i = 0; i < row.startElapsed; i++) await page.keyboard.press('n'); check(await state(), row.action);
    for (const hurtbox of row.hurtboxes) {
      const c = hurtbox.capsule, x = (c.start.x + c.end.x) / 2, y = (c.start.y + c.end.y) / 2;
      const result = await page.evaluate(({ x, y }) => window.__pikachuVerticalTiltPreview.probeHurtbox(x, y), { x, y });
      assert(result.confirmed && result.state.elapsed === row.startElapsed, 'Incoming centre probe missed/advanced clock');
      report.incoming.push({ action: row.action, pose: row.pose, facing, hurtbox: hurtbox.id, confirmed: true });
    }
    const maxX = Math.max(...row.hurtboxes.flatMap(box => [box.capsule.start.x + box.capsule.radius, box.capsule.end.x + box.capsule.radius]));
    const result = await page.evaluate(x => window.__pikachuVerticalTiltPreview.probeHurtbox(x, 0), maxX + 2);
    assert(!result.confirmed, 'Outside-envelope probe hit'); report.incoming.push({ action: row.action, pose: row.pose, facing, confirmed: false });
  }
  await page.evaluate(() => { const p = window.__pikachuVerticalTiltPreview; p.setAction('up-tilt'); p.setProbe('miss'); });
  await page.click('#attack'); await page.click('#play'); await page.waitForTimeout(100); await page.click('#play');
  const paused = await state(); await page.waitForTimeout(100); assert(paused.elapsed > 0 && same(paused, await state()), 'Pause did not preserve state'); report.pause = { passed: true, elapsed: paused.elapsed };
  const saved = await page.evaluate(() => window.__pikachuVerticalTiltPreview.savedFile);
  writeFileSync(path.join(out, 'shared-wolf-fixture-saved-moves.json'), JSON.stringify(JSON.parse(saved), null, 2) + '\n');
  assert(report.errors.length === 0, 'Browser errors'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, freeze: report.freeze.length, incoming: report.incoming.length, servedArt: Object.keys(report.servedArt ?? {}).length, errors: report.errors }));
