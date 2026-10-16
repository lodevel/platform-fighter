import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-runtime-shield';
const build = JSON.parse(await readFile('.tmp/pikachu-airjump-tumble-production-assets-staged.json', 'utf8'));
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? '.tmp/pikachu-airjump-tumble-production-pikachu-frames.json', 'utf8'));
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(new URL('../.tmp/pikachu-airjump-tumble-production-pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual MatchScene/InputResolver shield release11 and source Pikachu jab sensor contacts producing block/successful parry, both facings. Body and receiving use observed installed clocks. Native shield startup, angular selection, break/dizzy transitions and motion rates remain unqualified.' };
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuShieldOutcome', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4242/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.build = build;
  assert.equal(report.bundleSha256, build.bundleSha256);
  report.rows = await page.evaluate(async () => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 838,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 });
    scene.inputResolver.isActionHeld = (slot, action) => input[slot]?.[action] === true;
    const step = next => { input = next ?? {}; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const actor = scene.p1, rows = [];
    const reset = facing => {
      actor.resetForRound(floor.position.x, floor.bounds.min.y - 25);
      scene.p2.resetForRound(floor.position.x + facing * 55, floor.bounds.min.y - 25);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing); scene.p2.setFacing(-facing);
    };
    const read = () => { const sprite = scene.playerSlots[0].sprite;
      return { presentation: actor.getShieldPresentationState(), shield: actor.getShieldState(),
        percent: actor.getDamagePercent(), hitlag: actor.getHitlagRemaining(), receiving: actor.getActiveHurtboxes(),
        texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
        bodyMirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1), facing: actor.getFacing(),
        attackerMove: scene.p2.getActiveAttack()?.move.id ?? null, attackerFrame: scene.p2.getActiveAttack()?.framesElapsed ?? null }; };
    for (const facing of [1, -1]) for (const kind of ['release', 'block', 'parry']) {
      reset(facing); for (let n = 0; n < 4; n++) step({ 1: { shield: true } });
      if (kind === 'release') step();
      else step({ 1: { shield: kind === 'block' }, 2: { attack: true } });
      if (kind !== 'release') {
        for (let n = 0; n < 12 && actor.getShieldPresentationState()?.kind !== kind; n++)
          step(kind === 'block' ? { 1: { shield: true } } : {});
        if (actor.getShieldPresentationState()?.kind !== kind) throw new Error(`Actual source jab did not produce ${kind}/${facing}`);
      }
      const trace = [], captures = [], captured = new Set();
      for (let n = 0; n < 60; n++) {
        const observation = read(); trace.push(observation);
        if (observation.presentation?.kind !== kind) break;
        const age = observation.presentation.framesElapsed;
        if (!captured.has(age)) {
          const screenshot = `${kind}-${facing}-${age}.png`;
          if (age === 0 || age === 5 || age === 7 || age === 10 || age === observation.presentation.totalFrames) {
            await window.__capturePikachuShieldOutcome(screenshot); captures.push({ observation, screenshot });
          }
          captured.add(age);
        }
        step(kind === 'block' ? { 1: { shield: true } } : {});
      }
      rows.push({ kind, facing, trace, captures });
    }
    return rows;
  });
  for (const row of report.rows) {
    const active = row.trace.filter(o => o.presentation?.kind === row.kind), first = active[0];
    assert.equal(first.presentation.framesElapsed, 0); assert.equal(first.percent, 0);
    if (row.kind === 'release') {
      assert.equal(first.presentation.totalFrames, 11);
      assert.deepEqual([...new Set(active.map(o => o.presentation.framesElapsed))], Array.from({ length: 11 }, (_, n) => n));
    } else {
      assert.equal(first.attackerMove, 'pikachu.jab'); assert.ok(first.hitlag > 0);
      assert.ok(active.filter(o => o.hitlag > 0).every(o => o.presentation.framesElapsed === 0));
      assert.ok(active.some(o => o.presentation.framesElapsed > 0));
    }
    const sheet = { release: 'shield_end', block: 'shield_hit', parry: 'parry' }[row.kind], clip = metadata.animations[sheet];
    for (const o of active) {
      const local = Math.min(o.presentation.framesElapsed, clip.frameWindows.at(-1).endFrame - 1);
      const window = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
      assert.equal(o.texture, `char.pikachu.${sheet}`); assert.equal(o.textureFrame, window.artFrameIndex);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes);
      assert.deepEqual(o.origin, [0.5, 0.8125]); assert.equal(o.bodyMirror, row.facing);
    }
    assert.notEqual(row.trace.at(-1).presentation?.kind, row.kind);
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/shield-outcome-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }

