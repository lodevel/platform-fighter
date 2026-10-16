import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const url = process.argv[2] ?? 'http://127.0.0.1:4179/platform-fighter/';
const out = process.argv[3] ?? 'docs/review/2026-10-06/pikachu-character/landing-browser';
const expectedBundle = process.env.PF_EXPECT_BUNDLE ?? 'index-v5AbW1PH.js';
const { buildPikachuNormalMove } = await tsImport('../src/characters/pikachuNormalMoves.ts', import.meta.url);
const { getAuthorableCharacterSpec } = await tsImport('../src/characters/authorableCharacterRegistry.ts', import.meta.url);
const { parseCharacterDataFile, serializeCharacterDataSpec } = await tsImport('../src/characters/characterSerializer.ts', import.meta.url);
// Explicit test-only pose keeps airborne contacts away from the landing probe.
// Root landing contacts retain the source builder's documented authored scale.
const outsideProbePose = () => ({ start: { x: 0, y: -300 }, end: { x: 0, y: -300 } });
const sourceMoves = Object.fromEntries(['back-air', 'down-air'].map(id => [id, buildPikachuNormalMove(id, outsideProbePose)]));
const slots = { 'back-air': 'bair', 'down-air': 'dair' };
const fixtureMoves = Object.fromEntries(Object.entries(sourceMoves).map(([id, move]) =>
  [slots[id], { ...move, id: `donkeykong.${slots[id]}` }]));
const spec = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec({
  ...getAuthorableCharacterSpec('donkeykong'), moves: fixtureMoves,
}))));
await mkdir(out, { recursive: true });
const sourceText = JSON.stringify(sourceMoves, null, 2);
const savedText = JSON.stringify(serializeCharacterDataSpec(spec), null, 2);
await writeFile(`${out}/source-built-moves.json`, sourceText);
await writeFile(`${out}/saved-dk-fixture.json`, savedText);
const report = { url, expectedBundle, checked: '2026-10-06',
  scope: 'Pikachu source-built automatic back/down-air landing contacts restored through production MatchScene saved fighter factory on DK fixture bodies; actual Matter floor and handler, one-pixel hurtbox probe, injected resolver input, no victim launch/native airborne anatomy/Pikachu roster/art or physical-device acceptance',
  sourceMovesSha256: createHash('sha256').update(sourceText).digest('hex'),
  savedFixtureSha256: createHash('sha256').update(savedText).digest('hex'), errors: [], scenarios: [], findings: [] };
report.sourceFiles = await Promise.all(['src/characters/pikachuNormalMoves.ts', 'src/characters/pikachuSourceMoves.ts',
  'src/characters/pikachuAttackData.ts', 'src/characters/characterSerializer.ts', 'tools/pikachu-landing-acceptance.mjs']
  .map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 90000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  assert.equal(new URL(report.bundle).pathname.split('/').at(-1), expectedBundle, 'immutable production bundle');
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  for (const id of ['back-air', 'down-air']) for (const facing of [1, -1]) {
    const cases = ['contact', 'late-contact', 'after-clear', 'edge-miss', 'autocancel-late', 'hitlag', 'interruption', 'after-finish1', 'after-finish5'];
    if (id === 'back-air') cases.push('autocancel-early');
    for (const kind of cases) {
      await page.evaluate(spec => {
        const game = window.__game;
        for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
        game.scene.start('MatchScene', { characterOverrides: [{ slotIndex: 1, spec }], labMode: true,
          matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1043, itemFrequency: 'off', players: [
            { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
            { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' },
          ] } });
      }, spec);
      await page.waitForFunction(() => window.__game.scene.getScene('MatchScene').p1?.body);
      const result = await page.evaluate(({ id, facing, kind, fixtureMoves }) => {
        const scene = window.__game.scene.getScene('MatchScene'); scene.physicsEngine.pause();
        let input = {}, wallFrame = 0;
        scene.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: player === 1 ? input.moveY ?? 0 : 0 });
        scene.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
        scene.inputResolver.getSmash = () => ({ buttonHeld: false, stickJustPressed: false, x: 0, y: 0 });
        const step = (next = {}) => {
          input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); wallFrame++;
        };
        for (let frame = 0; frame < 120; frame++) step();
        const floor = scene.baseStage.bodies.platformBodies.find(body => body.label === 'platform.solid');
        // Use the outer solid-floor segment: teleporting across a floating
        // platform activates MatchScene's legitimate pass-through assist.
        const x = floor.position.x + 450 * facing, y = floor.bounds.min.y - 450;
        scene.p1.resetForRound(x, y);
        scene.p2.resetForRound(floor.position.x - 450 * facing, floor.bounds.min.y - 42);
        scene.p1.setFacing(facing); scene.p2.setFacing(-facing); step();
        scene.matter.body.setStatic(scene.p1.body, true);
        for (let frame = 0; frame < 12; frame++) step();
        if (!scene.p2.isGrounded()) throw new Error('Remote target fixture must have real Matter ground support');
        // A remote pixel probe uses player2's actual grounded classification.
        // Its real DK body stays on the opposite floor segment, avoiding the
        // production fighter jostle rule while keeping ground-only filters real.
        const targetProbe = scene.matter.add.rectangle(x + 400 * facing, y, 1, 1, {
          isStatic: true, isSensor: true, label: scene.p2.body.label,
          collisionFilter: { ...scene.p2.body.collisionFilter }, plugin: { ...scene.p2.body.plugin },
        });
        scene.hitboxDamageHandler.registerPlayer(1, targetProbe);
        scene.p2.getActiveHurtboxes = () => [{ id: 'landing-probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }];
        const slot = id === 'back-air' ? 'bair' : 'dair';
        const expected = fixtureMoves[slot], landingId = expected.landingAttack.id;
        const restoredMove = scene.p1.getAttack(expected.id);
        const hits = [], frames = [], groups = new Map();
        scene.hitboxDamageHandler.callback = (target, hit, context) => {
          if (target !== 1) return { confirmed: false };
          const active = scene.p1.getActiveAttack();
          hits.push({ wallFrame, elapsed: active?.framesElapsed, moveId: active?.move.id, damage: hit.damage,
            region: context.collisionHitId, sensor: active?.hitboxBody?.id });
          return { confirmed: true };
        };
        // Back/down use Character's direction-specific registered aerial paths.
        step(id === 'back-air' ? { moveX: -facing, attack: true } : { moveY: 1, attack: true });
        if (scene.p1.getActiveAttack()?.move.id !== expected.id)
          throw new Error(`Directional ${id} dispatch failed: ${JSON.stringify({ active: scene.p1.getActiveAttack()?.move.id, grounded: scene.p1.isGrounded() })}`);
        const total = expected.startupFrames + expected.activeFrames + expected.recoveryFrames;
        const wantedElapsed = kind === 'autocancel-early' ? 2 : kind === 'autocancel-late' ? 37
          : kind === 'after-finish1' ? total + 1 : kind === 'after-finish5' ? total + 5 : id === 'back-air' ? 6 : 16;
        // Continue stepping after the action finishes to measure stale context.
        for (let elapsed = 1; elapsed < wantedElapsed; elapsed++) step();
        const airborneSensor = scene.p1.getActiveAttack()?.hitboxBody?.id ?? null;
        const preTouchdownContext = scene.p1.aerialLandingContext === null ? null : {
          id: scene.p1.aerialLandingContext.move.id, elapsed: scene.p1.aerialLandingContext.framesElapsed,
        };
        scene.matter.body.setStatic(scene.p1.body, false);
        scene.matter.body.setPosition(scene.p1.body, { x, y: floor.bounds.min.y - 43 });
        scene.matter.body.setVelocity(scene.p1.body, { x: 0, y: 4 });
        const beforeTouchdown = { position: { ...scene.p1.body.position }, bounds: JSON.parse(JSON.stringify(scene.p1.body.bounds)),
          velocity: scene.p1.getVelocity(), impulse: { ...scene.p1.body.positionImpulse }, static: scene.p1.body.isStatic, sensor: scene.p1.body.isSensor,
          floor: JSON.parse(JSON.stringify(floor.bounds)), stageBodies: scene.baseStage.bodies.platformBodies.map(body => ({ id: body.id, label: body.label, bounds: body.bounds })) };
        step();
        const touchdown = { wallFrame, grounded: scene.p1.isGrounded(), activeElapsed: scene.p1.getActiveAttack()?.framesElapsed,
          ordinaryFrames: scene.p1.pendingOrdinaryLandingFrames,
          position: scene.p1.getPosition(), floorTop: floor.bounds.min.y };
        if (!touchdown.grounded) throw new Error(`No real Matter floor touchdown: ${JSON.stringify({ beforeTouchdown, touchdown })}`);
        const lag = id === 'back-air' ? 18 : 22;
        const edge = id === 'back-air' ? 41 : 51;
        const arrival = kind === 'late-contact' ? 1 : kind === 'after-clear' ? 2 : 0;
        const probe = distance => {
          const p = scene.p1.getPosition();
          scene.matter.body.setPosition(targetProbe, { x: p.x + distance * facing, y: p.y + 5 });
        };
        if (kind === 'interruption') scene.p1.applyHit({ damage: 1, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1, hitlagMultiplier: 0 });
        let shieldFirstStep = null;
        for (let landingStep = 1; landingStep <= lag + 6; landingStep++) {
          const before = scene.p1.getActiveAttack();
          const nextElapsed = before?.move.id === landingId ? before.framesElapsed + (scene.p1.isInHitlag() ? 0 : 1) : 0;
          probe(nextElapsed >= arrival ? kind === 'edge-miss' ? edge : 30 : 400);
          step({ shield: true, moveX: facing });
          const active = scene.p1.getActiveAttack(), sensor = active?.hitboxBody, group = sensor?.plugin.hitGroup;
          if (group && !groups.has(group)) groups.set(group, groups.size + 1);
          const record = { landingStep, wallFrame, grounded: scene.p1.isGrounded(), moveId: active?.move.id ?? null,
            targetGrounded: scene.p2.isGrounded(),
            position: scene.p1.getPosition(), velocity: scene.p1.getVelocity(), ledgeState: scene.p1.getLedgeHangState().name,
            elapsed: active?.framesElapsed ?? null, facing: active?.facing ?? null, sensor: sensor?.id ?? null,
            group: group ? groups.get(group) : null, regions: sensor?.plugin.collisionHits ?? [],
            cooldown: scene.p1.getCooldownRemaining(), shield: scene.p1.isShielding(),
            hitlag: scene.p1.getHitlagRemaining(), canAttack: scene.p1.canAttack(), itemGateForNextInput: scene.p1.canUseItemsBeforeInput() };
          frames.push(record);
          if (record.shield && shieldFirstStep === null) shieldFirstStep = landingStep;
          if (kind === 'hitlag' && landingStep === 1) scene.p1.armAttackerHitlag(3);
        }
        return { id, kind, facing, lag, wantedElapsed, touchdown, preTouchdownContext, airborneSensor, restoredMove,
          ordinaryLandingTuning: { soft: scene.p1.getTuning().softLandingFrames, hard: scene.p1.getTuning().hardLandingFrames },
          landingSeparatelyRegistered: scene.p1.getAttack(landingId) !== undefined,
          hits, frames, shieldFirstStep, engineVersion: scene.getMatchStartMetadata().engineVersion };
      }, { id, facing, kind, fixtureMoves });
      report.scenarios.push(result);
      assert.deepEqual(result.restoredMove, JSON.parse(JSON.stringify(fixtureMoves[slots[id]])), 'saved JSON restored by production factory');
      assert.equal(result.landingSeparatelyRegistered, false, 'nested landing is automatic');
      if (!kind.startsWith('after-finish')) assert.equal(result.touchdown.activeElapsed, result.wantedElapsed);
      if (kind.startsWith('after-finish')) {
        const staleLanding = result.frames.some(frame => frame.moveId === sourceMoves[id].landingAttack.id);
        if (staleLanding) report.findings.push({ id, kind, facing, issue: 'Expired aerial retains automatic landing route beyond final autocancel frames',
          touchdown: result.touchdown, hits: result.hits, shieldFirstStep: result.shieldFirstStep });
        if (!staleLanding) {
          assert.equal(result.preTouchdownContext, null, 'completed aerial context retired');
          assert.equal(result.touchdown.activeElapsed, undefined);
          assert.equal(result.hits.length, 0);
          assert(result.frames.every(frame => frame.moveId === null && frame.cooldown === 0));
          assert.equal(result.shieldFirstStep, 1 + result.touchdown.ordinaryFrames);
        }
        continue;
      }
      if (kind.startsWith('autocancel')) {
        assert.equal(result.hits.length, 0);
        assert(result.frames.every(frame => frame.moveId === null && frame.cooldown === 0), 'autocancel has no landing attack or lag');
        assert.equal(result.shieldFirstStep, 1 + result.touchdown.ordinaryFrames, 'autocancel retains measured ordinary fixture landing only');
      } else if (kind === 'interruption') {
        assert.equal(result.hits.length, 0);
        assert(result.frames.every(frame => frame.moveId !== sourceMoves[id].landingAttack.id), 'interruption suppresses landing route');
      } else {
        const landing = result.frames.filter(frame => frame.moveId === sourceMoves[id].landingAttack.id);
        assert.equal(landing[0].elapsed, 0);
        assert.equal(landing[0].cooldown, result.lag);
        assert.equal(result.shieldFirstStep, result.lag + 1 + (kind === 'hitlag' ? 3 : 0), 'exact first actionable step');
        const firstActive = landing.filter(frame => frame.elapsed === 0 || frame.elapsed === 1);
        assert(firstActive.every(frame => frame.sensor !== null));
        assert(firstActive.every(frame => frame.targetGrounded), 'native ground-only landing contacts use actual target support');
        assert(firstActive.every(frame => frame.regions.length === 1 && frame.regions[0].damage === 4));
        assert.equal(new Set(firstActive.map(frame => frame.group)).size, 1, 'one strike across source frames');
        assert(landing.filter(frame => frame.elapsed >= 2).every(frame => frame.sensor === null), 'game3 clears');
        assert(landing.every(frame => !frame.shield && !frame.canAttack), 'landing commitment blocks actions');
        assert(firstActive.every(frame => frame.sensor !== result.airborneSensor), 'airborne sensor removed');
        if (kind === 'edge-miss' || kind === 'after-clear') assert.equal(result.hits.length, 0);
        else {
          assert.equal(result.hits.length, 1, 'landing strike deduplicates continuously overlapping target');
          assert.equal(result.hits[0].damage, 4);
          assert.equal(result.hits[0].elapsed, kind === 'late-contact' ? 1 : 0);
        }
        if (kind === 'hitlag') assert.equal(landing.filter(frame => frame.elapsed === 0).length, 4, 'landing clock pauses3 steps');
      }
    }
  }
  assert.deepEqual(report.errors, []);
  report.coreScenariosPassed = true;
  report.passed = report.findings.length === 0;
  assert.deepEqual(report.findings, [], 'post-animation landing context boundary');
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (browser) await browser.close();
}
console.log(JSON.stringify({ scenarios: report.scenarios.length, bundle: report.bundle, passed: report.passed, errors: report.errors }));
