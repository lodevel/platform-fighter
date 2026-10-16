import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/defense';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual production MatchScene/InputResolver fresh spot/forward/back/neutral-air dodge clocks and protection, both facings. Dedicated defensive bodies and source travel/staling remain unqualified.', rows: [] };
const reviewed = process.env.PF_DEFENSE_REVIEWED === '1';
const kinds = process.env.PF_DEFENSE_KINDS?.split(',') ?? ['spot', 'forward', 'back', 'air'];
const metadata = reviewed ? JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8')) : null;
const poseData = reviewed ? (await tsImport(new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname, import.meta.url)).PIKACHU_STATE_AUTHORED_HURTBOX_POSES : null;
if (reviewed) report.scope = 'Actual both-facing defensive body/12caps source drawing windows with latched entry mirror basis, plus fresh dodge clocks/protection. Existing constant travel and staling remain adaptations; actual damage-protection contacts have separate evidence.';
page.on('pageerror', error => report.errors.push(error.message));
await page.exposeFunction('__capturePikachuDefense', async name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4214/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ metadata, kinds }) => {
    const game = window.__game;
    for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 618,
      itemFrequency: 'off', players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    let input = {};
    scene.inputResolver.getMoveVector = player => ({ x: player === 1 ? input.moveX ?? 0 : 0, y: 0 });
    scene.inputResolver.isActionHeld = (player, action) => player === 1 && input[action] === true;
    const step = (next = {}) => { input = next; scene.physicsEngine.resume();
      scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
    const overhead = scene.baseStage.bodies.platformBodies.filter(b => b !== floor);
    let airColumn;
    for (let x = floor.bounds.min.x + 200; x < floor.bounds.max.x - 200; x += 20)
      if (overhead.every(b => x + 25 < b.bounds.min.x || x - 25 > b.bounds.max.x)) { airColumn = x; break; }
    if (airColumn === undefined) throw new Error('Air-dodge fixture requires an unobstructed landing column');
    const rows = [];
    for (const facing of [-1, 1]) for (const kind of kinds) {
      const x = kind === 'air' ? airColumn : (floor.bounds.min.x + floor.bounds.max.x) / 2;
      scene.p1.resetForRound(x, floor.bounds.min.y - (kind === 'air' ? 500 : 25));
      scene.p2.resetForRound(floor.bounds.max.x - 50, floor.bounds.min.y - 25);
      for (let i = 0; i < 12; i++) step();
      scene.p1.setFacing(facing);
      step({ dodge: true, moveX: kind === 'forward' ? facing : kind === 'back' ? -facing : 0 });
      const trace = [];
      const sheet = { spot: 'spot_dodge', forward: 'roll', back: 'roll_back', air: 'air_dodge' }[kind];
      const captures = [];
      for (let f = 0; f < 60; f++) {
        const state = scene.p1.getDodgeState();
        trace.push({ frame: f, state, protected: scene.p1.isDodgeInvincible(), facing: scene.p1.getFacing(),
          position: scene.p1.getPosition(), texture: scene.playerSlots[0].sprite?.texture.key });
        if (!state.active) break;
        if (metadata) {
          const clip = metadata.animations[sheet];
          if (!clip) throw new Error(`Missing accepted defensive clip ${sheet}`);
          const age = state.active.framesElapsed;
          if (clip.frameWindows.some(w => w.startFrame === age)) {
            const sprite = scene.playerSlots[0].sprite, screenshot = `${sheet}-${facing}-${age}.png`;
            const observation = { age, actorFacing: scene.p1.getFacing(), bodyMirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1),
              scaleX: sprite.scaleX, flipX: sprite.flipX,
              receiving: scene.p1.getActiveHurtboxes(), texture: sprite.texture.key,
              textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY] };
            await window.__capturePikachuDefense(screenshot);
            captures.push({ observation, screenshot });
          }
        }
        step();
      }
      rows.push({ kind, sheet, facing, trace, captures });
    }
    return rows;
  }, { metadata, kinds });
  for (const row of report.rows) {
    const expected = { spot: [2, 16, 24], forward: [3, 14, 28], back: [3, 15, 33], air: [1, 26, 50] }[row.kind];
    const active = row.trace.filter(f => f.state.active);
    assert.equal(active.length, expected[2], `${row.kind} fresh total`);
    assert.deepEqual(active.filter(f => f.protected).map(f => f.state.active.framesElapsed),
      Array.from({ length: expected[1] - expected[0] }, (_, i) => expected[0] + i), `${row.kind} sourced protection`);
    if (row.kind === 'back') assert.equal(active[0].state.active.backward, true);
    if (reviewed) {
      assert.ok(row.captures.length > 1, `${row.kind}: all playable reviewed poses need actual captures`);
      const clip = metadata.animations[row.sheet];
      for (const { observation: o } of row.captures) {
        const window = clip.frameWindows.find(w => w.startFrame <= o.age && o.age < w.endFrame);
        const source = poseData.find(p => p.sheet === row.sheet && p.artFrameIndex === window.artFrameIndex).hurtboxes;
        const basis = row.facing * o.actorFacing;
        const expected = source.map(box => basis === 1 ? box : { ...box, offsetX: -box.offsetX,
          ...('capsule' in box ? { capsule: { ...box.capsule,
            start: { ...box.capsule.start, x: -box.capsule.start.x },
            end: { ...box.capsule.end, x: -box.capsule.end.x } } } : {}) });
        assert.deepEqual(o.receiving, expected, `${row.sheet}/${row.facing}/${o.age}: pose and compensated receiving basis`);
        assert.equal(o.texture, `char.pikachu.${row.sheet}`); assert.equal(o.textureFrame, window.artFrameIndex);
        assert.deepEqual(o.origin, [0.5, 0.8125]); assert.equal(o.bodyMirror, row.facing);
      }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify({ rows: report.rows.length, errors: report.errors }));
} finally {
  await writeFile(`${output}/defense-match-observations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
