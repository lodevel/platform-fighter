/** Browser acceptance compares live shared consumers with independently captured
 * source projections. Successful checks qualify only this isolated body fixture. */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'docs/review/2026-10-06/pikachu-character');
const packed = process.argv.includes('--packed');
const build = JSON.parse(readFileSync(path.join(base, packed ? 'smash-packed-preview-build.json' : 'smash-preview-build.json')));
const candidates = JSON.parse(readFileSync(path.join(base, 'smashes/hurtbox-preparation/candidates.json'))).rows;
const contacts = Object.fromEntries(Object.keys(build.poseSchedule).map(action => [action,
  JSON.parse(readFileSync(path.join(base, `sources/posed-resources/${action}-contact-candidates.json`))).rows]));
const sheets = { 'forward-smash': 'smash', 'up-smash': 'usmash', 'down-smash': 'dsmash' };
const totals = { 'forward-smash': 53, 'up-smash': 44, 'down-smash': 65 };
const firstContact = { 'forward-smash': 14, 'up-smash': 9, 'down-smash': 7 };
const lastContact = { 'forward-smash': 28, 'up-smash': 16, 'down-smash': 22 };
const pauseFrame = { 'forward-smash': 8, 'up-smash': 1, 'down-smash': 1 };
const out = path.join(base, packed ? 'smashes/packed-browser' : 'smashes/browser');
mkdirSync(out, { recursive: true });
const report = { scope: 'Three smash body candidates with authored2D contacts/receiving geometry, real Character input and shared Wolf saved factory. Native hold/keep clocks, charge-loop presentation, electricity FX and full Pikachu match qualification remain pending.',
  url: `http://127.0.0.1:${build.previewPort}/${packed ? 'pikachu-smash-packed-preview.html' : 'pikachu-smash-preview.html'}`, build: build.buildIdentity,
  input: 'Browser F/U/D taps; C/R hold and release; N physical steps. All dispatches pass through Character.applyInput.',
  cases: [], charge: [], freeze: [], incoming: [], errors: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a,b) => Math.abs(a-b) < 1e-8;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// This fixture explicitly uses Phaser.CANVAS. Avoid SwiftShader's GPU
// compositor competing with the authorized art generator during screenshots.
report.renderer = 'Phaser Canvas2D in Chromium with GPU acceleration disabled';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
const state = () => page.evaluate(() => window.__pikachuSmashPreview.state());
async function setup(action, facing, saved = false, automatic = false, probe = 'miss') {
  await page.evaluate(({action,facing,saved,automatic,probe}) => {
    const p=window.__pikachuSmashPreview;
    p.setSaved(saved); p.setAction(action); p.setFacing(facing); p.setAutomaticHitlag(automatic); p.setProbe(probe);
  }, {action,facing,saved,automatic,probe});
}
function ready(s, facing) {
  assert(s.elapsed===null && !s.charging && s.pose==='neutral' && s.regions.length===0, 'Return retained attack or charge');
  assert(s.grounded && s.flipped===(facing===-1), 'Grounded/mirror state wrong');
  assert(s.spriteScale===70/600*(packed?4:1) && s.spriteOrigin.x===.5 && s.spriteOrigin.y===(packed?.75:880/1024), 'Neutral registration wrong');
  assert(s.hurtboxes.length===1 && !s.hurtboxes[0].capsule, 'Return retained posed receiving regions');
  assert(Math.abs(s.root.y-s.floorTop)<.25, 'Shared movement body root drifted from floor');
}
function check(s, action) {
  const elapsed=s.elapsed ?? s.chargeStartupElapsed;
  assert(Number.isInteger(elapsed) && elapsed>=0 && elapsed<totals[action] && s.moveId===`pikachu.${action}`, `Wrong source input route/clock ${action}/${elapsed}`);
  const row=build.poseSchedule[action].find(row=>elapsed>=row.startElapsed && elapsed<row.endElapsed);
  assert(row && row.pose===s.pose && row.sourceIndex===s.sourceIndex && row.file===s.file, 'Body drawing missed authored hold');
  const index=build.poseSchedule[action].indexOf(row);
  assert(s.texture===(packed?`pikachu-packed-${sheets[action]}`:`pikachu-${action}.${row.pose}`) && s.spriteOrigin.x===.5 && s.spriteOrigin.y===.75 && s.spriteScale===70/600*(packed?4:1), 'Body registration changed');
  assert(s.presentationAlias==='donkeykong' && s.driver?.key===`donkeykong.${sheets[action]}.anim` && s.driver.frameIndex===index, 'Shared Match drawing consumer disagrees with physical clock');
  if(packed) assert(Number(s.spriteFrame)===index, 'Packed cell disagrees with driver');
  const candidate=candidates.find(candidate=>candidate.action===action && candidate.pose===row.pose);
  assert(same(s.hurtboxes,candidate.hurtboxes), 'Live receiving capsules missed the body pose');
  const expected=s.charging ? [] : contacts[action].find(frame=>frame.gameFrame===elapsed+1)?.regions ?? [];
  assert(s.regions.length===expected.length, `Source contact/clear/gap count wrong ${action}/${elapsed}`);
  const power=1+.4*(s.chargedReleaseFrames??0)/60;
  for(const region of expected) {
    const hit=s.regions.find(hit=>hit.id===region.id);
    assert(hit && near(hit.damage,region.damage*power) && near(hit.capsule.radius,region.authoredWorldRadius)
      && same(hit.capsule.start,region.start) && same(hit.capsule.end,region.end), `Independent source contact/damage mismatch ${action}/${elapsed}/${region.id}`);
    assert(hit.knockback?.reference, 'Regional reference launch dropped during charge or save/load');
  }
  return row;
}
async function drain(action, capture=false, facing=1) {
  const timeline=[], captured=new Set();
  for(let physical=0;physical<260;physical++) {
    const s=await state(); if(s.elapsed===null && !s.charging) break;
    const row=check(s,action); timeline.push(s);
    if(capture && !captured.has(row.pose)) {
      await page.screenshot({clip:await page.locator('#game').boundingBox(),path:path.join(out,`${action}-${row.pose}-${facing===1?'right':'left'}.png`)});
      captured.add(row.pose);
    }
    await page.keyboard.press('n');
  }
  ready(await state(),facing); return timeline;
}
try {
  await page.goto(report.url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__pikachuSmashPreview?.ready);
  const bundle=(await page.content()).match(/src="([^\"]*\/assets\/pikachu-smash-(?:packed-)?preview-[^\"]+\.js)"/)?.[1];
  assert(bundle,'Missing immutable preview bundle'); report.bundle=bundle;
  report.bundleSha256=sha(new Uint8Array(await(await fetch(new URL(bundle,report.url))).arrayBuffer()));
  assert(report.bundleSha256===build.files[bundle.replace(/^\//,'')],'Served bundle differs from recorded build');
  report.servedArt={};
  for(const [file,expected] of Object.entries(build.files).filter(([file])=>file.endsWith('.png'))) {
    const response=await fetch(new URL(file,report.url)); assert(response.ok,'Missing served art');
    const hash=sha(new Uint8Array(await response.arrayBuffer())); assert(hash===expected,'Served drawing changed'); report.servedArt[file]=hash;
  }
  assert(Object.keys(build.art).length===58 && Object.keys(report.servedArt).length===build.servedPngCount,'Missing reviewed body/neutral drawing');
  for(const saved of [false,true]) for(const action of Object.keys(totals)) for(const facing of [1,-1])
    for(const automatic of [false,true]) for(const probe of ['near','late','edge','miss']) {
      await setup(action,facing,saved,automatic,probe); ready(await state(),facing);
      const capture=!saved && !automatic && probe==='miss';
      // Initial heavy press is a real startup charge at elapsed0. Capture that
      // pose before tap release resumes the existing consumer at elapsed1.
      if(capture) {
        await page.keyboard.press('c'); const s=await state(),row=check(s,action);
        assert(s.charging && s.chargeStartupElapsed===0,'Heavy press skipped startup');
        await page.screenshot({clip:await page.locator('#game').boundingBox(),path:path.join(out,`${action}-${row.pose}-${facing===1?'right':'left'}.png`)});
        await page.keyboard.press('r');
      } else await page.keyboard.press(action==='forward-smash'?'f':action==='up-smash'?'u':'d');
      assert((await state()).elapsed===1,'Tap release did not resume existing startup clock');
      const timeline=await drain(action,capture,facing),s=await state();
      const expectedCount=probe==='miss'?0:probe==='late'?1:action==='down-smash'?probe==='edge'?5:6:1;
      assert(s.contacts.length===expectedCount,`Strike dedup/rehit/miss failed ${saved}/${action}/${facing}/${automatic}/${probe}: ${s.contacts.length}`);
      if(probe==='near') assert(s.contacts[0].elapsed===firstContact[action],'First source contact missed');
      if(probe==='late') assert(s.contacts[0].elapsed===lastContact[action],'Late-only target hit early');
      if(!automatic) assert(timeline.length===totals[action]-1,'Tap duration changed');
      if(automatic && probe!=='miss') assert(timeline.some((s,i)=>i>0 && s.elapsed===timeline[i-1].elapsed && s.hitlag>0),'Contact did not freeze physical action clock');
      report.cases.push({action,saved,facing,automaticHitlag:automatic,probe,passed:true,contacts:s.contacts,physicalSteps:timeline.length,timeline});
      console.log(JSON.stringify({action,saved,facing,automatic,probe,contacts:s.contacts.length,passed:true}));
    }
  for(const saved of [false,true]) for(const action of Object.keys(totals)) for(const facing of [1,-1]) for(const held of [30,60]) {
    await setup(action,facing,saved); await page.keyboard.press('c'); check(await state(),action);
    for(let i=0;i<pauseFrame[action];i++) { await page.keyboard.press('n'); check(await state(),action); }
    const pause=await state(); assert(pause.charging && pause.chargeStartupElapsed===pauseFrame[action] && pause.chargeHeldFrames===0,'Existing pause clock wrong');
    for(let i=0;i<held;i++) { await page.keyboard.press('n'); const s=await state(); check(s,action);
      if(i<59) assert(s.charging && s.chargeHeldFrames===i+1 && s.chargeStartupElapsed===pauseFrame[action],'Power timer drifted or early release'); }
    if(held===30) await page.keyboard.press('r');
    const release=await state(); assert(!release.charging && release.elapsed===pauseFrame[action] && release.chargedReleaseFrames===held,'Partial/full charge resume changed');
    await drain(action,false,facing); report.charge.push({action,saved,facing,held,passed:true,release,
      qualification:'Existing shared power cap/forced-release consumer only; native separate keep120 timer and exact hold-frame conversion pending'});
  }
  for(const action of Object.keys(totals)) for(const facing of [1,-1]) {
    await setup(action,facing); await page.keyboard.press('f');
    while((await state()).elapsed<firstContact[action]) await page.keyboard.press('n');
    const before=await state(); await page.click('#freeze');
    for(let i=0;i<3;i++) { await page.keyboard.press('n'); const s=await state();
      assert(s.elapsed===before.elapsed && s.pose===before.pose && same(s.regions,before.regions) && same(s.hurtboxes,before.hurtboxes) && same(s.driver,before.driver),'Hitlag changed clock, body, contact or receiver'); }
    await page.keyboard.press('n'); assert((await state()).elapsed===before.elapsed+1,'Physical clock did not resume');
    report.freeze.push({action,facing,passed:true});
  }
  for(const facing of [1,-1]) for(const row of candidates) {
    await setup(row.action,facing); await page.keyboard.press('c');
    if(row.startElapsed>0) { await page.keyboard.press('r'); for(let i=1;i<row.startElapsed;i++) await page.keyboard.press('n'); }
    check(await state(),row.action);
    for(const box of row.hurtboxes) {
      const cap=box.capsule,x=(cap.start.x+cap.end.x)/2,y=(cap.start.y+cap.end.y)/2;
      const result=await page.evaluate(({x,y})=>window.__pikachuSmashPreview.probeHurtbox(x,y),{x,y});
      assert(result.confirmed,'Receiving centre probe missed'); check(result.state,row.action);
      report.incoming.push({action:row.action,pose:row.pose,facing,hurtbox:box.id,confirmed:true});
    }
    const maxX=Math.max(...row.hurtboxes.flatMap(box=>[box.capsule.start.x+box.capsule.radius,box.capsule.end.x+box.capsule.radius]));
    const result=await page.evaluate(x=>window.__pikachuSmashPreview.probeHurtbox(x,0),maxX+2);
    assert(!result.confirmed,'Outside-envelope receiving probe hit'); report.incoming.push({action:row.action,pose:row.pose,facing,confirmed:false});
  }
  await setup('forward-smash',1); await page.click('#attack'); await page.click('#play'); await page.waitForTimeout(100); await page.click('#play');
  const paused=await state(); await page.waitForTimeout(100); assert(paused.elapsed>1 && same(paused,await state()),'Menu pause changed physical state'); report.pause={passed:true,elapsed:paused.elapsed};
  const saved=await page.evaluate(()=>window.__pikachuSmashPreview.savedFile);
  writeFileSync(path.join(out,'shared-wolf-fixture-saved-moves.json'),JSON.stringify(JSON.parse(saved),null,2)+'\n');
  assert(report.errors.length===0,'Browser raised errors'); report.status='passed';
} catch(error) { report.status='failed'; report.failure=error.stack??String(error); throw error; }
finally { writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n'); await browser.close(); }
console.log(JSON.stringify({status:report.status,cases:report.cases.length,charge:report.charge.length,freeze:report.freeze.length,incoming:report.incoming.length,servedArt:Object.keys(report.servedArt??{}).length,errors:report.errors}));
