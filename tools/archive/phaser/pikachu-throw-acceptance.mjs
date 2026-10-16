import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4177/platform-fighter/';
const out = process.argv[3] ?? 'docs/review/2026-10-06/pikachu-character/throw-events/browser';
await mkdir(out, { recursive: true });
const report = { url, scope: 'Pikachu sourced catch-only throw timelines in the shared production runtime, using DK fixture bodies; no Pikachu roster/art acceptance', errors: [], scenarios: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 90000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  for (const facing of [1, -1]) for (const direction of ['forward', 'up']) {
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1007,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
    });
    await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1?.body);
    const result = await page.evaluate(({ facing, direction }) => {
      const scene = window.__game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
      let input = {};
      scene.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: player === 1 ? input.moveY ?? 0 : 0 });
      scene.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
      scene.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
      const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
      for (let frame = 0; frame < 120; frame++) step();
      const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      const x = floor.position.x, y = floor.bounds.min.y - 42;
      scene.p1.resetForRound(x, y); scene.p1.setFacing(facing);
      scene.p2.resetForRound(x + 70 * facing, y); scene.p2.setFacing(-facing);
      for (let frame = 0; frame < 12; frame++) step();
      const forward = { damage: 2, animationFrames: 29, recoveryFrames: 14,
        knockback: { x: 1, y: -1, scaling: 0, reference: { base: 55, growth: 110, angle: 45 } },
        heldTargetHits: [10, 14, 18, 22].map(frame => ({ frame, damage: 2, hitlagMultiplier: 0 })) };
      const up = { damage: 5, animationFrames: 15, recoveryFrames: 20,
        knockback: { x: 0, y: -1, scaling: 0, reference: { base: 48, growth: 129, angle: 90 } },
        heldTargetHits: [{ frame: 13, damage: 3, hitlagMultiplier: 1.6 }] };
      const source = scene.p1.getGrabSpec();
      scene.p1.setGrabSpec({ ...source, cargo: undefined, throws: { ...source.throws, forward, up } });
      step({ grab: true });
      for (let frame = 0; frame < 15; frame++) step();
      const captured = scene.p2.isGrabbed();
      step(direction === 'forward' ? { moveX: facing } : { moveY: -1 });
      const frames = [];
      const spec = direction === 'forward' ? forward : up;
      let releaseCalls = 0;
      const originalHit = scene.p2.applyHit.bind(scene.p2);
      scene.p2.applyHit = hit => { releaseCalls++; return originalHit(hit); };
      for (let wallFrame = 0; wallFrame < 100; wallFrame++) {
        const state = scene.p1.getGrabState();
        const elapsed = state.active?.framesElapsed ?? spec.animationFrames;
        const released = !scene.p2.isGrabbed();
        frames.push({ wallFrame, elapsed, percent: scene.p2.getDamagePercent(), held: !released,
          freeze: scene.p1.getHitlagRemaining(), state: state.name });
        if (released) break;
        step();
      }
      return { direction, facing, captured, frames, releaseCalls,
        engineVersion: scene.getMatchStartMetadata().engineVersion };
    }, { facing, direction });
    report.scenarios.push(result);
    assert.equal(result.captured, true);
    const hits = direction === 'forward' ? [[10, 2], [14, 2], [18, 2], [22, 2]] : [[13, 3]];
    for (const frame of result.frames) {
      const expected = hits.filter(([elapsed]) => elapsed <= frame.elapsed).reduce((sum, [, damage]) => sum + damage, 0)
        + (frame.held ? 0 : direction === 'forward' ? 2 : 5);
      assert.equal(frame.percent, expected, `${direction} facing ${facing} elapsed ${frame.elapsed}`);
    }
    assert.equal(result.frames.at(-1).held, false);
    assert.equal(result.releaseCalls, 1);
    if (direction === 'up') assert(result.frames.filter(frame => frame.elapsed === 13).length > 1, 'pre-hit freezes the source clock');
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, errors: report.errors }));
