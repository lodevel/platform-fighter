import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';

if (!process.env.PF_BUILD_RECORD || !process.env.PF_REGISTRY_URL) throw Error('Set immutable build record and app URL');
const checkpoint = process.env.PF_BUILD_RECORD.replace(/-assets-staged\.json$/, '');
const build = JSON.parse(await readFile(process.env.PF_BUILD_RECORD, 'utf8'));
const metadataPath = checkpoint + '-pikachu-frames.json';
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const receivingPath = build.sourceLeafDirectory ? build.sourceLeafDirectory + '/pikachuStateHurtboxes.ts' : checkpoint + '-pikachuStateHurtboxes.ts';
const receiving = (await tsImport(new URL('../' + receivingPath, import.meta.url).pathname, import.meta.url)).PIKACHU_STATE_AUTHORED_HURTBOX_POSES;
const pinned = JSON.parse(await readFile(build.sourceHashes, 'utf8'));
assert.equal(createHash('sha256').update(await readFile(receivingPath)).digest('hex'), pinned['src/characters/pikachuStateHurtboxes.ts']);
assert.equal(createHash('sha256').update(await readFile(metadataPath)).digest('hex'), build.pikachuFramesSha256);
for (const path of ['src/match/MatchRng.ts', 'src/utils/Rng.ts', 'src/characters/referenceTrip.ts'])
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), pinned[path]);
const {MatchRng} = await tsImport(new URL('../src/match/MatchRng.ts', import.meta.url).pathname, import.meta.url);
const {referenceTripProbability} = await tsImport(new URL('../src/characters/referenceTrip.ts', import.meta.url).pathname, import.meta.url);
const seed = 5, expectedDraw = new MatchRng(seed).stream('combat-trip').next();
const routes = (process.env.PF_TRIP_ROUTES ?? 'wait,jump,attack,roll-forward,roll-back').split(',');
assert.ok(routes.every(route => ['wait', 'jump', 'attack', 'roll-forward', 'roll-back'].includes(route)));
const facings = (process.env.PF_TRIP_FACINGS ?? '1,-1').split(',').map(Number);
assert.ok(facings.every(facing => facing === 1 || facing === -1));
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-trip';
await mkdir(output, {recursive: true});
const report = {build, seed, expectedDraw, receivingPath, receivingSha256: createHash('sha256').update(await readFile(receivingPath)).digest('hex'),
  rows: [], errors: [], scope: 'Actual immutable MatchScene named combat-trip RNG and normal opposing down-tilt contact; no trip-state or RNG-value injection. Existing authored26-step observed trip uses native retained drawings0/23, not native SlipDown/SlipWait duration. Both-face full observed wait/body/12caps/floor, real recovery input branches and pause/replay freeze. Later source45/68/90 remain source-only; native common selector/rate/initial SlipDown and beta26 duration stay separate fidelity limits.'};
report.queryScope = 'Existing generic canAttack query is retained as a recorded value; trip control locks are proven by the normal resolver route and canUseItemsBeforeInput. A query-only discrepancy is reported separately from the observed normal-input lock.';
report.inputProvenance = 'Simulated InputResolver state consumed by genuine normal character input selection and real contact resolution; hardware keyboard/gamepad events and human feel are not measured by this probe.';
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-gpu']});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureTrip', n => page.screenshot({path: `${output}/${n}`}));
try {
  await page.goto(process.env.PF_REGISTRY_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, {timeout: 60000});
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  assert.equal(report.bundleSha256, build.bundleSha256);
  for (const facing of facings) for (const route of routes) {
    const row = await page.evaluate(async ({facing, route, seed}) => {
      const game = window.__game;
      for (const active of game.scene.getScenes(true)) game.scene.stop(active.scene.key);
      game.scene.start('MatchScene', {matchConfig: {mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: seed, itemFrequency: 'off', players: [
        {index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1'},
        {index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2'},
      ]}});
      const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause(); s.roundStartCountdown = 0; s.hitboxDebugLayer.setEnabled(true);
      let input = {}, opponentInput = {};
      s.inputResolver.getMoveVector = slot => ({x: (slot === 1 ? input : opponentInput).moveX ?? 0, y: (slot === 1 ? input : opponentInput).moveY ?? 0});
      s.inputResolver.isActionHeld = (slot, key) => (slot === 1 ? input : opponentInput)[key] === true;
      const step = (next = {}, second = {}) => {input = next; opponentInput = second; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();};
      const a = s.p1, floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
      a.resetForRound(floor.position.x, floor.bounds.min.y - 25); s.p2.resetForRound(floor.position.x + 55 * facing, floor.bounds.min.y - 25);
      a.setDamagePercent(0); s.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step();
      a.setFacing(facing); s.p2.setFacing(-facing);
      const read = () => {
        const sp = s.playerSlots[0].sprite;
        return {reaction: a.getReactionPresentationState(), recovery: a.getPikachuGroundRecoveryPresentationState(),
          tripped: a.isTripped(), knockedDown: a.isKnockedDown(), grounded: a.isGrounded(), facing: a.getFacing(),
          position: a.getPosition(), velocity: a.getVelocity(), percent: a.getDamagePercent(), hitlag: a.getHitlagRemaining(), hitstun: a.getHitstunRemaining(),
          move: a.getActiveAttack()?.move.id ?? null, attackAge: a.getActiveAttack()?.framesElapsed ?? null, special: a.getPikachuSpecialState(),
          dodge: a.getDodgeState(), grab: a.getGrabState(), canAttack: a.canAttack(), canUseItems: a.canUseItemsBeforeInput(),
          captureProtected: a.isCaptureProtected(), invincible: a.isInvincible(), jumpsquat: a.getJumpsquatRemaining(), jumps: a.getJumpsUsed(),
          receiving: a.getActiveHurtboxes(), texture: sp.texture.key, textureFrame: Number(sp.frame.name), origin: [sp.originX, sp.originY],
          spritePosition: {x: sp.x, y: sp.y}, scale: [sp.scaleX, sp.scaleY], rotation: sp.rotation, flipX: sp.flipX, flipY: sp.flipY,
          bodyMirror: Math.sign(sp.scaleX) * (sp.flipX ? -1 : 1), floorY: floor.bounds.min.y, stocks: s.stockTracker.getStocks(0),
          camera: {scrollX: s.cameras.main.scrollX, scrollY: s.cameras.main.scrollY, zoom: s.cameras.main.zoom}};
      };
      const stream = s.matchRng.stream('combat-trip'), originalNext = stream.next.bind(stream), draws = [];
      // Observe the actual named stream; do not change, force or consume a draw.
      stream.next = () => {const value = originalNext(); draws.push(value); return value;};
      const rngBefore = s.matchRng.snapshotState();
      // Direction is held before the attack edge, so the source route is a
      // deliberate crouched down-tilt rather than a same-frame posture change.
      for (let n = 0; n < 4; n++) step({}, {moveY: 1});
      step({}, {moveY: 1, attack: true});
      const source = s.p2.getActiveAttack();
      if (source?.move.id !== 'pikachu.down-tilt') throw Error('Normal opponent input did not select source down-tilt: ' + JSON.stringify({move: source?.move.id,
        grounded: s.p2.isGrounded(), canAttack: s.p2.canAttack(), position: s.p2.getPosition(), reaction: s.p2.getReactionPresentationState()}));
      const sourceMove = {id: source.move.id, damage: source.move.damage, tripChance: source.move.tripChance,
        collisionHits: source.move.collisionHits, hitWindows: source.move.hitWindows, startupFrames: source.move.startupFrames};
      const approach = [];
      for (let n = 0; n < 20 && a.getDamagePercent() === 0; n++) {step(); approach.push(read());}
      const impact = read(), frozen = [];
      while (a.getHitlagRemaining() > 0 && frozen.length < 30) {step(); frozen.push(read());}
      if (!a.isTripped()) throw Error('Genuine named RNG down-tilt did not trip the target');
      const entry = read(), trace = [], captures = [], seen = new Set(); let pause = null, replayFreeze = null;
      const capture = async label => {await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const screenshot = `trip-${facing}-${route}-${label}.png`; await window.__captureTrip(screenshot);
        const c = s.cameras.main, b = game.canvas.getBoundingClientRect();
        captures.push({screenshot, observation: read(), camera: {worldView: {x: c.worldView.x, y: c.worldView.y, width: c.worldView.width, height: c.worldView.height}, x: c.x, y: c.y, zoom: c.zoom, width: c.width, height: c.height}, canvas: {left: b.left, top: b.top, width: b.width, height: b.height, internalWidth: game.canvas.width, internalHeight: game.canvas.height}});};
      for (let n = 0; n < 35; n++) {
        const o = read(); trace.push(o); if (!o.tripped) break;
        const age = o.reaction.framesElapsed;
        if (!seen.has(o.textureFrame) || age === 25) {seen.add(o.textureFrame); await capture(age);}
        if (route === 'wait' && age === 5 && !pause) {const before = read(); for (let k = 0; k < 5; k++) s.update(0, s.physicsEngine.fixedTimestepMs); pause = {before, after: read()};}
        if (route === 'wait' && age === 6 && !replayFreeze) {
          const before = read(); a.armAttackerHitlag(4); const steps = [];
          for (let k = 0; k < 4; k++) {step({special: true, shield: true, dodge: true, grab: true}); steps.push(read());}
          replayFreeze = {before, steps, source: 'public replay freeze; not native trip hitlag'}; await capture('replay-freeze');
        }
        const branch = age === 7 && route !== 'wait' ? route === 'jump' ? {jump: true} : route === 'attack' ? {attack: true}
          : {moveX: route === 'roll-forward' ? facing : -facing} : null;
        step(branch ?? ([4, 15, 24].includes(age) ? {special: true, shield: true, dodge: true, grab: true} : {}));
      }
      const destination = read(); await capture('destination');
      for (let n = 0; n < 80 && (a.getPikachuGroundRecoveryPresentationState() || a.getActiveAttack()); n++) step();
      step(); const neutralFree = read(); step({attack: true}); const fresh = read(); await capture('fresh-jab');
      return {facing, route, seed, stream: 'combat-trip', draws, rngBefore, rngAfter: s.matchRng.snapshotState(), sourceMove,
        approach, impact, frozen, entry, trace, captures, pause, replayFreeze, destination, neutralFree, fresh};
    }, {facing, route, seed});
    report.rows.push(row);
    assert.equal(row.sourceMove.id, 'pikachu.down-tilt'); assert.deepEqual(row.draws, [expectedDraw]);
    assert.equal(row.impact.tripped, false); assert.ok(row.impact.hitlag > 0); assert.equal(row.impact.percent, row.sourceMove.damage * 1.05);
    const probability = referenceTripProbability({tripChance: row.sourceMove.tripChance, grounded: true, alreadyTripped: false, verticalVelocity: 0});
    row.probability = probability; assert.ok(expectedDraw < probability);
    assert.equal(row.entry.reaction.kind, 'trip'); assert.equal(row.entry.reaction.framesElapsed, 0); assert.equal(row.entry.hitstun, 0);
    const active = row.trace.filter(o => o.tripped);
    assert.deepEqual(active.map(o => o.reaction.framesElapsed), Array.from({length: route === 'wait' ? 26 : 8}, (_, i) => i));
    for (const o of active) {
      const clip = metadata.animations.trip, age = o.reaction.framesElapsed;
      const window = clip.frameWindows.find(w => w.startFrame <= age && age < w.endFrame);
      assert.equal(o.texture, 'char.pikachu.trip'); assert.equal(o.textureFrame, window.artFrameIndex); assert.equal(o.bodyMirror, facing);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      assert.deepEqual(o.receiving, receiving.find(p => p.sheet === 'trip' && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      assert.equal(o.receiving.length, 12); assert.ok(o.receiving.every(h => !h.intangible));
      assert.equal(o.invincible, false); assert.equal(o.captureProtected, false); assert.equal(o.grounded, true);
      assert.equal(o.canUseItems, false); assert.equal(o.move, null); assert.equal(o.special, null); assert.equal(o.jumpsquat, 0);
      assert.equal(o.dodge.active, null); assert.equal(o.grab.name, 'idle'); assert.equal(o.stocks, row.entry.stocks);
    }
    if (row.pause) {const {camera: ca, ...a} = row.pause.before, {camera: cb, ...b} = row.pause.after; assert.deepEqual(b, a);}
    if (row.replayFreeze) for (const o of row.replayFreeze.steps) {
      assert.deepEqual(o.reaction, row.replayFreeze.before.reaction); assert.deepEqual(o.receiving, row.replayFreeze.before.receiving);
      assert.ok(Math.abs(o.position.x - row.replayFreeze.before.position.x) < 1e-6); assert.ok(Math.abs(o.position.y - row.replayFreeze.before.position.y) < 1e-6);
    }
    if (route === 'attack') assert.equal(row.destination.move, 'pikachu.tripAttack');
    else assert.equal(row.destination.recovery.sheet, route === 'roll-forward' ? 'getup_roll' : route === 'roll-back' ? 'getup_roll_back' : 'getup');
    assert.equal(row.neutralFree.jumpsquat, 0); assert.equal(row.fresh.move, 'pikachu.jab');
    console.log(JSON.stringify({facing, route, result: 'PASS', captures: row.captures.length, probability}));
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) {report.result = 'FAIL'; report.assertionFailure = error.stack; throw error;}
finally {await writeFile(output + '/trip-match-observations.json', JSON.stringify(report, null, 2) + '\n'); await browser.close();}
