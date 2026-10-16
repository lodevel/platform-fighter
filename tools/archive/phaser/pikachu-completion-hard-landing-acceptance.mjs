import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

// The existing four-step landing commitment is a declared beta contract. This
// checks that real dynamic floor contact renders every played body and that
// corrected alpha clears the floor; it does not establish native status parity.
const record = process.env.PF_BUILD_RECORD;
const output = process.env.PF_REGISTRY_OUTPUT;
if (!record || !output || !process.env.PF_REGISTRY_URL) throw Error('Set PF_BUILD_RECORD, PF_REGISTRY_OUTPUT and PF_REGISTRY_URL');
const prefix = record.replace(/-assets-staged\.json$/, '');
const build = JSON.parse(await readFile(record, 'utf8'));
const metadataBytes = await readFile(`${prefix}-pikachu-frames.json`);
assert.equal(createHash('sha256').update(metadataBytes).digest('hex'), build.pikachuFramesSha256);
const metadata = JSON.parse(metadataBytes);
const sourceLeaf = `${build.sourceLeafDirectory}/pikachuStateHurtboxes.ts`;
const sourceHashes = JSON.parse(await readFile(build.sourceHashes, 'utf8'));
assert.equal(createHash('sha256').update(await readFile(sourceLeaf)).digest('hex'), sourceHashes['src/characters/pikachuStateHurtboxes.ts']);
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL(`../${sourceLeaf}`, import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const report = { build, errors: [], scope: 'Actual ordinary dynamic 500px fall and Matter floor contact, both facings; every four-step beta hard-landing age, immutable source body/12caps/affine alpha32 floor, pause and first fresh attack. Public round reset positions only; no forced velocity, status, grounding or pose. Source common LandingHeavy selector/rate and human controls remain separate fidelity limits.' };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__captureHardLanding', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => /\/assets\/index-.*\.js/.test(s)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  assert.equal(report.bundleSha256, build.bundleSha256);
  report.rows = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 1894, itemFrequency: 'off', players: [
      { index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' },
    ] } });
    const scene = game.scene.getScene('MatchScene'), actor = scene.p1;
    scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, key) => slot === 1 && input[key] === true;
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(b => b !== floor);
    const columns = [];
    for (let x = floor.bounds.min.x + 300; x <= floor.bounds.max.x - 300; x += 20)
      if (overhead.every(b => x + 25 < b.bounds.min.x || x - 25 > b.bounds.max.x)) columns.push(x);
    if (!columns.length) throw Error('Need unobstructed ordinary dynamic landing column');
    const x = columns[Math.floor(columns.length / 2)], alphaCache = new Map(), rows = [];
    const read = () => {
      const sp = scene.playerSlots[0].sprite, f = sp.frame, key = `${sp.texture.key}/${f.name}`;
      let pixels = alphaCache.get(key);
      if (!pixels) {
        const canvas = document.createElement('canvas'); canvas.width = f.cutWidth; canvas.height = f.cutHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(sp.texture.getSourceImage(), f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
        const rgba = ctx.getImageData(0, 0, f.cutWidth, f.cutHeight).data; pixels = [];
        for (let y = 0; y < f.cutHeight; y++) for (let x = 0; x < f.cutWidth; x++)
          if (rgba[(y * f.cutWidth + x) * 4 + 3] >= 32) pixels.push([x + .5, y + .5]);
        alphaCache.set(key, pixels);
      }
      let bottom = -Infinity;
      for (const [px, py] of pixels) {
        let dx = (px - sp.originX * f.cutWidth) * sp.scaleX, dy = (py - sp.originY * f.cutHeight) * sp.scaleY;
        if (sp.flipX) dx *= -1; if (sp.flipY) dy *= -1;
        bottom = Math.max(bottom, sp.y + dx * Math.sin(sp.rotation) + dy * Math.cos(sp.rotation));
      }
      const camera=scene.cameras.main,rect=game.canvas.getBoundingClientRect();
      return { camera:{x:camera.x,y:camera.y,zoom:camera.zoom,worldView:{x:camera.worldView.x,y:camera.worldView.y,width:camera.worldView.width,height:camera.worldView.height}},
        canvas:{left:rect.left,top:rect.top,width:rect.width,height:rect.height,internalWidth:game.canvas.width,internalHeight:game.canvas.height},
        landing: actor.getLandingPresentationState(), grounded: actor.isGrounded(), position: actor.getPosition(), velocity: actor.getVelocity(),
        stocks: scene.stockTracker.getStocks(1), receiving: actor.getActiveHurtboxes(), texture: sp.texture.key, textureFrame: Number(f.name),
        facing: actor.getFacing(), origin: [sp.originX, sp.originY], scale: [sp.scaleX, sp.scaleY], flipX: sp.flipX, flipY: sp.flipY,
        rotation: sp.rotation, spritePosition: { x: sp.x, y: sp.y }, geometricFeet: Math.max(...actor.body.vertices.map(v => v.y)),
        floorY: floor.bounds.min.y, alpha32Pixels: pixels.length, alpha32Bottom: bottom, alpha32Clearance: floor.bounds.min.y - bottom,
        canAttack: actor.canAttack(), move: actor.getActiveAttack()?.move.id ?? null };
    };
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); return read(); };
    for (const facing of [1, -1]) {
      actor.resetForRound(x, floor.bounds.min.y - 25 - 500); actor.setFacing(facing);
      scene.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - scene.p2.getTuning().height / 2);
      const flight = [], trace = [], captures = [];
      for (let n = 0; n < 120; n++) { const o = step(); flight.push(o); if (o.landing) break; }
      if (actor.getLandingPresentationState()?.kind !== 'hard') throw Error('Ordinary dynamic contact did not enter hard landing');
      const pausedBefore = read(); for (let n = 0; n < 5; n++) scene.update(0, scene.physicsEngine.fixedTimestepMs);
      const pauseFreeze = { before: pausedBefore, after: read() };
      for (let n = 0; n < 12; n++) {
        const o = read(); if (!o.landing) break; trace.push(o);
        const screenshot = `hard-landing-${facing}-${o.landing.framesElapsed}.png`;
        await window.__captureHardLanding(screenshot); captures.push({ screenshot, observation: o, age: o.landing.framesElapsed });
        step();
      }
      const ended = read(); step({ attack: true });
      rows.push({ facing, flight, trace, captures, pauseFreeze, ended, firstFreshAttack: read() });
    }
    return rows;
  });
  const clip = metadata.animations.landing_hard;
  report.floorFailures = [];
  const gameplaySnapshot=({camera,canvas,...snapshot})=>snapshot;
  for (const row of report.rows) {
    assert.deepEqual(row.trace.map(o => o.landing.framesElapsed), [0, 1, 2, 3]);
    assert.deepEqual(gameplaySnapshot(row.pauseFreeze.after), gameplaySnapshot(row.pauseFreeze.before), 'paused update preserves clock, actual body and physical root; render camera easing is independent');
    assert.ok(row.flight.some(o => !o.grounded && o.velocity.y > 0), 'ordinary dynamic descending approach');
    for (const o of row.trace) {
      assert.equal(o.stocks, row.flight[0].stocks); assert.equal(o.grounded, true); assert.equal(o.canAttack, false);
      assert.equal(o.landing.kind, 'hard'); assert.equal(o.landing.totalFrames, 4);
      const local = Math.min(o.landing.framesElapsed, clip.frameWindows.at(-1).endFrame - 1);
      const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(o.texture, 'char.pikachu.landing_hard'); assert.equal(o.textureFrame, window.artFrameIndex);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === 'landing_hard' && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      assert.equal(o.receiving.length, 12); assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      assert.equal(Math.sign(o.scale[0]) * (o.flipX ? -1 : 1), row.facing); assert.ok(o.alpha32Pixels > 0);
      assert.ok(Math.abs(o.geometricFeet - o.floorY) <= .1, 'true solid support vertices at floor');
      if (o.alpha32Clearance < -.55) report.floorFailures.push({ facing: row.facing, age: o.landing.framesElapsed, cell: o.textureFrame, clearance: o.alpha32Clearance });
    }
    assert.equal(row.ended.landing, null); assert.equal(row.firstFreshAttack.move, 'pikachu.jab');
  }
  assert.deepEqual(report.errors, []);
  report.result = report.floorFailures.length ? 'FAIL_FLOOR' : 'PASS';
  console.log(JSON.stringify({ result: report.result, cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length, floorFailures: report.floorFailures.length }));
  if (report.floorFailures.length) process.exitCode = 1;
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
