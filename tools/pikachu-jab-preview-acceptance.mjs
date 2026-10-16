import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed=process.argv.includes('--packed');
const build = JSON.parse(readFileSync(path.join(base, packed?'jab-packed-preview-build.json':'jab-preview-build.json')));
const candidates = JSON.parse(readFileSync(path.join(base, 'jab/hurtbox-preparation/candidates.json'))).rows;

const out = path.join(base, packed?'jab/packed-browser':'jab/browser'); mkdirSync(out, { recursive: true });
const report = { scope: 'Isolated grounded rough nine-pose jab, authored2D geometry and shared40x50body; direct and shared Wolf saved-move factory fixtures; no full Pikachu Lab/match/native qualification',
  url: `http://127.0.0.1:${build.previewPort??(packed?4199:4198)}/${packed?'pikachu-jab-packed-preview.html':'pikachu-jab-preview.html'}`, build: build.buildIdentity,
  input: 'Simulated browser F/N keyboard and pointer controls. Neutral light attack through shared Character; saved Wolf grounded dispatch slots preserve authored new-ID jab. Held repeat/native common status remains unqualified.', cases: [], freeze: [], incoming: [], errors: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
const state = () => page.evaluate(() => window.__pikachuJabPreview.state());
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
  const e = s.elapsed, total = 17;
  assert(Number.isInteger(e) && e >= 0 && e < total && s.moveId === `pikachu.${action}`, 'Wrong action route/clock');
  const row = build.poseSchedule[action].find(row => e >= row.startElapsed && e < row.endElapsed);
  assert(row && s.pose === row.pose && s.sourceIndex === row.sourceIndex && s.file === row.file, 'Drawing clock disagrees with reviewed mapping');
  assert(s.texture === (packed?'pikachu-packed-jab':`pikachu-${action}.${row.pose}`) && s.spriteScale === 70 / 600*(packed?4:1) && s.spriteOrigin.x === .5 && s.spriteOrigin.y === 1152 / 1536, 'Drawing root/scale wrong');
  const expected = candidates.find(candidate => candidate.action === action && candidate.pose === row.pose);
  assert(same(s.hurtboxes, expected.hurtboxes), 'Receiving geometry did not follow drawing clock');
  assert(s.selectedArtFrameIndex===build.poseSchedule.jab.indexOf(row),'Shared drawing selector disagrees with source holds');
  if(packed)assert(s.packedArt&&s.driver?.key==='donkeykong.attack.anim'&&s.driver.frameIndex===s.selectedArtFrameIndex&&Number(s.spriteFrame)===s.selectedArtFrameIndex,'Shared Match sprite driver disagrees with reviewed jab drawing clock');
  const active = e >= 1 && e < 3;
  assert(s.regions.length === (active ? 3 : 0), `Wrong contact/clear count at ${e}`);
  if(active)for(const [id,x,radius,damage,growth,base] of [[0,36,15,1.4,20,12],[1,48,15,1.2,20,12],[2,63,17.5,1,30,18]]){
    const hit=s.regions.find(hit=>hit.id===id);
    assert(hit && near(hit.damage,damage) && near(hit.capsule.radius,radius)
      && same(hit.capsule.start,{x,y:10}) && same(hit.capsule.end,{x,y:10}),'Changed source head region');
    assert(hit.knockback.reference.angle===0 && hit.knockback.reference.base===base && hit.knockback.reference.growth===growth
      && hit.hitlagMultiplier===1 && hit.sdiMultiplier===1.5 && hit.launchDirection==='forward','Changed source jab launch or contact multipliers');
  }
}
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pikachuJabPreview?.ready);
  const bundle = (await page.content()).match(/src="([^\"]*\/assets\/pikachu-jab-(?:packed-)?preview-[^\"]+\.js)"/)?.[1];
  assert(bundle, 'Missing exact bundle'); report.bundle = bundle;
  report.bundleSha256 = sha(new Uint8Array(await (await fetch(new URL(bundle, report.url))).arrayBuffer()));
  assert(report.bundleSha256 === build.files[bundle.replace(/^\//, '')], 'Served bundle differs from reviewed build');
  report.servedArt = {};
  for (const [file, expected] of Object.entries(build.files).filter(([file]) => file.endsWith('.png'))) {
    const response = await fetch(new URL(file, report.url)); assert(response.ok, 'Missing served art');
    const actual = sha(new Uint8Array(await response.arrayBuffer())); assert(actual === expected, 'Changed served art'); report.servedArt[file] = actual;
  }
  assert(Object.keys(report.servedArt).length === build.servedPngCount && Object.keys(build.art).length === 10, 'Missing one of10reviewed drawings');
  for (const saved of [false, true]) for (const action of ['jab']) for (const facing of [1, -1])
    for (const automatic of [false, true]) for (const probe of ['near', 'late', 'edge', 'miss']) {
      await page.evaluate(({ saved, action, facing, automatic, probe }) => {
        const p = window.__pikachuJabPreview; p.setSaved(saved); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(automatic); p.setProbe(probe);
      }, { saved, action, facing, automatic, probe });
      ready(await state(), facing); await page.keyboard.press('f');
      assert((await state()).elapsed === 0, 'Keyboard did not enter jab at elapsed0');
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
      const expectedContact = probe === 'near' ? {damage:1.4,region:0} : probe === 'late' ? {damage:1.2,region:1} : {damage:1,region:2};
      assert(s.contacts.every(hit => hit.damage === expectedContact.damage && hit.region === expectedContact.region), 'Changed sourced regional damage/overlap priority');
      if (probe === 'near') assert(s.contacts[0].elapsed === 1, 'Near target missed first source active frame');
      if (probe === 'late') assert(s.contacts[0].elapsed === 2, 'Late target hit outside chosen last active frame');
      if (!automatic) assert(timeline.length === 17, 'Action duration changed');
      if (automatic && probe !== 'miss') assert(timeline.some((s, i) => i > 0 && s.elapsed === timeline[i - 1].elapsed && s.hitlag > 0), 'Contact did not freeze clock');
      console.log(JSON.stringify({ action, saved, facing, automatic, probe, contacts: s.contacts, physicalSteps: timeline.length }));
      report.cases.push({ saved, action, facing, automaticHitlag: automatic, probe, passed: true, contacts: s.contacts, damage: s.damage, physicalSteps: timeline.length, timeline });
    }
  for (const action of ['jab']) for (const facing of [1, -1]) for(const frozenElapsed of [1,4]) {
    await page.evaluate(({ action, facing }) => { const p = window.__pikachuJabPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { action, facing });
    await page.keyboard.press('f'); for (let i = 0; i < frozenElapsed; i++) await page.keyboard.press('n'); const before = await state();
    await page.click('#freeze');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('n'); const s = await state(); assert(s.elapsed === before.elapsed && s.pose === before.pose && same(s.regions, before.regions) && same(s.hurtboxes, before.hurtboxes), 'Manual freeze changed attack geometry/drawing'); }
    await page.keyboard.press('n'); assert((await state()).elapsed === frozenElapsed+1, 'Clock did not resume'); report.freeze.push({ action, facing, frozenElapsed, passed: true });
  }
  for (const facing of [1, -1]) for (const row of candidates) {
    await page.evaluate(({ facing, action }) => { const p = window.__pikachuJabPreview; p.setSaved(false); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(false); p.setProbe('miss'); }, { facing, action: row.action });
    await page.keyboard.press('f'); for (let i = 0; i < row.startElapsed; i++) await page.keyboard.press('n'); check(await state(), row.action);
    for (const hurtbox of row.hurtboxes) {
      const c = hurtbox.capsule, x = (c.start.x + c.end.x) / 2, y = (c.start.y + c.end.y) / 2;
      const result = await page.evaluate(({ x, y }) => window.__pikachuJabPreview.probeHurtbox(x, y), { x, y });
      assert(result.confirmed && result.state.elapsed === row.startElapsed, 'Incoming centre probe missed/advanced clock');
      report.incoming.push({ action: row.action, pose: row.pose, facing, hurtbox: hurtbox.id, confirmed: true });
    }
    const maxX = Math.max(...row.hurtboxes.flatMap(box => [box.capsule.start.x + box.capsule.radius, box.capsule.end.x + box.capsule.radius]));
    const result = await page.evaluate(x => window.__pikachuJabPreview.probeHurtbox(x, 0), maxX + 2);
    assert(!result.confirmed, 'Outside-envelope probe hit'); report.incoming.push({ action: row.action, pose: row.pose, facing, confirmed: false });
  }
  report.restart=[];
  for(const saved of [false,true])for(const facing of [1,-1]){
    await page.evaluate(({saved,facing})=>{const p=window.__pikachuJabPreview;p.setSaved(saved);p.setFacing(facing);p.setAutomaticHitlag(false);p.setProbe('near');},{saved,facing});
    await page.keyboard.press('f');for(let i=0;i<5;i++)await page.keyboard.press('n');assert((await state()).elapsed===5,'Wrong pre-restart clock');
    await page.keyboard.press('f');const restarted=await state();assert(restarted.elapsed===0 && restarted.moveId==='pikachu.jab' && restarted.pose==='startup','Fresh press did not restart the same jab at source game7');
    await page.keyboard.press('n');await page.keyboard.press('n');const after=await state();assert(after.contacts.length===2 && near(after.damage,2.8),'Restarted jab did not receive a new strike identity');report.restart.push({saved,facing,passed:true,restarted,after});
  }
  await page.click('#reset');await page.keyboard.press('f');const playStart=await state();await page.click('#play');await page.waitForFunction(start=>window.__pikachuJabPreview.state().physicalSteps>start,playStart.physicalSteps);await page.click('#play');const paused=await state();await page.waitForTimeout(150);const later=await state();assert(paused.physicalSteps>playStart.physicalSteps&&!paused.playing&&same(paused,later),'Pause did not preserve fixed-step state');report.pause={passed:true,start:playStart,paused,later};
  const saved = await page.evaluate(() => window.__pikachuJabPreview.savedFile);
  writeFileSync(path.join(out, 'shared-wolf-fixture-saved-moves.json'), JSON.stringify(JSON.parse(saved), null, 2) + '\n');
  assert(report.errors.length === 0, 'Browser errors'); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack ?? String(error); throw error; }
finally { writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, freeze: report.freeze.length, incoming: report.incoming.length, servedArt: Object.keys(report.servedArt ?? {}).length, errors: report.errors }));
