import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/ledge';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { scope: 'Actual stage-corner detection and InputResolver ledge options, both sides, source catch gate and fresh option action/protection clocks. Geometry/travel, fresh hang formula and dedicated ledge drawings remain unqualified.', errors: [], rows: [] };
page.on('pageerror', error => report.errors.push(error.message));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4216/platform-fighter/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'));
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(() => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 328,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const observe = () => ({ ledge: scene.p1.getLedgeHangState(), attack: scene.p1.getActiveAttack() ? {
      id: scene.p1.getActiveAttack().move.id, frame: scene.p1.getActiveAttack().framesElapsed } : null,
      invincible: scene.p1.isInvincible(), receiving: scene.p1.getActiveHurtboxes().map(h => ({ id: h.id, intangible: h.intangible === true })),
      position: scene.p1.getPosition(), grounded: scene.p1.isGrounded() });
    const rows = [];
    for (const side of ['left', 'right']) for (const option of ['climb', 'roll', 'jump', 'attack']) {
      const facing = side === 'left' ? 1 : -1;
      const edgeX = side === 'left' ? floor.bounds.min.x : floor.bounds.max.x;
      scene.p1.resetForRound(edgeX - facing * 18, floor.bounds.min.y + 6);
      scene.p2.resetForRound(floor.position.x, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      scene.p1.setFacing(facing); scene.p1.setDamagePercent(0); scene.p2.setDamagePercent(0);
      scene.matter.body.setVelocity(scene.p1.body, { x: 0, y: 1 });
      let caught = null;
      for (let frame = 0; frame < 15; frame++) { step(); if (scene.p1.isHangingOnLedge()) { caught = observe(); break; } }
      if (!caught) throw new Error(`Actual ${side} platform ledge did not catch`);
      // Holding up before native catch19 must leave the fighter latched.
      const catchTrace = [caught];
      for (let frame = 0; frame < 18; frame++) { step({ moveY: -1 }); catchTrace.push(observe()); }
      if (!scene.p1.isHangingOnLedge()) throw new Error(`Source catch gate released early ${side}/${option}`);
      step();
      const intent = option === 'climb' ? { moveY: -1 } : option === 'roll' ? { moveX: facing }
        : option === 'jump' ? { jump: true } : { attack: true };
      step(intent);
      const trace = [observe()];
      for (let frame = 0; frame < 65; frame++) {
        if (option === 'climb' && trace.at(-1).ledge.name !== 'climbing'
          || option === 'roll' && trace.at(-1).ledge.name !== 'rolling'
          || option === 'attack' && !trace.at(-1).attack
          || option === 'jump' && trace.length >= 14) break;
        step(); trace.push(observe());
      }
      rows.push({ side, option, tuning: scene.p1.getTuning().ledge, catchTrace, trace });
    }
    return rows;
  });
  assert.equal(report.rows.length, 8);
  for (const row of report.rows) {
    assert.equal(row.tuning.catchFrames, 19);
    assert.ok(row.catchTrace.every(frame => frame.ledge.name === 'hanging'), 'catch19 gate must suppress up option');
    if (row.option === 'climb' || row.option === 'roll') {
      const state = row.option === 'climb' ? 'climbing' : 'rolling';
      const active = row.trace.filter(frame => frame.ledge.name === state);
      assert.equal(active.length, row.option === 'climb' ? 32 : 49);
      assert.equal(active.filter(frame => frame.invincible).length, row.option === 'climb' ? 31 : 26);
    } else if (row.option === 'attack') {
      const active = row.trace.filter(frame => frame.attack);
      assert.equal(active[0].attack.id, 'pikachu.ledgeAttack');
      assert.equal(active[0].attack.frame, 0);
      assert.equal(active.filter(frame => frame.receiving.some(h => h.intangible)).length, 25);
    } else {
      assert.equal(row.trace[0].grounded, false);
      assert.equal(row.trace.filter(frame => frame.invincible).length, 12);
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  await page.screenshot({ path: `${output}/actual-ledge-option.png` });
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} catch (error) {
  report.result = 'FAIL'; report.assertionFailure = error.message; throw error;
} finally {
  await writeFile(`${output}/ledge-match-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
