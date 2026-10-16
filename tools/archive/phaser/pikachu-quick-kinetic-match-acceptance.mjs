import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/quick-kinetic';
const { PIKACHU_UFD_STATS: source, PIKACHU_REFERENCE_PIXELS_PER_UNIT: scale } =
  await tsImport(new URL('../src/characters/pikachuUfdStats.ts', import.meta.url).pathname, import.meta.url);
const verifyBody = process.env.PF_QUICK_BODY_CHECK === '1';
const metadata = verifyBody ? JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8')) : null;
const poses = verifyBody ? (await tsImport(process.env.PF_PIKACHU_PHASE_LEAF ?? new URL('../src/characters/pikachuSpecialPhaseHurtboxes.ts', import.meta.url).pathname, import.meta.url)).PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES : null;
const { STALE_FRESH_MULTIPLIER } = await tsImport(new URL('../src/characters/combat.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], sourceExpectations: { gravity: source.gravity * scale, fallCap: source.fallSpeed * scale,
  controlCap: source.airSpeed * scale * 0.6, startupUpAcceleration: -0.002666667 * scale },
  scope: 'Actual InputResolver both-facing aerial Quick startup, first/second burst, independent END reset, gravity phase and control limit, aerial69/83 endpoints and real-floor landing24. Native common ground STOP and exact common control integration remain unqualified. Missing Quick body strips remain explicit fallback art, not visually qualified.' };
if (verifyBody) report.scope = 'Actual InputResolver aerial one/two-burst both-facing69/83 kinetics plus grounded horizontal52 body routes; accepted startup/warp/ground or airEND windows and all12 receiving capsules, source native direction rotation, distinct mirrored Rot pivot and real Neck sensors. Real-floor landing24. Native common ground STOP and exact control integration remain separately unqualified; body acceptance requires actual screenshot review.';
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__captureQuick', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4229/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ verifyBody }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 852,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume();
      scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(b => b !== floor), columns = [];
    for (let x = floor.bounds.min.x + 200; x < floor.bounds.max.x - 300; x += 20)
      if (overhead.every(b => x + 25 < b.bounds.min.x || x - 25 > b.bounds.max.x)) columns.push(x);
    if (!columns.length) throw new Error('Quick needs clear floor column');
    const originX = columns[0], actor = scene.p1, rows = [];
    const read = () => { const sprite = scene.playerSlots[0].sprite; return { state: actor.getPikachuSpecialState(),
      position: actor.getPosition(), velocity: actor.getVelocity(), grounded: actor.isGrounded(), helpless: actor.isHelpless(),
      texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), receiving: actor.getActiveHurtboxes(),
      origin: [sprite.originX, sprite.originY], spritePosition: { x: sprite.x, y: sprite.y }, rotation: sprite.rotation,
      facing: actor.getFacing(), sensorPosition: actor.getActiveAttack()?.hitboxBody?.position ? { ...actor.getActiveAttack().hitboxBody.position } : null,
      camera: { zoom: scene.cameras.main.zoom, scrollX: scene.cameras.main.scrollX, scrollY: scene.cameras.main.scrollY } }; };
    for (const facing of [1, -1]) for (const second of [false, true]) {
      actor.resetForRound(originX, floor.bounds.min.y - 450); scene.p2.resetForRound(floor.bounds.max.x - 50, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      const inherited = actor.getVelocity(); step({ moveY: -1, special: true });
      const trace = [read()], captures = [];
      if (verifyBody) { const screenshot = `quick-${facing}-${second ? 'two' : 'one'}-0.png`;
        await window.__captureQuick(screenshot); captures.push({ observation: trace[0], screenshot }); }
      for (let frame = 1; frame <= 90; frame++) {
        let next = { moveY: -1 };
        if (second && frame >= 27 && frame <= 32) next = { moveX: 0.8 * facing, moveY: -0.6 };
        // Steering starts after the decision and last burst; it cannot create a second burst.
        if (frame >= (second ? 43 : 29)) next = { moveX: facing };
        step(next); const observation = read(); trace.push(observation);
        const captureFrames = verifyBody ? [4, 8, 14, 16, 19, ...(second ? [28, 30, 33, 43, 58, 73] : [29, 44, 59])]
          : [10, 14, 19, 27, second ? 33 : 34, second ? 60 : 50];
        if (captureFrames.includes(frame)) {
          const screenshot = `quick-${facing}-${second ? 'two' : 'one'}-${frame}.png`;
          await window.__captureQuick(screenshot); captures.push({ observation, screenshot });
        }
        if (!observation.state) break;
      }
      const ended = trace.at(-1); let landing = null;
      // Reset horizontal drift after ending so real-floor acceptance cannot fall off-stage.
      for (let n = 1; n <= 220 && !landing; n++) {
        step(); if (actor.isGrounded()) { const contact = read(); step(); landing = { stepsAfterEnding: n, contact,
          position: actor.getPosition(), floorY: floor.bounds.min.y,
          contactedSurface: scene.baseStage.bodies.platformBodies.filter(body =>
            actor.getPosition().x + 25 > body.bounds.min.x && actor.getPosition().x - 25 < body.bounds.max.x)
            .sort((a, b) => Math.abs(a.bounds.min.y - actor.getPosition().y - 25) - Math.abs(b.bounds.min.y - actor.getPosition().y - 25))
            .map(body => ({ label: body.label, top: body.bounds.min.y, left: body.bounds.min.x, right: body.bounds.max.x }))[0],
          state: actor.getLandingPresentationState(),
          remaining: actor.getAnimationActionState().landingRecoveryRemaining, helpless: actor.isHelpless() }; }
      }
      rows.push({ facing, second, inherited, trace, captures, ended, landing });
    }
    const baseFloorTrials = [];
    for (const facing of [1, -1]) {
      actor.resetForRound(originX, floor.bounds.min.y - 450); scene.p2.resetForRound(floor.bounds.max.x - 50, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      step({ moveY: -1, special: true }); let end = null, landing = null;
      for (let n = 1; n <= 220; n++) {
        step({ moveY: -1 }); if (!end && !actor.getPikachuSpecialState()) end = { step: n, helpless: actor.isHelpless() };
        if (end && actor.isGrounded()) { const contact = read(); step(); landing = { contact, position: actor.getPosition(),
          floorY: floor.bounds.min.y, remaining: actor.getAnimationActionState().landingRecoveryRemaining,
          state: actor.getLandingPresentationState(), helpless: actor.isHelpless() }; break; }
      }
      baseFloorTrials.push({ facing, end, landing });
    }
    const groundBodies = [];
    if (verifyBody) for (const facing of [1, -1]) {
      actor.resetForRound(facing === 1 ? floor.bounds.min.x + 200 : floor.bounds.max.x - 200, floor.bounds.min.y - 25);
      scene.p2.resetForRound(facing === 1 ? floor.bounds.min.x + 50 : floor.bounds.max.x - 50, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      step({ moveY: -1, special: true }); const trace = [], captures = [];
      for (let frame = 0; frame < 80; frame++) {
        const observation = read(); trace.push(observation); if (!observation.state) break;
        if ([0, 4, 8, 14, 16, 19, 29, 44].includes(frame)) { const screenshot = `quick-${facing}-ground-${frame}.png`;
          await window.__captureQuick(screenshot); captures.push({ observation, screenshot }); }
        step({ moveX: facing });
      }
      groundBodies.push({ facing, trace, captures });
    }
    const receiverContacts = [];
    if (verifyBody) for (const facing of [1, -1]) for (const placement of ['current', 'stale']) {
      // Deliberately small fixture receiver separates endpoints55px apart;
      // default Wolf's tall receiving body legitimately spans both positions.
      scene.p2.setTuning({ width: 8, height: 8 });
      actor.resetForRound(originX, floor.bounds.min.y - 450); scene.p2.resetForRound(floor.bounds.max.x - 50, floor.bounds.min.y - 4);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      step({ moveY: -1, special: true }); for (let n = 1; n <= 13; n++) step({ moveY: -1 });
      const before = read(); const pivot = { x: -4.682244956493378 * facing, y: -2.0922493934631348 };
      const theta = -Math.PI / 2 * facing, dx = 14.648604480827279 * facing - pivot.x, dy = -5.279687200092056 - pivot.y;
      const target = { x: before.position.x + pivot.x + dx * Math.cos(theta) - dy * Math.sin(theta),
        y: before.position.y + pivot.y + dx * Math.sin(theta) + dy * Math.cos(theta) - (placement === 'current' ? 55 : 0) };
      scene.p2.resetForRound(target.x, target.y); scene.p2.setDamagePercent(0); step({ moveY: -1 });
      const observation = read(), screenshot = `quick-contact-${facing}-${placement}.png`;
      await window.__captureQuick(screenshot);
      receiverContacts.push({ facing, placement, before, target, observation, screenshot,
        receiving: scene.p2.getActiveHurtboxes(), damage: scene.p2.getDamagePercent() });
    }
    return { rows, baseFloorTrials, groundBodies, receiverContacts };
  }, { verifyBody });
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} versus ${expected}`);
  report.baseFloorTrials = report.rows.baseFloorTrials; report.groundBodies = report.rows.groundBodies;
  report.receiverContacts = report.rows.receiverContacts; report.rows = report.rows.rows;
  for (const row of report.rows) {
    const active = row.trace.filter(o => o.state), at = frame => active.find(o => o.state.frame === frame);
    assert.deepEqual(active.map(o => o.state.frame), Array.from({ length: row.second ? 83 : 69 }, (_, i) => i));
    near(at(0).velocity.x, 0, 'startup clears X'); near(at(0).velocity.y, 0, 'startup clears Y');
    for (let frame = 0; frame < 14; frame++) near(at(frame).state.gravity, frame < 10 ? 0 : report.sourceExpectations.startupUpAcceleration, `startup gravity ${frame}`);
    near(at(14).velocity.y, -55, 'first vertical burst');
    for (const anchor of row.second ? [19, 33] : [19]) {
      near(at(anchor).velocity.x, 0, 'air END resets X'); near(at(anchor).velocity.y, 0, 'air END resets Y');
      for (let local = 0; local < 8; local++) near(at(anchor + local).state.gravity, 0, `END initial gravity ${anchor}+${local}`);
    }
    const ending = row.second ? 33 : 19;
    for (let frame = ending + 8; frame < active.length; frame++) {
      near(at(frame).state.gravity, report.sourceExpectations.gravity, `END restored gravity ${frame}`);
      near(at(frame).velocity.y, Math.min((frame - ending - 7) * report.sourceExpectations.gravity, report.sourceExpectations.fallCap), `END sourced fall ${frame}`);
      assert.ok(Math.abs(at(frame).velocity.x) <= report.sourceExpectations.controlCap + 1e-5);
    }
    near(at(row.second ? 60 : 50).velocity.x, row.facing * report.sourceExpectations.controlCap, 'actual END held-input reaches source cap');
    assert.equal(row.ended.state, null); assert.equal(row.ended.helpless, true); assert.equal(row.ended.grounded, false);
    assert.equal(row.landing?.remaining, 24); assert.equal(row.landing?.helpless, false);
    assert.equal(row.landing?.state?.kind, 'special');
    // Compare the collision observation. A moving platform can move between
    // that contact and the following input which installs landing recovery.
    assert.ok(Math.abs(row.landing.contact.position.y + 25 - row.landing.contactedSurface.top) < 1, 'real contact position at observed platform surface');
  }
  for (const row of report.baseFloorTrials) {
    assert.equal(row.end?.step, 69); assert.equal(row.end?.helpless, true);
    assert.equal(row.landing?.remaining, 24); assert.equal(row.landing?.helpless, false); assert.equal(row.landing?.state?.kind, 'special');
    assert.ok(Math.abs(row.landing.position.y + 25 - row.landing.floorY) < 1, 'neutral-drift clear-column real base floor');
  }
  if (verifyBody) for (const row of [...report.rows, ...report.groundBodies]) {
    if (report.groundBodies.includes(row)) {
      const active = row.trace.filter(o => o.state);
      assert.deepEqual(active.map(o => o.state.frame), Array.from({ length: active.length }, (_, i) => i));
      assert.ok(active.some(o => o.state.frame === 29 && o.grounded), 'actual grounded END local10 branch');
      assert.equal(row.trace.at(-1).state, null);
    }
    for (const o of row.trace.filter(o => o.state)) {
      const s = o.state, air = !s.grounded;
      const first = s.frame >= 14 && s.frame < s.firstBurstEnd;
      const second = s.second && s.frame >= s.secondBurstStart && s.frame < s.secondBurstEnd;
      const warp = first || second;
      const sheet = s.frame < 14 ? air ? 'up_special_air_start' : 'up_special_start' : warp ? 'up_special'
        : air ? 'up_special_air_end' : 'up_special_end';
      const local = s.frame < 14 ? s.frame : warp ? s.frame - (second ? s.secondBurstStart : 14)
        : s.frame - (s.second && s.frame >= s.secondBurstEnd ? s.secondBurstEnd : s.firstBurstEnd);
      const clip = metadata.animations[sheet], window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(o.texture, `char.pikachu.${sheet}`); assert.equal(o.textureFrame, window.artFrameIndex);
      const theta = warp ? Math.atan2(o.velocity.y, Math.abs(o.velocity.x)) * o.facing : 0;
      near(o.rotation, theta, 'source native directed sprite rotation'); near(s.bodyRotation, theta, 'source directed snapshot');
      const pivot = { x: -4.682244956493378, y: -2.0922493934631348 };
      const rotate = point => { const px = pivot.x * o.facing, x = point.x * o.facing - px, y = point.y - pivot.y;
        return { x: (px + x * Math.cos(theta) - y * Math.sin(theta)) * o.facing,
          y: pivot.y + x * Math.sin(theta) + y * Math.cos(theta) }; };
      if (theta !== 0) {
        const canonicalX = clip.root[0] / clip.frameWidth + pivot.x / (clip.frameWidth * clip.scaleToWorld);
        near(o.origin[0], o.facing === 1 ? canonicalX : 1 - canonicalX, 'mirrored source pivot originX');
        near(o.origin[1], clip.root[1] / clip.frameHeight - (25 - pivot.y) / (clip.frameHeight * clip.scaleToWorld), 'source pivot originY');
        near(o.spritePosition.x, o.position.x + pivot.x * o.facing, 'source sprite pivot worldX');
        near(o.spritePosition.y, o.position.y + pivot.y, 'source sprite pivot worldY');
      } else assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      const expected = poses.find(p => p.sheet === sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes;
      assert.equal(o.receiving.length, 12);
      for (let i = 0; i < expected.length; i++) for (const endpoint of ['start', 'end']) {
        const point = warp ? rotate(expected[i].capsule[endpoint]) : expected[i].capsule[endpoint];
        near(o.receiving[i].capsule[endpoint].x, point.x, 'same source receiving rotatedX');
        near(o.receiving[i].capsule[endpoint].y, point.y, 'same source receiving rotatedY');
      }
      if (warp) {
        const neck = rotate({ x: 14.648604480827279, y: -5.279687200092056 });
        near(o.sensorPosition.x, o.position.x + neck.x * o.facing, 'actual native rotated Neck sensorX');
        near(o.sensorPosition.y, o.position.y + neck.y, 'actual native rotated Neck sensorY');
      }
    }
  }
  for (const contact of report.receiverContacts) {
    near(contact.damage, contact.placement === 'current' ? 2 * STALE_FRESH_MULTIPLIER : 0,
      'actual current-root hit versus stale-root rejection on8x8 fixture receiver');
  }
  if (verifyBody) report.groundEndLimit = 'Observed grounded startup/firstwarp/END local0 and10 windows verified; sourceEND local25 is not necessarily reached while grounded on1180floor because current commonSTOP adapter retains33X, then sourceledge/situation transitions occur. No ground52/nativeSTOP parity claim from this fixture.';
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ cases: report.rows.length, groundBodyCases: report.groundBodies.length,
    captures: [...report.rows, ...report.groundBodies].flatMap(r => r.captures).length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/quick-kinetic-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
