// Re-simulate a saved .replay.json (format v4+, full CharacterInput per frame)
// in the production preview and log every player's state per frame.
//
// It starts MatchScene with the replay's matchConfig + rngSeed and feeds the
// recorded inputs through MatchScene's CPU-controller hook (a controller's
// `sample(frame)` returns a finished CharacterInput, which is exactly what the
// replay stores), stepping the fixed 60 Hz simulation by hand.
//
// Usage:
//   PF_REWORK_URL=http://127.0.0.1:4173/platform-fighter/ \
//     node tools/replay-resim.mjs <replay.json> <out-dir> [--shots f1,f2,...]
// Output: <out-dir>/trace.json (per-frame state), <out-dir>/summary.json, and a
// screenshot per requested frame.
//
// The recorded inputs are fed raw (no replayMigrations pass): a pre-v6 file
// simply lacks attackStickX/Y, which the fighter reads as 0. What a raw feed
// cannot fix is a changed meaning: from format 6 an airborne `attackHeavy`
// fires an aerial (earlier builds ignored it) and an up-aimed one during
// jumpsquat becomes the up smash. Humans never produced `attackHeavy` before
// format 6, so only CPU players' recorded heavy presses are affected; the tool
// warns (stderr + summary.json `warnings`) when a pre-v6 replay has a CPU.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [replayPath, outDir, ...rest] = process.argv.slice(2);
if (!replayPath || !outDir) throw new Error('usage: replay-resim.mjs <replay.json> <out-dir> [--shots f1,f2]');
const shots = new Set((rest[rest.indexOf('--shots') + 1] ?? '').split(',').filter(Boolean).map(Number));
await mkdir(outDir, { recursive: true });
const replay = JSON.parse(await readFile(replayPath, 'utf8'));
const entries = replay.inputTimeline.entries;

// Format 6 is the first whose airborne / jumpsquat `attackHeavy` means what
// this build does with it (see the header and replayTypes.ts).
const HEAVY_SEMANTICS_FORMAT = 6;
const warnings = [];
const formatVersion = replay.version;
const isCpu = (p) => p?.inputType === 'ai' || p?.inputType === 'cpu' || p?.inputDevice?.kind === 'ai';
const cpuPlayers = (replay.matchConfig?.players ?? [])
  .map((player, position) => ({ player, position }))
  .filter(({ player }) => isCpu(player));
if (!(typeof formatVersion === 'number' && formatVersion >= HEAVY_SEMANTICS_FORMAT) && cpuPlayers.length > 0) {
  const presses = cpuPlayers.map(({ player, position }) => {
    let count = 0, first = null, prev = false;
    for (const entry of entries) {
      const heavy = entry.inputs?.[position]?.attackHeavy === true;
      if (heavy && !prev) { count += 1; first ??= entry.frame; }
      prev = heavy;
    }
    return `P${player.index} (${player.characterId}): ${count} heavy press(es)${first === null ? '' : `, first at frame ${first}`}`;
  });
  warnings.push(
    `replay format v${formatVersion} < ${HEAVY_SEMANTICS_FORMAT} with CPU player(s). This build fires an aerial ` +
    'for an airborne attackHeavy (older builds ignored it) and turns an up-aimed one during jumpsquat into ' +
    'the up smash. Humans could not produce attackHeavy before v6, but these CPU presses were recorded ' +
    'and are replayed as-is, so the re-simulation can diverge from the recorded match from the first ' +
    `such press on. ${presses.join('; ')}.`,
  );
}
for (const w of warnings) console.warn(`WARNING: ${w}`);

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });

// Upload the input table first (it can be several MB), in chunks.
await page.evaluate((hz) => { window.__rs = { inputs: [], hz }; }, Number(process.env.PF_RESIM_HZ ?? 60));
for (let i = 0; i < entries.length; i += 2000) {
  await page.evaluate((chunk) => { for (const e of chunk) window.__rs.inputs[e.frame] = e.inputs; }, entries.slice(i, i + 2000));
}

// Start, pause and hook the inputs in ONE synchronous evaluate: the match loop
// runs on its own otherwise and would step frames with no input.
// PF_RESIM_WARMUP=<frames>: first play a throwaway match on the same page (the
// session's global Matter body-id counter then starts higher), to test whether
// results depend on what ran earlier in the page.
const warm = Number(process.env.PF_RESIM_WARMUP ?? 0);
if (warm > 0) {
  await page.evaluate(({ matchConfig, warm }) => {
    const game = window.__game;
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
    game.scene.start('MatchScene', { matchConfig: { ...matchConfig, rngSeed: 7 } });
    const s = game.scene.getScene('MatchScene'); s.physicsEngine.pause();
    for (let i = 0; i < warm; i++) { s.physicsEngine.resume(); s.update(0, s.physicsEngine.fixedTimestepMs); s.physicsEngine.pause(); }
    game.scene.stop('MatchScene');
  }, { matchConfig: replay.matchConfig, warm });
  await page.waitForTimeout(300);
}

const info = await page.evaluate(({ matchConfig, rngSeed }) => {
  const game = window.__game;
  for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
  // Never resize the game: BaseStage builds the simulation geometry from
  // scene.scale.gameSize, so a smaller game size shrinks the stage (not the
  // fighters) and the re-simulation diverges from the live 1920x1080 match.
  game.scene.start('MatchScene', { matchConfig: { ...matchConfig, rngSeed } });
  const s = game.scene.getScene('MatchScene');
  s.physicsEngine.pause();
  const slots = s.playerSlots;
  const idle = { moveX: 0, moveY: 0, jump: false, attack: false, dropThrough: false, attackHeavy: false, special: false, shield: false, dodge: false, grab: false, ledgeRelease: null };
  s.cpuControllers.clear();
  slots.forEach((slot, i) => {
    s.cpuControllers.set(slot.playerIndex, {
      sample(frame) { const rec = window.__rs.inputs[frame]?.[i]; return rec ? { ...rec } : { ...idle }; },
      registerLandedHit() {}, reset() {},
    });
  });
  const pick = (c) => {
    const p = c.getPosition(); const v = c.getVelocity(); const a = c.getActiveAttack?.();
    const st = {};
    for (const k of ['isGrounded', 'isInHitlag', 'isInHitstun', 'isHelpless', 'isGrabbed', 'isShielding', 'isOnLedge']) {
      if (typeof c[k] === 'function') { try { st[k] = c[k](); } catch { /* ignore */ } }
    }
    return {
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), vx: +v.x.toFixed(3), vy: +v.y.toFixed(3),
      dmg: +c.getDamagePercent().toFixed(2),healing:c.getHealingState?.()??null,eating:c.getEatingState?.()??null, attack: a ? `${a.move.id}@${a.framesElapsed}` : null,
      ignoreGravity: c.body?.ignoreGravity ?? null, isStatic: c.body?.isStatic ?? null,
      bodyGravity: c.body?.gravityScale ? +c.body.gravityScale.y.toFixed(5) : null, ...st,
    };
  };
  // PF_RESIM_HZ emulates a display refresh rate: update() is called with
  // delta = 1000/hz until one physics step has run (60 = one call per step).
  const hz = Number(window.__rs.hz || 60);
  let clock = 0;
  window.__rs.step = () => {
    const frame = s.physicsEngine.getFrame();
    s.physicsEngine.resume();
    let guard = 0;
    while (s.physicsEngine.getFrame() === frame && guard++ < 20) { clock += 1000 / hz; s.update(clock, 1000 / hz); }
    s.physicsEngine.pause();
    const stocks = slots.map((sl) => { try { return s.stockTracker.getStocks(sl.playerIndex); } catch { return null; } });
    const items = (() => { try { return s.itemRegistry.size(); } catch { return null; } })();
    const spawns = (() => { try { return s.itemSpawnEventLog.getEntries().length; } catch { return null; } })();
    const held = slots.map((sl) => { try { return s.inventoriesByPlayerIndex.get(sl.playerIndex)?.getHeldItem()?.definition?.type ?? null; } catch { return null; } });
    // Live items: type, lifecycle state and position (Ultimate items phase 2: throws, catches and drops must replay too).
    const itemStates = (() => { try { return s.itemRegistry.getActive().map((it) => { const p = it.getPosition();
      // Phase 5: the Bob-omb fuse / walk and the Banana Peel's slips-and-throws count must replay too.
      const fuse = it.getBobOmbState?.(), wear = it.getDurability?.();
      return `${it.id}:${it.definition.type}:${it.getSnapshot().state}:${p.x.toFixed(2)},${p.y.toFixed(2)}`
        + (it.definition.foodVariant?`:food=${it.definition.foodVariant}`:'') + (it.getHammerState?.() ? `:h${JSON.stringify(it.getHammerState())}` : '') + (fuse ? `:${fuse.phase}@${fuse.phaseFrames}/${fuse.heldFrames}` : '') + (wear !== null && wear !== undefined ? `:w${wear}` : ''); }); } catch { return null; } })();
    // Live item explosions (phase 5).
    const explosions = (() => { try { return (s.itemExplosions ?? []).map((e) => `${e.x.toFixed(2)},${e.y.toFixed(2)}:${e.framesLeft}:${[...e.done].join('+')}`); } catch { return null; } })();
    // Live projectiles (Ultimate items phase 3: Star Rod stars must replay too).
    const projectiles = (() => { try { return s.projectiles.map((p) => `${p.id}:${p.moveId}:${p.x.toFixed(2)},${p.y.toFixed(2)}`); } catch { return null; } })();
    // P1's held-item ammo (Ultimate items phase 4: shots, scope stage costs and flower fuel must replay too).
    const ammo = (() => { try { return s.inventoriesByPlayerIndex.get(slots[0].playerIndex)?.getHeldItem()?.getAmmo() ?? null; } catch { return null; } })();
    return { frame, players: slots.map((sl, k) => ({ ...pick(sl.character), held: held[k] })), stocks, items, spawns, itemStates, projectiles, explosions, ammo, active: game.scene.isActive('MatchScene') };
  };
  return { players: slots.map((sl) => sl.playerIndex), start: s.physicsEngine.getFrame(), meta: s.getMatchStartMetadata?.() ?? null };
}, { matchConfig: replay.matchConfig, rngSeed: replay.rngSeed });
console.log('start frame', info.start);

const trace = [];
for (let f = info.start; f < entries.length + 240; f += 1) {
  // (a step can end the match; the trace stops when MatchScene goes inactive)
  let st;
  try {
    st = await page.evaluate(() => { try { return window.__rs.step(); } catch (e) { return { error: String(e), stack: String(e.stack).split('\n').slice(0, 6).join(' | ') }; } });
  } catch (e) { st = { error: String(e) }; }
  if (st.error) { console.log(`step failed after frame ${trace.at(-1)?.frame ?? 'none'}: ${st.error} :: ${st.stack ?? ''}`); break; }
  trace.push(st);
  if (shots.has(st.frame)) await page.screenshot({ path: `${outDir}/frame-${st.frame}.png` });
  if (!st.active) break;
}
await writeFile(`${outDir}/trace.json`, JSON.stringify(trace));
const summary = {
  replay: replayPath, formatVersion, engineVersionRecorded: replay.metadata.engineVersion, engineVersionNow: info.meta?.engineVersion ?? null,
  frames: trace.length, lastFrame: trace.at(-1)?.frame, finalStocks: trace.at(-1)?.stocks, pageErrors, warnings,
};
await writeFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
await browser.close();
