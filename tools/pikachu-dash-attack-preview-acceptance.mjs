import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed=process.argv.includes('--packed');
const build = JSON.parse(readFileSync(path.join(base, packed?'dash-attack-packed-preview-build.json':'dash-attack-preview-build.json')));
const candidates = JSON.parse(readFileSync(path.join(base, 'dash-attack/hurtbox-preparation/candidates.json'))).rows;
const contacts = JSON.parse(readFileSync(path.join(base,'sources/posed-resources/dash-attack-contact-candidates.json')));

const out = path.join(base, packed?'dash-attack/packed-browser':'dash-attack/browser'); mkdirSync(out, { recursive: true });
const report = { scope: 'Isolated grounded rough thirteen-pose dash attack, authored2D geometry and shared40x50body; direct and shared Wolf saved-move factory fixtures; no full Pikachu Lab/match/native qualification',
  url: `http://127.0.0.1:${build.previewPort??(packed?4204:4205)}/${packed?'pikachu-dash-attack-packed-preview.html':'pikachu-dash-attack-preview.html'}`, build: build.buildIdentity,
  input: 'Simulated browser F/N keyboard and pointer controls. Light press through shared Character running-speed discriminator; saved Wolf dashAttack slot preserves source-derived move. Source Pikachu kinetic travel remains unqualified.', cases: [], freeze: [], incoming: [], errors: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
const state = () => page.evaluate(() => window.__pikachuDashAttackPreview.state());
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
  const e = s.elapsed, total = 35;
  assert(Number.isInteger(e) && e >= 0 && e < total && s.moveId === `pikachu.${action}`, 'Wrong action route/clock');
  const row = build.poseSchedule[action].find(row => e >= row.startElapsed && e < row.endElapsed);
  assert(row && s.pose === row.pose && s.sourceIndex === row.sourceIndex && s.file === row.file, 'Drawing clock disagrees with reviewed mapping');
  assert(s.texture === (packed?'pikachu-packed-dash-attack':`pikachu-${action}.${row.pose}`) && s.spriteScale === 70 / 600*(packed?4:1) && s.spriteOrigin.x === .5 && s.spriteOrigin.y === 1152 / 1536, 'Drawing root/scale wrong');
  const expected = candidates.find(candidate => candidate.action === action && candidate.pose === row.pose);
  assert(same(s.hurtboxes, expected.hurtboxes), 'Receiving geometry did not follow drawing clock');
  assert(s.selectedArtFrameIndex===build.poseSchedule['dash-attack'].indexOf(row),'Shared drawing selector disagrees with source holds');
  if(packed)assert(s.packedArt&&s.driver?.key==='donkeykong.dash_attack.anim'&&s.driver.frameIndex===s.selectedArtFrameIndex&&Number(s.spriteFrame)===s.selectedArtFrameIndex,'Shared Match sprite driver disagrees with reviewed dash-attack drawing clock');
  const active = e >= 5 && e < 12;
  assert(s.regions.length === (active ? 1 : 0), `Wrong contact/clear count at ${e}`);
  if(active){
    const hit=s.regions[0], early=e<8;
    const expected=contacts.rows.find(row=>row.gameFrame===e+1);
    assert(hit.id===0&&hit.damage===(early?11:6)&&hit.capsule.radius===(early?25:20)
      &&same(hit.capsule.start,expected.start)&&same(hit.capsule.end,expected.end),'Changed source neck contact projection');
    assert(hit.knockback.reference.angle===(early?60:70)&&hit.knockback.reference.base===(early?70:100)
      &&hit.knockback.reference.growth===(early?88:50)&&hit.hitlagMultiplier===1.5
      &&hit.sdiMultiplier===1&&hit.launchDirection==='forward','Changed source dash launch or multipliers');
  }
}
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pikachuDashAttackPreview?.ready);
  const bundle = (await page.content()).match(/src="([^\"]*\/assets\/pikachu-dash-attack-(?:packed-)?preview-[^\"]+\.js)"/)?.[1];
  assert(bundle, 'Missing exact bundle'); report.bundle = bundle;
  report.bundleSha256 = sha(new Uint8Array(await (await fetch(new URL(bundle, report.url))).arrayBuffer()));
  assert(report.bundleSha256 === build.files[bundle.replace(/^\//, '')], 'Served bundle differs from reviewed build');
  report.servedArt = {};
  for (const [file, expected] of Object.entries(build.files).filter(([file]) => file.endsWith('.png'))) {
    const response = await fetch(new URL(file, report.url)); assert(response.ok, 'Missing served art');
    const actual = sha(new Uint8Array(await response.arrayBuffer())); assert(actual === expected, 'Changed served art'); report.servedArt[file] = actual;
  }
  assert(Object.keys(report.servedArt).length === build.servedPngCount && Object.keys(build.art).length === 14, 'Missing one of14reviewed drawings');
  for (const saved of [false, true]) for (const action of ['dash-attack']) for (const facing of [1, -1])
    for (const automatic of [false, true]) for (const probe of ['near', 'late', 'edge', 'miss']) {
      await page.evaluate(({ saved, action, facing, automatic, probe }) => {
        const p = window.__pikachuDashAttackPreview; p.setSaved(saved); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(automatic); p.setProbe(probe);
      }, { saved, action, facing, automatic, probe });
      ready(await state(), facing); await page.keyboard.press('f');
      assert((await state()).elapsed === 0, 'Keyboard did not enter dash-attack at elapsed0');
      const timeline = [], captured = new Set();
      for (let physical = 0; physical < 120; physical++) {
        const s = await state(); if (s.elapsed === null) break; check(s, action); timeline.push(s);
        if (!saved && !automatic && probe === 'miss' && !captured.has(s.pose)) {
          const pixels=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return document.querySelector('#game canvas').toDataURL('image/png');});writeFileSync(path.join(out,`${s.pose}-${facing===1?'right':'left'}.png`),Buffer.from(pixels.split(',')[1],'base64'));captured.add(s.pose);
        }
        await page.keyboard.press('n');
      }
      const s = await state(); ready(s, facing);
      assert(s.contacts.length === (probe === 'miss' ? 0 : 1), `Wrong strike dedup/hit/miss ${saved}/${action}/${facing}/${automatic}/${probe}`);
      const expectedContact = probe === 'late' ? {damage:6,region:0} : {damage:11,region:0};
      assert(s.contacts.every(hit => hit.damage === expectedContact.damage && hit.region === expectedContact.region), 'Changed sourced regional damage/overlap priority');
      if (probe === 'near') assert(s.contacts[0].elapsed === 5, 'Near target missed first source active frame');
      if (probe === 'late') assert(s.contacts[0].elapsed === 8, 'Late target hit outside chosen last active frame');
      if (!automatic) assert(timeline.length === 35, 'Action duration changed');
      if (automatic && probe !== 'miss') assert(timeline.some((s, i) => i > 0 && s.elapsed === timeline[i - 1].elapsed && s.hitlag > 0), 'Contact did not freeze clock');
      console.log(JSON.stringify({ action, saved, facing, automatic, probe, contacts: s.contacts, physicalSteps: timeline.length }));
      report.cases.push({ saved, action, facing, automaticHitlag: automatic, probe, passed: true, contacts: s.contacts, damage: s.damage, physicalSteps: timeline.length, timeline });
    }
  for (const action of ['dash-attack']) for (const facing of [1, -1]) for(const frozenElapsed of [7,18]) {
    await page.evaluate(({ action, facing }) => { const p = window.__pikachuDashAttackPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { action, facing });
    await page.keyboard.press('f'); for (let i = 0; i < frozenElapsed; i++) await page.keyboard.press('n'); const before = await state();
    await page.click('#freeze');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('n'); const s = await state(); assert(s.elapsed === before.elapsed && s.pose === before.pose && same(s.regions, before.regions) && same(s.hurtboxes, before.hurtboxes), 'Manual freeze changed attack geometry/drawing'); }
    await page.keyboard.press('n'); assert((await state()).elapsed === frozenElapsed+1, 'Clock did not resume'); report.freeze.push({ action, facing, frozenElapsed, passed: true });
  }
  for (const facing of [1, -1]) for (const row of candidates) {
    await page.evaluate(({ facing, action }) => { const p = window.__pikachuDashAttackPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { facing, action: row.action });
    await page.keyboard.press('f'); for (let i = 0; i < row.startElapsed; i++) await page.keyboard.press('n'); check(await state(), row.action);
    for (const hurtbox of row.hurtboxes) {
      const c = hurtbox.capsule, x = (c.start.x + c.end.x) / 2, y = (c.start.y + c.end.y) / 2;
      const result = await page.evaluate(({ x, y }) => window.__pikachuDashAttackPreview.probeHurtbox(x, y), { x, y });
      assert(result.confirmed && result.state.elapsed === row.startElapsed, 'Incoming centre probe missed/advanced clock');
      report.incoming.push({ action: row.action, pose: row.pose, facing, hurtbox: hurtbox.id, confirmed: true });
    }
    const maxX = Math.max(...row.hurtboxes.flatMap(box => [box.capsule.start.x + box.capsule.radius, box.capsule.end.x + box.capsule.radius]));
    const result = await page.evaluate(x => window.__pikachuDashAttackPreview.probeHurtbox(x, 0), maxX + 2);
    assert(!result.confirmed, 'Outside-envelope probe hit'); report.incoming.push({ action: row.action, pose: row.pose, facing, confirmed: false });
  }
  await page.click('#reset');await page.keyboard.press('f');const playStart=await state();await page.click('#play');await page.waitForFunction(start=>window.__pikachuDashAttackPreview.state().physicalSteps>start,playStart.physicalSteps);await page.click('#play');const paused=await state();await page.waitForTimeout(150);const later=await state();assert(paused.physicalSteps>playStart.physicalSteps&&!paused.playing&&same(paused,later),'Pause did not preserve fixed-step state');report.pause={passed:true,start:playStart,paused,later};
  const saved = await page.evaluate(() => window.__pikachuDashAttackPreview.savedFile);
  writeFileSync(path.join(out, 'shared-wolf-fixture-saved-moves.json'), JSON.stringify(JSON.parse(saved), null, 2) + '\n');
  assert(report.errors.length === 0, 'Browser errors'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, freeze: report.freeze.length, incoming: report.incoming.length, servedArt: Object.keys(report.servedArt ?? {}).length, errors: report.errors }));
