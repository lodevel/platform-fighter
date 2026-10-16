import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { chromium } from 'playwright';

const output = process.env.PF_REGISTRY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/completion-states-tumble';
const metadata = JSON.parse(await readFile(process.env.PF_PIKACHU_METADATA ?? 'assets/characters/pikachu/frames.json', 'utf8'));
const stateLeaf = process.env.PF_PIKACHU_STATE_LEAF ?? new URL('../src/characters/pikachuStateHurtboxes.ts', import.meta.url).pathname;
const { PIKACHU_STATE_AUTHORED_HURTBOX_POSES: poses } = await tsImport(stateLeaf, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], scope: 'Actual production Match observed reaction clocks and paired body/receiving. Public applyHit replay seeds ordinary ground/air damage and hard launches; real Matter flight/landing produces tumble/prone. This replay is not an authentic source-move collision, native reaction selector/rate or controller-feel proof.' };
page.on('pageerror', e => report.errors.push(e.message));
await page.exposeFunction('__captureReaction', name => page.screenshot({ path: `${output}/${name}` }));
try {
  await page.goto(process.env.PF_REGISTRY_URL ?? 'http://127.0.0.1:4231/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
  report.bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(src => /\/assets\/index-.*\.js/.test(src)));
  report.bundleSha256 = createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex');
  report.rows = await page.evaluate(async ({ metadata }) => {
    const game = window.__game; for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
    game.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: 858, itemFrequency: 'off',
      players: [{ index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' }, { index: 2, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p2' }] } });
    const scene = game.scene.getScene('MatchScene'); scene.physicsEngine.pause(); scene.roundStartCountdown = 0;
    scene.inputResolver.getMoveVector = () => ({ x: 0, y: 0 }); scene.inputResolver.isActionHeld = () => false;
    const step = () => { scene.physicsEngine.resume(); scene.update(0, scene.physicsEngine.fixedTimestepMs); scene.physicsEngine.pause(); };
    const floor = scene.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid'), actor = scene.p1, rows = [];
    for(const platform of scene.baseStage.bodies.platformBodies) if(platform!==floor) { platform.collisionFilter.mask=0; scene.matter.world.remove(platform); }
    for (const facing of [1, -1]) for (const vertical of [-8, -14]) for (const kind of ['face-up', 'face-down']) {
      const x = floor.position.x;
      actor.resetForRound(x, floor.bounds.min.y - (vertical === -14 ? 400 : 25)); scene.p2.resetForRound(x - 180, floor.bounds.min.y - 50);
      for (let n = 0; n < 12; n++) step(); actor.setFacing(facing); actor.setDamagePercent(0);
      const hit = { damage: 1, knockback: { x: kind === 'ground-damage' || kind === 'air-damage' ? 1 : 8,
        // This authored replay retains horizontal momentum until floor contact
        // so both existing observed prone-origin branches can be exercised.
        y: vertical, scaling: 0 },
        facing: kind === 'face-up' ? -facing : facing, hitlagMultiplier: 1,
        // Authored replay minimum exercises late held poses without asserting
        // that a native source move has this variable hitstun duration.
        ...(kind.endsWith('damage') ? { minHitstunFrames: 18 } : {}) };
      const outcome = actor.applyHit(hit), trace = [], captures = [], seen = new Set();
      // applyHit installs a simulation observation before the scene renders.
      // Advance the actual input/physics/render cycle before comparing sprites.
      step();
      for (let n = 0; n < 200; n++) {
        const reaction = actor.getReactionPresentationState(), sprite = scene.playerSlots[0].sprite;
        const sheet = reaction?.kind === 'damage' ? actor.isGrounded() ? 'hurt' : 'hurt_air'
          : reaction?.kind === 'tumble' ? 'tumble' : reaction?.kind === 'prone' ? reaction.origin === 'face-up' ? 'down_wait' : 'down_wait_face_down' : null;
        const observation = { reaction, position: actor.getPosition(), facing: actor.getFacing(), grounded: actor.isGrounded(),
          hitlag: actor.getHitlagRemaining(), hitstun: actor.getHitstunRemaining(), receiving: actor.getActiveHurtboxes(),
          texture: sprite.texture.key, textureFrame: Number(sprite.frame.name), origin: [sprite.originX, sprite.originY],
          mirror: Math.sign(sprite.scaleX) * (sprite.flipX ? -1 : 1), stocks: scene.stockTracker.getStocks(1) };
        if (sheet) {
          const clip = metadata.animations[sheet], end = clip.frameWindows.at(-1).endFrame;
          const local = clip.loopDuration ? reaction.framesElapsed % clip.loopDuration : Math.min(reaction.framesElapsed, end - 1);
          const w = clip.frameWindows.find(w => w.startFrame <= local && local < w.endFrame);
          observation.expected = { sheet, local, artFrameIndex: w?.artFrameIndex };
          const key = `${sheet}-${w?.artFrameIndex}-${reaction.phase ?? 'active'}${sheet==='tumble' && actor.getPosition().y+25>=floor.bounds.min.y-1 ? '-floor-boundary' : ''}`;
          if (!seen.has(key)) { seen.add(key); const screenshot = `reaction-${facing}-${vertical}-${kind}-${key}.png`;
            await window.__captureReaction(screenshot); captures.push({ screenshot, observation }); }
        }
        trace.push(observation); step();
      }
      rows.push({ facing, kind, vertical, hit, outcome, trace, captures, floorY:floor.bounds.min.y });
    }
    return rows;
  }, { metadata });
  for (const row of report.rows) {
    assert.ok(row.trace.some(o => o.reaction?.kind === 'damage'));
    assert.equal(row.trace.at(-1).stocks, row.trace[0].stocks, 'fixture must not KO/respawn');
    if (row.kind.startsWith('face-')) {
      if(row.vertical===-14) assert.equal(new Set(row.trace.filter(o=>o.expected?.sheet==='tumble').map(o=>o.textureFrame)).size,3,'long flight must reach all three actual tumble drawings');
      assert.ok(row.trace.some(o => o.reaction?.kind === 'tumble'), 'actual hard launch persists beyond hitstun');
      const prone = row.trace.filter(o => o.reaction?.kind === 'prone'); assert.ok(prone.length, 'real Matter floor contact produces prone');
      assert.equal(prone[0].reaction.origin, row.kind);
    }
    for (const o of row.trace.filter(o => o.expected)) {
      const e = o.expected, clip = metadata.animations[e.sheet]; assert.notEqual(e.artFrameIndex, undefined);
      assert.equal(o.texture, `char.pikachu.${e.sheet}`); assert.equal(o.textureFrame, e.artFrameIndex); assert.equal(o.mirror, o.reaction.facing);
      assert.deepEqual(o.origin, [clip.root[0] / clip.frameWidth, clip.root[1] / clip.frameHeight]);
      assert.deepEqual(o.receiving, poses.find(p => p.sheet === e.sheet && p.artFrameIndex === e.artFrameIndex).hurtboxes);
    }
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS'; console.log(JSON.stringify({ cases: report.rows.length, captures: report.rows.flatMap(r => r.captures).length }));
} catch (error) { report.result = 'FAIL'; report.assertionFailure = error.stack; throw error; }
finally { await writeFile(`${output}/reaction-body-match-observations.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); }
