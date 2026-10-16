import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/thunder-owner-miss';
const overlay = process.env.PF_HURTBOX_OVERLAY === '1';
const metadata = JSON.parse(await readFile('assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_SPECIAL_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../src/characters/pikachuSpecialHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const report = { overlay, scope: 'Actual browser WASD/G events through unchanged normal match bindings, real run/jump/Matter momentum produces owner-miss Thunder in both facings. Initial round positions are fixture seeds; owner is never teleported, velocity-written or status-written after fixture setup. Source86-step call commitment, article lifetime and body/receiving clocks measured through exit. Native FX/common STOP remain adapted.', errors: [], failedResponses: [], cases: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) report.failedResponses.push({ url: r.url(), status: r.status() }); });
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://localhost:4238/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  await page.evaluate(({ overlay }) => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 2819, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause(); s.roundStartCountdown = 0; s.hitboxDebugLayer.setEnabled(overlay);
    const observe = () => { const sprite = s.playerSlots[0].sprite; return {
      state: s.p1.getPikachuSpecialState(), objects: s.p1.getPikachuSpecialVisuals(), position: s.p1.getPosition(), velocity: s.p1.getVelocity(),
      jump: s.p1.getJumpPresentationState(), jumpsquat: s.p1.getJumpsquatRemaining(), grounded: s.p1.isGrounded(),
      attack: s.p1.getActiveAttack()?.move.id ?? null, age: s.p1.getActiveAttack()?.framesElapsed ?? null,
      receiving: s.p1.getActiveHurtboxes(), damage: s.p1.getDamagePercent(), opponentDamage: s.p2.getDamagePercent(), stocks: s.stockTracker.getStocks(1),
      texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
      camera: { x: s.cameras.main.worldView.x, y: s.cameras.main.worldView.y, zoom: s.cameras.main.zoom }, sprite: { x: sprite.x, y: sprite.y },
      mirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1),
      input: { move: s.inputResolver.getMoveVector(1), special: s.inputResolver.isActionHeld(1, 'special'), jump: s.inputResolver.isActionHeld(1, 'jump') },
    }; };
    window.__thunderMissObserve = observe;
    window.__thunderMissStep = (n = 1) => { let r; for (let i = 0; i < n; i++) { s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); r = observe(); } return r; };
    window.__thunderMissReset = facing => { const f = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
      s.p1.resetForRound(f.position.x, f.bounds.min.y - 25);
      s.p2.resetForRound(facing === 1 ? f.bounds.min.x + 50 : f.bounds.max.x - 50, f.bounds.min.y - s.p2.getTuning().height / 2);
      s.p1.setFacing(facing); s.p1.setDamagePercent(0); s.p2.setDamagePercent(0); window.__thunderMissStep(12); return observe(); };
  }, { overlay });
  for (const facing of [1, -1]) {
    const c = { facing, preparation: [], trace: [], captures: [] }; report.cases.push(c);
    c.initial = await page.evaluate(f => window.__thunderMissReset(f), facing);
    const direction = facing === 1 ? 'd' : 'a';
    await page.keyboard.down(direction); c.preparation.push(await page.evaluate(() => window.__thunderMissStep(19)));
    await page.keyboard.down('w');
    c.takeoff = await page.evaluate(() => { let r; for (let i = 0; i < 24; i++) { r = window.__thunderMissStep(); if (r.jump?.kind === 'ground') return r; } throw new Error('Normal keyboard jump did not take off'); });
    await page.keyboard.up('w'); await page.keyboard.up(direction);
    await page.keyboard.down('s'); await page.keyboard.down('g');
    c.start = await page.evaluate(() => window.__thunderMissStep());
    await page.keyboard.up('g'); await page.keyboard.up('s');
    assert.equal(c.start.state?.kind, 'thunder'); assert.equal(c.start.state.bornGrounded, false); assert.equal(c.start.state.frame, 0);
    const seen = new Set();
    for (let i = 0; i <= 88; i++) {
      const r = i === 0 ? c.start : await page.evaluate(() => window.__thunderMissStep()); c.trace.push(r);
      const key = `${r.texture}-${r.textureFrame}`;
      if (!seen.has(key) || [12, 24, 36, 60, 85, 86].includes(r.state?.frame ?? -1)) {
        seen.add(key); const screenshot = `miss-${facing}-${i}-${r.texture.split('.').at(-1)}-${r.textureFrame}.png`;
        await page.screenshot({ path: `${output}/${screenshot}` }); c.captures.push({ screenshot, traceIndex: i });
      }
    }
    c.cloud = c.trace.flatMap(r => r.objects).find(o => o.kind === 'cloud');
    assert.ok(c.cloud); assert.ok(c.trace.some(r => r.objects.some(o => o.kind === 'bolt')));
    assert.ok(c.trace.every(r => r.state?.branchFrame == null && !r.objects.some(o => o.kind === 'burst')), 'natural horizontal momentum must miss owner for every bolt');
    assert.ok(c.trace.every(r => r.damage === 0 && r.opponentDamage === 0 && r.stocks === c.initial.stocks));
    assert.ok(c.trace.every(r => !r.receiving.some(h => h.intangible)), 'owner miss must not grant self-hit protection');
    assert.ok(c.trace.some(r => Math.abs(r.position.x - c.cloud.x) > 85), 'ordinary momentum must carry owner beyond source85px self-catch corridor');
    assert.equal(c.trace[85].state?.frame, 85); assert.equal(c.trace[86].state, null); assert.equal(c.trace[86].attack, null);
    assert.ok(c.trace[85].objects.length === 0, 'all bolts must expire before ordinary commitment exit');
    assert.ok(c.trace.some(r => r.grounded), 'owner lands naturally');
    for (const r of c.trace.filter(r => r.state)) {
      const sheet = r.grounded ? 'down_special' : 'down_special_air', clip = metadata.animations[sheet];
      const local = Math.min(r.state.frame, clip.frameWindows.at(-1).endFrame - 1);
      const w = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(r.texture, `char.pikachu.${sheet}`); assert.equal(r.textureFrame, w.artFrameIndex);
      assert.deepEqual(r.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]); assert.equal(r.mirror, facing);
      const expected = poses.find(p => p.sheet === sheet && p.startElapsed <= local && local < p.endElapsed);
      assert.ok(expected, 'reviewed source receiving exists'); assert.deepEqual(r.receiving, expected.hurtboxes);
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedResponses, []); report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length, screenshots: report.cases.flatMap(c => c.captures).length, bundle: report.bundle }));
} catch (e) { report.result = 'FAIL'; report.assertionFailure = e.stack; throw e; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2)); await browser.close(); }
