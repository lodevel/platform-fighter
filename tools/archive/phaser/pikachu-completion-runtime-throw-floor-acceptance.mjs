import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-throw-floor';
if (!process.env.PF_BUILD_RECORD) throw Error('Set immutable PF_BUILD_RECORD');
const buildRecord = process.env.PF_BUILD_RECORD;
const checkpoint = buildRecord.replace(/-assets-staged\.json$/, '');
const build = JSON.parse(await readFile(buildRecord, 'utf8'));
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? `${checkpoint}-pikachu-frames.json`, 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(process.env.PF_PIKACHU_STATE_LEAF ?? new URL(`../${checkpoint}-pikachuStateHurtboxes.ts`, import.meta.url).pathname, import.meta.url);
const rootTrajectory = JSON.parse(await readFile('docs/review/2026-10-06/pikachu-character/sources/full-body-native-review/capture/back-throw-exact-root-trajectory.json', 'utf8'));
const native = JSON.parse(await readFile('docs/review/2026-10-06/pikachu-character/sources/native-grab-records.json', 'utf8'));
const requested = process.env.PF_THROW_DIRECTIONS?.split(',') ?? ['back', 'down'];
const freezeBackthrow = process.env.PF_BACK_THROW_FREEZE === '1';
const sheets = { forward: 'fthrow', back: 'bthrow', up: 'uthrow', down: 'dthrow' };
const directions = requested.filter(direction => metadata.animations[sheets[direction]]);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual source standing capture then InputResolver direction-selecting throws, all currently accepted requested body clips, both facings. Exact drawing windows/receiving and before/after release damage/facing/receiver hit-stop recorded. Source native down-throw stop-only/action-world qualification and paired target attachment remain independent.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuThrow', async name => {
  const view=await page.evaluate(()=>{
    const s=window.__game.scene.getScene('MatchScene'),c=s.cameras.main,r=window.__game.canvas.getBoundingClientRect();
    return {camera:{x:c.x,y:c.y,zoom:c.zoom,worldView:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height}},
      canvas:{left:r.left,top:r.top,width:r.width,height:r.height,internalWidth:window.__game.canvas.width,internalHeight:window.__game.canvas.height}};
  });
  await page.screenshot({path:`${output}/${name}`});return view;
});
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4226/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.build = build;
  assert.equal(report.bundleSha256, build.bundleSha256);
  report.rows = await page.evaluate(async ({ metadata, directions, sheets, freezeBackthrow }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 840,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const actor = scene.p1, rows = [];
    const transform = (character, sprite) => ({ texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
      position: character.getPosition(), bodyBottom: character.getBodyBottomY(), grounded: character.isGrounded(),
      spritePosition: { x: sprite.x, y: sprite.y }, origin: [sprite.originX, sprite.originY],
      scale: [sprite.scaleX, sprite.scaleY], rotation: sprite.rotation, flipX: sprite.flipX, flipY: sprite.flipY,
      facing: character.getFacing(), receiving: character.getActiveHurtboxes(), floorY: floor.bounds.min.y,
      capture: character.getCapturePresentationState() });
    const read = () => { const sprite = scene.playerSlots[0].sprite;
      return { presentation: actor.getThrowPresentationState(), grab: actor.getGrabState(),
        sourceSpec: actor.getGrabSpec().throws, grabHoldHitbox: actor.getGrabSpec().hitbox, hitlag: actor.getHitlagRemaining(),
        throwInvincible: actor.isThrowInvincible(),
        receiving: actor.getActiveHurtboxes(), texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
        origin: [sprite.originX, sprite.originY], bodyMirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1),
        actorFacing: actor.getFacing(), actorPosition: actor.getPosition(), actorVelocity: actor.getVelocity(),
        actorBody: transform(actor, sprite),
        targetBody: transform(scene.p2, scene.playerSlots[1].sprite),
        target: { captured: scene.p2.isGrabbed(), percent: scene.p2.getDamagePercent(),
          hitlag: scene.p2.getHitlagRemaining(), velocity: scene.p2.getVelocity(), position: scene.p2.getPosition() } }; };
    for (const facing of [1, -1]) for (const direction of directions) {
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.position.x + facing * 45, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing); scene.p2.setFacing(-facing);
      step({ grab: true }); for (let n = 0; n < 12 && !scene.p2.isGrabbed(); n++) step();
      if (!scene.p2.isGrabbed()) throw new Error(`Throw ${direction}/${facing} requires actual capture`);
      step({ moveX: direction === 'forward' ? facing : direction === 'back' ? -facing : 0,
        moveY: direction === 'up' ? -1 : direction === 'down' ? 1 : 0 });
      const trace = [], captures = [], seen = new Set(), sheet = sheets[direction]; let freezeInjected = false;
      for (let n = 0; n < 110; n++) {
        const observation = read(); trace.push(observation);
        if (!observation.presentation) break;
        const age = observation.presentation.framesElapsed;
        const spec=observation.sourceSpec[direction];
        const eventAges=[spec.animationFrames,...(spec.heldTargetHits??[]).map(hit=>hit.frame)];
        const eventBoundary=eventAges.some(event=>Math.abs(age-event)<=1);
        if ((metadata.animations[sheet].frameWindows.some(w => w.startFrame === age)||eventBoundary) && !seen.has(age)) {
          seen.add(age); const screenshot = `${sheet}-${facing}-${age}.png`;
          const view = await window.__capturePikachuThrow(screenshot); captures.push({ observation, screenshot, view });
        }
        if (freezeBackthrow && direction === 'back' && age === 10) {
          if (!freezeInjected) { actor.armAttackerHitlag(4); freezeInjected = true; }
          else if (observation.hitlag > 0 && !seen.has('frozen')) {
            seen.add('frozen'); const screenshot = `bthrow-${facing}-10-authored-freeze.png`;
            const view = await window.__capturePikachuThrow(screenshot); captures.push({ observation, screenshot, view });
          }
        }
        step();
      }
      rows.push({ facing, direction, sheet, trace, captures, floorY: floor.bounds.min.y,
        authoredFreeze: freezeInjected ? { age: 10, frames: 4, source: 'public armAttackerHitlag replay seed; not native backthrow hitlag' } : null });
    }
    return rows;
  }, { metadata, directions, sheets, freezeBackthrow });
  for (const row of report.rows) {
    const active = row.trace.filter(o => o.presentation), first = active[0], spec = first.sourceSpec[row.direction];
    const ages = [...new Set(active.map(o => o.presentation.framesElapsed))];
    assert.deepEqual(ages, Array.from({ length: spec.animationFrames + spec.recoveryFrames }, (_, n) => n));
    assert.equal(first.presentation.direction, row.direction); assert.ok(first.target.captured);
    const released = active.find(o => !o.target.captured);
    assert.equal(released.presentation.framesElapsed, spec.animationFrames);
    const source = native.catches[{ forward: 'ThrowF', back: 'ThrowB', up: 'ThrowHi', down: 'ThrowLw' }[row.direction]];
    const absolute = source.absolutes.find(a => a.kind === 'FIGHTER_ATTACK_ABSOLUTE_KIND_THROW');
    const totalDamage = absolute.damage + (row.direction === 'down' ? 0 : source.attacks.reduce((sum, hit) => sum + hit.damage, 0));
    assert.equal(released.target.percent, totalDamage);
    if (absolute.hitlag === 0) assert.equal(released.target.hitlag, 0);
    else assert.ok(released.target.hitlag > 0);
    for (const o of active) {
      const clip = metadata.animations[row.sheet], age = o.presentation.framesElapsed;
      const window = clip.frameWindows.find(w => w.startFrame <= age && age < w.endFrame);
      assert.equal(o.target.captured,age<spec.animationFrames,'actual capture retires at source release');
      const heldDamage=row.direction==='down'?0:source.attacks.filter(hit=>hit.frame-1<=age).reduce((sum,hit)=>sum+hit.damage,0);
      assert.equal(o.target.percent,heldDamage+(age>=spec.animationFrames?absolute.damage:0),'every source held-hit and release damage boundary');
      assert.ok(window, `${row.sheet} source drawing at actual action age${age}`);
      assert.equal(o.texture, `char.pikachu.${row.sheet}`); assert.equal(o.textureFrame, window.artFrameIndex);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      // Back release reverses HIT facing for launch; the actor's actual facing
      // remains authoritative and must not be inferred from launch direction.
      assert.equal(o.bodyMirror, row.direction === 'back' ? o.actorFacing : row.facing);
      if (spec.invincibilityFrames !== undefined)
        assert.equal(o.throwInvincible, age < spec.invincibilityFrames,
          `${row.direction} true source protection at throw age${age}`);
      if (row.direction === 'back' && spec.rootMotionX) {
        const sample = rootTrajectory.rows[age].worldDisplacementInEntryFacingBasis.x
          - rootTrajectory.rows[0].worldDisplacementInEntryFacingBasis.x;
        assert.ok(Math.abs(spec.rootMotionX[age] - sample) < 1e-8, 'exact source sample0-subtracted beta trajectory');
        assert.ok(Math.abs(o.actorPosition.x - first.actorPosition.x - sample * row.facing) < 0.1,
          `actual solved floor backthrow transport at age${age}`);
        if (o.target.captured) {
          const expectedOffset = first.target.position.x - first.actorPosition.x;
          assert.ok(Math.abs(o.target.position.x - o.actorPosition.x - expectedOffset) < 0.1,
            'captured target follows actual postphysics actor root under existing attachment policy');
        }
      }
    }
    assert.equal(row.trace.at(-1).presentation, null);
    if (row.authoredFreeze) {
      const held = active.filter(o => o.presentation.framesElapsed === 10);
      assert.equal(held.length, 5, 'one source age10 plus four frozen simulation steps');
      assert.ok(held.every(o => Math.abs(o.actorPosition.x - held[0].actorPosition.x) < 1e-7), 'no sampled delta replay during freeze');
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/throw-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
