/** Production Link Final visuals; explicit resource/position fixtures, saved DOM activation. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { openMatchHost, launchMatch } from './browser-match-host.mjs';
import { launchWindowsEdgeCdp } from './windows-edge-cdp.mjs';
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const url = arg('url', 'http://127.0.0.1:4173/platform-fighter/'), out = arg('out', '.tmp/link-final-visuals');
await mkdir(out, { recursive: true });
const source = await readFile(new URL(import.meta.url)); await writeFile(`${out}/harness-at-run.mjs`, source);
const report = { url, harnessSha256: createHash('sha256').update(source).digest('hex'), input: 'Saved DOM special binding; resource grant, deterministic positions and target placement are explicit fixtures. One step SimView per tick; draw uses that view.', errors: [], rows: [] };
const edge = process.argv.includes('--edge') ? await launchWindowsEdgeCdp({ windowsPort: 9235, bridgePort: 9236 }) : null;
const browser = edge ? await chromium.connectOverCDP(edge.endpoint) : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }), page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
try {
 report.browser = browser.version(); report.script = await openMatchHost(page, url);
 report.graphics = await page.evaluate(() => { const canvas = document.querySelector('canvas'), gl = canvas?.getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return gl && { renderer: gl.getParameter(gl.RENDERER), unmaskedRenderer: d && gl.getParameter(d.UNMASKED_RENDERER_WEBGL) }; });
 for (const airborne of [false, true]) for (const facing of [1, -1]) {
  const hit = facing === -1, key = `${airborne ? 'air' : 'ground'}-${facing === 1 ? 'right' : 'left'}-${hit ? 'hit' : 'miss'}`;
  await launchMatch(page, { mode: 'stocks', stockCount: 9, stageId: 'flat', rngSeed: 161026, itemFrequency: 'off', linkIntroPolicy: 'none', finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: true }, players: [{ index: 1, characterId: 'link', paletteIndex: facing === 1 ? 0 : 3, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }] });
  const setup = await page.evaluate(({ airborne, facing, hit }) => {
   const host = window.__sim, sim = host.match, neutral = { moveX: 0, moveY: 0, jump: false, attack: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, dropThrough: false };
   for (let n = 0; n < 240; n++) host.step([neutral, neutral]);
   const floor = sim.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), x = floor.position.x, top = floor.bounds.min.y;
   sim.p1.resetForRound(x, top - sim.p1.getTuning().height / 2); sim.p1.setFacing(facing); sim.p2.resetForRound(x - 180 * facing, top - sim.p2.getTuning().height / 2);
   for (let n = 0; n < 10; n++) host.step([neutral, neutral]);
   if (airborne) { sim.p1.resetForRound(x, top - sim.p1.getTuning().height / 2 - 160); sim.p1.setFacing(facing); }
   const frame = sim.physicsEngine.getFrame(); for (const slot of sim.playerSlots) sim.consumeFinalEvents(sim.finalSmashController.resetParticipant(slot.playerIndex, slot.character.getPositionResetGeneration(), 'owner-reset', 0), frame);
   sim.consumeFinalEvents(sim.finalSmashController.grantBall(0, frame), frame);
   let arranged = false;
   window.__linkVisual = { step(dom = false) {
    const active = sim.finalSmashController.getActive();
    if (!arranged && active?.phaseAge >= 59) { const p = sim.p1.getPosition(); sim.matter.body.setPosition(sim.p2.body, { x: p.x + (hit ? 500 : -180) * facing, y: p.y - 12 }); sim.matter.body.setVelocity(sim.p2.body, { x: 0, y: 0 }); arranged = true; }
    const started = performance.now(), view = dom ? host.step() : host.step([neutral, neutral]);
    const hash = sim.getSimDigest().hash; host.draw(); const drawMs = performance.now() - started;
    const run = sim.finalSmashController.getActive(), control = sim.p1.getFinalSmashControl();
    return { frame: view.frame, age: run?.phaseAge ?? null, phase: run?.phase ?? null, control, hash, hashAfterDraw: sim.getSimDigest().hash,
     fighters: [sim.p1, sim.p2].map(f => ({ position: f.getPosition(), root: f.getSourceRootPosition(), velocity: f.getVelocity(), grounded: f.isGrounded(), facing: f.getFacing(), damage: f.getDamagePercent(), hitlag: f.getHitlagRemaining(), hurtboxes: f.getActiveHurtboxes() })),
     arrows: sim.linkArticles.ancientArrows().map(a => ({ ...a.state })), owner: host.presentation(0), fx: host.presentationSprites?.() ?? [], explosions: view.explosions, events: view.events, drawMs };
   } };
   const binding = host.inputResolver.dispatcher.bindings.get(sim.playerSlots[0].bindingsSlot).bindings.special.find(b => b.kind === 'keyboard'); return { binding, buildIdentity: sim.buildIdentity };
  }, { airborne, facing, hit });
  const row = { key, setup, trace: [], screenshots: [] }; report.rows.push(row);
  const code = setup.binding.keyCode ?? setup.binding.code; assert.ok(Number.isInteger(code));
  await page.keyboard.down(String.fromCharCode(code)); row.trace.push(await page.evaluate(() => window.__linkVisual.step(true))); await page.keyboard.up(String.fromCharCode(code));
  const captured = new Set(); let started = !!row.trace[0].phase;
  for (let n = 0; n < 350; n++) {
   const state = await page.evaluate(() => window.__linkVisual.step()); row.trace.push(state); started ||= !!state.phase;
   assert.equal(state.hash, state.hashAfterDraw, `${key} redraw preserves authority`);
   const stamps = [...([8, 24, 34, 35, 45, 55, 59, 60, 61, 63, 70, 100].includes(state.age) ? [`age-${state.age}`] : []), ...state.arrows.map(a => `arrow-${a.phase}`)];
   for (const stamp of stamps) if (!captured.has(stamp)) { captured.add(stamp); const path = `${out}/${key}-${stamp}.png`; await page.screenshot({ path }); row.screenshots.push({ stamp, frame: state.frame, path }); }
   if (started && !state.phase && !state.arrows.length) break;
  }
  const active = row.trace.filter(s => s.control?.role === 'owner');
  row.ownerFrames = [...new Set(active.map(s => s.owner?.frame))]; row.ownerKeys = [...new Set(active.map(s => s.owner?.key))];
  row.missingOwnerTicks = active.filter(s => !s.owner?.visible || !s.owner?.submitted).length;
  row.maxDamage = Math.max(...row.trace.map(s => s.fighters[1].damage)); row.arrowPhases = [...new Set(row.trace.flatMap(s => s.arrows.map(a => a.phase)))];
  assert.equal(row.missingOwnerTicks, 0); assert.equal(row.trace.at(-1).control, null); assert.equal(row.trace.at(-1).phase, null);
  if (process.argv.includes('--expect-effects')) {
   const charging = active.filter(s => s.control.age < 60);
   row.loadedArrowTicks = charging.filter(s => s.fx.some(f => f.key === 'char.link.fx__link_ancientbowarrow' && f.submitted && f.visible)).length;
   assert.equal(row.loadedArrowTicks, charging.length, key + ' loaded arrow actually submitted through charge');
   assert.ok(charging.length >= 59);
   const released = active.filter(s => s.control.age >= 60 && !s.arrows.length);
   assert.ok(released.every(s => !s.fx.some(f => f.key === 'char.link.fx__link_ancientbowarrow')), key + ' loaded arrow releases without a stale quad');
  }
  assert.equal(row.maxDamage > 0, hit); if (hit) assert.ok(row.arrowPhases.includes('fighter-blast'));
  console.log(JSON.stringify({ key, frames: row.ownerFrames.length, missing: row.missingOwnerTicks, damage: row.maxDamage, arrows: row.arrowPhases })); await save();
 }
 const compare = arg('compare', null);
 if (compare) { const before = JSON.parse(await readFile(compare, 'utf8')); for (const row of report.rows) { const base = before.rows.find(r => r.key === row.key); const authority = trace => trace.map(({ owner, fx, drawMs, ...rest }) => rest); assert.deepEqual(authority(row.trace), authority(base.trace), row.key + ' identical gameplay, collision, clocks, events and digest'); } report.comparison = { baseline: compare, identicalAuthorityTicks: report.rows.reduce((n, r) => n + r.trace.length, 0) }; }
 assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.failure = error.stack; throw error; }
finally { await save(); await context.close(); await browser.close(); await edge?.close(); }
