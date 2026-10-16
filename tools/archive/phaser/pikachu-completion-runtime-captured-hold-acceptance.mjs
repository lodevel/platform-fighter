import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-captured-hold';
const buildRecord = process.env.PF_BUILD_RECORD ?? '.tmp/pikachu-airjump-tumble-production-assets-staged.json';
const checkpoint = process.env.PF_CHECKPOINT ?? buildRecord.replace(/-assets-staged\.json$/, '');
const build = JSON.parse(await readFile(buildRecord, 'utf8'));
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? `${checkpoint}-pikachu-frames.json`, 'utf8'));
const captureOnly = true;
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL(`../${checkpoint}-pikachuStateHurtboxes.ts`, import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual production MatchScene simulated resolver source standing grab catches real ground/air Pikachu receivers both facings; observed captive default high-body loop/root/12caps, actual pummel hit-stop freezes captive age. Ground-captor clearance requires the accompanying immutable alpha audit. Capture-duration/mash qualification and native hi-low/bone attachment parity are separate scopes.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuGrab', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4242/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.build = build;
  assert.equal(report.bundleSha256, build.bundleSha256);
  report.observations = await page.evaluate(async ({ metadata, captureOnly }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 838,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : input.victimActions ? .5 : 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 ? input[action] === true
      : input.victimActions === true && ['attack', 'special', 'jump'].includes(action);
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const actor = scene.p1, rows = [], contacts = [];
    const reset = (facing, gap) => {
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.position.x + facing * gap, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing); scene.p2.setFacing(-facing);
    };
    const read = () => { const sprite = scene.playerSlots[0].sprite, targetSprite = scene.playerSlots[1].sprite;
      return { presentation: actor.getGrabPresentationState(), grab: actor.getGrabState(),
        hitlag: actor.getHitlagRemaining(), targetHitlag: scene.p2.getHitlagRemaining(), targetPercent: scene.p2.getDamagePercent(),
        receiving: actor.getActiveHurtboxes(), texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
        origin: [sprite.originX, sprite.originY], bodyMirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1),
        captured: scene.p2.isGrabbed(), activeCatch: actor.grabHitboxBody !== null,
        victimMove: scene.p2.getActiveAttack()?.move.id ?? null,
        victimSpecial: scene.p2.getPikachuSpecialState(), victimJumps: scene.p2.getJumpsUsed(),
        targetBody: { presentation: scene.p2.getCapturePresentationState(),
          texture: targetSprite.texture.key, textureFrame: Number(targetSprite.frame.name),
          origin: [targetSprite.originX, targetSprite.originY],
          position: scene.p2.getPosition(), spritePosition: { x: targetSprite.x, y: targetSprite.y },
          scale: [targetSprite.scaleX, targetSprite.scaleY], rotation: targetSprite.rotation,
          flipX: targetSprite.flipX, flipY: targetSprite.flipY, floorY: floor.bounds.min.y,
          bodyMirror: Math.sign(targetSprite.scaleX) * (targetSprite.flipX ? -1 : 1),
          facing: scene.p2.getFacing(), receiving: scene.p2.getActiveHurtboxes() } }; };
    for (const facing of [1, -1]) {
      for (const variant of captureOnly ? [] : ['standing', 'dash', 'pivot']) {
      const sheet = { standing: 'grab', dash: 'dash_grab', pivot: 'pivot_grab' }[variant];
      if (!metadata.animations[sheet]) continue;
      reset(facing, 400);
      if (variant !== 'standing') {
        for (let n = 0; n < 24; n++) step({ moveX: facing });
        scene.p2.setPosition(actor.getPosition().x + facing * 500, floor.bounds.min.y - 25);
      }
      step({ grab: true, moveX: variant === 'pivot' ? -facing : variant === 'dash' ? facing : 0 });
      const trace = [], captures = [];
      for (let n = 0; n < 50; n++) {
        const observation = read(); trace.push(observation);
        if (!['whiffStartup', 'whiffActive', 'whiffRecovery'].includes(observation.grab.name)) break;
        const age = observation.presentation.framesElapsed;
        if (metadata.animations[sheet].frameWindows.some(w => w.startFrame === age)) {
          const screenshot = `${sheet}-${facing}-${age}.png`; await window.__capturePikachuGrab(screenshot);
          captures.push({ observation, screenshot });
        }
        step();
      }
      rows.push({ facing, variant, sheet, trace, captures });
      }
      for (const situation of ['ground', 'air']) {
        reset(facing, 45);
        if (situation === 'air') scene.p2.setPosition(floor.position.x + facing * 45, floor.bounds.min.y - 60);
        let connected = null;
        const original = actor.resolveGrabConnect.bind(actor);
        actor.resolveGrabConnect = target => { connected = { targetGrounded: target.isGrounded(),
          sourceClock: actor.getGrabPresentationState(), targetPosition: target.getPosition() }; return original(target); };
        step({ grab: true });
        for (let n = 0; n < 12 && !scene.p2.isGrabbed(); n++) step();
        const contact = { facing, situation, connected, observation: read(), targetVelocity: scene.p2.getVelocity(), holding: [], pummel: [] };
        const entryScreenshot = `captured-${facing}-${situation}-entry.png`;
        await window.__capturePikachuGrab(entryScreenshot);
        contact.entryScreenshot = entryScreenshot;
        contacts.push(contact);
        if (situation === 'ground' && metadata.animations.grab_hold && scene.p2.isGrabbed()) {
          for (const target of [0, 8, 15, 23, 30, 45, 60]) {
            for (let n = 0; n < 90 && actor.getGrabState().active.framesElapsed < target; n++) step({ victimActions: target >= 30 });
            const screenshot = `grab_hold-${facing}-${target}.png`;
            await window.__capturePikachuGrab(screenshot); contact.holding.push({ observation: read(), screenshot });
          }
          if (metadata.animations.pummel) {
            step({ attack: true });
            const seen = new Set();
            for (let n = 0; n < 30 && actor.getGrabState().active?.pummelCooldownRemaining > 0; n++) {
              const observation = read(), local = 5 - observation.grab.active.pummelCooldownRemaining;
              let screenshot = null;
              if ([0, 2, 4].includes(local) && !seen.has(local)) {
                seen.add(local); screenshot = `pummel-${facing}-${local}.png`; await window.__capturePikachuGrab(screenshot);
              }
              contact.pummel.push({ observation, local, screenshot }); step();
            }
            contact.afterPummel = read();
          }
        }
        actor.resolveGrabConnect = original;
      }
    }
    return { rows, contacts };
  }, { metadata, captureOnly });
  for (const row of report.observations.rows) {
    const active = row.trace.filter(o => ['whiffStartup', 'whiffActive', 'whiffRecovery'].includes(o.grab.name));
    const total = { standing: 36, dash: 44, pivot: 39 }[row.variant];
    const firstCatch = { standing: 6, dash: 10, pivot: 11 }[row.variant];
    assert.deepEqual(active.map(o => o.presentation.framesElapsed), Array.from({ length: total }, (_, n) => n));
    assert.deepEqual(active.filter(o => o.activeCatch).map(o => o.presentation.framesElapsed), [firstCatch, firstCatch + 1]);
    assert.equal(row.captures.length, metadata.animations[row.sheet].frameWindows.length);
    for (const o of active) {
      const window = metadata.animations[row.sheet].frameWindows.find(w => w.startFrame <= o.presentation.framesElapsed && o.presentation.framesElapsed < w.endFrame);
      assert.equal(o.presentation.variant, row.variant); assert.equal(o.texture, `char.pikachu.${row.sheet}`);
      assert.equal(o.textureFrame, window.artFrameIndex); assert.equal(o.bodyMirror, row.facing);
      assert.deepEqual(o.origin, [0.5, 0.8125]);
      const source = poses.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes;
      const expected = row.variant === 'pivot' ? source.map(h => ({ ...h, offsetX: -h.offsetX,
        capsule: { ...h.capsule, start: { ...h.capsule.start, x: -h.capsule.start.x },
          end: { ...h.capsule.end, x: -h.capsule.end.x } } })) : source;
      assert.deepEqual(o.receiving, JSON.parse(JSON.stringify(expected)));
    }
  }
  for (const c of report.observations.contacts) {
    assert.ok(c.observation.captured); assert.equal(c.connected.targetGrounded, c.situation === 'ground');
    assert.equal(c.connected.sourceClock.variant, 'standing'); assert.ok([6, 7].includes(c.connected.sourceClock.framesElapsed));
    assert.equal(c.observation.grab.name, 'holding');
    for (const h of c.holding) {
      const o = h.observation, clip = metadata.animations.grab_hold, local = o.grab.active.framesElapsed % clip.loopDuration;
      const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(o.texture, 'char.pikachu.grab_hold'); assert.equal(o.textureFrame, window.artFrameIndex);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === 'grab_hold' && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      assert.ok(o.captured); assert.equal(o.targetPercent, 0); assert.equal(o.bodyMirror, c.facing);
    }
    if (c.pummel.length) {
      assert.deepEqual([...new Set(c.pummel.map(p => p.local))], [0, 1, 2, 3, 4]);
      assert.equal(c.pummel.filter(p => p.observation.hitlag > 0).length, 11);
      assert.ok(c.pummel.filter(p => p.observation.hitlag > 0).every(p => p.local === 0));
      for (const p of c.pummel) {
        const o = p.observation, window = metadata.animations.pummel.frameWindows.find(w => w.startFrame <= p.local && p.local < w.endFrame);
        assert.equal(o.texture, 'char.pikachu.pummel'); assert.equal(o.textureFrame, window.artFrameIndex);
        assert.deepEqual(o.receiving, poses.find(p => p.sheet === 'pummel' && p.artFrameIndex === window.artFrameIndex).hurtboxes);
        assert.ok(o.captured); assert.equal(o.targetPercent, 1); assert.equal(o.bodyMirror, c.facing);
      }
      assert.ok(c.afterPummel.captured); assert.equal(c.afterPummel.targetPercent, 1);
    }
    if (metadata.animations.captured) {
      for (const o of [c.observation, ...c.holding.map(h => h.observation), ...c.pummel.map(p => p.observation)]) {
        assert.equal(o.victimMove, null, 'captured victim attack is blocked');
        assert.equal(o.victimSpecial, null, 'captured victim special is blocked');
        const beforeAttempts = c.holding.find(h => h.observation.grab.active.framesElapsed === 23)?.observation;
        if (beforeAttempts && o.grab.active.framesElapsed >= 30)
          assert.equal(o.victimJumps, beforeAttempts.victimJumps, 'captured jump attempts consume no additional jump');
        const target = o.targetBody, clip = metadata.animations.captured;
        assert.ok(target.presentation.active);
        const local = target.presentation.framesElapsed % clip.loopDuration;
        const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
        assert.equal(target.texture, 'char.pikachu.captured'); assert.equal(target.textureFrame, window.artFrameIndex);
        assert.equal(target.bodyMirror, target.presentation.facing);
        assert.deepEqual(target.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
        assert.deepEqual(target.receiving, poses.find(p => p.sheet === 'captured' && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      }
      const frozen = c.pummel.filter(p => p.observation.targetHitlag > 0);
      assert.ok(new Set(frozen.map(p => p.observation.targetBody.presentation.framesElapsed)).size <= 1);
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ whiffs: report.observations.rows.length, contacts: report.observations.contacts.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/grab-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
