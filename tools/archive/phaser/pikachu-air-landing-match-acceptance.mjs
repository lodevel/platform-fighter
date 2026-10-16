import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';
const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/air-landing';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual MatchScene source airjump/default fall/Quick Attack helpless and actual Matter soft/hard landings, both facings. Existing beta native-index presentation and native-selector/exit gaps remain explicit; no forced status, pose or timer. Position reset creates unobstructed airborne and near-floor fixtures.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__capturePikachuAir', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4220/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.observations = await page.evaluate(async ({ specialLanding }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 442,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause(); s.roundStartCountdown = 0;
    let input = {};
    s.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    s.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = next => { input = next ?? {}; s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); };
    const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = s.baseStage.bodies.platformBodies.filter(b => b !== floor), columns = [];
    for (let x = floor.bounds.min.x + 300; x <= floor.bounds.max.x - 300; x += 20)
      if (overhead.every(b => x + 25 < b.bounds.min.x || x - 25 > b.bounds.max.x)) columns.push(x);
    if (!columns.length) throw new Error('Actual airborne fixture needs unobstructed column');
    const actor = s.p1, x = columns[Math.floor(columns.length / 2)], rows = [], transitions = [];
    const reset = (facing, height) => {
      actor.resetForRound(x, floor.bounds.min.y - 25 - height); actor.setFacing(facing);
      s.p2.resetForRound(floor.bounds.max.x - 60, floor.bounds.min.y - s.p2.getTuning().height / 2);
    };
    const read = () => { const sprite = s.playerSlots[0].sprite;
      return { ordinary: actor.getOrdinaryPresentationState(), jump: actor.getJumpPresentationState(),
        landing: actor.getLandingPresentationState(), grounded: actor.isGrounded(), helpless: actor.isHelpless(),
        velocity: actor.getVelocity(), position: actor.getPosition(), receiving: actor.getActiveHurtboxes(),
        facing: actor.getFacing(), texture: sprite.texture.key, textureFrame: Number(sprite.frame.name),
        origin: [sprite.originX, sprite.originY] }; };
    const capture = async (sheet, facing, target, age) => { const observation = read(), screenshot = `${sheet}-${facing}-${target}.png`;
      await window.__capturePikachuAir(screenshot); rows.push({ sheet, facing, target, age, observation, screenshot }); };
    for (const facing of [1, -1]) {
      reset(facing, 500); step(); step({ jump: true });
      for (const target of [0, 10]) {
        for (let n = 0; n < 30 && (actor.getJumpPresentationState()?.framesElapsed ?? -1) < target; n++) step();
        await capture('airjump', facing, target, actor.getJumpPresentationState()?.framesElapsed);
      }
      reset(facing, 500); step();
      for (const target of [0, 6, 12, 18, 30]) {
        for (let n = 0; n < 40 && (actor.getOrdinaryPresentationState()?.framesElapsed ?? -1) < target; n++) step();
        await capture('fall', facing, target, actor.getOrdinaryPresentationState()?.framesElapsed);
      }
      reset(facing, 500); step();
      step({ special: true, moveY: -1 });
      for (let n = 0; n < 100 && !actor.isHelpless(); n++) step({ moveY: -1 });
      if (!actor.isHelpless()) throw new Error('Actual Quick Attack did not enter helpless');
      for (const target of [0, 4, 8, 12]) {
        for (let n = 0; n < 30 && (actor.getOrdinaryPresentationState()?.framesElapsed ?? -1) < target; n++) step();
        await capture('fall_special', facing, target, actor.getOrdinaryPresentationState()?.framesElapsed);
      }
      if (specialLanding) {
        const timeline = [];
        for (let n = 0; n < 150; n++) {
          step(); const o = read(); timeline.push({ step: n, grounded: o.grounded, landing: o.landing, texture: o.texture, textureFrame: o.textureFrame });
          if (o.landing && [0, 5, 12, 20, 23].includes(o.landing.framesElapsed))
            await capture('landing_special', facing, o.landing.framesElapsed, o.landing.framesElapsed);
          if (timeline.some(t => t.landing) && !o.landing) break;
        }
        transitions.push({ facing, kind: 'special', timeline });
      }
      for (const kind of ['soft', 'hard']) {
        reset(facing, kind === 'soft' ? 8 : 500);
        const timeline = [];
        for (let n = 0; n < 120; n++) {
          step(); const o = read(); timeline.push({ step: n, grounded: o.grounded, landing: o.landing, texture: o.texture, textureFrame: o.textureFrame });
          if (o.landing) await capture(`landing_${kind}`, facing, o.landing.framesElapsed, o.landing.framesElapsed);
          if (timeline.some(t => t.landing) && !o.landing) break;
        }
        transitions.push({ facing, kind, timeline });
      }
    }
    return { rows, transitions };
  }, { specialLanding: !!metadata.animations.landing_special });
  for (const row of report.observations.rows) {
    const o = row.observation, clip = metadata.animations[row.sheet];
    assert.ok(Number.isFinite(row.age) && row.age >= row.target);
    const local = clip.loopDuration ? row.age % clip.loopDuration : Math.min(row.age, clip.frameWindows.at(-1).endFrame - 1);
    const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
    assert.equal(o.texture, `char.pikachu.${row.sheet}`, `${row.sheet}/${row.facing}/${row.age}`);
    assert.equal(o.textureFrame, window.artFrameIndex);
    assert.deepEqual(o.receiving, poses.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes);
    assert.deepEqual(o.origin, [0.5, 0.8125]); assert.equal(o.facing, row.facing);
    if (row.sheet === 'fall_special') assert.equal(o.helpless, true);
  }
  for (const transition of report.observations.transitions) {
    const states = transition.timeline.filter(t => t.landing);
    assert.ok(states.length > 0, `${transition.kind}: actual floor must install a landing state`);
    assert.ok(states.every(t => t.landing.kind === transition.kind));
    const expectedTotal = transition.kind === 'soft' ? 2 : transition.kind === 'hard' ? 4 : 24;
    assert.ok(states.every(t => t.landing.totalFrames === expectedTotal));
    assert.deepEqual(states.map(t => t.landing.framesElapsed), Array.from({ length: expectedTotal }, (_, n) => n),
      `${transition.kind}: every installed real-floor recovery step is observed`);
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ rows: report.observations.rows.length, landings: report.observations.transitions.length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/air-landing-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
