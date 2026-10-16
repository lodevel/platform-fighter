import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/skull-bodies';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const { PIKACHU_SPECIAL_PHASE_AUTHORED_HURTBOX_POSES: poses } =
  await tsImport(process.env.PF_PIKACHU_PHASE_LEAF ?? new URL('../src/characters/pikachuSpecialPhaseHurtboxes.ts', import.meta.url).pathname, import.meta.url);
const { STALE_FRESH_MULTIPLIER } = await tsImport(new URL('../src/characters/combat.ts', import.meta.url).pathname, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual InputResolver both-facing ground/air Skull charge80 misses and charge20 real receiver hits. Source status clocks select reviewed start/hold/ready/release/ground or air END/hit; all observed body windows match12 receiving capsules. Sparse drawing/native common AIR_STOP limits, slope render and floor alpha remain separately qualified.' };
report.sharedFreshDamageMultiplier = STALE_FRESH_MULTIPLIER;
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureSkull', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4230/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ metadata }) => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 858,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {}; scene.inputResolver.getMoveVector = slot => ({ x: slot === 1 ? input.moveX ?? 0 : 0, y: slot === 1 ? input.moveY ?? 0 : 0 });
    scene.inputResolver.isActionHeld = (slot, action) => slot === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    // This independently spells out the published status-local body clocks;
    // it does not call the production presentation resolver.
    const clock = s => {
      const air = !s.grounded;
      if (s.hit && s.branchFrame !== null) return { sheet: air ? 'side_special_air_hit' : 'side_special_hit', local: s.frame - s.branchFrame };
      if (s.frame < 13) return { sheet: air ? 'side_special_air_start' : 'side_special_start', local: s.frame };
      if (s.holding) return { sheet: air ? 'side_special_air_hold' : 'side_special_hold', local: Math.max(0, s.heldFrames - 1) % 6 };
      if (s.normalizedFrame < 13) return { sheet: air ? 'side_special_air_ready' : 'side_special_ready', local: s.frame - 13 - s.heldFrames };
      if (s.normalizedFrame <= 51) return { sheet: 'side_special', local: s.normalizedFrame - 13 };
      return { sheet: air ? 'side_special_air_miss_end' : 'side_special_end', local: s.normalizedFrame - 52 };
    };
    const read = () => { const sprite = scene.playerSlots[0].sprite; return { state: actor.getPikachuSpecialState(),
      position: actor.getPosition(), velocity: actor.getVelocity(), facing: actor.facing, grounded: actor.isGrounded(),
      receiving: actor.getActiveHurtboxes(), contact: !!actor.getActiveAttack()?.hitboxBody,
      texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
      mirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1), rotation: sprite.rotation, receiverDamage: scene.p2.getDamagePercent(),
      stocks: scene.stockTracker.getStocks(1) }; };
    for (const facing of [1, -1]) for (const air of [false, true]) for (const hit of [false, true]) {
      const charge = hit ? 20 : 80;
      // Air charge80 needs a clear column beside the floor: the real hold
      // naturally descends below the floor before release, still inside the
      // actual blast zone. A1300-high spawn would immediately KO/respawn.
      const originX = air ? facing === 1 ? floor.bounds.min.x - 100 : floor.bounds.max.x + 100
        : facing === 1 ? floor.bounds.min.x + 160 : floor.bounds.max.x - 160;
      const receiverX = air ? facing === 1 ? floor.bounds.max.x - 50 : floor.bounds.min.x + 50
        : facing === 1 ? floor.bounds.min.x + 50 : floor.bounds.max.x - 50;
      actor.resetForRound(originX, floor.bounds.min.y - (air ? 900 : 25)); scene.p2.resetForRound(receiverX, floor.bounds.min.y - 25);
      actor.setDamagePercent(0); scene.p2.setDamagePercent(0); for (let n = 0; n < 12; n++) step(); actor.setFacing(facing);
      step({ moveX: facing * 0.5, special: true }); const trace = [], captures = [], seen = new Set(); let targetPlacement = null;
      for (let n = 0; n < 270; n++) {
        const observation = read(); trace.push(observation); if (!observation.state) break;
        const selected = clock(observation.state), clip = metadata.animations[selected.sheet];
        const poseWindow = clip?.frameWindows.find(w => w.startFrame <= selected.local && (w.endFrame === null || selected.local < w.endFrame));
        observation.expected = { ...selected, artFrameIndex: poseWindow?.artFrameIndex };
        const key = `${selected.sheet}-${poseWindow?.artFrameIndex}`;
        if (poseWindow && !seen.has(key)) { seen.add(key); const screenshot = `skull-${facing}-${air ? 'air' : 'ground'}-${hit ? 'hit' : 'miss'}-${key}.png`;
          await window.__captureSkull(screenshot); captures.push({ observation, screenshot }); }
        if (hit && !targetPlacement && !observation.state.holding && observation.state.normalizedFrame === (air ? 16 : 46)) {
          // Fixture places a real receiver ahead of the next source Neck
          // contact. Collision, damage and rebound still run through Matter.
          const speed = (1.6 + (3.2 - 1.6) * charge / 80) * 5;
          targetPlacement = { x: observation.position.x + facing * (speed + 15), y: air ? observation.position.y + 3.7500009536743164 : floor.bounds.min.y - 25 };
          scene.p2.resetForRound(targetPlacement.x, targetPlacement.y); scene.p2.setDamagePercent(0);
        }
        const held = observation.state.holding && observation.state.charge < charge;
        step(held ? { moveX: facing * 0.5, special: true } : {});
      }
      rows.push({ facing, air, hit, charge, targetPlacement, trace, captures });
    }
    return rows;
  }, { metadata });
  for (const row of report.rows) {
    const active = row.trace.filter(o => o.state); assert.equal(active[0].state.kind, 'skullBash');
    assert.equal(row.trace.at(-1).state, null); assert.equal(Math.max(...active.map(o => o.state.charge)), row.charge);
    assert.equal(row.trace.at(-1).stocks, active[0].stocks, 'fixture must not silently KO/respawn');
    if (row.air && !row.hit) assert.ok(active.every(o => !o.grounded), 'clear offstage maxcharge stays truly airborne');
    const phases = new Set();
    for (const o of active) {
      const { sheet, local, artFrameIndex } = o.expected; phases.add(sheet); assert.notEqual(artFrameIndex, undefined, `${sheet} local${local}`);
      const clip = metadata.animations[sheet]; assert.equal(o.texture, `char.pikachu.${sheet}`); assert.equal(o.textureFrame, artFrameIndex);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]); assert.equal(o.mirror, row.facing);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === sheet && p.artFrameIndex === artFrameIndex).hurtboxes);
      if (!o.state.hit && !o.state.holding && o.state.normalizedFrame >= 13 && o.state.normalizedFrame <= 51) {
        assert.ok(o.velocity.y <= 5.5 + 1e-5, 'explicit native release vertical limit');
        assert.equal(o.contact, o.state.normalizedFrame >= 17, 'release windup13..16 then real contact17');
      }
    }
    assert.ok(phases.has(row.air ? 'side_special_air_start' : 'side_special_start')); assert.ok(phases.has('side_special'));
    if (row.hit) { assert.ok(active.some(o => o.state.hit), 'actual receiver contact selects hit branch');
      assert.ok(Math.abs(row.trace.at(-1).receiverDamage - (6.2 + 15.2 * row.charge / 80) * STALE_FRESH_MULTIPLIER) < 1e-5); }
    else { assert.equal(row.trace.at(-1).receiverDamage, 0); assert.ok([...phases].some(sheet => sheet.endsWith('end'))); }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
  console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length, errors: report.errors }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/skull-body-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
