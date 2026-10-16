import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
import {chromium} from 'playwright';

if (!process.env.PF_BUILD_RECORD || !process.env.PF_REGISTRY_URL) throw Error('Set immutable PF_BUILD_RECORD and PF_REGISTRY_URL');
const checkpoint = process.env.PF_BUILD_RECORD.replace(/-assets-staged\.json$/, '');
const build = JSON.parse(await readFile(process.env.PF_BUILD_RECORD, 'utf8'));
const metadata = JSON.parse(await readFile(checkpoint + '-pikachu-frames.json', 'utf8'));
const auxiliaryPath = build.sourceLeafDirectory ? build.sourceLeafDirectory + '/pikachuAuxiliaryBody.ts' : checkpoint + '-pikachuAuxiliaryBody.ts';
const auxiliary = await tsImport(new URL('../' + auxiliaryPath, import.meta.url).pathname, import.meta.url);
const receivingPath = build.sourceLeafDirectory + '/pikachuStateHurtboxes.ts';
const {selectPikachuStateHurtboxes} = await tsImport(new URL('../' + receivingPath, import.meta.url).pathname, import.meta.url);
const runtimePath = build.sourceLeafDirectory ? build.sourceLeafDirectory + '/pikachuLedgeJumpRuntime.ts' : null;
const runtime = runtimePath ? await tsImport(new URL('../' + runtimePath, import.meta.url).pathname, import.meta.url) : null;
const pinnedHashes = JSON.parse(await readFile(build.sourceHashes, 'utf8'));
assert.equal(createHash('sha256').update(await readFile(auxiliaryPath)).digest('hex'), pinnedHashes['src/characters/pikachuAuxiliaryBody.ts']);
assert.equal(createHash('sha256').update(await readFile(receivingPath)).digest('hex'), pinnedHashes['src/characters/pikachuStateHurtboxes.ts']);
if (runtimePath) assert.equal(createHash('sha256').update(await readFile(runtimePath)).digest('hex'), pinnedHashes['src/characters/pikachuLedgeJumpRuntime.ts']);
assert.equal(createHash('sha256').update(await readFile(checkpoint + '-pikachu-frames.json')).digest('hex'), build.pikachuFramesSha256);
const independentCollisionHelpers = {};
for (const path of ['src/characters/attackCollisionShapes.ts', 'src/characters/capsuleGeometry.ts']) {
  independentCollisionHelpers[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(independentCollisionHelpers[path], pinnedHashes[path]);
}
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-ledge-jump';
await mkdir(output, {recursive: true});
const report = {
  build, errors: [], rows: [], auxiliaryPath, runtimePath, independentCollisionHelpers, runtimeSha256: runtimePath ? createHash('sha256').update(await readFile(runtimePath)).digest('hex') : null,
  auxiliarySha256: createHash('sha256').update(await readFile(auxiliaryPath)).digest('hex'),
  scope: 'Actual immutable MatchScene source ledge catch -> normal simulated jump edge. Source12 start and27 cancellable flight share exact local drawing/body/12 receiving regions. Physical actor/support pair bypass and actual geometric clearance are distinct from vulnerability. Native common kinetics, motion/gameplay clock mapping and hardware bindings remain explicit beta limits.',
};
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--disable-gpu']});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureLedgeJump', n => page.screenshot({path: `${output}/${n}`}));
try {
  await page.goto(process.env.PF_REGISTRY_URL, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, {timeout: 60000});
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  assert.equal(report.bundleSha256, build.bundleSha256);
  await page.evaluate(({opponentCharacterId, boundaryOnly}) => {
    const game = window.__game;
    for (const active of game.scene.getScenes(true)) game.scene.stop(active.scene.key);
    game.scene.start('MatchScene', {matchConfig: {mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 2017, itemFrequency: 'off', players: [
      {index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1'},
      {index: 2, characterId: opponentCharacterId, paletteIndex: 1, inputType: 'keyboard_p2'},
    ]}});
    const s = game.scene.getScene('MatchScene');
    s.physicsEngine.pause(); s.roundStartCountdown = 0; s.hitboxDebugLayer.setEnabled(true);
    let input = {}, opponentInput = {};
    s.inputResolver.getMoveVector = slot => ({x: (slot === 1 ? input : opponentInput).moveX ?? 0, y: (slot === 1 ? input : opponentInput).moveY ?? 0});
    s.inputResolver.isActionHeld = (slot, key) => (slot === 1 ? input : opponentInput)[key] === true;
    const step = (next = {}, second = {}) => {input = next; opponentInput = second; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause();};
    const a = s.p1, floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const read = () => {
      const sp = s.playerSlots[0].sprite;
      return {
        ledgeJump: a.getPikachuLedgeJumpPresentationState(),
        attachment: a.getPikachuLedgeJumpRootMotionState?.() ?? a.getPikachuLedgeAttachmentState(),
        ledge: a.getLedgeHangState(), position: a.getPosition(), velocity: a.getVelocity(),
        geometricBottom: Math.max(...a.body.vertices.map(v => v.y)),
        geometricX: {min: Math.min(...a.body.vertices.map(v => v.x)), max: Math.max(...a.body.vertices.map(v => v.x))},
        geometricHalfHeight: (Math.max(...a.body.vertices.map(v => v.y)) - Math.min(...a.body.vertices.map(v => v.y))) / 2,
        grounded: a.isGrounded(), facing: a.getFacing(), hitlag: a.getHitlagRemaining(),
        canAttack: a.canAttack(), canUseItems: a.canUseItemsBeforeInput(), jumps: a.getJumpsUsed(),
        jump: a.getJumpPresentationState(), jumpsquat: a.getJumpsquatRemaining(),
        locomotion: a.getLocomotionState(), ordinary: a.getOrdinaryPresentationState(),
        landing: a.getLandingPresentationState(), item: a.getPikachuItemPresentationState(),
        move: a.getActiveAttack()?.move.id ?? null, special: a.getPikachuSpecialState(),
        dodge: a.getDodgeState(), invincible: a.isInvincible(), captureProtected: a.isCaptureProtected(), helpless: a.isHelpless(),
        receiving: a.getActiveHurtboxes(), stocks: s.stockTracker.getStocks(0), percent: a.getDamagePercent(),
        texture: sp.texture.key, textureFrame: Number(sp.frame.name), origin: [sp.originX, sp.originY],
        spritePosition: {x: sp.x, y: sp.y}, scale: [sp.scaleX, sp.scaleY], rotation: sp.rotation,
        flipX: sp.flipX, flipY: sp.flipY, bodyMirror: Math.sign(sp.scaleX) * (sp.flipX ? -1 : 1),
        support: {bounds: floor.bounds, isSensor: floor.isSensor},
        opponent: {position: s.p2.getPosition(), grounded: s.p2.isGrounded()},
        camera: {scrollX: s.cameras.main.scrollX, scrollY: s.cameras.main.scrollY, zoom: s.cameras.main.zoom},
      };
    };
    const captureView = () => {
      const c = s.cameras.main, b = game.canvas.getBoundingClientRect();
      return {camera: {worldView: {x: c.worldView.x, y: c.worldView.y, width: c.worldView.width, height: c.worldView.height}, x: c.x, y: c.y, zoom: c.zoom, width: c.width, height: c.height}, canvas: {left: b.left, top: b.top, width: b.width, height: b.height, internalWidth: game.canvas.width, internalHeight: game.canvas.height}};
    };
    window.__runLedgeJump = async ({facing, route}) => {
      const corner = {x: facing === 1 ? floor.bounds.min.x : floor.bounds.max.x, y: floor.bounds.min.y};
      a.resetForRound(corner.x - 18 * facing, corner.y + 6);
      s.p2.resetForRound(floor.position.x, corner.y - s.p2.getTuning().height / 2);
      a.setFacing(facing); s.matter.body.setVelocity(a.body, {x: 0, y: 1});
      let caught = null;
      for (let n = 0; n < 15; n++) {step(); if (a.isHangingOnLedge()) {caught = read(); break;}}
      if (!caught) throw Error('Actual supporting corner catch missed');
      for (let n = 0; n < 19; n++) step();
      const before = read(); step({jump: true});
      const trace = [], captures = [], pauses = [], freezes = [], cells = new Set();
      let wall = null, cancelled = null;
      if (route === 'contact-boundary') {
        while (a.getPikachuLedgeJumpPresentationState()?.phase === 'start' && a.getPikachuLedgeJumpPresentationState().framesElapsed < 6) step();
        s.p2.resetForRound(corner.x + 46 * facing, corner.y - s.p2.getTuning().height / 2);
        s.p2.setFacing(-facing); step(); step(); step();
        const beforeContact = read();
        if (beforeContact.ledgeJump?.phase !== 'start' || beforeContact.ledgeJump.framesElapsed !== 9) throw Error('Exact real-jab boundary fixture missed source age9');
        const acceptedHitCalls = [], originalApplyHit = a.applyHit.bind(a);
        // Observe the real router's accepted contact immediately before damage;
        // a protected regional overlap never calls applyHit at all.
        a.applyHit = (...args) => {
          acceptedHitCalls.push({ledgeJump: a.getPikachuLedgeJumpPresentationState(),
            position: a.getPosition(), percentBefore: a.getDamagePercent(), receiving: a.getActiveHurtboxes()});
          return originalApplyHit(...args);
        };
        step({}, {attack: true});
        for (let n = 0; n < 8; n++) {
          const observation = read(), attack = s.p2.getActiveAttack();
          const hitWindow = attack?.move.hitWindows?.find(w => w.startFrame <= attack.framesElapsed && attack.framesElapsed < w.endFrame);
          observation.attacker = {position: s.p2.getPosition(), facing: s.p2.getFacing(), move: attack?.move.id ?? null,
            age: attack?.framesElapsed ?? null, collisionHits: hitWindow?.collisionHits ?? attack?.move.collisionHits ?? [],
            sensor: attack?.hitboxBody ? {position: {...attack.hitboxBody.position}} : null};
          trace.push(observation);
          if (n === 0 || observation.attacker.sensor) {
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const screenshot = `ledge-jump-${facing}-${route}-${n}.png`;
            await window.__captureLedgeJump(screenshot); captures.push({screenshot, observation, ...captureView()});
          }
          if (observation.percent > beforeContact.percent) break;
          step();
        }
        return {facing, route, corner, caught, before, beforeContact, acceptedHitCalls, trace, captures, pauses, freezes,
          ended: read(), after: [], wall: null, contactBoundary: true};
      }
      if (route === 'wall') wall = s.matter.add.rectangle(corner.x + 18 * facing, corner.y - 80, 10, 220, {
        isStatic: true, label: 'completion.runtime.ledge-jump-wall',
        collisionFilter: {category: floor.collisionFilter.category, mask: floor.collisionFilter.mask},
      });
      const capture = async label => {
        if (boundaryOnly && label !== 'ordinary-landed') return;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const screenshot = `ledge-jump-${facing}-${route}-${label}.png`;
        await window.__captureLedgeJump(screenshot); captures.push({screenshot, observation: read(), ...captureView()});
      };
      for (let n = 0; n < 125; n++) {
        const observation = read(); trace.push(observation);
        const owner = observation.ledgeJump;
        if (owner) {
          const key = owner.phase + ':' + observation.textureFrame;
          if (!cells.has(key) || owner.phase === 'start' && owner.framesElapsed === 11) {
            cells.add(key); await capture(owner.phase + '-' + owner.framesElapsed);
          }
          if (route === 'freeze' && (owner.phase === 'start' && owner.framesElapsed === 4 || owner.phase === 'flight' && [7, 26].includes(owner.framesElapsed))) {
            if (!pauses.some(p => p.before.ledgeJump.phase === owner.phase && p.before.ledgeJump.framesElapsed === owner.framesElapsed)) {
              const paused = read(); for (let k = 0; k < 5; k++) s.update(0, s.physicsEngine.fixedTimestepMs);
              pauses.push({before: paused, after: read()});
              a.armAttackerHitlag(4); const frozen = [];
              for (let k = 0; k < 4; k++) {step(); frozen.push(read());}
              freezes.push({before: paused, frozen, source: 'public replay armAttackerHitlag; not source-native cliff hitlag'});
              await capture(owner.phase + '-freeze-' + owner.framesElapsed);
            }
          }
          if (owner.phase === 'flight' && owner.framesElapsed === 1 && ['airjump', 'attack', 'special', 'dodge'].includes(route)) {
            const intent = route === 'airjump' ? {jump: true} : route === 'attack' ? {attack: true} : route === 'special' ? {special: true} : {shield: true};
            step(intent); cancelled = read(); await capture('fresh-' + route); break;
          }
        }
        if (!owner && n > 11) {await capture('retired'); break;}
        // Consume requests during the startup so no late queued jump can leak.
        const intent = owner?.phase === 'start' && [5, 10, 11].includes(owner.framesElapsed)
          ? {jump: true, attack: true, special: true, moveX: -facing} : {};
        step(intent);
      }
      const ended = read(), after = [];
      if (['normal', 'freeze'].includes(route)) for (let n = 0; n < 100; n++) {
        step(); after.push(read()); if (a.isGrounded() && n > 2) break;
      }
      if (after.length) await capture('ordinary-landed');
      const wallReport = wall ? {bounds: {...wall.bounds}, maximumGeometricX: Math.max(...trace.map(o => (o.position.x - corner.x) * facing)),
        contacts: trace.filter(o => Math.min(o.geometricX.max, wall.bounds.max.x) > Math.max(o.geometricX.min, wall.bounds.min.x))
          .map(o => ({ledgeJump: o.ledgeJump, penetration: Math.min(o.geometricX.max, wall.bounds.max.x) - Math.max(o.geometricX.min, wall.bounds.min.x), position: o.position}))} : null;
      if (wall) s.matter.world.remove(wall);
      return {facing, route, corner, caught, before, trace, captures, pauses, freezes, cancelled, ended, after, wall: wallReport, tuning: a.getTuning()};
    };
  }, {opponentCharacterId: (process.env.PF_LEDGE_JUMP_ROUTES ?? '').includes('contact') ? 'pikachu' : 'donkeykong', boundaryOnly: process.env.PF_LEDGE_JUMP_BOUNDARY_ONLY === '1'});
  const routes = (process.env.PF_LEDGE_JUMP_ROUTES ?? 'normal,freeze,airjump,attack,special,dodge,wall').split(',');
  for (const facing of [1, -1]) for (const route of routes) {
    const row = await page.evaluate(args => window.__runLedgeJump(args), {facing, route});
    report.rows.push(row);
    assert.equal(row.before.ledge.name, 'hanging');
    if (row.contactBoundary) {
      const {selectAttackCollisionHit} = await tsImport(new URL('../src/characters/attackCollisionShapes.ts', import.meta.url).pathname, import.meta.url);
      const {posedCapsule} = await tsImport(new URL('../src/characters/capsuleGeometry.ts', import.meta.url).pathname, import.meta.url);
      const sensors = row.trace.filter(o => o.attacker.sensor);
      assert.equal(sensors.length, 2, 'one real jab straddles source start/flight');
      const lastProtected = sensors[0], vulnerable = sensors[1];
      assert.deepEqual(lastProtected.ledgeJump, {phase: 'start', framesElapsed: 11, facing});
      assert.ok(lastProtected.receiving.every(h => h.intangible === true));
      assert.equal(lastProtected.percent, row.beforeContact.percent);
      assert.ok(selectAttackCollisionHit(lastProtected.attacker.collisionHits, lastProtected.attacker.position, lastProtected.attacker.facing,
        lastProtected.receiving.map(h => posedCapsule(h.capsule, lastProtected.position, facing)), lastProtected.grounded),
      'real jab overlaps source start receiving when protection is ignored');
      assert.ok(vulnerable.percent > row.beforeContact.percent, 'next active step hits first source flight phase');
      assert.equal(row.acceptedHitCalls.length, 1, 'protected contact never calls damage');
      assert.deepEqual(row.acceptedHitCalls[0].ledgeJump, {phase: 'flight', framesElapsed: 0, facing},
        'real collision router accepts the exact first source flight step');
      assert.equal(vulnerable.ledgeJump, null, 'actual vulnerable hit interrupts source flight');
      assert.ok(vulnerable.hitlag > 0); assert.equal(vulnerable.attacker.move, 'pikachu.jab');
      console.log(JSON.stringify({facing, route, result: 'PASS', captures: row.captures.length})); continue;
    }
    assert.equal(row.trace[0].ledgeJump.phase, 'start'); assert.equal(row.trace[0].ledgeJump.framesElapsed, 0); assert.equal(row.trace[0].ledgeJump.facing, facing);
    const start = row.trace.filter(o => o.ledgeJump?.phase === 'start');
    assert.deepEqual(start.map(o => o.ledgeJump.framesElapsed), Array.from({length: 12}, (_, i) => i));
    for (const o of row.trace) {
      const owner = o.ledgeJump; if (!owner) continue;
      const sheet = owner.phase === 'start' ? 'ledge_jump_start' : 'ledge_jump';
      const pose = auxiliary.selectPikachuAuxiliaryBody(sheet, owner.framesElapsed);
      assert.ok(pose); assert.equal(o.texture, 'char.pikachu.' + sheet); assert.equal(o.textureFrame, pose.artFrameIndex);
      assert.equal(o.receiving.length, 12); assert.equal(o.bodyMirror, facing);
      const clip = metadata.animations[sheet]; assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      const basis = facing * o.facing;
      const expected = pose.hurtboxes.map(h => ({...h, ...(owner.phase === 'start' ? {intangible: true} : {}), offsetX: h.offsetX * basis,
        capsule: {start: {x: h.capsule.start.x * basis, y: h.capsule.start.y}, end: {x: h.capsule.end.x * basis, y: h.capsule.end.y}, radius: h.capsule.radius}}));
      assert.deepEqual(o.receiving, expected, 'drawing and exact source receiving agree');
      assert.equal(o.support.isSensor, false, 'support body itself remains solid');
      assert.equal(o.opponent.grounded, true, 'other actor remains supported');
      assert.equal(o.stocks, row.caught.stocks);
      if (owner.phase === 'start') {
        assert.equal(o.captureProtected, true, 'all source start receiving regions reject capture');
        assert.equal(o.canAttack, false); assert.equal(o.canUseItems, false); assert.equal(o.move, null); assert.equal(o.special, null); assert.equal(o.jumpsquat, 0);
        if (route !== 'wall') {
          const offset = runtime?.pikachuLedgeJumpStartOffset(owner.framesElapsed, o.geometricHalfHeight) ?? {x: -8.999999761581421 + pose.sourceRootDelta.x, y: 50.236501693725586 + pose.sourceRootDelta.y - o.geometricHalfHeight};
          const expectedX = row.corner.x + offset.x * facing;
          assert.ok(Math.abs(o.position.x - expectedX) < .1, 'source start X, without blocked catchup');
          const expectedY = row.corner.y + offset.y;
          assert.ok(Math.abs(o.position.y - expectedY) < .6, 'source start physical root');
        }
      } else assert.equal(o.invincible, false, 'source start protection does not spill into flight');
    }
    for (const pause of row.pauses) {
      const {camera: ca, ...a} = pause.before, {camera: cb, ...b} = pause.after;
      assert.deepEqual(b, a, 'pause freezes action/body/receiving');
    }
    for (const freeze of row.freezes) for (const o of freeze.frozen) {
      assert.deepEqual(o.ledgeJump, freeze.before.ledgeJump); assert.deepEqual(o.position, freeze.before.position);
      assert.deepEqual(o.receiving, freeze.before.receiving); assert.equal(o.textureFrame, freeze.before.textureFrame);
    }
    if (row.cancelled) {
      assert.equal(row.cancelled.ledgeJump, null, 'fresh flight action retires presentation immediately');
      if (route === 'airjump') {assert.equal(row.cancelled.jumps, 2); assert.ok(row.cancelled.velocity.y < 0); assert.equal(row.cancelled.jump.kind, 'air');}
      if (route === 'attack') assert.equal(row.cancelled.move, 'pikachu.neutral-air');
      if (route === 'special') assert.ok(row.cancelled.special);
      if (route === 'dodge') assert.equal(row.cancelled.dodge.active?.kind, 'air');
    }
    if (['normal', 'freeze'].includes(route)) {
      const flight = row.trace.filter(o => o.ledgeJump?.phase === 'flight');
      assert.deepEqual(flight.map(o => o.ledgeJump.framesElapsed), Array.from({length: 27}, (_, i) => i));
      assert.equal(flight[0].jumps, 1); assert.equal(flight[0].jumpsquat, 0); assert.ok(flight[0].velocity.y < 0);
      assert.equal(row.after.at(-1).grounded, true, 'ordinary gravity returns to actual support');
      assert.equal(row.after.at(-1).ledgeJump, null);
      const landed = row.after.at(-1);
      assert.equal(landed.texture, 'char.pikachu.run'); assert.equal(landed.textureFrame, 0);
      assert.equal(landed.receiving.length, 12, 'first real grounded contact pairs reviewed run0 drawing with source receiving');
      assert.deepEqual(landed.receiving, selectPikachuStateHurtboxes('run', 0));
    }
    if (route === 'wall') {
      assert.ok(row.wall.contacts.length, 'different actual wall contacts the actor');
      assert.ok(row.wall.contacts.every(c => c.penetration < .6), 'geometric wall penetration stays within solver slop');
      const last = start.at(-1);
      assert.ok((row.corner.x - last.position.x) * facing > 2, 'blocked source displacement was not caught up absolutely');
    }
    console.log(JSON.stringify({facing, route, result: 'PASS', captures: row.captures.length}));
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) {report.result = 'FAIL'; report.assertionFailure = error.stack; throw error;}
finally {await writeFile(output + '/ledge-jump-match-observations.json', JSON.stringify(report, null, 2) + '\n'); await browser.close();}
