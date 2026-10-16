import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const url = process.argv[2] ?? 'http://127.0.0.1:4179/platform-fighter/';
const out = process.argv[3] ?? 'docs/review/2026-10-06/pikachu-character/fair-clock/browser';
const { buildPikachuNormalMove } = await tsImport('../src/characters/pikachuNormalMoves.ts', import.meta.url);
const move = buildPikachuNormalMove('forward-air', undefined, { rehitClockPolicy: 'authored-attack-elapsed' });
await mkdir(out, { recursive: true });
await writeFile(`${out}/source-built-move.json`, JSON.stringify(move, null, 2));
const report = { url, scope: 'Source-built Pikachu fair in shared production MatchScene using DK fixture bodies and stationary one-pixel hurtbox; authored attack-elapsed repeat clock, injected simulation input, no victim launch/native timer/roster/art acceptance',
  moveSha256: createHash('sha256').update(JSON.stringify(move)).digest('hex'), errors: [], scenarios: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 90000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  for (const facing of [1, -1]) for (const firstFrame of [10, 11]) for (const freezeFrames of [0, 5]) {
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1021,
        itemFrequency: 'off', players: [
          { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
          { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
        ] } });
    });
    await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1?.body);
    const result = await page.evaluate(({ facing, firstFrame, freezeFrames, move }) => {
      const scene = window.__game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
      let input = {}, wallFrame = 0;
      scene.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: 0 });
      scene.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
      scene.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
      const step = (next = {}) => {
        input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); wallFrame++;
      };
      for (let frame = 0; frame < 120; frame++) step();
      const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
      const x = floor.position.x, y = floor.bounds.min.y - 450;
      scene.p1.resetForRound(x, y); scene.p2.resetForRound(x + 400 * facing, y);
      scene.p1.setFacing(facing); scene.p2.setFacing(-facing); step();
      scene.matter.body.setStatic(scene.p1.body, true); scene.matter.body.setStatic(scene.p2.body, true);
      // DK's canonical executeFair hook owns its fixture ID. Replace that
      // registered record with source-built data; only the routing ID changes.
      const fixtureMove = { ...move, id: 'donkeykong.fair' };
      scene.p1.addAttack(fixtureMove); scene.p1.setAerialForward(fixtureMove.id);
      const anchor = { ...scene.p1.getPosition() };
      scene.p2.getActiveHurtboxes = () => [{ id: 'fair-probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }];
      const hits = [], frames = [], groups = new Map();
      scene.hitboxDamageHandler.callback = (target, hit, context) => {
        if (target !== 1) return { confirmed: false };
        const active = scene.p1.getActiveAttack();
        hits.push({ wallFrame, elapsed: active.framesElapsed, damage: hit.damage, region: context.collisionHitId, sensor: active.hitboxBody.id });
        if (freezeFrames) scene.p1.armAttackerHitlag(freezeFrames);
        return { confirmed: true };
      };
      // Injected resolver path still exercises normal directional aerial dispatch.
      step({ moveX: facing, attack: true });
      if (scene.p1.getActiveAttack()?.move.id !== fixtureMove.id) throw new Error(`Source fair did not dispatch through directional aerial input: ${JSON.stringify({
        active: scene.p1.getActiveAttack()?.move.id, grounded: scene.p1.isGrounded(), facing: scene.p1.getFacing(),
        forward: scene.p1.getAerialForwardId(), previousAttack: scene.p1.prevAttackHeld, input,
      })}`);
      let staleSensorRejected = false;
      for (let frame = 0; frame < 180 && scene.p1.getActiveAttack(); frame++) {
        const before = scene.p1.getActiveAttack();
        const nextElapsed = before.framesElapsed + (scene.p1.isInHitlag() ? 0 : 1);
        scene.matter.body.setPosition(scene.p2.body, { x: anchor.x + (nextElapsed >= firstFrame ? 45 : 400) * facing, y: anchor.y + 17.5 });
        step();
        const active = scene.p1.getActiveAttack();
        const sensor = active?.hitboxBody;
        const group = sensor?.plugin.hitGroup;
        if (group && !groups.has(group)) groups.set(group, groups.size + 1);
        frames.push({ wallFrame, elapsed: active?.framesElapsed ?? null, hitlag: scene.p1.getHitlagRemaining(), sensor: sensor?.id ?? null,
          group: group ? groups.get(group) : null, regions: sensor?.plugin.collisionHits?.map(hit => ({ id: hit.id, rehitFrames: hit.rehitFrames })) ?? [] });
        if (!staleSensorRejected && sensor && active.framesElapsed >= firstFrame && active.framesElapsed <= 24) {
          // The live sensor is temporarily detached from the current action;
          // the production lookup must reject its attempt to borrow that clock.
          const liveAction = scene.p1.activeAttack;
          liveAction.hitboxBody = null;
          try { scene.hitboxDamageHandler.sampleHurtboxContacts([sensor]); }
          catch (error) {
            if (!String(error.message).includes('requires an explicit non-negative gameplay clock')) throw error;
            staleSensorRejected = true;
          } finally { liveAction.hitboxBody = sensor; }
        }
      }
      return { facing, firstFrame, freezeFrames, sourceMoveId: move.id, fixtureMoveId: fixtureMove.id, hits, frames, staleSensorRejected,
        finished: scene.p1.getActiveAttack() === null, engineVersion: scene.getMatchStartMetadata().engineVersion };
    }, { facing, firstFrame, freezeFrames, move });
    report.scenarios.push(result);
    const expectedLinks = Array.from({ length: 5 }, (_, i) => firstFrame + 3 * i);
    assert.deepEqual(result.hits.map(hit => hit.elapsed), [...expectedLinks, 26]);
    assert.deepEqual(result.hits.map(hit => hit.damage), [1.3, 1.3, 1.3, 1.3, 1.3, 4.8]);
    assert.equal(result.staleSensorRejected, true);
    assert.equal(result.finished, true);
    assert(result.frames.filter(frame => frame.elapsed === 25).every(frame => frame.sensor === null));
    const linkFrames = result.frames.filter(frame => frame.elapsed >= 10 && frame.elapsed <= 24);
    assert.equal(new Set(linkFrames.map(frame => frame.group)).size, 1, 'continuous linker group');
    assert(new Set(linkFrames.map(frame => frame.sensor)).size > 1, 'sensor replacement');
    assert(linkFrames.every(frame => frame.regions.length === 4 && frame.regions.every(hit => hit.rehitFrames === 3)));
    assert(result.frames.find(frame => frame.elapsed === 26).group !== linkFrames[0].group, 'new finisher group');
    if (freezeFrames) {
      assert(result.frames.filter(frame => frame.elapsed === firstFrame && frame.hitlag > 0).length > 1, 'attack clock pauses');
      assert(result.hits[1].wallFrame - result.hits[0].wallFrame > 3, 'physics elapsed time exceeds repeat interval');
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, errors: report.errors }));
