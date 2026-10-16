#!/usr/bin/env node
/* Donkey Kong rework: per-family match probe (locomotion | ground-attacks | aerials | specials | defense | grabs-throws-cargo | ledge-recovery | items-taunts) + Pikachu short regression.
 *
 *   node tools/dk-rework-family-probe.mjs <outDir> [--family extras2|locomotion|locomotion-extra|ground-attacks|aerials|specials|defense|grabs-throws-cargo|partials|ledge-recovery|items-taunts|engine-source-fixes|remaining-gaps|final-gaps] [--url URL]
 *                                          [--strict] [--only seg1,seg2] [--opponent id] [--skip-pikachu]
 *
 * Needs `npm run preview` serving http://127.0.0.1:4173/platform-fighter/ (override with
 * --url or PF_REWORK_URL). Wrap the whole thing in `flock .tmp/dk-heavy.lock` (see CLAUDE.md).
 *
 * Part A: DK (P1, keyboard_p1) vs Pikachu (P2, parked). Real trusted key events through
 *   Playwright drive Phaser's keyboard route; the physics engine is paused and stepped one
 *   fixed 60 Hz step at a time via MatchScene.update. Keyboard input is digital, so the two
 *   WALK segments use a SIMULATED analog tilt (inputResolver.getMoveVector override, 0.5);
 *   everything else is real key input.
 * Part B: Pikachu (P1) vs Pikachu (P2): idle / run / jump / jab regression.
 *
 * Per step it records the selected animation key + frame, the intended DK body sheet
 * (packedBody.clock), physics body bounds, sprite bounds, and the OPAQUE-pixel bounds of the
 * current frame in world space, so "feet on the floor" and "body centre" are measured, not assumed.
 * It also records each fighter's active attack (id, phase, age, live hitbox), smash charge, damage
 * percent and every hit P2 receives (HitInfo: damage, knockback reference), for attack families.
 * Attack segments place P2 in front of P1 (`opponent` = centre distance), run in both facings
 * (`fwd`/`back` keys mirror per facing) and take screenshots at DK attack/charge ages (`shotAges`).
 * Output: <outDir>/dk-rework-family-probe.json (+ per-step records) and PNG screenshots.
 * Exit code 1 only with --strict (missing expected sheets / page errors); otherwise it reports.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : (argv[i + 1] ?? true); };
const outDir = argv.find((a, i) => !a.startsWith('--') && !['--url', '--only', '--opponent', '--regression-char', '--family'].includes(argv[i - 1]));
if (!outDir) { console.error('usage: node tools/dk-rework-family-probe.mjs <outDir> [--family locomotion|ground-attacks] [--url URL] [--strict] [--only seg,seg] [--opponent id] [--skip-pikachu] [--regression-char id]'); process.exit(2); }
const family = flag('--family') ?? 'locomotion';
const url = flag('--url') ?? process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const strict = argv.includes('--strict');
const only = flag('--only')?.split(',') ?? null;
/** Escape hatches for builds that predate Pikachu: --opponent <id> replaces P2, --skip-pikachu skips part B. */
const opponent = flag('--opponent') ?? 'pikachu';
const skipPikachu = argv.includes('--skip-pikachu');
const regressionChar = flag('--regression-char') ?? 'pikachu';
await mkdir(outDir, { recursive: true });

/** phases: keys held (real key events), tilt (simulated analog moveX), steps, until, shots (phase-relative step indices). */
const FOOD_SOURCE_TABLE=JSON.parse(await readFile('docs/review/2026-10-11/ultimate-items/spec/items.json','utf8')).items.find(i=>i.id==='food').uses[0].special[0].value;
const DK_SEGMENTS = [
  { name: 'idle', must: ['idle'], phases: [{ steps: 90, shots: [0, 45] }] },
  { name: 'walk-right', simulatedTilt: true, must: ['walk'], phases: [{ tilt: 0.5, steps: 45, shots: [20] }, { steps: 10 }] },
  { name: 'walk-left', startFrac: 0.7, simulatedTilt: true, must: ['walk'], phases: [{ tilt: -0.5, steps: 45, shots: [20] }, { steps: 10 }] },
  { name: 'dash-run-right', must: ['dash', 'run'], phases: [{ keys: ['d'], steps: 60, shots: [3, 40] }, { steps: 30 }] },
  { name: 'dash-run-left', startFrac: 0.7, must: ['dash', 'run'], phases: [{ keys: ['a'], steps: 60, shots: [3, 40] }, { steps: 30 }] },
  { name: 'run-brake', mustAny: ['run_brake', 'run_brake_left'], phases: [{ keys: ['d'], steps: 40 }, { steps: 45, shots: [4, 12] }] },
  { name: 'run-turn', startFrac: 0.3, must: ['run_turn'], phases: [{ keys: ['d'], steps: 40 }, { keys: ['a'], steps: 45, shots: [5, 20] }] },
  { name: 'dash-turn', must: ['dash_turn'], phases: [{ keys: ['d'], steps: 5 }, { keys: ['a'], steps: 30, shots: [4, 14] }] },
  { name: 'crouch', must: ['crouch_start', 'crouch', 'crouch_end'], phases: [{ keys: ['s'], steps: 30, shots: [2, 20] }, { steps: 15, shots: [3] }] },
  { name: 'full-hop', must: ['jumpsquat', 'jump', 'fall'], should: ['landing_soft', 'landing_hard'],
    phases: [{ keys: ['w'], steps: 20, shots: [1, 10] }, { until: 'falling', steps: 80, shots: [0] }, { until: 'landed', steps: 80, shots: [0] }, { steps: 40, shots: [1, 8] }] },
  { name: 'short-hop', must: ['jumpsquat', 'jump_short'], should: ['landing_soft'],
    phases: [{ keys: ['w'], steps: 2, shots: [1] }, { until: 'landed', steps: 80, shots: [10] }, { steps: 30, shots: [1] }] },
  { name: 'air-jump', must: ['airjump'],
    phases: [{ keys: ['w'], steps: 3 }, { steps: 10 }, { keys: ['w'], steps: 3, shots: [2] }, { until: 'landed', steps: 120, shots: [20] }, { steps: 30 }] },
  { name: 'air-drift', must: ['jump'], optional: ['air_drift'],
    phases: [{ keys: ['w'], steps: 25 }, { keys: ['w', 'd'], steps: 20, shots: [10] }, { until: 'landed', steps: 120 }, { steps: 30 }] },
  { name: 'fast-fall', must: ['fall', 'fall_fast'],
    phases: [{ keys: ['w'], steps: 20 }, { until: 'falling', steps: 80 }, { keys: ['s'], until: 'landed', steps: 80, shots: [6] }, { steps: 40, shots: [1] }] },
];
/** Ground attacks: real keys F (attack), V (smash), S, W, and fwd/back = D/A mirrored per facing.
 * Simulated analog `tilt` ({x,y}, x relative to facing) is used only for the three forward tilts:
 * a held digital D dashes at full speed, so D+F is always a dash attack (or a flick smash). */
const age = (label, move, at, extra = {}) => ({ label, move, age: at, ...extra });
const GROUND_ATTACK_SEGMENTS = [
  { name: 'jab', opponent: 70, must: ['jab'], shotAges: [age('startup', 'jab', 1), age('contact', 'jab', 4), age('recovery', 'jab', 14)],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }] },
  { name: 'jab-jab2', opponent: 70, must: ['jab', 'jab2'], shotAges: [age('jab1-contact', 'jab', 4), age('jab2-contact', 'jab2', 3), age('jab2-recovery', 'jab2', 18)],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 23 }, { keys: ['f'], steps: 1 }, { steps: 50 }] },
  // jab1 whiffs (P2 out of range); P2 runs in so jab2 connects on its first (age 3) or held-split (age 4) pose.
  ...[['jab2-runin-a3', 6], ['jab2-runin-a4', 8]].map(([name, from]) => ({ name, opponent: 160, p2Hold: [{ key: 'toward', from, to: 30 }],
    must: ['jab', 'jab2'], shotAges: [age('jab2-startup', 'jab2', 1), age('jab2-contact', 'jab2', from === 6 ? 3 : 4), age('jab2-recovery', 'jab2', 18)],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 9 }, { keys: ['f'], steps: 1 }, { steps: 50 }] })),
  { name: 'ftilt', opponent: 95, simulatedTilt: true, must: ['tilt'], shotAges: [age('startup', 'tilt', 3), age('contact', 'tilt', 6), age('recovery', 'tilt', 20)],
    phases: [{ tilt: { x: 0.5, y: 0 }, steps: 3 }, { tilt: { x: 0.5, y: 0 }, keys: ['f'], steps: 1 }, { steps: 60 }] },
  { name: 'ftilt-up', opponent: 95, simulatedTilt: true, must: ['tilt_up'], shotAges: [age('startup', 'tilt', 3), age('contact', 'tilt', 6), age('recovery', 'tilt', 20)],
    phases: [{ tilt: { x: 0.5, y: -0.5 }, steps: 3 }, { tilt: { x: 0.5, y: -0.5 }, keys: ['f'], steps: 1 }, { steps: 60 }] },
  { name: 'ftilt-down', opponent: 95, simulatedTilt: true, must: ['tilt_down'], shotAges: [age('startup', 'tilt', 3), age('contact', 'tilt', 6), age('recovery', 'tilt', 20)],
    phases: [{ tilt: { x: 0.5, y: 0.5 }, steps: 3 }, { tilt: { x: 0.5, y: 0.5 }, keys: ['f'], steps: 1 }, { steps: 60 }] },
  { name: 'utilt', opponent: 40, must: ['utilt'], shotAges: [age('startup', 'utilt', 2), age('contact', 'utilt', 5), age('recovery', 'utilt', 22)],
    phases: [{ keys: ['w'], steps: 3 }, { keys: ['w', 'f'], steps: 1 }, { steps: 50 }] },
  { name: 'utilt-air-target', opponent: 40, p2Hold: [{ key: 'up', from: 0, to: 6 }], must: ['utilt'],
    shotAges: [age('startup', 'utilt', 2), age('contact', 'utilt', 5), age('recovery', 'utilt', 22)],
    phases: [{ keys: ['w'], steps: 3 }, { keys: ['w', 'f'], steps: 1 }, { steps: 50 }] },
  { name: 'dtilt', opponent: 95, must: ['dtilt'], shotAges: [age('startup', 'dtilt', 2), age('contact', 'dtilt', 5), age('recovery', 'dtilt', 14)],
    phases: [{ keys: ['s'], steps: 8 }, { keys: ['s', 'f'], steps: 1 }, { steps: 40 }] },
  { name: 'dash-attack', opponent: 230, must: ['dash_attack'], shotAges: [age('startup', 'dash_attack', 4), age('contact-early', 'dash_attack', 9), age('late', 'dash_attack', 16), age('recovery', 'dash_attack', 28)],
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 50 }] },
  // Late roll: P2 runs in after the early window so only the late hit (ages 12-23) can reach it.
  { name: 'dash-attack-late', opponent: 335, p2Hold: [{ key: 'toward', from: 15, to: 40 }], must: ['dash_attack'],
    shotAges: [age('early', 'dash_attack', 9), age('late-contact', 'dash_attack', 14), age('recovery', 'dash_attack', 28)],
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 50 }] },
  { name: 'fsmash-short', opponent: 115, must: ['smash'], shotAges: [age('startup', 'smash', 13), age('contact', 'smash', 21), age('recovery', 'smash', 36)],
    phases: [{ keys: ['fwd', 'v'], steps: 3 }, { steps: 70 }] },
  { name: 'fsmash-held', opponent: 115, must: ['smash', 'smash_charge'], shotAges: [age('charge', 'charge:smash', 30), age('contact', 'smash', 21), age('recovery', 'smash', 36)],
    phases: [{ keys: ['fwd', 'v'], steps: 2 }, { keys: ['v'], steps: 60 }, { steps: 70 }] },
  { name: 'usmash-short', opponent: 40, p2Hold: [{ key: 'up', from: 3, to: 9 }], must: ['usmash'], shotAges: [age('startup', 'usmash', 8), age('contact', 'usmash', 13), age('recovery', 'usmash', 30)],
    phases: [{ keys: ['w', 'v'], steps: 3 }, { steps: 70 }] },
  { name: 'usmash-held', opponent: 40, p2Hold: [{ key: 'up', from: 49, to: 55 }], must: ['usmash', 'usmash_charge'], shotAges: [age('charge', 'charge:usmash', 30), age('contact', 'usmash', 13), age('recovery', 'usmash', 30)],
    phases: [{ keys: ['w', 'v'], steps: 2 }, { keys: ['v'], steps: 50 }, { steps: 70 }] },
  { name: 'dsmash-short', opponent: 80, must: ['dsmash'], shotAges: [age('startup', 'dsmash', 5), age('contact', 'dsmash', 10), age('recovery', 'dsmash', 30)],
    phases: [{ keys: ['s', 'v'], steps: 3 }, { steps: 70 }] },
  // Close target: the early fists (ages 10-11) reach it before the late spheres.
  { name: 'dsmash-close', opponent: 50, must: ['dsmash'], shotAges: [age('startup', 'dsmash', 5), age('contact', 'dsmash', 10), age('recovery', 'dsmash', 30)],
    phases: [{ keys: ['s', 'v'], steps: 1 }, { steps: 70 }] },
  { name: 'dsmash-held', opponent: 80, must: ['dsmash', 'dsmash_charge'], shotAges: [age('charge', 'charge:dsmash', 30), age('contact', 'dsmash', 10), age('recovery', 'dsmash', 30)],
    phases: [{ keys: ['s', 'v'], steps: 2 }, { keys: ['v'], steps: 50 }, { steps: 70 }] },
  // Source fixes 2026-10-11 (SmashWiki Smash attack): the smash key is held far past full charge (60) and
  // the smash auto-releases at 180 held frames; opponent out of reach so the whole move is visible.
  ...[['fsmash', ['fwd', 'v'], 'smash'], ['usmash', ['w', 'v'], 'usmash'], ['dsmash', ['s', 'v'], 'dsmash']].map(([n, lead, sheet]) => ({
    name: `${n}-hold-max`, opponent: 400, must: [sheet, `${sheet}_charge`],
    shotAges: [age('charge-60', `charge:${sheet}`, 60), age('charge-179', `charge:${sheet}`, 179), age('release', sheet, 1)],
    phases: [{ keys: lead, steps: 2 }, { keys: ['v'], steps: 230 }, { steps: 70 }] })),
].flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing, startFrac: facing === 1 ? 0.3 : 0.7 })));
/** Locomotion-extra (backward jumps, fall variants, brake side, air drift): real keys, both facings.
 * fwd/back mirror per facing; `mustNot` lists sheets that must NOT appear (forward jumps stay unchanged).
 * The direction key goes down only once the jumpsquat sheet is showing (record 4 after the jump key):
 * pressing it earlier turns/dashes first (W is up+jump, so the tap-jump buffer delays jumpsquat 4 steps while the stick
 * already dashes), so the stick-away-from-facing entry is made during jumpsquat. DK keeps facing through jumpsquat
 * (locomotion jumpsquatKeepsFacing), so a back stick there is a back jump (jump_b / jump_short_b); `*-same-step` checks
 * that W+back pressed together still dashes/turns first and then jumps forward. */
const hop = (name, dir, extra) => ({ name, ...extra, phases: [{ keys: ['w'], steps: 4 }, { keys: ['w', ...dir], steps: 16, shots: [1, 10] }, { until: 'falling', steps: 80, shots: [0] }, { until: 'landed', steps: 80, shots: [0] }, { steps: 30 }] });
const shortHop = (name, dir, extra) => ({ name, ...extra, phases: [{ keys: ['w'], steps: 2 }, { steps: 2 }, { keys: dir, steps: 5, shots: [3] }, { until: 'landed', steps: 80, shots: [10] }, { steps: 30 }] });
const airJump = (name, dir, extra) => ({ name, ...extra, phases: [{ keys: ['w'], steps: 2 }, { steps: 12 }, { keys: ['w', ...dir], steps: 3, shots: [2] }, { keys: dir, steps: 12 }, { until: 'landed', steps: 120, shots: [20] }, { steps: 30 }] });
const LOCOMOTION_EXTRA_SEGMENTS = [
  { name: 'run-brake-long', startFrac: null, mustAny: ['run_brake_left'], phases: [{ keys: ['fwd'], steps: 45 }, { steps: 45, shots: [3, 10] }] },
  { name: 'run-brake-age22', startFrac: null, mustAny: ['run_brake', 'run_brake_left'], phases: [{ keys: ['fwd'], steps: 22 }, { steps: 45, shots: [3, 10] }] },
  { name: 'run-brake-age30', startFrac: null, mustAny: ['run_brake', 'run_brake_left'], phases: [{ keys: ['fwd'], steps: 30 }, { steps: 45, shots: [3, 10] }] },
  { name: 'air-drift', must: ['air_drift'], phases: [{ keys: ['w'], steps: 12 }, { until: 'falling', steps: 80 }, { keys: ['fwd'], until: 'landed', steps: 80, shots: [5] }, { steps: 20 }] },
  ...[7].map(at => ({ name: `full-hop-back-at${at}`, must: ['jump_b'], mustNot: ['jump'], phases: [{ keys: ['w'], steps: at }, { keys: ['w', 'back'], steps: 20 - at, shots: [2] }, { until: 'falling', steps: 80 }, { until: 'landed', steps: 80 }, { steps: 20 }] })),
  hop('full-hop-back', ['back'], { must: ['jumpsquat', 'jump_b'], mustNot: ['jump'] }),
  { name: 'full-hop-back-same-step', must: ['dash', 'jumpsquat', 'jump'], mustNot: ['jump_b'], phases: [{ keys: ['w', 'back'], steps: 20, shots: [2, 10] }, { until: 'landed', steps: 120 }, { steps: 20 }] },
  hop('full-hop-fwd', ['fwd'], { must: ['jump'], mustNot: ['jump_b'] }),
  hop('full-hop-neutral', [], { must: ['jump'], mustNot: ['jump_b'] }),
  shortHop('short-hop-back', ['back'], { must: ['jumpsquat', 'jump_short_b'], mustNot: ['jump_short'] }),
  shortHop('short-hop-fwd', ['fwd'], { must: ['jump_short'], mustNot: ['jump_short_b'] }),
  airJump('air-jump-back', ['back'], { must: ['airjump_b'], mustNot: ['airjump'] }),
  airJump('air-jump-fwd', ['fwd'], { must: ['airjump'], mustNot: ['airjump_b'] }),
  { name: 'fall-back', must: ['fall_b'], phases: [{ keys: ['w'], steps: 15 }, { until: 'falling', steps: 80 }, { keys: ['back'], until: 'landed', steps: 80, shots: [6] }, { steps: 20 }] },
  ...[['neutral', [], 'fall_aerial'], ['fwd', ['fwd'], 'fall_aerial_f'], ['back', ['back'], 'fall_aerial_b']].map(([n, k, sheet]) => (
    { name: `aerial-fall-${n}`, must: ['airjump', sheet], phases: [{ keys: ['w'], steps: 3 }, { steps: 10 }, { keys: ['w'], steps: 3 }, { keys: k, steps: 12 }, { keys: k, until: 'falling', steps: 60 }, { keys: k, until: 'landed', steps: 120, shots: [8] }, { steps: 20 }] })),
].flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: seg.startFrac === null ? (facing === 1 ? 0.3 : 0.7) : 0.5 })));

/** Aerials: real keys only. Hop = short (w tap) or full (w held); the aerial key is pressed once airborne.
 * `pin` holds P2 (teleported each step, no velocity) at (dx forward, dy down) from DK's body centre from attack
 * age `from` until a hit lands or age `to`, so each hitbox window is exercised in isolation. Screenshots are taken
 * at the first contact (`shotOnHit`). Each row: inventory id, move (sheet), keys, pin, expect = sourced fresh values. */
const AERIAL_ROWS = [
  { row: 'donkeykong.neutral-air-early', move: 'nair', keys: ['f'], pin: { from: 9, to: 10, dx: 40, dy: 0 }, expect: { damage: 12, base: 20, growth: 100, angle: 361 } },
  { row: 'donkeykong.neutral-air-late', move: 'nair', keys: ['f'], pin: { from: 14, to: 26, dx: 40, dy: 0 }, expect: { damage: 9, base: 10, growth: 100, angle: 361 } },
  { row: 'donkeykong.forward-air-early', move: 'fair', keys: ['fwd', 'f'], pin: { from: 17, to: 19, dx: 45, dy: -5 }, expect: { damage: 16, base: 20, growth: 85, angle: 361 } },
  { row: 'donkeykong.forward-air-late-meteor', move: 'fair', keys: ['fwd', 'f'], pin: { from: 20, to: 22, dx: 60, dy: 30 }, expect: { damage: 15, base: 30, growth: 100, angle: 270 } },
  { row: 'donkeykong.forward-air-late-arms', move: 'fair', keys: ['fwd', 'f'], pin: { from: 20, to: 22, dx: 5, dy: -20 }, expect: { damage: 13, base: 30, growth: 100, angle: 361 } },
  { row: 'donkeykong.back-air-early', move: 'bair', keys: ['back', 'f'], pin: { from: 6, to: 7, dx: -45, dy: 3 }, expect: { damage: 13, base: 20, growth: 97, angle: 361 } },
  { row: 'donkeykong.back-air-late', move: 'bair', keys: ['back', 'f'], pin: { from: 9, to: 15, dx: -55, dy: 3 }, expect: { damage: 8, base: 10, growth: 100, angle: 361 } },
  { row: 'donkeykong.up-air', move: 'uair', keys: ['w', 'f'], pin: { from: 5, to: 9, dx: 15, dy: -33 }, expect: { damage: 13, base: 32, growth: 90, angle: 90 } },
  { row: 'donkeykong.down-air-foot', move: 'dair', keys: ['s', 'f'], pin: { from: 13, to: 15, dx: 5, dy: 67 }, expect: { damage: 16, base: 30, growth: 90, angle: 270 } },
  { row: 'donkeykong.down-air-body', move: 'dair', keys: ['s', 'f'], pin: { from: 13, to: 15, dx: 0, dy: -5 }, expect: { damage: 13, base: 20, growth: 90, angle: 361 } },
];
const AERIAL_HOPS = {
  short: [{ keys: ['w'], steps: 2 }, { steps: 5 }],
  full: [{ keys: ['w'], steps: 14 }, { steps: 3 }],
};
const AERIAL_SEGMENTS = AERIAL_ROWS.flatMap(row => Object.entries(AERIAL_HOPS).flatMap(([hop, lead]) => [1, -1].map(facing => ({
  name: `${row.row.split('.')[1]}-${hop}-${facing === 1 ? 'r' : 'l'}`, row: row.row, hop, facing, startFrac: facing === 1 ? 0.3 : 0.7,
  must: [row.move], expect: row.expect, pin: row.pin, shotOnHit: true,
  shotAges: [{ label: 'contact', move: row.move, age: -1 }],
  phases: [...lead, { keys: row.keys, steps: 1 }, { steps: 75 }],
}))));
/** Landing lag with no target: short hop, aerial pressed on the way down so the landing falls inside the move
 * (before its autocancel window); `wait` = steps after the jump key. Up-air uses the simulated analog stick (tilt up)
 * because a real W press while falling is an air jump. */
const AERIAL_LANDING_SEGMENTS = [['nair', ['f'], 28], ['fair', ['fwd', 'f'], 18], ['bair', ['back', 'f'], 18], ['uair', ['f'], 28, { x: 0, y: -1 }], ['dair', ['s', 'f'], 18]]
  .flatMap(([move, keys, wait, tilt]) => [1, -1].map(facing => ({ name: `${move}-landing-${facing === 1 ? 'r' : 'l'}`, row: `${move}-landing`, hop: 'short', facing,
    startFrac: facing === 1 ? 0.3 : 0.7, must: [move], simulatedTilt: !!tilt,
    phases: [{ keys: ['w'], steps: 2 }, { steps: wait }, { keys, ...(tilt ? { tilt } : {}), steps: 1 }, { steps: 70 }] })));
/** Specials: real keys only (G = special, H = shield, W = up/jump, S = down, fwd/back mirrored per facing), both facings.
 * `row` = inventory id; `expect` = sourced fresh values (one record, or `anyOf` records for multi-region moves).
 * Pins (see AERIAL_ROWS) hold P2 from attack age `from` to `to` (or segment steps `fromStep`..`toStep`) at (dx, dy) from DK's
 * body centre; `dy: null` stands P2 on the floor. `hitShots` take one screenshot at the first hit whose DK attack age is
 * >= minAge (highest matching threshold). A full hop is W held 14 steps; W is released 5 steps before G (the 4-step
 * directional window would otherwise read the hop's up as an up special). A short hop is W for 2 steps, airborne ~8 steps later. */
const FULL_HOP = [{ keys: ['w'], steps: 14 }, { steps: 5 }];
const SHORT_HOP = [{ keys: ['w'], steps: 2 }, { steps: 8 }];
const PUNCH = { ground: { bkb: 45, kbg: 70, min: 10, partialMax: 27, full: { damage: 28, base: 35, growth: 73, angle: 361 } },
  air: { bkb: 60, kbg: 65, min: 6, partialMax: 23, full: { damage: 25, base: 40, growth: 72, angle: 361 } } };
const SPECIAL_SEGMENTS = [
  { name: 'punch-ground-charge', row: 'donkeykong.giant-punch-ground-charge', must: ['neutral_special_charge'],
    phases: [{ keys: ['g'], steps: 1 }, { steps: 140, shots: [3, 20, 60, 116] }] },
  { name: 'punch-air-charge', row: 'donkeykong.giant-punch-air-charge', must: ['neutral_special_air_charge'],
    phases: [...FULL_HOP, { keys: ['g'], steps: 1 }, { steps: 30, shots: [6, 20] }, { until: 'landed', steps: 120, shots: [3] }, { steps: 20 }] },
  { name: 'punch-ground-partial-min', row: 'donkeykong.giant-punch-ground-partial', opponent: 85, must: ['neutral_special'], punch: 'ground', hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['g'], steps: 1 }, { steps: 8 }, { keys: ['g'], steps: 1 }, { steps: 110 }] },
  { name: 'punch-ground-partial-mid', row: 'donkeykong.giant-punch-ground-partial', opponent: 85, must: ['neutral_special', 'neutral_special_charge'], punch: 'ground', hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['g'], steps: 1 }, { steps: 60 }, { keys: ['g'], steps: 1 }, { steps: 110 }] },
  { name: 'punch-air-partial', row: 'donkeykong.giant-punch-air-partial', must: ['neutral_special_air'], punch: 'air', hitShots: [{ label: 'contact', minAge: 0 }],
    pin: { from: 17, to: 20, dx: 75, dy: -12 }, phases: [...FULL_HOP, { keys: ['g'], steps: 1 }, { steps: 14 }, { keys: ['g'], steps: 1 }, { steps: 110 }] },
  { name: 'punch-ground-full', row: 'donkeykong.giant-punch-ground-full', opponent: 85, must: ['neutral_special'], punch: 'ground', hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['g'], steps: 1 }, { steps: 125 }, { keys: ['g'], steps: 1 }, { steps: 110 }] },
  { name: 'punch-air-full', row: 'donkeykong.giant-punch-air-full', must: ['neutral_special_air'], punch: 'air', hitShots: [{ label: 'contact', minAge: 0 }],
    pin: { from: 17, to: 20, dx: 75, dy: -12 }, phases: [{ keys: ['g'], steps: 1 }, { steps: 125 }, ...FULL_HOP, { keys: ['g'], steps: 1 }, { steps: 110 }] },
  { name: 'punch-ground-cancel-bank', row: 'donkeykong.giant-punch-ground-cancel-bank', opponent: 85, must: ['neutral_special_cancel', 'neutral_special'], punch: 'ground',
    // Cancel banks the charge; a fresh G resumes charging from the bank, a second G fires it.
    phases: [{ keys: ['g'], steps: 1 }, { steps: 40 }, { keys: ['h'], steps: 12, shots: [0, 2] }, { steps: 10 }, { keys: ['g'], steps: 1 }, { steps: 10 },
      { keys: ['g'], steps: 1 }, { steps: 40, shots: [18] }] },
  { name: 'punch-air-cancel-bank', row: 'donkeykong.giant-punch-air-cancel-bank', must: ['neutral_special_air_cancel'],
    phases: [...FULL_HOP, { keys: ['g'], steps: 1 }, { steps: 20 }, { keys: ['h'], steps: 1, shots: [0] }, { steps: 6, shots: [1, 3] }, { until: 'landed', steps: 100 }, { steps: 20 }] },
  { name: 'headbutt-ground', row: 'donkeykong.headbutt-ground', opponent: 75, must: ['side_special'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { damage: 10, base: 40, growth: 40, angle: 270 }, phases: [{ keys: ['fwd', 'g'], steps: 1 }, { steps: 80 }] },
  { name: 'headbutt-air', row: 'donkeykong.headbutt-air', must: ['side_special_air'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { anyOf: [{ damage: 8, base: 15, growth: 40, angle: 70 }, { damage: 10, base: 30, growth: 40, angle: 270 }] },
    pin: { from: 18, to: 22, dx: 70, dy: -13 }, phases: [...FULL_HOP, { keys: ['fwd', 'g'], steps: 1 }, { steps: 70 }] },
  { name: 'spin-ground-chain', row: 'donkeykong.spinning-kong-ground-*', opponent: 55, must: ['up_special_ground'],
    hitShots: [{ label: 'first', minAge: 0 }, { label: 'rung', minAge: 23 }, { label: 'final', minAge: 60 }],
    phases: [{ keys: ['w', 'g'], steps: 1 }, { steps: 115, shots: [80, 104] }, { steps: 20 }] },
  { name: 'spin-ground-final', row: 'donkeykong.spinning-kong-ground-final', must: ['up_special_ground'], hitShots: [{ label: 'final', minAge: 0 }],
    pin: { from: 60, to: 62, dx: 40, dy: null }, phases: [{ keys: ['w', 'g'], steps: 1 }, { steps: 115 }] },
  { name: 'spin-air-chain', row: 'donkeykong.spinning-kong-air-*', must: ['up_special_air', 'up_special_air_land'],
    hitShots: [{ label: 'first', minAge: 0 }, { label: 'rung', minAge: 8 }, { label: 'final', minAge: 36 }],
    pin: { from: 3, to: 6, dx: 0, dy: -30 },
    phases: [{ keys: ['w'], steps: 14 }, { keys: ['w', 'g'], steps: 1 }, { keys: ['w'], steps: 2 }, { steps: 70, shots: [50] }, { until: 'landed', steps: 200 }, { steps: 45, shots: [1, 12] }] },
  { name: 'spin-air-final', row: 'donkeykong.spinning-kong-air-final', must: ['up_special_air'], hitShots: [{ label: 'final', minAge: 0 }],
    pin: { from: 38, to: 43, dx: 0, dy: -10, hitbox: true }, phases: [{ keys: ['w'], steps: 14 }, { keys: ['w', 'g'], steps: 1 }, { keys: ['w'], steps: 2 }, { steps: 110 }] },
  // Late in a held full hop (W never re-pressed, so no air jump): the spin starts low and may land before it ends.
  { name: 'spin-air-land', row: 'donkeykong.spinning-kong-air-land', must: ['up_special_air', 'up_special_air_land'],
    phases: [{ keys: ['w'], steps: 45 }, { keys: ['w', 'g'], steps: 1 }, { until: 'landed', steps: 200 }, { steps: 45, shots: [1, 10, 30] }] },
  // Grounded spin started near a side platform's edge, drifting forward off it onto the floor below:
  // touchdown before frame 63 continues on the grounded SpecialHi tail from frame 63 (groundedLandingFrame).
  { name: 'spin-ground-land', row: 'donkeykong.spinning-kong-ground-land', must: ['up_special_ground'], mustNot: ['up_special_air_land'],
    p1On: { edge: 12 },
    phases: [{ keys: ['w', 'g'], steps: 1 }, { keys: ['fwd'], until: 'landed', steps: 90, shots: [10] }, { steps: 60, shots: [0, 1, 13, 40] }] },
  // Aerial spin started just above the floor (end of a held full hop) under the top platform: it rises
  // through the pass-through platform (peak ~171 px) and touches down on it before special fall,
  // continuing on grounded SpecialHi frame 63 (groundedLandingFrame) instead of landing_fall_special.
  { name: 'spin-air-land-during', row: 'donkeykong.spinning-kong-air-land', must: ['up_special_air', 'up_special_ground'], mustNot: ['up_special_air_land'],
    p1On: { under: 'top' },
    phases: [{ keys: ['w'], until: 'nearFloor', steps: 90 }, { keys: ['w', 'g'], steps: 1 }, { keys: ['w'], steps: 2 }, { until: 'settled', steps: 120, shots: [30] },
      { steps: 60, shots: [0, 1, 13, 40] }] },
  { name: 'slap-ground-first', row: 'donkeykong.hand-slap-ground-first', opponent: 60, must: ['down_special'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { anyOf: [{ damage: 14, base: 85, growth: 30, angle: 78 }, { damage: 14, base: 85, growth: 30, angle: 84 }] },
    phases: [{ keys: ['s', 'g'], steps: 1 }, { steps: 60 }] },
  // Source fixes 2026-10-11 (SmashWiki offsets [0, 5, 6.1], 15 u apart): grounded reach far in front and behind DK.
  ...[['far', 150], ['behind', -140]].map(([n, d]) => ({ name: `slap-ground-${n}`, row: 'donkeykong.hand-slap-ground-first', opponent: d, must: ['down_special'],
    hitShots: [{ label: 'contact', minAge: 0 }], expect: { anyOf: [{ damage: 14, base: 85, growth: 30, angle: 78 }, { damage: 14, base: 85, growth: 30, angle: 84 }] },
    phases: [{ keys: ['s', 'g'], steps: 1 }, { steps: 60 }] })),
  { name: 'slap-ground-second', row: 'donkeykong.hand-slap-ground-second', must: ['down_special'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { anyOf: [{ damage: 14, base: 85, growth: 30, angle: 78 }, { damage: 14, base: 85, growth: 30, angle: 84 }] },
    pin: { from: 21, to: 24, dx: 45, dy: null }, phases: [{ keys: ['s', 'g'], steps: 1 }, { steps: 60 }] },
  { name: 'slap-ground-repeat', row: 'donkeykong.hand-slap-ground-repeat', must: ['down_special'], hitShots: [{ label: 'repeat-contact', minAge: 0 }],
    expect: { anyOf: [{ damage: 14, base: 85, growth: 30, angle: 78 }, { damage: 14, base: 85, growth: 30, angle: 84 }] },
    pin: { fromStep: 34, toStep: 42, dx: 45, dy: null },
    phases: [{ keys: ['s', 'g'], steps: 1 }, { keys: ['s'], steps: 17 }, { keys: ['s', 'g'], steps: 1 }, { keys: ['s'], steps: 10 }, { steps: 60, shots: [30] }] },
  { name: 'slap-air-first', row: 'donkeykong.hand-slap-air-first', must: ['down_special_air'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { damage: 5, base: 0, growth: 100, angle: 90, fixed: 36 }, pin: { from: 18, to: 21, dx: 25, dy: 0 },
    phases: [...FULL_HOP, { keys: ['s', 'g'], steps: 1 }, { steps: 70 }] },
  { name: 'slap-air-second', row: 'donkeykong.hand-slap-air-second', must: ['down_special_air'], hitShots: [{ label: 'contact', minAge: 0 }],
    expect: { damage: 6, base: 30, growth: 100, angle: 270 }, pin: { from: 27, to: 30, dx: 25, dy: 10 },
    phases: [...FULL_HOP, { keys: ['s', 'g'], steps: 1 }, { steps: 70 }] },
  { name: 'slap-air-land', row: 'donkeykong.hand-slap-air-land', must: ['down_special_air', 'down_special_air_land'],
    phases: [...SHORT_HOP, { keys: ['s', 'g'], steps: 1 }, { until: 'landed', steps: 80, shots: [8] }, { steps: 30, shots: [1, 6] }] },
  // Up special out of jumpsquat (Ultimate jump-canceled up special): W (up + jump) held for `w` steps, then W + G. W first
  // fills the tap-jump buffer, then jumpsquat, then takeoff; a press on any jumpsquat step must be the rooted grounded spin.
  ...[3, 4, 5, 6, 7, 8, 9].map(w => ({ name: `spin-jumpsquat-w${w}`, row: 'donkeykong.spinning-kong-out-of-jumpsquat', stepMode: true,
    phases: [{ keys: ['w'], steps: w }, { keys: ['w', 'g'], steps: 1 }, { keys: ['w'], steps: 30, shots: [6] }, { steps: 120 }] })),
  // Hand Slap mash window: the second G lands on the step whose attack age is `at` (first G = age 0).
  ...[2, 6, 12, 13, 25, 26, 32].map(at => ({ name: `slap-mash-at${at}`, row: 'donkeykong.hand-slap-ground-repeat', stepMode: true, must: ['down_special'],
    phases: [{ keys: ['s', 'g'], steps: 1 }, { keys: ['s'], steps: at - 1 }, { keys: ['s', 'g'], steps: 1 }, { keys: ['s'], steps: 5 }, { steps: 60 }] })),
].flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: facing === 1 ? 0.3 : 0.7 })));
/** Defense: real keys (H = shield, R = dedicated dodge button, W/A/S/D stick, fwd/back mirrored per facing).
 * Shield + stick is the dodge chord (down = spot dodge, fwd/back = roll, in the air a directional air dodge); R in the air is the
 * neutral air dodge. P2 (Pikachu) attacks with the real Numpad1 jab key through `p2Hold` {key:'Numpad1', from, to}; P2 stands at
 * centre distance `opponent` facing DK. `p2at` sweeps the jab press step so the hit lands inside / after the intangible window or
 * the parry window. `shieldHealth` is probe setup (drops shield HP before the block that breaks it), not player input. */
const jabAt = at => [{ key: 'Numpad1', from: at, to: at + 3 }];
const DEFENSE_OPP = 62;
/** Start x fractions (facing +1, -1) with open floor below (no side/top platform under the fall or the dodge travel). */
const HI_START = [0.364, 0.92];
const DEFENSE_SEGMENTS = [
  { name: 'baseline-jab', row: 'baseline', opponent: DEFENSE_OPP, p2Hold: jabAt(2), phases: [{ steps: 40 }] },
  { name: 'shield-hold', row: 'donkeykong.shield', must: ['shield'], phases: [{ keys: ['h'], steps: 70, shots: [4, 30, 69] }, { steps: 20 }] },
  { name: 'shield-release', row: 'donkeykong.shield-release', must: ['shield', 'shield_end'], phases: [{ keys: ['h'], steps: 20 }, { steps: 30, shots: [0, 3, 7] }] },
  { name: 'shield-block', row: 'donkeykong.shield-block', opponent: DEFENSE_OPP, must: ['shield', 'shield_hit'], p2Hold: jabAt(12),
    phases: [{ keys: ['h'], steps: 60, shots: [14, 17, 22] }, { steps: 20 }] },
  ...[0, 1, 3, 4, 5, 7, 9].map(at => ({ name: `parry-p2at${at}`, row: 'donkeykong.parry', opponent: DEFENSE_OPP, p2Hold: jabAt(20 + at),
    phases: [{ keys: ['h'], steps: 20 }, { steps: 30, shots: [at + 2] }] })),
  { name: 'shield-break', row: 'donkeykong.shield-break', opponent: DEFENSE_OPP, shieldHealth: 2, must: ['shield', 'shield_break'], p2Hold: jabAt(10),
    phases: [{ keys: ['h'], steps: 12 }, { steps: 230, shots: [8, 40, 120, 190] }] },
  ...[0, 1, 2, 12, 14, 15, 16, 20].map(at => ({ name: `spot-dodge-p2at${at}`, row: 'donkeykong.spot-dodge', opponent: DEFENSE_OPP, p2Hold: jabAt(at), must: ['spot_dodge'],
    phases: [{ keys: ['h', 's'], steps: 1 }, { steps: 70, shots: at === 2 ? [3, 9, 16, 22] : [] }] })),
  ...[0, 1, 2, 12, 13, 14].map(at => ({ name: `roll-fwd-p2at${at}`, row: 'donkeykong.roll-forward', opponent: DEFENSE_OPP, p2Hold: jabAt(at), must: ['roll'],
    phases: [{ keys: ['h', 'fwd'], steps: 1 }, { steps: 70, shots: at === 2 ? [3, 9, 16, 24] : [] }] })),
  ...[2, 3, 4, 14].map(at => ({ name: `roll-back-p2at${at}`, row: 'donkeykong.roll-back', opponent: DEFENSE_OPP, p2Hold: jabAt(at), must: ['roll_back'],
    phases: [{ keys: ['h', 'back'], steps: 1 }, { steps: 70, shots: at === 2 ? [3, 9, 16, 26] : [] }] })),
  // Back roll slides away from the jab: a close P2 (45 px) lets hits at steps 4+ reach DK inside the window; step 3 is just before it.
  ...[3, 4, 8, 12].map(at => ({ name: `roll-back-close-p2at${at}`, row: 'donkeykong.roll-back', opponent: 45, p2Hold: jabAt(at), must: ['roll_back'],
    phases: [{ keys: ['h', 'back'], steps: 1 }, { steps: 70 }] })),
  ...[['neutral', ['r'], 'air_dodge', 'donkeykong.air-dodge-neutral'], ['horizontal', ['h', 'fwd'], 'air_dodge_horizontal', 'donkeykong.air-dodge-horizontal'],
    ['up', ['h', 'w'], 'air_dodge_up', 'donkeykong.air-dodge-up'], ['up-diagonal', ['h', 'w', 'fwd'], 'air_dodge_up_diagonal', 'donkeykong.air-dodge-up-diagonal'],
    ['down', ['h', 's'], 'air_dodge_down', 'donkeykong.air-dodge-down'], ['down-diagonal', ['h', 's', 'fwd'], 'air_dodge_down_diagonal', 'donkeykong.air-dodge-down-diagonal']]
    .map(([n, keys, sheetAlias, row]) => ({ name: `air-dodge-${n}`, row, must: ['air_dodge'], intendedAlias: sheetAlias,
      phases: [...FULL_HOP, { keys, steps: 1 }, { steps: 130, shots: [3, 12, 24, 40] }, { until: 'landed', steps: 200 }, { steps: 40, shots: [1, 6] }] })),
  // Full-length air dodges: DK starts LIFT px up (probe setup) so the dodge is not cut short by landing; real keys for the dodge itself.
  ...[['neutral', ['r']], ['horizontal', ['h', 'fwd']], ['up', ['h', 'w']], ['up-diagonal', ['h', 'w', 'fwd']], ['down', ['h', 's']], ['down-diagonal', ['h', 's', 'fwd']]]
    .map(([n, keys]) => ({ name: `air-dodge-hi-${n}`, row: `donkeykong.air-dodge-${n}`, lift: 600, startFracs: HI_START, must: ['air_dodge'],
      phases: [{ steps: 2 }, { keys, steps: 1 }, { steps: 160, shots: [3, 12, 24, 40, 60] }, { until: 'landed', steps: 200 }, { steps: 30, shots: [1, 6] }] })),
  // Pikachu pinned at DK's side in the air and jabbing: hit inside (step 8) / after (step 60) the neutral air-dodge intangible window.
  ...[8, 40, 60].map(at => ({ name: `air-dodge-hi-neutral-hit${at}`, row: 'donkeykong.air-dodge-neutral', lift: 600, startFracs: HI_START, opponent: 62, p2Hold: [{ key: 'Numpad1', from: at, to: at + 14 }], must: ['air_dodge'],
    pin: { fromStep: 0, toStep: at + 14, dx: 58, dy: 0 },
    phases: [{ steps: 2 }, { keys: ['r'], steps: 1 }, { steps: 100, shots: [at - 1] }] })),
].flatMap(seg => [1, -1].map(facing => ({ ...seg, stepMode: true, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: seg.startFracs?.[facing === 1 ? 0 : 1] ?? (facing === 1 ? 0.3 : 0.7) })));
/** Grabs / throws / cargo: real keys (T = grab, F = attack/pummel, W/A/S/D stick, fwd/back mirrored per facing); P2 (Pikachu) is the
 * target and escapes with real Numpad1 / ArrowLeft presses (`mash`). Cargo = a forward stick throw while holding (cargo entry), then
 * walk / jump / the four cargo throws (attack + stick direction). `holdWait` = steps to reach the hold from the grab press. */
const mash = (from, to, every = 4) => Array.from({ length: Math.ceil((to - from) / every) }, (_, i) => ({ key: i % 2 ? 'ArrowLeft' : 'Numpad1', from: from + i * every, to: from + i * every + 2 }));
const GRAB = { keys: ['t'], steps: 1 };
const HOLD_WAIT = 40;
const toHold = [GRAB, { steps: HOLD_WAIT, shots: [4, 12, 25] }];
const throwSeg = (dir, key) => ({ name: `throw-${dir}`, row: `donkeykong.${dir}-throw`, opponent: 60, must: ['grab_hold', ...(dir === 'back' ? ['bthrow'] : dir === 'up' ? ['uthrow'] : ['dthrow'])],
  phases: [...toHold, { keys: [key], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30, 45, 60] }] });
const CARGO_ENTRY = [...toHold, { keys: ['fwd'], steps: 1 }, { steps: 20, shots: [1, 8, 15] }];
const cargoThrow = (dir, keys, extra = {}) => ({ name: `cargo-${dir}-throw`, row: `donkeykong.cargo-${dir}-throw-ground`, opponent: 60, must: ['cargo_hold', `cargo_${dir[0]}throw`],
  phases: [...CARGO_ENTRY, { steps: 20, shots: [3] }, { keys, steps: 1 }, { steps: 80, shots: [2, 8, 14, 20, 30, 45, 60] }], ...extra });
/** Simulated reference hits (probe setup): reference knockback well under / over DK's 16-unit cargo-throw armor. */
const SIM_WEAK_HIT = { damage: 1, facing: 1, hitlagMultiplier: 1, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 5, growth: 10, angle: 45 } } };
const SIM_STRONG_HIT = { damage: 12, facing: 1, hitlagMultiplier: 1, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 60, growth: 100, angle: 45 } } };
const GRAB_SEGMENTS = [
  { name: 'grab-hit-hold', row: 'donkeykong.grab-standing', opponent: 60, must: ['grab', 'grab_pull', 'grab_hold'],
    phases: [GRAB, { steps: 150, shots: [3, 7, 9, 14, 22, 30, 60, 100, 136, 142] }] },
  { name: 'grab-whiff', row: 'donkeykong.grab-standing', opponent: 400, must: ['grab'], phases: [GRAB, { steps: 70, shots: [0, 6, 7, 9, 14, 22, 30, 37, 40] }] },
  { name: 'grab-dash', row: 'donkeykong.grab-dash', opponent: 150, must: ['dash_grab'],
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 't'], steps: 1 }, { steps: 100, shots: [1, 5, 9, 10, 14, 25, 35, 45] }] },
  { name: 'grab-dash-whiff', row: 'donkeykong.grab-dash', opponent: 600, must: ['dash_grab'],
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 't'], steps: 1 }, { steps: 70, shots: [2, 8, 10, 20, 30, 40, 50] }] },
  // Unpinned target behind the run: the pivot grab keeps no run momentum (native CatchTurn has no Trans travel).
  { name: 'grab-pivot', row: 'donkeykong.grab-pivot', opponent: -40, must: ['pivot_grab'],
    phases: [{ keys: ['fwd'], steps: 5 }, { keys: ['back', 't'], steps: 1 }, { steps: 100, shots: [1, 6, 10, 11, 14, 25, 35, 45] }] },
  { name: 'grab-pivot-whiff', row: 'donkeykong.grab-pivot', opponent: -600, must: ['pivot_grab'],
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['back', 't'], steps: 1 }, { steps: 70, shots: [2, 8, 11, 20, 30, 40, 50] }] },
  { name: 'pummel', row: 'donkeykong.pummel', opponent: 60, must: ['grab_hold', 'pummel'],
    phases: [...toHold, { keys: ['f'], steps: 1 }, { steps: 12, shots: [1, 4, 8] }, { keys: ['f'], steps: 1 }, { steps: 40, shots: [2, 10, 30] }] },
  { name: 'grab-escape', row: 'donkeykong.grab-escape', opponent: 60, must: ['grab_pull'],
    p2Hold: mash(24, 160), phases: [GRAB, { steps: 140, shots: [30, 50, 70] }] },
  throwSeg('back', 'back'), throwSeg('up', 'w'), throwSeg('down', 's'),
  { name: 'throw-forward-cargo-entry', row: 'donkeykong.forward-throw-cargo-entry', opponent: 60, must: ['grab_hold', 'fthrow', 'cargo_hold'],
    phases: [...CARGO_ENTRY, { steps: 60, shots: [5, 30] }] },
  { name: 'cargo-hold-walk', row: 'donkeykong.cargo-hold-ground', opponent: 60, must: ['cargo_hold', 'cargo_walk'],
    phases: [...CARGO_ENTRY, { steps: 90, shots: [2, 20, 40, 70] }, { keys: ['fwd'], steps: 40, shots: [5, 20, 38] }, { steps: 30, shots: [3] }] },
  { name: 'cargo-jump', row: 'donkeykong.cargo-jump', opponent: 60, must: ['cargo_hold', 'cargo_jump'],
    phases: [...CARGO_ENTRY, { steps: 15 }, { keys: ['w'], steps: 6, shots: [1, 5] }, { steps: 70, shots: [2, 8, 14, 20, 28, 40, 55] }] },
  { name: 'cargo-hold-air', row: 'donkeykong.cargo-hold-air', opponent: 60, must: ['cargo_hold', 'cargo_hold_air'],
    phases: [...CARGO_ENTRY, { steps: 5 }, { keys: ['back'], until: 'airborne', steps: 600 }, { keys: ['back'], steps: 40, shots: [2, 6, 14, 22, 30] }] },
  cargoThrow('forward', ['f']), cargoThrow('back', ['back', 'f']), cargoThrow('up', ['w', 'f']), cargoThrow('down', ['s', 'f']),
  // Source fixes 2026-10-11: knockback armor during a cargo throw. Throw keys are real; the two hits on DK are SIMULATED
  // (probe setup: applyHitDetailed with a reference launch) because the only opponent is the carried one.
  ...[['forward', ['f']], ['back', ['back', 'f']], ['up', ['w', 'f']], ['down', ['s', 'f']]].map(([dir, keys]) => ({
    ...cargoThrow(dir, keys), name: `cargo-${dir}-throw-armor`, row: `donkeykong.cargo-${dir}-throw-ground`,
    p1SimHits: [{ step: 84, hit: SIM_WEAK_HIT }, { step: 86, hit: SIM_STRONG_HIT }] })),
  // Walking off backward turns the carry to face the walk, so in the air the back throw is the stick toward the stage
  // (`fwd` relative to the segment's starting facing). Carried DK has no ledge catch (no cliff check while carrying).
  ...[['forward', ['f']], ['back', ['fwd', 'f']], ['up', ['w', 'f']], ['down', ['s', 'f']]].map(([dir, keys]) => ({ name: `cargo-${dir}-throw-air`, row: `donkeykong.cargo-${dir}-throw-air`,
    opponent: 60, must: ['cargo_hold', 'cargo_hold_air', `cargo_${dir[0]}throw`],
    phases: [...CARGO_ENTRY, { steps: 5 }, { keys: ['back'], until: 'airborne', steps: 600 }, { keys: ['back'], steps: 5 }, { keys, steps: 1 }, { steps: 80, shots: [2, 8, 14, 20, 30, 45, 60] }] })),
].flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing, stepMode: true,
  startFrac: facing === 1 ? 0.3 : 0.7 })));
/** Animation continuity: per-step sheet/frame through each move's end (the animation tail after FAF), the charge loops and
 * a P2 hit (Numpad1 jab through CDP). Real keys except the forward tilt's simulated analog stick (see GROUND_ATTACK_SEGMENTS). */
const CONTINUITY_SEGMENTS = [
  { name: 'jab', must: ['jab'], phases: [{ keys: ['f'], steps: 1 }, { steps: 40, shots: [22, 24] }] },
  { name: 'ftilt', simulatedTilt: true, must: ['tilt'], phases: [{ tilt: { x: 0.5, y: 0 }, steps: 3 }, { tilt: { x: 0.5, y: 0 }, keys: ['f'], steps: 1 }, { steps: 50, shots: [38, 41] }] },
  { name: 'dash-attack', must: ['dash_attack'], phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 70, shots: [33, 40, 50, 58] }] },
  { name: 'fsmash-held', must: ['smash', 'smash_charge'], phases: [{ keys: ['fwd', 'v'], steps: 2 }, { keys: ['v'], steps: 62, shots: [20, 21, 22, 56, 57] },
    { steps: 90, shots: [40, 50, 55] }] },
  { name: 'punch-charge', must: ['neutral_special_charge'], phases: [{ keys: ['g'], steps: 1 }, { steps: 60, shots: [27, 28, 29, 30] }] },
  { name: 'hit-by-p2', opponent: 62, p2Hold: jabAt(2), p1HitShots: true, phases: [{ steps: 45 }] },
].map(seg => ({ ...seg, stepMode: true, facing: 1, startFrac: 0.3 }));
/** Partials (2026-10-11): grounded adjacent up tilt, close forward smash, down smash shoulder/fist regions, parry flash,
 * shield release clock, and air dodges that run their full length off-stage (DK starts beyond the floor edge, `lift`
 * px up, dodging away from the stage) plus on-stage early/late directional landings. Real keys; `pin`/`lift` are setup. */
const OFFSTAGE = [1.14, -0.14];
const PARTIAL_SEGMENTS = [
  ...[50, 64].map(d => ({ name: `utilt-adjacent-${d}`, row: 'donkeykong.up-tilt', opponent: d, must: ['utilt'], hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['w'], steps: 3 }, { keys: ['w', 'f'], steps: 1 }, { steps: 50 }] })),
  ...[50, 64].map(d => ({ name: `fsmash-close-${d}`, row: 'donkeykong.forward-smash-close', opponent: d, must: ['smash'], hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['fwd', 'v'], steps: 3 }, { steps: 70 }] })),
  { name: 'fsmash-far-115', row: 'donkeykong.forward-smash', opponent: 115, must: ['smash'], hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['fwd', 'v'], steps: 3 }, { steps: 70 }] },
  // Airborne target held above DK's front shoulder (clear of the floor-level fist) over the early arms window.
  { name: 'dsmash-shoulder', row: 'donkeykong.down-smash-arms', must: ['dsmash'], hitShots: [{ label: 'contact', minAge: 0 }],
    pin: { from: 8, to: 13, dx: 40, dy: -30 }, phases: [{ keys: ['s', 'v'], steps: 1 }, { steps: 70 }] },
  { name: 'dsmash-fist-95', row: 'donkeykong.down-smash', opponent: 95, must: ['dsmash'], hitShots: [{ label: 'contact', minAge: 0 }],
    phases: [{ keys: ['s', 'v'], steps: 1 }, { steps: 70 }] },
  { name: 'shield-release', row: 'donkeykong.shield-release', must: ['shield', 'shield_end'], phases: [{ keys: ['h'], steps: 20 }, { steps: 30, shots: [0, 3, 7, 10] }] },
  ...[1, 3].map(at => ({ name: `parry-p2at${at}`, row: 'donkeykong.parry', opponent: DEFENSE_OPP, p2Hold: jabAt(20 + at),
    phases: [{ keys: ['h'], steps: 20 }, { steps: 40, shots: [at + 1, at + 2, at + 4, at + 8, at + 14] }] })),
  ...[['up', ['h', 'w']], ['down', ['h', 's']], ['down-diagonal', ['h', 's', 'fwd']], ['horizontal', ['h', 'fwd']], ['up-diagonal', ['h', 'w', 'fwd']], ['neutral', ['r']]]
    .map(([n, keys]) => ({ name: `air-dodge-off-${n}`, row: `donkeykong.air-dodge-${n}`, lift: 600, startFracs: OFFSTAGE, must: ['air_dodge'],
      phases: [{ steps: 2 }, { keys, steps: 1 }, { steps: 125, shots: [3, 24, 70] }] })),
  // On-stage landings: down from a full hop lands early; up from 540 px lands late in the dodge.
  { name: 'air-dodge-land-early-down', row: 'donkeykong.air-dodge-down', must: ['air_dodge'],
    phases: [...FULL_HOP, { keys: ['h', 's'], steps: 1 }, { until: 'landed', steps: 130 }, { steps: 30, shots: [1, 6] }] },
  { name: 'air-dodge-land-late-up', row: 'donkeykong.air-dodge-up', lift: 540, must: ['air_dodge'],
    phases: [{ steps: 2 }, { keys: ['h', 'w'], steps: 1 }, { until: 'landed', steps: 140 }, { steps: 30, shots: [1, 6] }] },
].flatMap(seg => [1, -1].map(facing => ({ ...seg, stepMode: true, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: seg.startFracs?.[facing === 1 ? 0 : 1] ?? (facing === 1 ? 0.3 : 0.7) })));

/** Ledge / recovery / downed / footstool / captured / entry / parry (2026-10-11). Real keys; `setup` is probe setup (positions and damage), see reset().
 * Ledge: DK is placed just outside the ledge corner the segment faces (facing 1 = left corner) and holds forward until the catch; get-up needs
 * an upward stick of at least 0.5 that is not a jump, so it uses the SIMULATED analog tilt (a real W press is the ledge jump). */
const SMASH_P2 = [{ key: 'toward', from: 4, to: 9 }, { key: 'Numpad0', from: 4, to: 9 }];
const TRIP_P2 = [{ key: 'ArrowDown', from: 4, to: 12 }, { key: 'Numpad1', from: 6, to: 9 }];
const LEDGE_APPROACH = { p1Edge: { dx: 45, dy: -30, vx: 0, vy: 0 } };
const toLedge = [{ steps: 1 }, { keys: ['fwd'], untilSheet: 'ledge_catch', steps: 60 }, { keys: [], steps: 6, shots: [3] }];
/** Source fixes 2026-10-11 (SmashWiki Edge regrab penalties): catch the ledge, drop (S), air-jump (W) and catch again,
 * `grabs` times without landing, then take an option. Real keys; ledge.grabs in the records counts the catches. */
// Between catches DK drops (real S), waits out the 30-frame regrab cooldown in the air, and is re-placed at the approach
// point (probe setup, the same `p1Edge` as the first catch; no landing, no hitstun) before the real forward catch.
const regrab = (grabs, wait = 32) => [...toLedge.slice(0, 2), ...(grabs > 1 ? [toLedge[2], { steps: 22 }] : []), ...Array.from({ length: grabs - 1 }, (_, i) => [
  { keys: ['s'], steps: 1 }, { steps: 3 }, { keys: ['w'], steps: 3 }, { steps: 26 },
  { p1Edge: LEDGE_APPROACH.p1Edge, steps: 1 }, { keys: ['fwd'], untilSheet: 'ledge_catch', steps: 60 }, ...(i < grabs - 2 ? [{ keys: [], steps: 32 }] : [])]).flat(),
  ...(wait ? [{ keys: [], steps: wait }] : [])];
const LEDGE_SEGMENTS = [
  // Hold forward from the catch: the roll starts on the first step the (slowed) catch allows an option.
  ...[1, 2, 3, 4, 5, 6].map(g => ({ name: `ledge-regrab${g}-catch-roll`, setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge_roll'],
    phases: [...regrab(g, 0), { keys: ['fwd'], steps: 70, shots: [12, 19, 24, 40] }] })),
  ...[2, 3, 4].flatMap(g => [
    { name: `ledge-regrab${g}-attack`, setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge_attack'], phases: [...regrab(g), { keys: ['f'], steps: 1 }, { steps: 70, shots: [2, 12, 24, 40] }] },
    { name: `ledge-regrab${g}-getup`, setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge_getup'], simulatedTilt: true, phases: [...regrab(g), { tilt: { x: 0, y: -1 }, steps: 1 }, { steps: 50, shots: [2, 20] }] },
    { name: `ledge-regrab${g}-jump`, setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge_jump'], phases: [...regrab(g), { keys: ['w'], steps: 2 }, { steps: 40, shots: [2, 10] }] },
  ]),
  // Six catches, then a seventh attempt that must not latch.
  { name: 'ledge-regrab7', setup: LEDGE_APPROACH, must: ['ledge_catch'], phases: [...regrab(7), { steps: 60, shots: [10, 40] }] },
  { name: 'ledge-hang', setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge'], phases: [...toLedge, { steps: 150, shots: [4, 20, 60, 100] }, { keys: ['s'], steps: 20, shots: [3] }] },
  { name: 'ledge-getup', setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge', 'ledge_getup'], simulatedTilt: true,
    phases: [...toLedge, { steps: 40 }, { tilt: { x: 0, y: -1 }, steps: 1 }, { steps: 60, shots: [2, 8, 14, 20, 27, 34] }] },
  { name: 'ledge-roll', setup: LEDGE_APPROACH, must: ['ledge', 'ledge_roll'], phases: [...toLedge, { steps: 40 }, { keys: ['fwd'], steps: 2 }, { steps: 70, shots: [2, 10, 18, 26, 34, 44, 52] }] },
  { name: 'ledge-attack', setup: LEDGE_APPROACH, must: ['ledge', 'ledge_attack'], phases: [...toLedge, { steps: 40 }, { keys: ['f'], steps: 1 }, { steps: 80, shots: [3, 10, 20, 24, 34, 50, 62] }] },
  { name: 'ledge-jump', setup: LEDGE_APPROACH, must: ['ledge', 'ledge_jump'], phases: [...toLedge, { steps: 40 }, { keys: ['w'], steps: 2 }, { steps: 50, shots: [1, 5, 10, 20] }] },
  // Up special above the stage edge: spin ends helpless and DK falls (fall_special) past the corner.
  { name: 'fall-special', setup: { p1Edge: { dx: 160, dy: -250, vx: 0, vy: 0 } }, must: ['up_special_air', 'fall_special'],
    phases: [{ steps: 2 }, { keys: ['w', 'g'], steps: 1 }, { keys: ['w'], steps: 2 }, { steps: 140, shots: [30, 60, 80, 100, 120] }] },
  // tech-back: DK is turned away (p1Facing -1) so the key toward the stage is the BACK roll and the roll stays on the stage.
  // Hits from P2: a Pikachu forward smash (Numpad0 + toward) at DK's damage percent `p1Damage`: 20% leaves DK knocked down next to the stage,
  // 40%+ is a KO (the revived DK stands in idle on the revival platform). P2 stands 80 px in front; `p1Facing: -1` turns DK away so he lands face down.
  { name: 'hurt-jab', opponent: 62, p2Hold: jabAt(2), must: ['hurt'], phases: [{ steps: 70, shots: [3, 8, 14, 30] }] },
  ...[['getup-neutral', 1, [], ['getup']], ['getup-attack', 1, ['f'], ['getup_attack']], ['getup-roll-fwd', 1, ['fwd'], ['getup_roll']], ['getup-roll-back', 1, ['back'], ['getup_roll']]]
    .flatMap(([name, dkFace, keys, must]) => [['', 1], ['-facedown', -1]].map(([suffix, face]) => ({ name: `knockdown-${name}${suffix}`,
      opponent: 80, setup: { p1Damage: 20, p1Facing: face }, p2Hold: SMASH_P2, must: ['hurt', 'tumble', suffix ? 'down_wait_face_down' : 'down_wait', ...must.map(m => suffix && m === 'getup_attack' ? 'getup_attack_face_down' : m)],
      // Knockdown 245 / option lock 25 (remaining-gaps): an option press waits to prone age 25; the neutral getup is the automatic one.
      phases: [{ steps: 75 }, { untilSheet: suffix ? 'down_wait_face_down' : 'down_wait', steps: 30, shots: [1] }, { steps: keys.length ? 24 : 6 }, ...(keys.length ? [{ keys, steps: 1 }] : []),
        keys.length ? { steps: 80, shots: [2, 8, 14, 20, 26, 34, 42, 54] } : { steps: 300, shots: [2, 120, 238, 244, 250, 256, 264, 272, 284] }] }))),
  ...[['in-place', []], ['forward', ['fwd']], ['back', ['fwd']]].map(([name, dir]) => ({ name: `tech-${name}`, opponent: 80, setup: name === 'back' ? { p1Damage: 20, p1Facing: -1 } : { p1Damage: 20 }, p2Hold: SMASH_P2,
    must: ['tumble', name === 'in-place' ? 'tech' : name === 'forward' ? 'tech_forward' : 'tech_back'],
    phases: [{ steps: 25 }, { until: 'nearFloor', steps: 120 }, { keys: ['h', ...dir], steps: 2 }, { keys: dir, until: 'landed', steps: 30 }, { keys: dir, steps: 3 }, { steps: 70, shots: [0, 4, 9, 16, 24, 32, 40, 50] }] })),
  ...[30, 40].map(d => ({ name: `tumble-${d}`, opponent: 80, setup: { p1Damage: d }, p2Hold: SMASH_P2, must: ['tumble'], phases: [{ steps: 150, shots: [85, 95, 105, 120, 140] }] })),
  // Trip: DK's own down tilt (the only trip-capable move in the roster) from a DK P2; the seeded trip stream decides, so P2 repeats it.
  // Hard trip 99 / option lock 39 (remaining-gaps): the automatic getup comes on frame 100, a trip attack is accepted from frame 40.
  { name: 'trip-recovery', p2Char: 'donkeykong', opponent: 95, p2Hold: TRIP_P2, must: ['hurt', 'trip', 'getup'], phases: [{ steps: 21 }, { steps: 130, shots: [0, 6, 12, 18, 24, 30, 36, 50, 98, 102, 110] }] },
  { name: 'trip-attack', p2Char: 'donkeykong', opponent: 95, p2Hold: TRIP_P2, must: ['trip', 'trip_attack'], phases: [{ untilSheet: 'trip', steps: 40 }, { steps: 40 }, { keys: ['f'], steps: 1 }, { steps: 75, shots: [2, 10, 18, 22, 30, 40, 50, 62] }] },
  // Revival (final-gaps; SmashWiki Revival platform / On-screen appearance): the revived DK stands (idle) on the platform, no Entry.
  { name: 'entry-ko', opponent: 80, setup: { p1Damage: 60 }, p2Hold: SMASH_P2, must: ['idle'], mustNot: ['entry'], phases: [{ steps: 170 }, { steps: 370, shots: [0, 6, 12, 18, 30, 150, 300, 310, 330] }] },
  // Wall / ceiling tech: DK beside the stage's side face (or under its bottom) is hit toward the surface by a P2 aerial and presses shield (+ jump for the wall jump).
  // Wall: DK hangs beside the stage's side face while P2's neutral air (a multi-hit) pushes and finally launches him into it; shield (+ jump) is pressed just before that launch.
  ...[['wall', ['h']], ['wall-jump', ['h', 'w']]].map(([name, keys]) => ({ name: `tech-${name}`, setup: { p1Edge: { dx: 40, dy: 30 }, p2Rel: { dx: -50, dy: -10 }, p2Facing: 1, p1Damage: 40 },
    p2Hold: [{ key: 'Numpad1', from: 1, to: 6 }], must: [name === 'wall' ? 'tech_wall' : 'tech_wall_jump'],
    // The wall jump needs jump already held when the contact step runs (a fresh W press during hitstun is swallowed), so W is held from step 40.
    phases: [{ steps: 40 }, ...(name === 'wall-jump' ? [{ keys: ['w'], steps: 14 }] : [{ steps: 14 }]), { keys, steps: 7 }, { keys: name === 'wall-jump' ? ['w'] : [], steps: 12 }, { steps: 80, shots: [0, 3, 8, 14, 20, 26, 32, 40] }] })),
  { name: 'tech-ceiling', setup: { p1Edge: { dx: -300, dy: 100 }, p2Rel: { dx: 0, dy: 60 }, p2Facing: -1, p1Damage: 25 }, p2Hold: [{ key: 'ArrowUp', from: 1, to: 6 }, { key: 'Numpad1', from: 1, to: 6 }],
    must: ['tech_ceiling'], phases: [{ steps: 11 }, { keys: ['h'], steps: 4 }, { steps: 70, shots: [0, 3, 8, 14, 20, 26, 32] }] },
  // Footstool: DK drops onto P2's head and presses jump (tap = mini hop, held = full); P2 drops onto DK's head and presses jump.
  { name: 'footstool-performer-mini', opponent: 0, setup: { p1Rel: { dx: 0, dy: -80, vy: 6 } }, must: ['footstool_jump_mini'], phases: [{ steps: 2 }, { keys: ['w'], steps: 1 }, { steps: 60, shots: [2, 6, 12] }] },
  { name: 'footstool-performer-full', opponent: 0, setup: { p1Rel: { dx: 0, dy: -80, vy: 6 } }, must: ['footstool_jump_mini'], phases: [{ steps: 2 }, { keys: ['w'], steps: 14 }, { steps: 60, shots: [2, 6, 12] }] },
  { name: 'footstool-recipient-ground', opponent: 0, setup: { p2Rel: { dx: 0, dy: -80, vy: 6 } }, p2Hold: [{ key: 'ArrowUp', from: 2, to: 4 }], must: ['footstool_pose'], phases: [{ steps: 70, shots: [4, 8, 14, 22] }] },
  { name: 'footstool-recipient-air', opponent: 0, lift: 200, setup: { p2Rel: { dx: 0, dy: -80, vy: 6 } }, p2Hold: [{ key: 'ArrowUp', from: 2, to: 4 }], must: ['footstool_air_pose'], phases: [{ steps: 70, shots: [4, 8, 14, 22] }] },
  // Captured: P2 (Pikachu) grabs DK (Numpad4), pummels (Numpad1) and DK mashes with real keys.
  { name: 'captured', opponent: 60, p2Hold: [{ key: 'Numpad4', from: 4, to: 6 }, { key: 'Numpad1', from: 70, to: 72 }], must: ['captured', 'captured_hit'],
    phases: [{ steps: 60, shots: [20, 40] }, { steps: 25, shots: [12, 14, 20] }, ...Array.from({ length: 24 }, (_, i) => ({ keys: [i % 2 ? 'a' : 'd'], steps: 3 })), { steps: 70, shots: [1, 6, 12, 20, 28] }] },
  // Parry: shield is raised and P2 jabs inside the parry window (P2 jab step = 20 + at).
  ...[1, 3].map(at => ({ name: `parry-p2at${at}`, opponent: DEFENSE_OPP, p2Hold: jabAt(20 + at), phases: [{ keys: ['h'], steps: 20 }, { steps: 75, shots: [at + 1, at + 2, at + 4, at + 8, at + 14, at + 22, at + 30, at + 40] }] })),
];
const LEDGE_FAMILY = LEDGE_SEGMENTS.flatMap(seg => [1, -1].map(facing => ({ ...seg, stepMode: true, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing, startFrac: facing === 1 ? 0.3 : 0.7 })));
/** Items / heavy items / taunts: real keys (F attack = pickup near an item and the held-weapon swing, T grab = light-item toss,
 * B = taunt appeal, W/A/S/D stick, fwd/back mirrored per facing). `setup.item` {type, dx} spawns one item through the normal
 * registry at dx px in front of DK (probe setup, not input): type = ITEM_SPAWN_TABLE index (src/items/itemCatalog.ts order:
 * 0 Home-Run Bat, 1 Beam Sword, 2 hammer, 3 Ray Gun, 4 Bob-omb, 5 crate = heavy, 6 Star Rod, 7 Super Scope, 8 Fire Flower, 9 Banana Peel), selected through the match's Item Switch. A direction key pressed on the same step as the toss is a fresh flick (strong); the simulated analog tilt 0.5
 * is the ordinary throw (held stick, no flick, no dash). Strong and ordinary tosses share the one drawn clip (aliases). */
const itemAt = (type, dx = 0) => ({ setup: { item: { type, dx } } });
const BAT = itemAt(0), SWORD = itemAt(1), GUN = itemAt(3), BOBOMB = itemAt(4), CRATE = itemAt(5), ROD = itemAt(6), SCOPE = itemAt(7), FLOWER = itemAt(8),
  // The peel lies 55 px ahead: inside the pickup range, outside the slip box (an un-placed peel slips everyone).
  BANANA = itemAt(9, 55);
const PICK = [{ keys: ['f'], steps: 1 }, { steps: 40, shots: [0, 3, 7, 12] }];
const throwPhases = (keys, tilt, steps = 70, shots = [2, 8, 14, 20, 30, 45, 60]) => [...PICK.map(({ shots: _s, ...p }) => p),
  ...(tilt ? [{ tilt, steps: 8 }, { tilt, keys: ['t'], steps: 1 }] : [{ keys: [...keys, 't'], steps: 1 }]), { steps, shots }];
const airThrow = (keys, steps = 70) => [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: [...keys, 't'], steps: 1 }, { steps, shots: [1, 6, 12, 18, 26, 40] }];
const PICKED = PICK.map(({ shots: _s, ...p }) => p);
/** Home-Run Bat uses by real keys (F attack, V smash, fwd), the forward tilt with the SIMULATED analog 0.5 (keyboard has no tilt). */
const BAT_USE_SEGMENTS = [
  { name: 'bat-jab', row: 'donkeykong.item-bat-ground-jab', ...BAT, opponent: 60, must: ['item_bat_swing_1'], phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 40, shots: [2, 3, 4, 8, 20] }] },
  { name: 'bat-ftilt', row: 'donkeykong.item-bat-ground-tilt', ...BAT, opponent: 60, simulatedTilt: true, must: ['item_bat_swing_3'],
    phases: [...PICKED, { tilt: { x: 0.5, y: 0 }, keys: ['f'], steps: 1 }, { steps: 50, shots: [3, 7, 8, 12, 30] }] },
  { name: 'bat-dash', row: 'donkeykong.item-bat-dash', ...BAT, opponent: 200, must: ['item_bat_swing_dash'],
    phases: [...PICKED, { keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 55, shots: [2, 6, 7, 10, 20, 40] }] },
  { name: 'bat-fsmash', row: 'donkeykong.item-bat-ground-smash', ...BAT, opponent: 70, must: ['item_bat_swing_4'],
    // Held V never charges the bat; 120 steps after release let the 0% launch reach the blast zone (SmashWiki: one-hit KO).
    phases: [...PICKED, { keys: ['v'], steps: 1 }, { keys: ['v'], steps: 30 }, { steps: 120, shots: [10, 18, 19, 20, 21, 25, 40, 60, 100] }] },
];
const ITEM_SEGMENTS = [
  { name: 'pickup-stand', ...BAT, must: ['item_pickup_stand', 'item_carry'], phases: PICK },
  { name: 'pickup-walk', ...itemAt(0, 30), must: ['item_pickup_walk', 'item_carry'], phases: [{ keys: ['fwd', 'f'], steps: 1 }, { steps: 40, shots: [0, 3, 7, 12] }] },
  { name: 'carry', ...BAT, must: ['item_carry'], phases: [{ keys: ['f'], steps: 1 }, { steps: 170, shots: [10, 40, 80, 120, 160] }] },
  { name: 'throw-forward-strong', ...BAT, opponent: 120, must: ['item_throw_f'], phases: throwPhases(['fwd']) },
  { name: 'throw-forward', ...BAT, simulatedTilt: true, opponent: 120, must: ['item_throw_f'], phases: throwPhases([], { x: 0.5, y: 0 }) },
  { name: 'throw-back-strong', ...BAT, must: ['item_throw_b'], phases: throwPhases(['back']) },
  { name: 'throw-back', ...BAT, simulatedTilt: true, must: ['item_throw_b'], phases: throwPhases([], { x: -0.5, y: 0 }) },
  { name: 'throw-up', ...BAT, must: ['item_throw_hi'], phases: throwPhases(['w']) },
  { name: 'throw-up-ordinary', ...BAT, simulatedTilt: true, must: ['item_throw_hi'], phases: throwPhases([], { x: 0, y: -0.5 }) },
  { name: 'throw-down', ...BAT, must: ['item_throw_lw'], phases: throwPhases(['s']) },
  { name: 'throw-down-ordinary', ...BAT, simulatedTilt: true, must: ['item_throw_lw'], phases: throwPhases([], { x: 0, y: 0.5 }) },
  { name: 'throw-drop', ...BAT, must: ['item_throw_drop'], phases: throwPhases([]) },
  { name: 'throw-dash', ...BAT, opponent: 200, must: ['item_throw_dash'], phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['fwd'], steps: 14 }, { keys: ['fwd', 't'], steps: 1 }, { steps: 70, shots: [1, 6, 12, 20, 30, 45] }] },
  { name: 'throw-air-forward', ...BAT, must: ['item_throw_air_f'], phases: airThrow(['fwd']) },
  { name: 'throw-air-back', ...BAT, must: ['item_throw_air_b'], phases: airThrow(['back']) },
  { name: 'throw-air-up', ...BAT, must: ['item_throw_air_hi'], phases: airThrow(['w']) },
  { name: 'throw-air-down', ...BAT, must: ['item_throw_air_lw'], phases: airThrow(['s']) },
  // Home-Run Bat (Ultimate items phase 1): jab / forward tilt / dash attack / forward smash each play their own native clip.
  ...BAT_USE_SEGMENTS,
  { name: 'sword-jab', ...SWORD, opponent: 60, must: ['item_bat_swing_1'], phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['f'], steps: 1 }, { steps: 60, shots: [2, 6, 12, 18, 26, 40] }] },
  // Beam Sword (Ultimate items phase 3): the forward smash charges on the native sword swing and its hold loop.
  { name: 'sword-smash', ...SWORD, opponent: 60, must: ['item_sword_swing_4', 'item_sword_swing_4_hold'], phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['v'], steps: 40 }, { steps: 60, shots: [2, 20, 40] }] },
  { name: 'raygun-ground', ...GUN, opponent: 200, must: ['item_lgun_shoot'], phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['f'], steps: 1 }, { steps: 60, shots: [2, 8, 14, 20, 30, 45] }] },
  { name: 'raygun-air', ...GUN, opponent: 200, must: ['item_lgun_shoot_air'], phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['f'], steps: 1 }, { steps: 60, shots: [2, 8, 14, 20, 30, 45] }] },
  // Ultimate items phase 4: firing while walking keeps the legs on item_shoot_legs_* under the upper-body layer.
  { name: 'raygun-walk', ...GUN, opponent: 200, must: ['item_shoot_legs_walk_f', 'upper:item_lgun_shoot_upper'],
    // F first: D + F on one step is a fresh flick = a smash input = a smash throw (universal-rules smashAttacksThrowItem).
    phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['f'], steps: 1 }, { keys: ['fwd'], steps: 30 }, { keys: ['w'], steps: 3 }, { steps: 60, shots: [2, 8, 20, 40] }] },
  // Heavy item (crate): pickup, carry phases, jump, turn, the four throws.
  { name: 'heavy-pickup-carry', ...CRATE, must: ['item_heavy_get', 'super_lift_wait'], phases: [{ keys: ['f'], steps: 1 }, { steps: 110, shots: [2, 8, 14, 20, 30, 60, 100] }] },
  { name: 'heavy-walk', ...CRATE, must: ['super_lift_wait', 'super_lift_walk_middle'], optional: ['super_lift_walk_slow', 'super_lift_walk_fast'],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['fwd'], steps: 70, shots: [5, 25, 45, 65] }, { steps: 20, shots: [4] }] },
  { name: 'heavy-turn', ...CRATE, must: ['super_lift_turn'], phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['back'], steps: 40, shots: [2, 6, 10, 20] }] },
  { name: 'heavy-jump', ...CRATE, must: ['super_lift_jump_squat', 'super_lift_jump', 'super_lift_fall', 'super_lift_landing'],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['w'], steps: 4, shots: [1] }, { until: 'landed', steps: 160, shots: [3, 10, 20, 40, 60] }, { steps: 40, shots: [2, 8, 14] }] },
  ...[['forward', [], null], ['forward-strong', ['fwd'], null], ['back', [], { x: -0.5, y: 0 }], ['back-strong', ['back'], null], ['up', ['w'], null], ['down', ['s'], null]].map(([n, keys, tilt]) => ({
    name: `heavy-throw-${n}`, ...CRATE, simulatedTilt: !!tilt, opponent: 120, must: [`item_heavy_throw_${n.startsWith('forward') ? 'f' : n.startsWith('back') ? 'b' : n === 'up' ? 'hi' : 'lw'}`],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, ...(tilt ? [{ tilt, steps: 6 }, { tilt, keys: ['f'], steps: 1 }] : [{ keys: [...keys, 'f'], steps: 1 }]), { steps: 70, shots: [2, 8, 14, 20, 30, 45, 60] }] })),
  ...['up', 'side', 'down'].map(d => ({ name: `taunt-${d}`, must: [`taunt_${d}_r`], mustAny: undefined,
    phases: [{ keys: d === 'up' ? ['w', 'b'] : d === 'down' ? ['s', 'b'] : ['fwd', 'b'], steps: 1 }, { steps: 95, shots: [1, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80] }] })),
].map(seg => ({ ...seg, stepMode: true, opponent: seg.opponent ?? 300 }));
/** Ultimate items phase 1 (2026-10-11): the Home-Run Bat for DK (native clips) and Pikachu (its own attack sheets + the bat
 * sprite at its hand: temporary until Pikachu's bat art), the native aerial with a bat, the forward smash KO at 0% and a
 * reflect during the wind-up (P2 Pikachu Thunder Jolt by real Numpad2). F3 (real key) turns on the hitbox debug layer so the
 * damage areas are drawn. */
const ULTIMATE_ITEM_SEGMENTS = [
  ...BAT_USE_SEGMENTS,
  // Pikachu plays its own native item swing clips (phase 3 art install), the same keys as DK's.
  ...BAT_USE_SEGMENTS.map(seg => ({ ...seg, row: null, name: `pikachu-${seg.name}`, p1Char: 'pikachu' })),
  { name: 'bat-air-native', row: 'donkeykong.item-bat-air-use', ...BAT, mustNot: ['item_bat_swing_1'], mustAny: ['nair', 'fair', 'aerial'],
    phases: [...PICKED, { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['f'], steps: 1 }, { steps: 50, shots: [2, 6, 12] }] },
  { name: 'bat-fsmash-reflect', ...BAT, opponent: 260, must: ['item_bat_swing_4'], p2Hold: [{ key: 'Numpad2', from: 41, to: 43 }],
    phases: [...PICKED, { keys: ['v'], steps: 1 }, { steps: 90, shots: [10, 20, 30, 40, 60] }] },
].map(seg => ({ ...seg, stepMode: true, hitboxDebug: true, opponent: seg.opponent ?? 300 }));
/** Ultimate items phase 2 (2026-10-12): one pickup / catch / throw / drop planner for DK and Pikachu. Real keys: F pickup,
 * T grab = toss (a direction key on the same step = fresh flick = smash throw), V smash input = smash throw (up/down with any
 * item; forward with a non-battering item: the test ray gun), fwd held then T = dash throw, T in the air = Z-drop, T under a
 * falling item = air catch. `mustActions` are the planner actions that must start; `mustHeldEnd` the held state at the end. */
const PHASE2_ITEM_SEGMENTS = [
  { name: 'pickup-stand', ...BAT, mustActions: ['pickup-standing'], mustHeldEnd: true, phases: PICK },
  { name: 'pickup-walk', ...itemAt(0, 30), mustActions: ['pickup-walking'], mustHeldEnd: true,
    phases: [{ keys: ['fwd', 'f'], steps: 1 }, { steps: 40, shots: [0, 3, 7, 12] }] },
  { name: 'toss-forward', ...BAT, opponent: 120, mustActions: ['throw-ground-forward-strong'], mustHeldEnd: false, phases: throwPhases(['fwd']) },
  { name: 'toss-back', ...BAT, mustActions: ['throw-ground-back-strong'], mustHeldEnd: false, phases: throwPhases(['back']) },
  { name: 'toss-up', ...BAT, mustActions: ['throw-ground-up-strong'], phases: throwPhases(['w']) },
  { name: 'toss-down', ...BAT, mustActions: ['throw-ground-down-strong'], mustHeldEnd: false, phases: throwPhases(['s']) },
  { name: 'ground-drop', ...BAT, mustActions: ['ground-drop'], mustHeldEnd: false, phases: throwPhases([]) },
  { name: 'dash-throw', ...BAT, opponent: 260, mustActions: ['dash-throw'], mustHeldEnd: false,
    phases: [...PICKED, { keys: ['fwd'], steps: 14 }, { keys: ['fwd', 't'], steps: 1 }, { steps: 70, shots: [1, 6, 12, 20, 30, 45] }] },
  { name: 'air-toss-forward', ...BAT, mustActions: ['throw-air-forward-strong'], mustHeldEnd: false, phases: airThrow(['fwd']) },
  { name: 'z-drop', ...BAT, mustHeldEnd: false, mustNot: ['item_throw_drop', 'item_throw_air_f'],
    phases: [...PICKED, { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['t'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 10, 20] }] },
  { name: 'smash-throw-up', ...BAT, mustActions: ['throw-ground-up-strong'], phases: [...PICKED, { keys: ['w', 'v'], steps: 1 }, { steps: 60, shots: [2, 8, 14, 20, 40] }] },
  { name: 'smash-throw-down', ...BAT, mustActions: ['throw-ground-down-strong'], mustHeldEnd: false,
    phases: [...PICKED, { keys: ['s', 'v'], steps: 1 }, { steps: 50, shots: [2, 8, 14, 20] }] },
  { name: 'smash-throw-forward-gun', ...GUN, opponent: 160, mustActions: ['throw-ground-forward-strong'], mustHeldEnd: false,
    phases: [...PICKED, { keys: ['fwd', 'v'], steps: 1 }, { steps: 60, shots: [2, 8, 12, 16, 24, 40] }] },
  { name: 'air-catch', ...itemAt(0, 400), lift: 300, mustHeldEnd: true,
    phases: [{ steps: 2 }, { itemAt: { dx: 30, dy: -10 }, keys: ['t'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 6, 12] }] },
];
const PHASE2_FAMILY = [...PHASE2_ITEM_SEGMENTS, ...PHASE2_ITEM_SEGMENTS.map(seg => ({ ...seg, name: `pikachu-${seg.name}`, p1Char: 'pikachu',
  // Pikachu has no own item clips beyond its sparse light-item set: its body sheets are not required, only the planner actions.
  must: undefined, mustNot: undefined }))].map(seg => ({ ...seg, stepMode: true, hitboxDebug: true, opponent: seg.opponent ?? 300 }));
/** Ultimate items phase 3 (2026-10-12): Beam Sword and Star Rod for DK and Pikachu by real keys (F jab, V forward smash: held
 * 50 steps = charged, fwd held then F = dash attack; forward tilt with the SIMULATED analog 0.5), each Star Rod star a projectile
 * whose damage area is drawn (`mustStars` = stars spawned in the segment); `setup.item.ammo` empties the rod first (probe
 * setup, not input). DK's four ordinary aerial tosses: the SIMULATED analog 0.5 held in the air, then T. */
const CHARGE = [{ keys: ['v'], steps: 50, shots: [3, 20, 45] }, { steps: 70, shots: [5, 8, 9, 12, 20, 40] }];
const swordUses = (prefix, item, rows, extra = {}) => [
  { name: `${prefix}-jab`, row: rows.jab, ...item, opponent: 70, must: ['item_bat_swing_1'], phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 40, shots: [2, 3, 4, 8, 20] }] },
  { name: `${prefix}-ftilt`, row: rows.ftilt, ...item, opponent: extra.ftiltOpponent ?? 70, simulatedTilt: true, must: ['item_bat_swing_3'], mustStars: extra.stars,
    phases: [...PICKED, { tilt: { x: 0.5, y: 0 }, keys: ['f'], steps: 1 }, { steps: 60, shots: [3, 7, 8, 12, 20, 30] }] },
  { name: `${prefix}-dash`, row: rows.dash, ...item, opponent: 200, must: ['item_bat_swing_dash'],
    phases: [...PICKED, { keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 55, shots: [2, 6, 7, 10, 20, 40] }] },
  { name: `${prefix}-fsmash-charged`, row: rows.charge, ...item, opponent: extra.ftiltOpponent ?? 80, must: ['item_sword_swing_4', 'item_sword_swing_4_hold'], mustStars: extra.stars,
    phases: [...PICKED, ...CHARGE] },
  { name: `${prefix}-fsmash`, row: rows.fsmash, ...item, opponent: extra.ftiltOpponent ?? 80, must: ['item_sword_swing_4'], mustNot: ['item_sword_swing_4_hold'], mustStars: extra.stars,
    phases: [...PICKED, { keys: ['v'], steps: 1 }, { steps: 70, shots: [8, 12, 14, 15, 20, 40] }] },
];
const emptyRod = { setup: { item: { type: 6, dx: 0, ammo: 0 } } };
const PHASE3_SEGMENTS = [
  ...swordUses('sword', SWORD, { jab: null, ftilt: 'donkeykong.item-sword-ground-tilt', dash: 'donkeykong.item-sword-dash',
    charge: 'donkeykong.item-sword-charge', fsmash: 'donkeykong.item-sword-ground-smash' }),
  ...swordUses('rod', ROD, {}, { stars: 1, ftiltOpponent: 260 }),
  // The empty rod still swings and fires nothing (SmashWiki Star Rod).
  ...swordUses('rod-empty', emptyRod, {}, { stars: 0, ftiltOpponent: 70 }).filter(seg => /ftilt|fsmash-charged/.test(seg.name)),
];
const airTossOrdinary = (dir, tilt) => ({ name: `air-toss-${dir}-ordinary`, row: `donkeykong.item-throw-air-${dir}`, ...BAT, simulatedTilt: true,
  mustActions: [`throw-air-${dir}-ordinary`], mustHeldEnd: false,
  phases: [...PICKED, { keys: ['w'], steps: 3 }, { steps: 4 }, { tilt, steps: 6 }, { tilt, keys: ['t'], steps: 1 }, { steps: 70, shots: [1, 6, 12, 18, 26, 40] }] });
const PHASE3_FAMILY = [...PHASE3_SEGMENTS, ...PHASE3_SEGMENTS.map(seg => ({ ...seg, row: null, name: `pikachu-${seg.name}`, p1Char: 'pikachu' })),
  airTossOrdinary('forward', { x: 0.5, y: 0 }), airTossOrdinary('back', { x: -0.5, y: 0 }), airTossOrdinary('up', { x: 0, y: -0.5 }),
  airTossOrdinary('down', { x: 0, y: 0.5 })].map(seg => ({ ...seg, stepMode: true, hitboxDebug: true, opponent: seg.opponent ?? 300 }));
/** Ultimate items phase 4 (2026-10-12): Ray Gun, Super Scope, Fire Flower for DK and Pikachu by real keys (F fire = neutral
 * attack / neutral aerial, fwd / back held while a shot runs = the legs walk, fwd held then F = the press out of a run, W = jump).
 * `must` entries `upper:<clip>` are the upper-body layer drawn over the legs; `mustShots` {id prefix: n} = projectiles spawned
 * (`minShots` = at least n); `setup.item.ammo` empties the item first (probe setup, not input). */
const shots = (prefix, n) => ({ mustShots: { [prefix]: n } });
const GUN_SHOT = 'item.rayGun.shot', RAPID = 'item.superScope.rapid', CHARGED = 'item.superScope.charge', FLAME = 'item.fireFlower.flame';
const hopFire = (extra = []) => [...PICKED, { keys: ['w'], steps: 3 }, { steps: 5 }, { keys: ['f'], steps: 1, shots: [0] }, ...extra];
const PHASE4_SEGMENTS = [
  { name: 'gun-stand', row: 'donkeykong.item-raygun-ground-jab', ...GUN, opponent: 260, must: ['item_lgun_shoot'], ...shots(GUN_SHOT, 1),
    phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 40, shots: [2, 8, 9, 14, 24] }] },
  { name: 'gun-walk-forward', row: 'donkeykong.item-raygun-walk-forward', ...GUN, opponent: 300, must: ['item_shoot_legs_walk_f', 'upper:item_lgun_shoot_upper'],
    ...shots(GUN_SHOT, 1), phases: [...PICKED, { keys: ['f'], steps: 1 }, { keys: ['fwd'], steps: 22, shots: [3, 8, 9, 16] }, { steps: 20 }] },
  { name: 'gun-walk-back', row: 'donkeykong.item-raygun-walk-back', ...GUN, opponent: 300, must: ['item_shoot_legs_walk_b', 'upper:item_lgun_shoot_upper'],
    ...shots(GUN_SHOT, 1), phases: [...PICKED, { keys: ['f'], steps: 1 }, { keys: ['back'], steps: 22, shots: [3, 8, 9, 16] }, { steps: 20 }] },
  { name: 'gun-run', ...GUN, opponent: 400, must: ['run', 'item_shoot_legs_walk_f', 'upper:item_lgun_shoot_upper'], ...shots(GUN_SHOT, 1),
    phases: [...PICKED, { keys: ['fwd'], steps: 16 }, { keys: ['fwd', 'f'], steps: 1 }, { keys: ['fwd'], steps: 24, shots: [2, 8, 9, 16] }, { steps: 20 }] },
  { name: 'gun-jump-squat', row: 'donkeykong.item-raygun-jump-squat', ...GUN, opponent: 300, must: ['item_shoot_legs_jump_squat', 'upper:item_lgun_shoot_upper', 'item_lgun_shoot_air'],
    ...shots(GUN_SHOT, 1), phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 1 }, { keys: ['w'], steps: 4, shots: [0, 1, 2, 3] }, { steps: 40, shots: [4, 10] }] },
  { name: 'gun-air', row: 'donkeykong.item-raygun-air-use', ...GUN, opponent: 300, must: ['item_lgun_shoot_air'], ...shots(GUN_SHOT, 1),
    phases: hopFire([{ steps: 40, shots: [4, 8, 9, 16] }]) },
  { name: 'gun-landing', row: 'donkeykong.item-raygun-landing', ...GUN, opponent: 300, must: ['item_lgun_shoot_air', 'item_shoot_legs_landing', 'upper:item_lgun_shoot_upper'],
    phases: [...PICKED, { keys: ['w'], steps: 2 }, { until: 'falling', steps: 60 }, { keys: ['f'], steps: 1, shots: [0] }, { until: 'landed', steps: 60, shots: [0] },
      { steps: 30, shots: [0, 2, 5, 10] }] },
  { name: 'gun-empty-throw', ...GUN, setup: { item: { type: 3, dx: 0, ammo: 0 } }, opponent: 140, mustActions: ['throw-ground-forward-ordinary'], mustHeldEnd: false,
    must: ['item_throw_f'], ...shots(GUN_SHOT, 0), mustItemGone: 'rayGun', phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 90, shots: [2, 8, 14, 24, 60] }] },
  { name: 'scope-tap', ...SCOPE, opponent: 300, must: ['item_scope_start', 'item_scope_rapid', 'item_scope_end'], ...shots(RAPID, 5),
    phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 90, shots: [5, 16, 17, 24, 40, 60] }] },
  { name: 'scope-charge', ...SCOPE, opponent: 300, must: ['item_scope_start', 'item_scope_wait', 'item_scope_fire', 'item_scope_end'], ...shots(`${CHARGED}10`, 1),
    phases: [...PICKED, { keys: ['f'], steps: 120, shots: [10, 40, 80, 119] }, { steps: 70, shots: [1, 3, 4, 8, 20] }] },
  // Four holds: 30 / 60 / 90 / 120 steps = charge 15 / 45 / 75 / 105 frames → stages 4 / 6 / 8 / 10 (16 + 8 + 12 + 4 = 40 ammo).
  { name: 'scope-stages', ...SCOPE, opponent: 300, must: ['item_scope_fire'], ...shots(CHARGED, 4),
    phases: [...PICKED, ...[30, 60, 90, 120].flatMap(n => [{ keys: ['f'], steps: n, shots: [n - 1] }, { steps: 60, shots: [3] }])] },
  // Walking back while tapping: the shots fly away from DK over several steps (a shot that hits on its spawn step is never in a
  // snapshot, so the walk-forward variant at close range under-counts the burst).
  { name: 'scope-walk', ...SCOPE, opponent: 300, must: ['item_shoot_legs_walk_b', 'upper:item_scope_rapid_upper'], ...shots(RAPID, 5),
    phases: [...PICKED, { keys: ['f'], steps: 1 }, { keys: ['back'], steps: 50, shots: [10, 20, 30] }, { steps: 40 }] },
  { name: 'scope-air', ...SCOPE, opponent: 300, must: ['item_scope_air_start', 'item_scope_air_rapid'], minShots: { [RAPID]: 2 },
    phases: hopFire([{ steps: 60, shots: [6, 16, 24, 40] }]) },
  { name: 'flower-stream', ...FLOWER, opponent: 90, must: ['item_lgun_shoot', 'item_fflower_shoot_loop'], minShots: { [FLAME]: 7 },
    phases: [...PICKED, { keys: ['f'], steps: 90, shots: [7, 8, 20, 40, 60, 85] }, { steps: 30, shots: [5] }] },
  { name: 'flower-walk', ...FLOWER, opponent: 300, must: ['item_shoot_legs_walk_f', 'upper:item_fflower_shoot_loop_upper'], minShots: { [FLAME]: 3 },
    phases: [...PICKED, { keys: ['f'], steps: 14 }, { keys: ['f', 'fwd'], steps: 40, shots: [10, 25, 39] }, { steps: 20 }] },
  { name: 'flower-air', ...FLOWER, opponent: 300, must: ['item_lgun_shoot_air', 'item_fflower_shoot_air_loop'], minShots: { [FLAME]: 2 },
    phases: [...PICKED, { keys: ['w'], steps: 3 }, { steps: 3 }, { keys: ['f'], steps: 30, shots: [8, 16, 28] }, { steps: 40 }] },
];
const PHASE4_FAMILY = [...PHASE4_SEGMENTS, ...PHASE4_SEGMENTS.map(seg => ({ ...seg, row: null, name: `pikachu-${seg.name}`, p1Char: 'pikachu' }))]
  .map(seg => ({ ...seg, stepMode: true, hitboxDebug: true, opponent: seg.opponent ?? 300 }));
/** Ultimate items phase 5 (2026-10-12): throwing items for DK and Pikachu by real keys. The attack button throws a held
 * Bob-omb / Banana Peel (universal-rules throwingItemAttackButton): F neutral = forward, a direction key on the same step =
 * a fresh flick = a smash throw (W up, S down, fwd / back), V smash = smash throw, fwd held then F = dash throw, F in the
 * air = air throw. Checks: `mustExplosions` explosions spawned, `p1Unhurt` (the explosion never hurts its user),
 * `p2Trip` / `p1NoTrip` (Banana Peel slips), `p2HitDamage` / `p2HitAngle` (thrown hit), `mustFuse` (Bob-omb walking),
 * `mustItemGone`. Screenshots are also taken on each explosion's first step and on P2's first tripped step. */
const tossF = (keys = []) => [...PICKED, { keys: [...keys, 'f'], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30, 50] }];
const PHASE5_SEGMENTS = [
  { name: 'bob-toss-forward', row: 'donkeykong.item-bomb-ground-jab', ...BOBOMB, opponent: 370, pikachuOpponent: 160, mustActions: ['throw-ground-forward-ordinary'],
    must: ['item_throw_f'], mustHeldEnd: false, mustExplosions: 1, p1Unhurt: true, p2HitDamage: 31.6, mustItemGone: 'bobOmb', phases: tossF() },
  // Probe setup (not input): P1 turned to face the near blast zone, so its back toss flies over the long side of the stage;
  // the key toward that side ('fwd' of the segment) is the fighter's back.
  { name: 'bob-toss-back', ...BOBOMB, setup: { item: { type: 4, dx: 0 }, p1Facing: -1, p2Rel: { dx: 300, dy: 0 } },
    pikachuSetup: { item: { type: 4, dx: 0 }, p1Facing: -1, p2Rel: { dx: 170, dy: 0 } }, mustActions: ['throw-ground-back-strong'],
    must: ['item_throw_b'], mustHeldEnd: false, mustExplosions: 1, p1Unhurt: true, p2HitDamage: 33.5, phases: tossF(['fwd']) },
  { name: 'bob-toss-up', ...BOBOMB, opponent: 300, mustActions: ['throw-ground-up-strong'], must: ['item_throw_hi'], mustHeldEnd: false,
    mustExplosions: 1, p1Unhurt: true, phases: [...PICKED, { keys: ['w', 'f'], steps: 1 }, { steps: 140, shots: [2, 8, 20, 40, 60, 80, 100] }] },
  // Thrown down at its own feet: it explodes at once; DK (its user) is unhurt, P2 next to him is hit.
  { name: 'bob-toss-down', ...BOBOMB, opponent: 70, mustActions: ['throw-ground-down-strong'], must: ['item_throw_lw'], mustHeldEnd: false,
    mustExplosions: 1, p1Unhurt: true, p2HitDamage: 25, phases: tossF(['s']) },
  { name: 'bob-smash-toss', ...BOBOMB, opponent: 400, pikachuOpponent: 180, mustActions: ['throw-ground-forward-strong'], must: ['item_throw_f'], mustHeldEnd: false,
    mustExplosions: 1, p1Unhurt: true, p2HitDamage: 33.5, phases: [...PICKED, { keys: ['v'], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30] }] },
  { name: 'bob-dash-toss', ...BOBOMB, opponent: 560, pikachuOpponent: 300, mustActions: ['dash-throw'], must: ['item_throw_dash'], mustHeldEnd: false,
    mustExplosions: 1, p1Unhurt: true, p2HitDamage: 33.5, phases: [...PICKED, { keys: ['fwd'], steps: 14 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30] }] },
  { name: 'bob-air-toss', row: 'donkeykong.item-bomb-air-use', ...BOBOMB, opponent: 220, mustActions: ['throw-air-forward-ordinary'], must: ['item_throw_air_f'],
    mustHeldEnd: false, mustExplosions: 1, p1Unhurt: true,
    phases: [...PICKED, { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['f'], steps: 1, shots: [0] }, { steps: 80, shots: [2, 8, 14, 20, 30, 50] }] },
  // Meteor: DK jumps over P2 (P2 a few px ahead) and throws down at the jump's peak.
  // Probe setup (not input): `pin` keeps P2 standing 30 px ahead of DK, under the falling Bob-omb, until it is hit.
  { name: 'bob-air-meteor', row: 'donkeykong.item-bomb-air-use', ...BOBOMB, opponent: 200, pin: { fromStep: 44, toStep: 160, dx: 30, dy: null }, mustActions: ['throw-air-down-strong'], must: ['item_throw_air_lw'],
    mustHeldEnd: false, mustExplosions: 1, p1Unhurt: true, p2HitAngle: 270,
    phases: [...PICKED, { keys: ['w'], steps: 3 }, { until: 'falling', steps: 60 }, { keys: ['s', 'f'], steps: 1, shots: [0] }, { steps: 70, shots: [2, 4, 6, 8, 12, 20, 40] }] },
  // Held until the fuse runs out: it flashes, then explodes in the hand. DK (its user) is unhurt, P2 beside him is hit.
  { name: 'bob-hold-fuse', ...BOBOMB, opponent: 45, mustHeldEnd: false, mustExplosions: 1, p1Unhurt: true, p2HitDamage: 25,
    phases: [...PICKED, { steps: 640, shots: [100, 540, 544, 548, 552, 556, 600, 601, 602, 603, 620] }] },
  // Not picked up: it stands up, walks toward the nearest fighter (P2) and explodes on contact; DK, 200 px away, is untouched.
  { name: 'bob-walk', ...itemAt(4, 200), opponent: 280, mustFuse: 'walking', mustExplosions: 1, p1Unhurt: true, p2HitDamage: 25,
    phases: [{ steps: 470, shots: [10, 290, 310, 330, 350, 370, 390, 410, 430] }] },
  // Banana Peel: thrown at a grounded P2 it slips them (4.1%, soft trip); the peel bounces off and stays (one of its two uses).
  { name: 'banana-toss', ...BANANA, opponent: 230, pikachuOpponent: 150, mustActions: ['throw-ground-forward-ordinary'], must: ['item_throw_f'], mustHeldEnd: false,
    p2Trip: true, p2HitDamage: 4.1, phases: tossF() },
  // Thrown down the stage (use 1), DK runs over it and back (its placer never slips), then P2 runs onto it: P2 slips (use 2) and
  // the peel is gone.
  { name: 'banana-slip', ...BANANA, opponent: 420, mustActions: ['throw-ground-forward-ordinary'], mustHeldEnd: false, p1NoTrip: true, p2Trip: true,
    mustItemGone: 'bananaPeel', p2Hold: [{ key: 'toward', from: 176, to: 200 }],
    phases: [...PICKED, { keys: ['f'], steps: 1 }, { steps: 40, shots: [10, 39] }, { keys: ['fwd'], steps: 34, shots: [10, 20, 30] },
      { keys: ['back'], steps: 40, shots: [10, 20, 30] }, { steps: 20 }, { steps: 90, shots: [10, 20, 30, 40, 60, 89] }] },
];
const PHASE5_FAMILY = [...PHASE5_SEGMENTS, ...PHASE5_SEGMENTS.map(seg => ({ ...seg, row: null, name: `pikachu-${seg.name}`, p1Char: 'pikachu',
  opponent: seg.pikachuOpponent ?? seg.opponent, setup: seg.pikachuSetup ?? seg.setup,
  // Pikachu's sparse light-item set: its throw body sheets are not required, only the planner actions.
  must: undefined }))].map(seg => ({ ...seg, stepMode: true, hitboxDebug: true, opponent: seg.opponent ?? 300 }));
// Phase 6: trusted keys exercise the timed lock; rngState forces only the named malfunction stream.
const HAMMER_SEGMENTS=[
 {name:'golden-platform-contact',setup:{item:{type:10,dx:0,rngState:1},p2Protection:'revival'},opponent:55,must:['item_hammer_wait'],mustHeldEnd:true,hammerProtectedTarget:'revival',
  phases:[{steps:65},...PICKED,{steps:180,shots:[0,30,70,120,179]}]},
 {name:'golden-invincible-contact',setup:{item:{type:10,dx:0,rngState:1},p2Protection:'invincible'},opponent:55,must:['item_hammer_wait'],mustHeldEnd:true,hammerProtectedTarget:'invincible',
  phases:[{steps:65},...PICKED,{steps:180,shots:[0,30,70,120,179]}]},
 {name:'hammer-wait',row:'donkeykong.item-hammer-ground-jab',setup:{item:{type:2,dx:0,rngState:1}},opponent:55,
  must:['item_hammer_wait'],mustHeldEnd:true,p2HitDamage:22,phases:[...PICKED,{steps:70,shots:[0,5,9,16,32,48]}]},
 {name:'hammer-walk-lock',row:'donkeykong.item-hammer-ground-tilt',setup:{item:{type:2,dx:0,rngState:1}},must:['item_hammer_move'],hammerLock:true,mustHeldEnd:true,
  phases:[...PICKED,{keys:['fwd','f','v','g','h','r','t','b'],steps:40,shots:[0,8,16,32]}]},
 {name:'hammer-jump-lock',row:'donkeykong.item-hammer-air-use',setup:{item:{type:2,dx:0,rngState:1}},must:['item_hammer_jump'],hammerLock:true,mustHeldEnd:true,
  phases:[...PICKED,{keys:['w'],steps:3},{steps:10,shots:[2,6]},{keys:['w','f','g','h','r','t'],steps:3},{steps:30,shots:[0,10]}]},
 {name:'hammer-expire',row:'donkeykong.item-hammer-ground-smash',setup:{item:{type:2,dx:0,rngState:1}},must:['item_hammer_wait','jab'],mustHeldEnd:false,mustItemGone:'hammer',
  phases:[...PICKED,{steps:485,shots:[0,420,460,484]},{keys:['f'],steps:1},{steps:15,shots:[3,8]}]},
 {name:'hammer-headless',opponent:55,setup:{item:{type:2,dx:0,rngState:7}},must:['item_hammer_wait'],mustHeldEnd:true,hammerVariant:'headless',
  phases:[...PICKED,{steps:55,shots:[0,8,16,32]}]},
 {name:'golden-grow-hit',setup:{item:{type:10,dx:0,rngState:1}},opponent:55,must:['item_hammer_wait'],p2HitDamage:30,p2HitAngle:45,mustHeldEnd:true,
  phases:[{keys:['f'],steps:1},{steps:70,shots:[0,20,40,58]},{keys:['f'],steps:1},{steps:65,shots:[0,8,16,32]}]},
 {name:'golden-float',setup:{item:{type:10,dx:0,rngState:1}},must:['item_hammer_move','item_hammer_jump'],hammerLock:true,mustHeldEnd:true,
  phases:[{steps:65},...PICKED,{keys:['fwd'],steps:20},{keys:['w'],steps:3},{until:'falling',steps:80},{steps:3},
   ...Array.from({length:5},()=>[{keys:['w'],steps:1},{steps:6,shots:[0]}]).flat()]},
 {name:'golden-squeaky',opponent:55,setup:{item:{type:10,dx:0,rngState:7}},must:['item_hammer_wait'],hammerVariant:'squeaky',mustHeldEnd:true,
  phases:[{steps:65},...PICKED,{steps:55,shots:[0,8,16,32]}]},
];
const PHASE6_FAMILY=[...HAMMER_SEGMENTS,...HAMMER_SEGMENTS.map(seg=>({...seg,row:null,name:`pikachu-${seg.name}`,p1Char:'pikachu',
 must:seg.must}))].map(seg=>({...seg,stepMode:true,hitboxDebug:true,opponent:seg.opponent??300}));
/** Phase 7 source-driven healing: setup damage/item placement is injected; every pickup/use/hit uses real keys. */
const HEALING_SEGMENTS=[
 {name:'food-stand',setup:{item:{type:11,dx:0},p1Damage:100},must:['item_light_eat'],recovery:{food:true,noTouch:12},
  phases:[{steps:12},{keys:['f'],steps:1,shots:[0]},{steps:14,shots:[2,3,7,8]}]},
 {name:'food-walk',setup:{item:{type:11,dx:0},p1Damage:100},must:['item_light_walk_eat'],recovery:{food:true,walking:true},
  phases:[{keys:['fwd','f'],steps:1,shots:[0]},{keys:['fwd'],steps:11,shots:[4,9]},{steps:10}]},
 {name:'food-flinch',setup:{item:{type:11,dx:0},p1Damage:100},opponent:40,p2Hold:[{key:'Numpad1',from:0,to:3}],
  must:['item_light_eat'],recovery:{flinch:true},phases:[{keys:['f'],steps:1,shots:[0]},{steps:45,shots:[0,2,12,30]}]},
 {name:'food-with-loaded-gun',setup:{item:{type:3,dx:0},p1Damage:100},must:['item_light_eat'],mustHeldEnd:true,
  recovery:{food:true,heldWeapon:'rayGun'},phases:[...PICKED,{spawnItem:{type:11,dx:0,keepHeld:true},steps:1},
   {keys:['f'],steps:1,shots:[0]},{steps:14,shots:[2,7,9,13]}]},
 {name:'tomato-stand',setup:{item:{type:13,dx:0},p1Damage:100},must:['item_light_eat'],recovery:{amount:50,gradual:true},
  phases:[{keys:['f'],steps:1,shots:[0]},{steps:80,shots:[2,8,16,40,79]}]},
 {name:'heart-stand',setup:{item:{type:12,dx:0},p1Damage:160},mustNot:['item_light_eat'],recovery:{amount:100,gradual:true},
  phases:[{keys:['f'],steps:1,shots:[0]},{steps:120,shots:[10,40,80,119]}]},
 {name:'tomato-contact-during-heal',setup:{item:{type:13,dx:0},p1Damage:100},opponent:40,p2Hold:[{key:'Numpad1',from:20,to:23}],
  must:['item_light_eat'],recovery:{amount:50,gradual:true,contact:true},phases:[{keys:['f'],steps:1},{steps:150,shots:[8,21,30,80,149]}]},
 {name:'heart-contact-during-heal',setup:{item:{type:12,dx:0},p1Damage:160},opponent:40,p2Hold:[{key:'Numpad1',from:20,to:23}],
  recovery:{amount:100,gradual:true,contact:true},phases:[{keys:['f'],steps:1},{steps:150,shots:[8,21,30,100,149]}]},
];
const PHASE7_FAMILY=[...HEALING_SEGMENTS,...HEALING_SEGMENTS.map(seg=>({...seg,name:`pikachu-${seg.name}`,p1Char:'pikachu'}))]
 .map(seg=>({...seg,stepMode:true,opponent:seg.opponent??300}));
// Seed-only setup for the natural item-food RNG. No runtime definition/amount is overwritten.
const FOOD_SPAWN_SEEDS=Array.from({length:36},()=>null);
for(let seed=0;FOOD_SPAWN_SEEDS.some(v=>v===null);seed++){
 let t=(seed+0x6d2b79f5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
 const index=Math.floor(((t^(t>>>14))>>>0)/4294967296*36);FOOD_SPAWN_SEEDS[index]??=seed;
}
const FOOD_VARIETY_FAMILY=Object.keys(FOOD_SOURCE_TABLE).filter(n=>!['Daisy','Peach (giant)','Power Pellet'].includes(n))
 .flatMap((variant,i)=>['donkeykong','pikachu'].map(p1Char=>({name:`${p1Char}-food-variety-${i}`,p1Char,stepMode:true,
  facing:i%2===0?1:-1,startFrac:i%2===0?.3:.7,opponent:300,setup:{item:{type:11,dx:0,rngFoodState:FOOD_SPAWN_SEEDS[i]},p1Damage:100},
  must:['item_light_eat'],recovery:{food:true,expectedVariant:variant},phases:[{keys:['f'],steps:1,shots:[0]},{steps:14}]})));
const ULTIMATE_ITEM_FAMILY = [...ULTIMATE_ITEM_SEGMENTS, ...PHASE2_FAMILY, ...PHASE3_FAMILY, ...PHASE4_FAMILY, ...PHASE5_FAMILY, ...PHASE6_FAMILY,...PHASE7_FAMILY].flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing, startFrac: facing === 1 ? 0.3 : 0.7 })));
const ITEM_FAMILY = ITEM_SEGMENTS.flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing, startFrac: facing === 1 ? 0.3 : 0.7 })));
/** Engine source fixes (2026-10-11, universal Ultimate rules): defense / ledge / heavy-walk rows re-run, plus new segments for the
 * 400 − percent shield-break stun (with real A/D stick mashing), shield regeneration after release, the spot-dodge attack cancel,
 * dodge staleness (six consecutive dodges), a hang held to the 390-frame drop, and one 1v1-damage row per family (jab, forward
 * smash, back throw, Headbutt). Picked rows reuse the existing segment definitions unchanged. */
const pickSegments = (list, names) => list.filter(seg => names.some(n => seg.name === n || seg.name === `${n}-r` || seg.name === `${n}-l`));
const bothFacings = (list, extra = {}) => list.flatMap(seg => [1, -1].map(facing => ({ ...seg, ...extra, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: facing === 1 ? 0.3 : 0.7 })));
const repeatDodge = (keys, times, gap) => Array.from({ length: times }, () => [{ keys, steps: 1 }, { steps: gap }]).flat();
const ENGINE_FIX_SEGMENTS = [
  ...pickSegments(DEFENSE_SEGMENTS, ['shield-hold', 'shield-release', 'shield-block', 'parry-p2at1', 'parry-p2at3', 'parry-p2at5',
    'spot-dodge-p2at2', 'spot-dodge-p2at16', 'spot-dodge-p2at20', 'roll-fwd-p2at2', 'roll-fwd-p2at13', 'roll-back-p2at2', 'roll-back-close-p2at4']),
  ...bothFacings([
    { name: 'shield-regen', row: 'donkeykong.shield', must: ['shield'], phases: [{ keys: ['h'], steps: 70, shots: [4, 69] }, { steps: 120, shots: [10, 60, 119] }] },
    { name: 'shield-break-0', row: 'donkeykong.shield-break', opponent: DEFENSE_OPP, shieldHealth: 2, must: ['shield', 'shield_break'], p2Hold: jabAt(10),
      phases: [{ keys: ['h'], steps: 12 }, { steps: 470, shots: [8, 40, 200, 380, 430] }] },
    { name: 'shield-break-120', row: 'donkeykong.shield-break', opponent: DEFENSE_OPP, setup: { p1Damage: 120 }, shieldHealth: 2, must: ['shield', 'shield_break'], p2Hold: jabAt(10),
      phases: [{ keys: ['h'], steps: 12 }, { steps: 350, shots: [8, 200, 300] }] },
    { name: 'shield-break-mash', row: 'donkeykong.shield-break', opponent: DEFENSE_OPP, shieldHealth: 2, must: ['shield', 'shield_break'], p2Hold: jabAt(10),
      phases: [{ keys: ['h'], steps: 12 }, { steps: 40 }, ...Array.from({ length: 60 }, (_, i) => ({ keys: [i % 2 ? 'a' : 'd'], steps: 1 })), { steps: 340, shots: [100, 250] }] },
    { name: 'spot-dodge-cancel', row: 'donkeykong.spot-dodge', opponent: 300, must: ['spot_dodge', 'jab'], phases: [{ keys: ['h', 's'], steps: 1 }, { steps: 15 }, { keys: ['f'], steps: 1 }, { steps: 40, shots: [4, 5, 6, 10] }] },
    { name: 'spot-dodge-stale', row: 'donkeykong.spot-dodge', opponent: 300, must: ['spot_dodge'], phases: [...repeatDodge(['h', 's'], 5, 36), { keys: ['h', 's'], steps: 1 }, { steps: 45, shots: [3, 8, 20] }] },
    { name: 'roll-stale', row: 'donkeykong.roll-forward', opponent: 600, must: ['roll'],
      // A forward roll turns DK around, a back roll does not: back, then five forward rolls alternating the segment-relative key.
      phases: [...['back', 'fwd', 'back', 'fwd', 'back'].map(k => [{ keys: [k, 'h'], steps: 1 }, { steps: 46 }]).flat(), { keys: ['fwd', 'h'], steps: 1 }, { steps: 60, shots: [4, 10, 20] }] },
  ], { stepMode: true }),
  ...pickSegments(LEDGE_FAMILY, ['ledge-hang', 'ledge-getup', 'ledge-jump', 'ledge-roll', 'ledge-attack']),
  ...bothFacings([
    { name: 'ledge-hang-max', setup: LEDGE_APPROACH, must: ['ledge_catch', 'ledge'], phases: [...toLedge, { steps: 420, shots: [40, 380, 386, 392] }] },
    { name: 'ledge-hang-90', setup: { ...LEDGE_APPROACH, p1Damage: 90 }, must: ['ledge_catch', 'ledge'], phases: [...toLedge, { steps: 80, shots: [20, 40] }] },
  ], { stepMode: true }),
  ...pickSegments(ITEM_FAMILY, ['heavy-walk']),
  ...pickSegments(FAMILY_SEGMENTS_FOR_PICK(), ['jab', 'fsmash-short', 'headbutt-ground', 'throw-back']),
];
function FAMILY_SEGMENTS_FOR_PICK() { return [...GROUND_ATTACK_SEGMENTS, ...SPECIAL_SEGMENTS, ...GRAB_SEGMENTS]; }
/** Remaining gaps (2026-10-11): sourced prone/trip clocks, revival-platform hold, captured/pummel damage reaction, ledge drop,
 * bury and cargo recipients (DK P2 as the source), item catches/drops/back tosses, heavy fall/pass, air swings. Real keys; P2 keys
 * through CDP; `setup.item` / `itemAt` place items (probe setup); simulated analog stick only where marked (back tosses). */
const DK_P2_HEADBUTT = [{ key: 'toward', from: 4, to: 6 }, { key: 'Numpad2', from: 4, to: 6 }];
const cargoP2 = extra => [{ key: 'Numpad4', from: 4, to: 6 }, { key: 'toward', from: 60, to: 61 }, ...extra];
const REMAINING_GAP_SEGMENTS = [
  // Prone: missed tech, then lie untouched to the automatic getup (frame 246); presses before frame 26 are refused.
  ...[['', 1], ['-facedown', -1]].flatMap(([suffix, face]) => [
    { name: `prone-wait${suffix}`, row: suffix ? 'donkeykong.prone-face-down' : 'donkeykong.prone-face-up', opponent: 80, setup: { p1Damage: 20, p1Facing: face }, p2Hold: SMASH_P2,
      must: [suffix ? 'down_wait_face_down' : 'down_wait', 'getup'],
      phases: [{ steps: 75 }, { untilSheet: suffix ? 'down_wait_face_down' : 'down_wait', steps: 40, shots: [0] }, { steps: 280, shots: [30, 61, 100, 160, 243, 246, 252] }] },
    // The untilSheet step is prone age 0 (frame 1): fresh W presses at ages 10 and 24 (frame 25) are refused; W at age 25 (frame 26) stands.
    { name: `prone-press-early${suffix}`, row: suffix ? 'donkeykong.prone-face-down' : 'donkeykong.prone-face-up', opponent: 80, setup: { p1Damage: 20, p1Facing: face }, p2Hold: SMASH_P2,
      must: [suffix ? 'down_wait_face_down' : 'down_wait'], mustNot: ['getup'],
      phases: [{ steps: 75 }, { untilSheet: suffix ? 'down_wait_face_down' : 'down_wait', steps: 40 }, { steps: 9 }, { keys: ['w'], steps: 1 }, { steps: 13 },
        { keys: ['w'], steps: 1 }, { steps: 20, shots: [0] }] },
    { name: `prone-press-26${suffix}`, row: suffix ? 'donkeykong.prone-face-down' : 'donkeykong.prone-face-up', opponent: 80, setup: { p1Damage: 20, p1Facing: face }, p2Hold: SMASH_P2,
      must: [suffix ? 'down_wait_face_down' : 'down_wait', 'getup'],
      phases: [{ steps: 75 }, { untilSheet: suffix ? 'down_wait_face_down' : 'down_wait', steps: 40 }, { steps: 24 }, { keys: ['w'], steps: 1, shots: [0] }, { steps: 40, shots: [10] }] },
  ]),
  // Pikachu regression on the same universal clock.
  { name: 'pikachu-prone-wait', p1Char: 'pikachu', row: 'pikachu.prone', opponent: 80, setup: { p1Damage: 8 }, p2Hold: SMASH_P2, must: ['down_wait'],
    phases: [{ steps: 75 }, { untilSheet: 'down_wait', steps: 40 }, { steps: 260, shots: [100, 246] }] },
  // Trip (hard): DK P2's down tilt; lie untouched to the automatic getup on frame 100.
  { name: 'trip-wait', p2Char: 'donkeykong', row: 'donkeykong.trip', opponent: 95, p2Hold: TRIP_P2, must: ['trip', 'getup'], phases: [{ steps: 21 }, { steps: 130, shots: [0, 50, 98, 102] }] },
  // Revival platform: KO, then wait untouched (hold to 300 frames) / dismount with a stick press after 40 frames.
  { name: 'respawn-wait', row: 'donkeykong.respawn', opponent: 80, setup: { p1Damage: 60 }, p2Hold: SMASH_P2, must: ['idle'], mustNot: ['entry'],
    phases: [{ steps: 400, untilRevival: true }, { steps: 340, shots: [0, 7, 15, 23, 30, 45, 60, 90, 120, 200, 299, 302, 320] }] },
  { name: 'respawn-dismount', row: 'donkeykong.respawn', opponent: 80, setup: { p1Damage: 60 }, p2Hold: SMASH_P2, must: ['idle'], mustNot: ['entry'],
    phases: [{ steps: 400, untilRevival: true }, { steps: 40, shots: [20] }, { keys: ['back'], steps: 1, shots: [0] }, { steps: 60, shots: [5, 30] }] },
  { name: 'pikachu-respawn-wait', p1Char: 'pikachu', row: 'pikachu.respawn', opponent: 80, setup: { p1Damage: 80 }, p2Hold: SMASH_P2, must: ['entry'],
    phases: [{ steps: 400, untilRevival: true }, { steps: 320, shots: [60, 127] }] },
  // Captured damage: Pikachu grabs DK and pummels once; DK does not mash, so the reaction plays out after the hitlag.
  { name: 'captured-pummel', row: 'donkeykong.captured-damage', opponent: 60, p2Hold: [{ key: 'Numpad4', from: 4, to: 6 }, { key: 'Numpad1', from: 70, to: 72 }], must: ['captured', 'captured_hit'],
    phases: [{ steps: 60 }, { steps: 60, shots: [12, 27, 30, 34, 40, 46] }] },
  // DK pummels Pikachu: Pikachu's captured_hit drawing now has its own anchor.
  ...pickSegments(GRAB_SEGMENTS, ['pummel']).filter(seg => seg.facing === 1).map(seg => ({ ...seg, name: 'pummel', row: 'donkeykong.pummel' })),
  // Ledge drop: one S press (not held) and the away key.
  // SmashWiki Fast fall: "If the player taps down on the control stick while hanging from a ledge, their character will begin
  // to fast fall right after letting go of it" — the digital S key is a tap, so this drop fast-falls (fall_fast = fall art).
  { name: 'ledge-drop-down', row: 'donkeykong.ledge-drop', setup: LEDGE_APPROACH, must: ['ledge', 'fall_fast'], phases: [...toLedge, { steps: 40 }, { keys: ['s'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 10, 25] }] },
  // SmashWiki Fast fall: a down TAP while hanging fast-falls after letting go; a down TILT (simulated analog 0.5) merely lets go.
  { name: 'ledge-drop-down-tilt', row: 'donkeykong.ledge-drop', setup: LEDGE_APPROACH, simulatedTilt: true, must: ['ledge', 'fall'], mustNot: ['fall_fast'],
    phases: [...toLedge, { steps: 40 }, { tilt: { x: 0, y: 0.5 }, steps: 1, shots: [0] }, { steps: 40, shots: [2, 10, 25] }] },
  { name: 'ledge-drop-away', row: 'donkeykong.ledge-drop', setup: LEDGE_APPROACH, must: ['ledge'], phases: [...toLedge, { steps: 40 }, { keys: ['back'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 10, 25] }] },
  // Bury: DK P2's grounded Headbutt on DK; DK mashes (A/D) to escape.
  { name: 'buried', p2Char: 'donkeykong', row: 'donkeykong.buried-recipient', opponent: 75, p2Hold: DK_P2_HEADBUTT,
    phases: [{ steps: 40, shots: [25, 35] }, { steps: 60, shots: [20, 50] }, ...Array.from({ length: 20 }, (_, i) => ({ keys: [i % 2 ? 'a' : 'd'], steps: 2, ...([0, 3, 4].includes(i) ? { shots: [0, 1] } : {}) })), { steps: 80, shots: [2, 6, 12, 20] }] },
  // Cargo recipient: DK P2 grabs DK, carries (forward), then throws in each direction; DK P1 gives no input.
  { name: 'cargo-recipient-carried', p2Char: 'donkeykong', row: 'donkeykong.cargo-recipient-carried', opponent: 60, p2Hold: cargoP2([]), phases: [{ steps: 120, shots: [20, 70, 90, 110] }] },
  ...[['forward', ['Numpad1']], ['back', ['away', 'Numpad1']], ['up', ['ArrowUp', 'Numpad1']], ['down', ['ArrowDown', 'Numpad1']]].map(([dir, keys]) => ({
    name: `cargo-recipient-${dir}-throw`, p2Char: 'donkeykong', row: `donkeykong.cargo-recipient-${dir}-throw`, opponent: 60,
    p2Hold: cargoP2(keys.map(key => ({ key, from: 100, to: 101 }))), phases: [{ steps: 100, shots: [90] }, { steps: 90, shots: [3, 10, 18, 30, 50, 80] }] })),
  // Items: air Z-drop, air catches (grab / aerial / air dodge), catches with a dash attack and a down tilt, back tosses.
  { name: 'item-drop-air', row: 'donkeykong.item-drop-air', ...BAT, mustNot: ['item_throw_drop', 'item_throw_air_f'], phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['t'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 10] }] },
  ...[['air', ['t'], 'donkeykong.item-catch-air'], ['aerial', ['f'], 'donkeykong.item-catch-aerial'], ['air-dodge', ['r'], 'donkeykong.item-catch-air-dodge']].map(([n, keys, row]) => ({
    name: `item-catch-${n}`, row, ...itemAt(0, 400), lift: 300, phases: [{ steps: 2 }, { itemAt: { dx: 30, dy: -10 }, keys, steps: 1, shots: [0] }, { steps: 40, shots: [2, 6, 12] }] })),
  // Window edges (SmashWiki Item: 5 frames for aerials, air dodges and dash attacks, 2 for tilts): the item first overlaps
  // DK at the last open action age (caught) or the first closed one (not caught).
  ...[['aerial', ['f'], 5, 'donkeykong.item-catch-aerial'], ['air-dodge', ['r'], 5, 'donkeykong.item-catch-air-dodge']].flatMap(([n, keys, w, row]) =>
    [[w - 1, 'in'], [w, 'out']].map(([at, tag]) => ({ name: `item-catch-${n}-age${at}-${tag}`, row, ...itemAt(0, 400), lift: 300,
      phases: [{ steps: 2 }, { keys, steps: 1 }, { steps: at - 1 }, { itemAt: { dx: 30, dy: -10 }, steps: 1, shots: [0] }, { steps: 20 }] }))),
  ...[[4, 'in'], [5, 'out']].map(([at, tag]) => ({ name: `item-catch-dash-attack-age${at}-${tag}`, row: 'donkeykong.item-pickup-dash-attack', ...itemAt(0, 400), opponent: 600,
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1 }, { steps: at - 1 }, { itemAt: { dx: 60, dy: -10 }, steps: 1, shots: [0] }, { steps: 40 }] })),
  ...[[1, 'in'], [2, 'out']].map(([at, tag]) => ({ name: `item-catch-dtilt-age${at}-${tag}`, row: 'donkeykong.item-pickup-tilt', ...itemAt(0, 400),
    phases: [{ keys: ['s'], steps: 8 }, { keys: ['s', 'f'], steps: 1 }, { steps: at - 1 }, { itemAt: { dx: 45, dy: 0 }, keys: ['s'], steps: 1, shots: [0] }, { steps: 30 }] })),
  // A GROUNDED item ahead of a dash attack (the bat lies where DK's dash attack starts).
  { name: 'item-dash-attack-grounded', row: 'donkeykong.item-pickup-dash-attack', ...itemAt(0, 150), opponent: 600,
    phases: [{ keys: ['fwd'], steps: 10 }, { keys: ['fwd', 'f'], steps: 1, shots: [0] }, { steps: 50, shots: [4, 10, 25] }] },
  { name: 'item-catch-dash-attack', row: 'donkeykong.item-pickup-dash-attack', ...itemAt(0, 400), opponent: 600, must: ['dash_attack'],
    phases: [{ keys: ['fwd'], steps: 10 }, { itemAt: { dx: 60, dy: -10 }, keys: ['fwd', 'f'], steps: 1, shots: [0] }, { steps: 50, shots: [2, 8, 20, 40] }] },
  { name: 'item-catch-dtilt', row: 'donkeykong.item-pickup-tilt', ...itemAt(0, 400), must: ['dtilt'],
    phases: [{ keys: ['s'], steps: 8 }, { itemAt: { dx: 45, dy: 0 }, keys: ['s', 'f'], steps: 1, shots: [0] }, { steps: 40, shots: [2, 8, 20] }] },
  { name: 'item-throw-back-ordinary', row: 'donkeykong.item-throw-ground-back', ...BAT, simulatedTilt: true, must: ['item_throw_b'],
    phases: [...PICK.map(({ shots: _s, ...p }) => p), { tilt: { x: -0.5, y: 0 }, keys: ['t'], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30] }] },
  { name: 'heavy-throw-back-ordinary', row: 'donkeykong.heavy-item-heavy-throw-b', ...CRATE, simulatedTilt: true, opponent: 120, must: ['item_heavy_throw_b'],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { tilt: { x: -0.5, y: 0 }, keys: ['f'], steps: 1 }, { steps: 70, shots: [2, 8, 14, 20, 30, 45] }] },
  { name: 'heavy-fall-full-hop', row: 'donkeykong.heavy-super-lift-fall', ...CRATE, must: ['super_lift_jump', 'super_lift_fall'],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['w'], steps: 16 }, { until: 'landed', steps: 160, shots: [10, 20, 30] }, { steps: 30 }] },
  { name: 'heavy-pass', row: 'donkeykong.heavy-super-lift-pass', ...CRATE, p1On: { edge: 60 }, must: ['super_lift_fall'],
    phases: [{ keys: ['f'], steps: 1 }, { steps: 40 }, { keys: ['s'], steps: 2, shots: [1] }, { until: 'landed', steps: 120, shots: [2, 8, 14] }, { steps: 30 }] },
  // Ultimate: aerials with a battering item stay the fighter's own aerials (bat and Beam Sword rows re-scoped NOT_APPLICABLE).
  ...[['bat', BAT, 'donkeykong.item-bat-air-use', { mustNot: ['item_bat_swing_1'] }], ['sword', SWORD, 'donkeykong.item-sword-air-use', { mustNot: ['item_bat_swing_1'] }]].map(([n, item, row, expect]) => ({
    name: `${n}-air-use`, row, ...item, ...expect, phases: [...PICK.map(({ shots: _s, ...p }) => p), { keys: ['w'], steps: 3 }, { steps: 6 }, { keys: ['f'], steps: 1 }, { steps: 50, shots: [2, 6, 12, 18, 26] }] })),
].map(seg => ({ ...seg, stepMode: true, opponent: seg.opponent ?? 300 }));
const REMAINING_GAP_FAMILY = REMAINING_GAP_SEGMENTS.flatMap(seg => [1, -1].map(facing => ({ ...seg, name: `${seg.name}-${facing === 1 ? 'r' : 'l'}`, facing,
  startFrac: seg.p1On ? 0.5 : facing === 1 ? 0.3 : 0.7 })));
/** Final gaps (2026-10-11): respawn stands (wait) on the revival platform (no Entry: SmashWiki Revival platform / On-screen
 * appearance); bury drawn sunk and cut at the floor (DK and Pikachu); cargo recipients paired through the cargo throws
 * (DK carried by DK, and Pikachu carried by DK). Same inputs as the remaining-gaps segments. */
const FINAL_GAP_FAMILY = [
  ...pickSegments(REMAINING_GAP_FAMILY, ['respawn-wait', 'respawn-dismount']),
  ...pickSegments(REMAINING_GAP_FAMILY, ['pikachu-respawn-wait', 'buried', 'cargo-recipient-carried', 'cargo-recipient-forward-throw',
    'cargo-recipient-back-throw', 'cargo-recipient-up-throw', 'cargo-recipient-down-throw']),
  ...pickSegments(REMAINING_GAP_FAMILY, ['buried']).map(seg => ({ ...seg, name: `pikachu-${seg.name}`, p1Char: 'pikachu', row: 'pikachu.buried' })),
  ...pickSegments(GRAB_SEGMENTS, ['cargo-forward-throw', 'cargo-back-throw', 'cargo-up-throw', 'cargo-down-throw']),
];
/** extras2 (2026-10-11): DK carried / thrown by another DK's Cargo Throw, drawn with the cargo_recipient_* clips (same inputs as the
 * remaining-gaps cargo-recipient segments; the throw phase takes denser shots because the clips end at the release frame). */
const EXTRAS2_FAMILY = pickSegments(REMAINING_GAP_FAMILY, ['cargo-recipient-carried', 'cargo-recipient-forward-throw',
  'cargo-recipient-back-throw', 'cargo-recipient-up-throw', 'cargo-recipient-down-throw']).map(seg => ({ ...seg,
  must: [seg.name.startsWith('cargo-recipient-carried') ? 'cargo_recipient_carried' : `cargo_recipient_${{ forward: 'fthrow', back: 'bthrow', up: 'uthrow', down: 'dthrow' }[seg.name.split('-')[2]]}`],
  phases: seg.phases.length === 1 ? [{ steps: 200, shots: [20, 86, 110, 140, 170, 195] }] : [seg.phases[0], { steps: 40, shots: [1, 3, 5, 8, 11, 14, 16, 18] }] }));
const FAMILY_SEGMENTS = { extras2: EXTRAS2_FAMILY, 'final-gaps': FINAL_GAP_FAMILY, 'remaining-gaps': REMAINING_GAP_FAMILY, 'engine-source-fixes': ENGINE_FIX_SEGMENTS, 'items-taunts': ITEM_FAMILY, 'ultimate-items': ULTIMATE_ITEM_FAMILY, 'ultimate-food-varieties':FOOD_VARIETY_FAMILY, 'ledge-recovery': LEDGE_FAMILY, partials: PARTIAL_SEGMENTS, 'grabs-throws-cargo': GRAB_SEGMENTS, 'animation-continuity': CONTINUITY_SEGMENTS, defense: DEFENSE_SEGMENTS, specials: SPECIAL_SEGMENTS, aerials: [...AERIAL_SEGMENTS, ...AERIAL_LANDING_SEGMENTS], locomotion: DK_SEGMENTS, 'ground-attacks': GROUND_ATTACK_SEGMENTS, 'locomotion-extra': LOCOMOTION_EXTRA_SEGMENTS };
if (!FAMILY_SEGMENTS[family]) { console.error(`unknown --family ${family}`); process.exit(2); }

const PIKACHU_SEGMENTS = [
  { name: 'idle', must: ['idle'], phases: [{ steps: 40, shots: [20] }] },
  { name: 'run', must: ['run'], phases: [{ keys: ['d'], steps: 40, shots: [30] }, { steps: 20 }] },
  { name: 'jump', must: ['jump'], phases: [{ keys: ['w'], steps: 20, shots: [10] }, { until: 'landed', steps: 120, shots: [0] }, { steps: 20 }] },
  { name: 'jab', must: ['jab'], phases: [{ keys: ['f'], steps: 1 }, { steps: 40, shots: [3, 8] }] },
];

/** Installed into the page. Everything it returns is plain JSON. */
async function installProbe({ p1, p2, seed }) {
  const g = window.__game;
  for (const old of g.scene.getScenes(true)) g.scene.stop(old.scene.key);
  g.scale.setGameSize(1440, 1000);
  g.scene.start('MatchScene', { matchConfig: { mode: 'stocks', stockCount: 5, stageId: 'flat', rngSeed: seed,
    itemFrequency: 'off', players: [
      { index: 1, characterId: p1, paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: p2, paletteIndex: 1, inputType: 'keyboard_p2' }] } });
  const s = g.scene.getScene('MatchScene');
  // scene.start is deferred to the next game step; wait until create() has built the physics world.
  for (let i = 0; i < 600 && !(s.p1 && s.p2 && s.physicsEngine && s.matter?.world); i++) await new Promise(r => setTimeout(r, 50));
  s.physicsEngine.pause(); s.roundStartCountdown = 0; s.cpuControllers.clear();
  const floor = s.baseStage.bodies.platformBodies.find(b => b.label === 'platform.solid');
  // Pass-through platforms: two side platforms and the top one (smallest top y).
  const passes = s.baseStage.bodies.platformBodies.filter(b => b.label === 'platform.passThrough').map(b => b.bounds);
  const topPlatform = passes.reduce((a, b) => (b.min.y < a.min.y ? b : a), passes[0]);
  const sidePlatforms = passes.filter(b => b !== topPlatform).sort((a, b) => a.min.x - b.min.x);
  const dt = s.physicsEngine.fixedTimestepMs;
  const realMove = s.inputResolver.getMoveVector.bind(s.inputResolver);
  let tilt = null;
  s.inputResolver.getMoveVector = (player, ...rest) => (player === 1 && tilt !== null ? tilt : realMove(player, ...rest));
  let contacts = [];
  const applyHit = s.p2.applyHitDetailed.bind(s.p2);
  s.p2.applyHitDetailed = (hit, ...rest) => {
    const result = applyHit(hit, ...rest);
    const { damage, baseDamage, staleMultiplier, knockback, hitlagMultiplier, shieldDamage, slip, referenceKnockbackMultiplier, facing } = hit;
    contacts.push(JSON.parse(JSON.stringify({ damage, baseDamage, staleMultiplier, knockback, hitlagMultiplier, shieldDamage, slip, referenceKnockbackMultiplier,
      facing, outcome: result.outcome })));
    return result;
  };
  let contactsP1 = [];
  const applyHitP1 = s.p1.applyHitDetailed.bind(s.p1);
  s.p1.applyHitDetailed = (hit, ...rest) => {
    const result = applyHitP1(hit, ...rest);
    const { damage, shieldDamage, hitlagMultiplier, direct, shieldKind } = hit;
    contactsP1.push(JSON.parse(JSON.stringify({ damage, shieldDamage, hitlagMultiplier, direct, shieldKind, outcome: result.outcome, damageApplied: result.damageApplied })));
    return result;
  };
  const slotOf = i => s.playerSlots.find(x => x.playerIndex === i - 1); // slots are 0-based

  const opaqueCache = new Map();
  const opaqueLocal = frame => {
    const key = `${frame.texture.key}:${frame.name}`;
    if (opaqueCache.has(key)) return opaqueCache.get(key);
    const w = frame.cutWidth, h = frame.cutHeight;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(frame.source.image, frame.cutX, frame.cutY, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let c0 = w, c1 = -1, r0 = h, r1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 16) {
      if (x < c0) c0 = x; if (x > c1) c1 = x; if (y < r0) r0 = y; if (y > r1) r1 = y;
    }
    const out = { w, h, c0, c1, r0, r1 };
    opaqueCache.set(key, out);
    return out;
  };
  const r2 = v => Math.round(v * 100) / 100;
  /** Opaque pixel bounds in world space; origin/scale/flip independent (maps through getBounds()). */
  const opaqueWorld = sprite => {
    const o = opaqueLocal(sprite.frame);
    if (o.c1 < 0) return null;
    const b = sprite.getBounds(), flipped = sprite.flipX;
    const left = b.x + (flipped ? o.w - (o.c1 + 1) : o.c0) / o.w * b.width;
    const right = b.x + (flipped ? o.w - o.c0 : o.c1 + 1) / o.w * b.width;
    return { left: r2(left), right: r2(right), top: r2(b.y + o.r0 / o.h * b.height), bottom: r2(b.y + (o.r1 + 1) / o.h * b.height) };
  };
  const readSlot = index => {
    const slot = slotOf(index), ch = slot.character, sprite = slot.sprite, tuning = ch.getTuning();
    const pos = ch.getPosition(), vel = ch.getVelocity(), bounds = ch.body.bounds;
    const anim = sprite.anims.currentAnim?.key ?? null;
    const bodyBottom = pos.y + tuning.height / 2;
    const op = opaqueWorld(sprite), sb = sprite.getBounds();
    const bodyState = ch.getPackedBodyState?.() ?? null;
    const atk = ch.getActiveAttack?.() ?? null, charge = ch.chargingSmash ?? null;
    const hb = atk?.hitboxBody?.bounds ?? null;
    return {
      attack: atk && { id: atk.move.id, sheetVariant: atk.move.sheetVariant ?? null, phase: atk.phase, age: atk.framesElapsed,
        live: atk.hitboxBody != null, chargeHeldFrames: atk.chargeHeldFrames ?? null,
        hitboxBounds: hb && { minX: r2(hb.min.x), maxX: r2(hb.max.x), minY: r2(hb.min.y), maxY: r2(hb.max.y) } },
      punch: bodyState?.punch ?? null, specialCharge: ch.chargingSpecial ? { held: ch.chargingSpecial.framesHeld } : null,
      specialBank: ch.storedSpecialCharge ?? null, buried: ch.getBuriedPresentationState?.() ?? null, helpless: ch.isHelpless?.() ?? null,
      landing: ch.landingPresentation ? { kind: ch.landingPresentation.kind, totalFrames: ch.landingPresentation.totalFrames, framesElapsed: ch.landingPresentation.framesElapsed ?? null } : null,
      cooldown: ch.cooldownRemaining ?? null,
      grab: (g => ({ name: g.name, age: g.active?.framesElapsed ?? null, cargo: g.active?.cargo ?? false, cargoStartup: g.active?.cargoStartupRemaining ?? null,
        throwDir: g.active?.throwDirection ?? null, throwAirborne: g.active?.throwAirborne ?? null, variant: ch.getGrabPresentationState?.()?.variant ?? null,
        pummelCooldown: g.active?.pummelCooldownRemaining ?? null, cooldownRemaining: g.cooldownRemaining ?? null }))(ch.getGrabState()),
      grabbed: ch.isGrabbed(), throwPresentation: ch.getThrowPresentationState?.() ?? null, release: ch.getGrabReleasePresentationState?.() ?? null,
      attachment: ch.getCaptureAttachmentDiagnostic?.()?.status ?? null, captureBudget: ch.getCaptureBudgetState?.() ?? null,
      dodge: (d => ({ name: d.name, kind: d.active?.kind ?? null, directional: d.active?.directional ?? false, backward: d.active?.backward ?? false,
        age: d.active?.framesElapsed ?? null, iframesRemaining: d.iframesRemaining }))(ch.getDodgeState()),
      shield: (sh => ({ name: sh.name, health: r2(sh.health), stunRemaining: sh.stunRemaining, blockStunRemaining: sh.blockStunRemaining }))(ch.getShieldState()),
      shieldPresentation: ch.getShieldPresentationState?.() ?? null, invincible: ch.isInvincible(),
      charging: charge && { moveId: charge.moveId, startupElapsed: charge.startupElapsed ?? null, held: charge.framesHeld },
      damage: r2(ch.getDamagePercent()), hitstun: ch.hitstunRemaining ?? null, hitlag: ch.getHitlagRemaining?.() ?? null,
      dodgeStaleCount: ch.getDodgeStaleness?.()?.count ?? null, damageTakenMultiplier: ch.getDamageTakenMultiplier?.() ?? null,
      ledge: (l => ({ name: l.name, age: l.active?.framesElapsed ?? null, grabs: l.ledgeGrabsSinceGround, iframes: l.hangIframesRemaining }))(ch.getLedgeHangState()),
      ledgeAttackRoot: ch.getLedgeAttackRootMotionState?.() ?? null,
      reaction: ch.getReactionPresentationState?.() ?? null, tripped: ch.isTripped?.() ?? null,
      committed: bodyState?.committed ?? null, surfaceTech: bodyState?.surfaceTech ?? null, footstoolRecipient: ch.getFootstoolRecipientPresentationState?.() ?? null,
      footstoolPerformer: bodyState?.footstoolPerformer ?? null, respawn: ch.getPikachuRespawnPresentationState?.() ?? null,
      revival: ch.isOnRevivalPlatform?.() ?? null, invincibleFrames: ch.getInvincibilityRemaining?.() ?? null,
      spawnPlatforms: s.respawnHandler.getActiveSpawnPlatforms().filter(pl => pl.playerIndex === index - 1).length,
      capture: (c => c && { kind: c.event.kind, age: c.event.framesElapsed, holdAge: c.framesElapsed })(ch.getCapturePresentationState?.() ?? null),
      knockedDown: ch.isKnockedDown?.() ?? null,
      healing:ch.getHealingState?.()??null,eating:ch.getEatingState?.()??null,
      held: s.getInventory(slot.playerIndex)?.getHeldItem()?.definition.type ?? null,
      hammer: s.getInventory(slot.playerIndex)?.getHeldItem()?.getHammerState?.() ?? null,
      hammerAreas: ch.getEquippedItem()?.definition.hammer ? ch.getHammerDamageAreas(ch.getEquippedItem().definition.hammer) : [],
      hammerAreaVisible: s.hammerAreasVisual.get(s.getInventory(slot.playerIndex)?.getHeldItem()?.id)?.visible??false,
      ammo: s.getInventory(slot.playerIndex)?.getHeldItem()?.getAmmo() ?? null, heavyAction: ch.getDonkeyKongHeavyItemActionState?.()?.plan.action ?? null,
      itemAction: ch.getItemActionState?.()?.plan.action ?? null, taunt: ch.getTauntPresentationState?.() ?? null,
      // Held item: the drawn hand's native socket (getHeldItemSocket) and where the item sprite is actually drawn.
      itemSocket: (k => k && { x: r2(k.x), y: r2(k.y), angle: k.angle === null ? null : r2(k.angle), length: r2(k.length ?? 1) })(ch.getHeldItemSocket?.() ?? null),
      heldVisual: (h => { const c = h && s.itemVisuals.get(h.id); return c ? { x: r2(c.x), y: r2(c.y), angle: r2(c.angle), scaleX: c.scaleX, scaleY: r2(c.scaleY),visible:c.visible } : null; })(
        s.getInventory(slot.playerIndex)?.getHeldItem()),
      items: s.getItemRegistry().getActive().map(it => ({ type: it.definition.type,foodVariant:it.definition.foodVariant??null, state: it.getSnapshot().state,
        x: r2(it.getPosition().x), y: r2(it.getPosition().y) })),
      stocks: s.stockTracker.getStocks(index - 1), tumbling: ch.isTumbling?.() ?? null,
      sheet: anim ? anim.split('.')[1] : null, frame: sprite.frame.name, textureKey: sprite.texture.key,
      // Shooting items: the upper-body layer drawn over the legs, the session (phase, ages, charge, shots).
      overlay: (o => o ? o.key.split('.')[1] : null)(slot.spriteAnimSm?.current?.()?.overlay ?? null),
      overlayFrame: slot.spriteAnimSm?.current?.()?.overlay?.frameIndex ?? null,
      upperVisible: s.upperBodySprites?.get(slot.playerIndex)?.visible ?? false,
      shooting: ch.getItemShootingState?.() ?? null,
      frameSize: [sprite.frame.cutWidth, sprite.frame.cutHeight],
      intendedSheet: bodyState?.clock?.sheet ?? null, flipX: sprite.flipX,
      scale: [r2(sprite.scaleX), r2(sprite.scaleY)], origin: [r2(sprite.originX), r2(sprite.originY)],
      position: { x: r2(pos.x), y: r2(pos.y) }, velocity: { x: r2(vel.x), y: r2(vel.y) },
      grounded: ch.isGrounded(), facing: ch.getFacing(), locomotion: ch.getLocomotionState?.().name ?? null,
      jumpsUsed: ch.getJumpsUsed?.() ?? null,
      body: { width: tuning.width, height: tuning.height, centreY: r2(pos.y), bottom: r2(bodyBottom),
        boundsMinY: r2(bounds.min.y), boundsMaxY: r2(bounds.max.y) },
      sprite: { x: r2(sprite.x), y: r2(sprite.y), bounds: { x: r2(sb.x), y: r2(sb.y), w: r2(sb.width), h: r2(sb.height) } },
      opaque: op && { ...op, height: r2(op.bottom - op.top), width: r2(op.right - op.left) },
      // A buried fighter's frame is cut at the floor line (MatchScene.drawBuriedSink): rows kept and their world bottom.
      crop: sprite.isCropped ? { rows: r2(sprite._crop.height), bottom: r2(sprite.y - sprite.originY * sprite.height * sprite.scaleY + sprite._crop.height * sprite.scaleY) } : null,
      buriedDirt: s.buriedDirt?.get(slot.playerIndex)?.mound?.visible ?? null,
      // Ultimate bury effects (mash shake, splashes at 30%, yellow flash at 60%) and the live hurtbox top (sinks with the body).
      buriedEffects: ch.getBuriedEffects?.() ?? null,
      buriedClock: ch.buriedState ? { initialFrames: ch.buriedState.initialFrames, age: ch.buriedState.age, mashReduction: ch.buriedState.mash.reduction } : null,
      hurtboxTop: (hbs => hbs.length ? r2(pos.y + Math.min(...hbs.map(h => h.capsule ? Math.min(h.capsule.start.y, h.capsule.end.y) - h.capsule.radius
        : h.offsetY - h.height / 2))) : null)(ch.getActiveHurtboxes()),
      // Root (sprite.x/y with a root origin) should sit on the body bottom; opaque feet should sit on it too.
      rootMinusBodyBottom: r2(sprite.y - bodyBottom),
      feetMinusBodyBottom: op ? r2(op.bottom - bodyBottom) : null,
      feetMinusFloorTop: op ? r2(op.bottom - floor.bounds.min.y) : null,
      centreXOffset: op ? r2((op.left + op.right) / 2 - pos.x) : null,
    };
  };
  const snap = () => ({ frame: s.physicsEngine.getFrame(), p1Stocks: s.stockTracker.getStocks(0), p1: readSlot(1), p2: readSlot(2), hitsOnP2: contacts.splice(0), hitsOnP1: contactsP1.splice(0),
    // Phase 5: live item explosions (centre, radius, drawn damage-area circle) and the Bob-omb fuse / Banana Peel wear.
    explosions: (s.itemExplosions ?? []).map(e => ({ x: r2(e.x), y: r2(e.y), radius: e.spec.radius, framesLeft: e.framesLeft, owner: e.owner,
      done: [...e.done], area: { visible: e.area.visible, radius: r2(e.area.radius), x: r2(e.area.x), y: r2(e.area.y) } })),
    items: s.getItemRegistry().getActive().map(i => ({ id: i.id, type: i.definition.type, state: i.getSnapshot().state, x: r2(i.getPosition().x), y: r2(i.getPosition().y),
      fuse: i.getBobOmbState?.()?.phase ?? null, wear: i.getDurability?.() ?? null, owner: i.getOwnerPlayerIndex?.() ?? null,
      visual: (c => c && { visible: c.visible, alpha: r2(c.alpha), x: r2(c.x), y: r2(c.y), angle: r2(c.angle), scaleX: c.scaleX,
        parts: c.list.map(g => ({ type: g.type, texture: g.texture?.key ?? null, w: r2(g.displayWidth), h: r2(g.displayHeight) })) })(s.itemVisuals.get(i.id)) })),
    hitboxDebug: s.hitboxDebugLayer?.isEnabled?.() ?? null, swingFlashes: s.swingFlashes.length,
    // Live projectiles (Star Rod stars): sensor box and the drawn container (its parts include the damage-area box).
    projectiles: s.projectiles.map(p => ({ id: p.id, moveId: p.moveId, owner: p.ownerSlotIndex, x: r2(p.x), y: r2(p.y), w: p.width, h: p.height,
      damage: p.damage, visible: p.container.visible, parts: p.container.list.map(g => ({ type: g.type, w: r2(g.displayWidth ?? g.width ?? 0), h: r2(g.displayHeight ?? g.height ?? 0) })) })) });
  const once = () => { s.physicsEngine.resume(); s.update(0, dt); s.physicsEngine.pause(); };
  // 'landed' = on the ground again after having been airborne during this phase (or before it).
  let sawAir = false;
  const until = {
    falling: () => !s.p1.isGrounded() && s.p1.getVelocity().y >= 0,
    landed: () => { sawAir ||= !s.p1.isGrounded(); return sawAir && s.p1.isGrounded(); },
    // Grounded again while not rising: rising through a pass-through platform's top is not a landing.
    settled: () => { sawAir ||= !s.p1.isGrounded(); return sawAir && s.p1.isGrounded() && s.p1.getVelocity().y >= 0; },
    // Descending with the feet less than 14 px above the main floor (still airborne).
    nearFloor: () => !s.p1.isGrounded() && s.p1.getVelocity().y > 0
      && floor.bounds.min.y - (s.p1.getPosition().y + s.p1.getTuning().height / 2) < 14,
  };
  /** Probe setup (not player input): one item through the normal registry (Item Switch index), grounded `dx` px in front of DK. */
  const spawnItem = ({ type, dx, dy, ammo, rngState,keepHeld,rngFoodState }) => {
    if(!keepHeld)s.getInventory(s.playerSlots[0].playerIndex)?.drop(0, s.p1.getPosition());
    for (const old of s.getItemRegistry().getActive()) { if(keepHeld&&old.isHeld())continue;old.markDespawned(s.physicsEngine.getFrame()); s.itemVisuals.get(old.id)?.destroy(); }
    s.thrownItems = [];
    // The Item Switch (MatchConfig.itemSwitch) with only this item on: the spawn's item-type pick can only be it.
    const table = ['homeRunBat', 'beamSword', 'hammer', 'rayGun', 'bobOmb', 'crate', 'starRod', 'superScope', 'fireFlower', 'bananaPeel', 'goldenHammer','food','heartContainer','maximTomato'];
    s.activeMatchConfig = { ...s.activeMatchConfig, itemSwitch: Object.fromEntries(table.map((t, i) => [t, i === type])) };
    if(rngFoodState!==undefined)s.matchRng.stream('item-food').setState(rngFoodState);
    if(rngState!==undefined)s.matchRng.stream(type===10?'item-golden-hammer':'item-hammer').setState(rngState);
    const tr = s.baseStage.transform, scale = s.stage.scale, p = s.p1.getPosition(), x = p.x + dx * s.p1.getFacing();
    const feet = p.y + s.p1.getTuning().height / 2;
    const design = { x: (x - tr.offsetX) / scale, y: (feet - tr.offsetY) / scale };
    let spawn = true;
    s.itemSpawnManager.step = frame => spawn ? (spawn = false, [{ frame, anchorIndex: 0, anchor: design, spawnPosition: design }]) : [];
    once();
    const item = s.getItemRegistry().getActive().at(-1);
    if (!item) throw new Error('item spawn absent');
    // Grounded now (its idle-despawn clock starts at the current frame, not at frame 0).
    if (dy === undefined) item.markGrounded(s.physicsEngine.getFrame(), { x, y: feet });
    // Probe setup (not input): spend shots until `ammo` are left (the empty Star Rod).
    if (ammo !== undefined) while ((item.getAmmo() ?? 0) > ammo && item.spendShot()) { /* spend */ }
  };
  /** Probe setup (not input): moves the active item to (dx forward, dy down) from P1's body centre as a FALLING item. */
  const placeItem = ({ dx, dy }) => {
    const item = s.getItemRegistry().getActive().at(-1);
    if (!item) throw new Error('no item to place');
    const p = s.p1.getPosition(), pos = { x: p.x + dx * s.p1.getFacing(), y: p.y + dy };
    if (item.getSnapshot().state === 'grounded') item.markFalling(s.physicsEngine.getFrame(), pos);
    item.updateFreePosition(pos); s.itemFallingY.set(item.id, pos.y);
    const c = s.itemVisuals.get(item.id); if (c) { c.x = pos.x; c.y = pos.y; }
    return item.getSnapshot().state;
  };
  window.__fam = {
    meta: () => ({ engineVersion: s.getMatchStartMetadata().engineVersion, p1, p2, seed,
      floorTop: floor.bounds.min.y, floorBottom: floor.bounds.max.y, floorX: [floor.bounds.min.x, floor.bounds.max.x], fixedTimestepMs: dt,
      blastZone: (({ offsetX, offsetY, viewportScale: scale }, z) => ({ left: offsetX + z.left * scale, right: offsetX + z.right * scale,
        top: offsetY + z.top * scale, bottom: offsetY + z.bottom * scale }))(s.baseStage.transform, s.activeStage.blastZone),
      passThroughPlatforms: passes.map(b => ({ top: b.min.y, x: [b.min.x, b.max.x] })) }),
    /** p1On: { edge: px } starts P1 on a side platform, `edge` px inside the edge it faces (right
     * platform edge for facing 1 on the left platform, mirrored); { under: 'top' } starts P1 on the
     * floor under the top platform's centre. */
    reset(startFrac = 0.2, facing = 1, opponent = null, p1On = null, lift = 0, setup = null) {
      tilt = null;
      const [x0, x1] = [floor.bounds.min.x, floor.bounds.max.x];
      let x = x0 + (x1 - x0) * startFrac, top = floor.bounds.min.y;
      if (p1On?.edge !== undefined) {
        const b = sidePlatforms[facing === 1 ? 0 : sidePlatforms.length - 1];
        x = facing === 1 ? b.max.x - p1On.edge : b.min.x + p1On.edge; top = b.min.y;
      } else if (p1On?.under === 'top') x = (topPlatform.min.x + topPlatform.max.x) / 2;
      s.p1.resetForRound(x, top - s.p1.getTuning().height / 2);
      s.p2.resetForRound(opponent === null ? x1 - 60 : x + facing * opponent, floor.bounds.min.y - s.p2.getTuning().height / 2);
      s.p1.setFacing(facing); s.p2.setFacing(-facing); s.p1.setInvincibility?.(0); s.p2.setInvincibility?.(0);
      for (const p of [s.p1, s.p2]) p.setDamagePercent?.(0);
      for (let i = 0; i < 14; i++) once();
      contacts = []; contactsP1 = [];
      // Probe setup (not player input): `lift` px above the settled position, zero velocity, so an air dodge can run its full length before landing.
      if (lift) { const c = s.p1.getPosition(); s.p1.setPosition(c.x, c.y - lift); s.p1.setVelocity?.(0, 0); }
      // Probe setup (not player input): `setup` places the fighters / damage before the segment's real keys start.
      // p1Edge {dx, dy, vx, vy}: DK dx px outside the ledge corner the segment faces (facing 1 = left corner) and dy px below the floor top.
      // p1Rel {dx, dy, vx, vy}: DK relative to P2's body centre (x forward of P2 = toward P2's facing). p2Rel: P2 relative to DK (dx forward of DK).
      if (setup) {
        const [fx0, fx1] = [floor.bounds.min.x, floor.bounds.max.x], top = floor.bounds.min.y, hh = s.p1.getTuning().height / 2;
        if (setup.p1Edge) window.__fam.placeEdge(setup.p1Edge, facing);
        if (setup.p2Rel) { const c = s.p1.getPosition(); s.p2.setPosition(c.x + setup.p2Rel.dx * facing, c.y + setup.p2Rel.dy); s.p2.setVelocity?.(setup.p2Rel.vx ?? 0, setup.p2Rel.vy ?? 0); }
        if (setup.p1Rel) { const c = s.p2.getPosition(); s.p1.setPosition(c.x + setup.p1Rel.dx * facing, c.y + setup.p1Rel.dy); s.p1.setVelocity?.(setup.p1Rel.vx ?? 0, setup.p1Rel.vy ?? 0); }
        if (setup.item) spawnItem(setup.item);
        if (setup.p1Damage !== undefined) s.p1.setDamagePercent(setup.p1Damage);
        if (setup.p2Damage !== undefined) s.p2.setDamagePercent(setup.p2Damage);
        if (setup.p2Facing !== undefined) s.p2.setFacing(setup.p2Facing * facing);
        if (setup.p1Facing !== undefined) s.p1.setFacing(setup.p1Facing * facing);
        if(setup.p2Protection==='revival')s.p2.beginRevivalPlatform();
        if(setup.p2Protection==='invincible')s.p2.setInvincibility(600,'invincible');
      }
      return { grounded: s.p1.isGrounded(), ...snap() };
    },
    /** Teleports P2 to (dx * facing, dy) from P1's body centre (y down) with no velocity: an airborne target held where a hitbox window reaches. */
    /** Probe setup (not player input): drops DK's shield health so the next block breaks it. */
    setShield(health) { s.p1.shieldState = { ...s.p1.shieldState, health }; },
    placeItem,spawnItem,
    /** Probe setup (not player input): DK dx px outside the ledge corner `facing` faces and dy px below the floor top. */
    placeEdge(e, facing, bodyOnly = false) {
      const [fx0, fx1] = [floor.bounds.min.x, floor.bounds.max.x];
      const x = facing === 1 ? fx0 - e.dx : fx1 + e.dx, y = floor.bounds.min.y + e.dy;
      // bodyOnly moves just the Matter body: Character.setPosition is a respawn-style reset (it clears the ledge-catch count).
      if (bodyOnly) { s.matter.body.setPosition(s.p1.body, { x, y }); s.matter.body.setVelocity(s.p1.body, { x: e.vx ?? 0, y: e.vy ?? 0 }); }
      else { s.p1.setPosition(x, y); s.p1.setVelocity?.(e.vx ?? 0, e.vy ?? 0); }
    },
    /** Probe setup (not player input): a SIMULATED hit on DK through applyHitDetailed. */
    hitP1(hit) {
      const r = applyHitP1({ ...hit, facing: hit.facing * s.p1.getFacing() });
      return JSON.parse(JSON.stringify({ outcome: r.outcome, damageApplied: r.damageApplied, reactionResisted: r.reactionResisted ?? false,
        magnitude: r.knockback.magnitude, hitstun: r.knockback.hitstunFrames, grabAfter: s.p1.getGrabState().name, victimGrabbed: s.p2.isGrabbed() }));
    },
    place(dx, dy, hitbox = false) {
      const c = s.p1.getPosition(), b = hitbox ? s.p1.getActiveAttack?.()?.hitboxBody?.bounds : null;
      const x = b ? (b.min.x + b.max.x) / 2 : c.x + dx * s.p1.getFacing();
      const y = b ? (b.min.y + b.max.y) / 2 : dy === null ? floor.bounds.min.y - s.p2.getTuning().height / 2 : c.y + dy;
      s.p2.setPosition(x, y);
      s.p2.setVelocity?.(0, 0);
    },
    step(n, { simulatedTilt = null, untilName = null } = {}) {
      tilt = simulatedTilt; sawAir = !s.p1.isGrounded(); const out = [];
      for (let i = 0; i < n; i++) {
        once(); out.push(snap());
        if (untilName && until[untilName]()) break;
      }
      return out;
    },
  };
  return window.__fam.meta();
}

const report = { url, probe: 'dk-rework-family-probe', family, strict, errors: [], failedResponses: [], parts: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const sheetRuns = records => {
  const runs = [];
  records.forEach((r, i) => {
    const sheet = r.p1.sheet, last = runs.at(-1);
    if (last && last.sheet === sheet) { last.toStep = i; last.frames.add(r.p1.frame); }
    else runs.push({ sheet, fromStep: i, toStep: i, frames: new Set([r.p1.frame]) });
  });
  return runs.map(r => ({ ...r, frames: [...r.frames] }));
};
const range = values => values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;

async function runPart(partName, p1, p2, segments, seed) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => report.errors.push(`${partName}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(`${partName} console: ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400) report.failedResponses.push({ url: r.url(), status: r.status() }); });
  const part = { part: partName, p1, p2, segments: [] };
  report.parts.push(part);
  const held = new Set();
  // Playwright's Numpad<n> sends the NumLock-off keyCode (End/Down/...), which Phaser does not read as NUMPAD_<n> (96+n);
  // P2's default attack is Numpad1, so numpad digits go through CDP with the real windowsVirtualKeyCode.
  const cdp = await page.context().newCDPSession(page);
  const numpadDigit = k => /^Numpad\d$/.test(k) ? Number(k.slice(6)) : null;
  const keyEvent = (type, k) => numpadDigit(k) === null ? page.keyboard[type === 'keyUp' ? 'up' : 'down'](k)
    : cdp.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 96 + numpadDigit(k), code: k, key: String(numpadDigit(k)), location: 3 });
  const press = async keys => {
    for (const k of [...held]) if (!keys.includes(k)) { await keyEvent('keyUp', k); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { await keyEvent('rawKeyDown', k); held.add(k); }
  };
  /** fwd/back are facing-relative keys; tilt.x is facing-relative stick. */
  const keysFor = (seg, phase) => [...(phase.keys ?? []).map(k => k === 'fwd' ? (seg.facing === -1 ? 'a' : 'd')
    : k === 'back' ? (seg.facing === -1 ? 'd' : 'a') : k)];
  const tiltFor = (seg, phase) => phase.tilt === undefined ? null
    : typeof phase.tilt === 'number' ? { x: phase.tilt, y: 0 } : { x: phase.tilt.x * (seg.facing ?? 1), y: phase.tilt.y };
  /** A shotAges entry matches the DK attack (sheet move suffix) or charge ('charge:<sheet>') age. */
  const matchesAge = (want, p1) => want.move.startsWith('charge:')
    ? p1.sheet === `${want.move.slice(7)}_charge` && p1.charging?.held === want.age
    : p1.attack?.age === want.age && (p1.sheet === want.move || p1.sheet?.startsWith(`${want.move}_`));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
    if (!report.bundle) {
      report.bundle = await page.evaluate(() => [...document.scripts].find(s => /assets\/index-/.test(s.src))?.src ?? null);
      report.bundleSha256 = report.bundle ? createHash('sha256').update(await (await page.request.get(report.bundle)).body()).digest('hex') : null;
    }
    part.meta = await page.evaluate(installProbe, { p1, p2, seed });
    report.engineVersion ??= part.meta.engineVersion;
    for (const seg of segments) {
      if (only && !only.includes(seg.name)) continue;
      await press([]);
      console.error("segment", seg.name);
      const start = await page.evaluate(a => window.__fam.reset(...a), [seg.startFrac ?? 0.2, seg.facing ?? 1, seg.opponent ?? null, seg.p1On ?? null, seg.lift ?? 0, seg.setup ?? null]);
      const records = [], shots = [];
      let step = 0, hitSeen = false;
      const hammerDrawingShots=new Set();
      const ageShots = (seg.shotAges ?? []).map(want => ({ ...want, taken: false }));
      const hitShots = (seg.hitShots ?? []).map(h => ({ ...h, taken: false })).sort((a, b) => b.minAge - a.minAge);
      if (seg.shieldHealth !== undefined) await page.evaluate(h => window.__fam.setShield(h), seg.shieldHealth);
      // Real F3 key: MatchScene's hitbox debug layer draws every live hitbox / hurtbox (the damage areas).
      if (seg.hitboxDebug && !start.hitboxDebug) await page.keyboard.press('F3');
      for (const [pi, phase] of seg.phases.entries()) {
        if (phase.p1Edge) await page.evaluate(a => window.__fam.placeEdge(...a), [phase.p1Edge, seg.facing ?? 1, true]);
        if(phase.spawnItem)await page.evaluate(a=>window.__fam.spawnItem(a),phase.spawnItem);
        if (phase.itemAt) await page.evaluate(a => window.__fam.placeItem(a), phase.itemAt);
        await press(keysFor(seg, phase));
        if (ageShots.length || hitShots.length || seg.stepMode) {   // attack segments: one step at a time, screenshots at DK ages / hits
          let sawAir = records.length > 0 && !records.at(-1).p1.grounded;
          for (let i = 0; i < phase.steps; i++) {
            // p2Hold: P2 holds a real key over [from, to) ('up' = jump, 'toward' = run at DK) to meet a window.
            if (seg.p2Hold) await press([...keysFor(seg, phase), ...seg.p2Hold.filter(h => step >= h.from && step < h.to)
              .map(h => h.key === 'up' ? 'ArrowUp' : h.key === 'toward' ? (seg.facing === -1 ? 'ArrowRight' : 'ArrowLeft')
                : h.key === 'away' ? (seg.facing === -1 ? 'ArrowLeft' : 'ArrowRight') : h.key)]);
            // pin: hold P2 in a hitbox window (see AERIAL_ROWS) until it is hit or the window age passes.
            const prev = records.at(-1);
            if (seg.pin && !hitSeen && (seg.pin.fromStep !== undefined ? step >= seg.pin.fromStep && step <= seg.pin.toStep
              : prev?.p1.attack && prev.p1.attack.age + 1 >= seg.pin.from && prev.p1.attack.age + 1 <= seg.pin.to + 1))
              await page.evaluate(a => window.__fam.place(...a), [seg.pin.dx, seg.pin.dy, seg.pin.hitbox ?? false]);
            const simHits = [];
            for (const h of (seg.p1SimHits ?? []).filter(h => h.step === step)) simHits.push(await page.evaluate(hit => window.__fam.hitP1(hit), h.hit));
            const [r] = await page.evaluate(a => window.__fam.step(...a), [1, { simulatedTilt: tiltFor(seg, phase) }]);
            if (simHits.length) r.simulatedHitsOnP1 = simHits;
            if (r.hitsOnP2.length || r.hitsOnP1.length) hitSeen = true;
            records.push({ seg: seg.name, step: step++, phase: pi, keys: keysFor(seg, phase), tilt: tiltFor(seg, phase), ...r });
            if(/^pikachu-(hammer-wait|golden-grow-hit|golden-float)-[rl]$/.test(seg.name)&&r.p1.hammer&&r.p1.sheet.startsWith('item_hammer_')){
              const key=`${r.p1.sheet}-${r.p1.frame}`;
              if(!hammerDrawingShots.has(key)){
                hammerDrawingShots.add(key);const file=`${partName}-${seg.name}-drawing-${key}-s${step-1}.png`;
                await page.screenshot({path:`${outDir}/${file}`});
                shots.push({file,label:'hammer-drawing',atRecord:records.length-1,sheet:r.p1.sheet,frame:r.p1.frame});
              }
            }
            const hitShot = r.hitsOnP2.length ? hitShots.find(h => (r.p1.attack?.age ?? 0) >= h.minAge) : null;
            if (hitShot && !hitShot.taken) {
              hitShot.taken = true;
              const file = `${partName}-${seg.name}-${hitShot.label}-${r.p1.sheet}${r.p1.attack?.age ?? ''}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, label: hitShot.label, atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
            if (seg.p1HitShots && r.hitsOnP1.length && !shots.some(sh => sh.label === 'p1-hit')) {
              const file = `${partName}-${seg.name}-p1-hit-s${step - 1}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, label: 'p1-hit', atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
            const prevRec = records.at(-2);
            if (r.explosions?.some(e => !(prevRec?.explosions ?? []).some(o => o.x === e.x && o.y === e.y))) {
              const file = `${partName}-${seg.name}-explosion-s${step - 1}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, label: 'explosion', atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
            if (r.p2.tripped && !prevRec?.p2.tripped) {
              const file = `${partName}-${seg.name}-p2-trip-s${step - 1}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, label: 'p2-trip', atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
            if (phase.shots?.includes(i)) {
              const file = `${partName}-${seg.name}-p${pi}-s${i}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
            // until (step mode): 'falling' = airborne and not rising; 'landed' = grounded after being airborne.
            if (phase.until === 'falling' && !r.p1.grounded && r.p1.velocity.y >= 0) break;
            if (phase.until === 'landed' && sawAir && r.p1.grounded) break;
            if (phase.until === 'falling' && !r.p1.grounded && r.p1.velocity.y > 0) break;
            if (phase.until === 'airborne' && !r.p1.grounded) break;
            if (phase.until === 'nearFloor' && !r.p1.grounded && r.p1.velocity.y > 0 && part.meta.floorTop - r.p1.body.bottom < (phase.within ?? 40)) break;
            if (phase.untilSheet && r.p1.sheet === phase.untilSheet) break;
            if (phase.untilRevival && r.p1.revival) break;
            if (phase.untilNotSheet && r.p1.sheet !== phase.untilNotSheet) break;
            sawAir ||= !r.p1.grounded;
            for (const want of ageShots) if (!want.taken && (seg.shotOnHit ? r.hitsOnP2.length > 0 : matchesAge(want, r.p1))) {
              want.taken = true;
              const file = `${partName}-${seg.name}-${want.label}-${want.move.replace(':', '-')}${seg.shotOnHit ? r.p1.attack?.age : want.age}.png`;
              await page.screenshot({ path: `${outDir}/${file}` });
              shots.push({ file, label: want.label, atRecord: records.length - 1, sheet: r.p1.sheet, frame: r.p1.frame });
            }
          }
          continue;
        }
        const marks = [...(phase.shots ?? [])].sort((a, b) => a - b);
        let done = 0, finished = false;
        const chunkTo = async target => {
          const want = target - done;
          if (finished || want <= 0) return;
          const got = await page.evaluate(a => window.__fam.step(...a), [want,
            { simulatedTilt: tiltFor(seg, phase), untilName: phase.until ?? null }]);
          for (const r of got) records.push({ seg: seg.name, step: step++, phase: pi, keys: keysFor(seg, phase), tilt: tiltFor(seg, phase), ...r });
          done += got.length;
          if (got.length < want) finished = true;
        };
        for (const mark of marks) {
          await chunkTo(mark + 1);
          if (done < mark + 1) continue;
          const file = `${partName}-${seg.name}-p${pi}-s${mark}.png`;
          await page.screenshot({ path: `${outDir}/${file}` });
          shots.push({ file, atRecord: records.length - 1 });
        }
        await chunkTo(phase.steps);
      }
      await press([]);
      const sheets = sheetRuns(records), seen = new Set(sheets.map(r => r.sheet));
      for (const r of records) if (r.p1.overlay) seen.add(`upper:${r.p1.overlay}`);
      const missing = (seg.must ?? []).filter(m => !seen.has(m));
      const present = (seg.mustNot ?? []).filter(m => seen.has(m));
      const missingAny = seg.mustAny && !seg.mustAny.some(m => seen.has(m)) ? seg.mustAny : [];
      // Item planner evidence: the item actions started, held steps drawn at the native hand socket, the held state at the end.
      const actionsSeen = [...new Set(records.map(r => r.p1.itemAction).filter(Boolean))];
      const heldRecords = records.filter(r => r.p1.held && r.p1.heldVisual && r.p1.itemSocket);
      const itemEvidence = { actions: actionsSeen, heldSteps: heldRecords.length,
        socketAngleSteps: heldRecords.filter(r => r.p1.itemSocket.angle !== null).length,
        maxDrawnMinusSocketPx: heldRecords.length ? Math.round(100 * Math.max(...heldRecords.map(r => Math.hypot(r.p1.heldVisual.x - r.p1.itemSocket.x,
          r.p1.heldVisual.y - r.p1.itemSocket.y)))) / 100 : null,
        heldAtEnd: records.at(-1)?.p1.held ?? null, heldAtStart: records[0]?.p1.held ?? null };
      const missingActions = (seg.mustActions ?? []).filter(a => !actionsSeen.includes(a)).map(a => `ACTION:${a}`);
      const starRecords = records.flatMap(r => r.projectiles.filter(p => p.moveId === 'item.starRod.star').map(p => ({ step: r.step, ...p })));
      const stars = { spawned: [...new Set(starRecords.map(p => p.id))].length, steps: starRecords.length,
        boxes: [...new Set(starRecords.map(p => `${p.w}x${p.h}`))], drawnArea: [...new Set(starRecords.map(p => p.parts.find(q => q.type === 'Rectangle')).filter(Boolean).map(q => `${q.w}x${q.h}`))],
        ammo: [...new Set(records.map(r => r.p1.ammo))], hitsOnP2: records.flatMap(r => r.hitsOnP2.filter(() => r.projectiles.length || records[r.step - 1]?.projectiles.length).map(h => ({ step: r.step, damage: h.damage }))) };
      if (seg.mustStars !== undefined && stars.spawned !== seg.mustStars) missingActions.push(`STARS:${seg.mustStars}!=${stars.spawned}`);
      // Item shots (phase 4): distinct projectiles per move id, their sensor boxes, drawn damage areas and hits on P2.
      // Projectiles still flying from an earlier segment (alive at the reset) are not this segment's.
      const before = new Set((start.projectiles ?? []).map(p => p.id));
      const shotRecords = records.flatMap(r => r.projectiles.filter(p => p.moveId.startsWith('item.') && p.owner === 0 && !before.has(p.id))
        .map(p => ({ step: r.step, ...p })));
      const shotIds = new Map();
      for (const p of shotRecords) if (!shotIds.has(p.id)) shotIds.set(p.id, { moveId: p.moveId, firstStep: p.step, box: `${p.w}x${p.h}`, damage: p.damage,
        drawnArea: (q => q ? `${q.w}x${q.h}` : null)(p.parts.find(q => q.type === 'Rectangle')) });
      const itemShots = { spawned: [...shotIds.values()], ammo: [...new Set(records.map(r => r.p1.ammo))],
        upper: [...new Set(records.map(r => r.p1.overlay).filter(Boolean))],
        phases: [...new Set(records.map(r => r.p1.shooting?.phase).filter(Boolean))] };
      const count = prefix => itemShots.spawned.filter(x => x.moveId.startsWith(prefix)).length;
      for (const [prefix, n] of Object.entries(seg.mustShots ?? {})) if (count(prefix) !== n) missingActions.push(`SHOTS:${prefix}=${count(prefix)}!=${n}`);
      for (const [prefix, n] of Object.entries(seg.minShots ?? {})) if (count(prefix) < n) missingActions.push(`SHOTS:${prefix}=${count(prefix)}<${n}`);
      if (seg.mustItemGone && records.at(-1)?.p1.items.some(it => it.type === seg.mustItemGone)) missingActions.push(`ITEM_PRESENT:${seg.mustItemGone}`);
      // Phase 5: explosions, user immunity, slips, the thrown hit, the walking fuse.
      const explosionsSeen = [];
      for (const r of records) for (const e of r.explosions ?? []) if (!explosionsSeen.some(o => o.x === e.x && o.y === e.y))
        explosionsSeen.push({ firstStep: r.step, x: e.x, y: e.y, radius: e.radius, owner: e.owner, area: e.area });
      const p2Hits = records.flatMap(r => r.hitsOnP2.map(h => ({ step: r.step, damage: h.damage, angle: h.knockback?.reference?.angle ?? null, slip: h.slip ?? null })));
      const throwingEvidence = { explosions: explosionsSeen, p1DamageEnd: records.at(-1)?.p1.damage ?? null, hitsOnP1: records.reduce((n, r) => n + r.hitsOnP1.length, 0),
        p2Hits, p2TrippedSteps: records.filter(r => r.p2.tripped).length, p1TrippedSteps: records.filter(r => r.p1.tripped).length,
        fuses: [...new Set(records.flatMap(r => (r.items ?? []).map(it => it.fuse)).filter(Boolean))],
        wear: [...new Set(records.flatMap(r => (r.items ?? []).filter(it => it.wear !== null).map(it => it.wear)))] };
      if (seg.mustExplosions !== undefined && explosionsSeen.length !== seg.mustExplosions) missingActions.push(`EXPLOSIONS:${explosionsSeen.length}!=${seg.mustExplosions}`);
      if (explosionsSeen.some(e => !e.area?.visible || Math.abs(e.area.radius - e.radius) > .01)) missingActions.push('EXPLOSION_AREA_NOT_DRAWN');
      if (seg.p1Unhurt && (throwingEvidence.p1DamageEnd !== 0 || throwingEvidence.hitsOnP1 > 0)) missingActions.push('P1_HURT');
      if (seg.p2Trip && !throwingEvidence.p2TrippedSteps) missingActions.push('P2_NO_TRIP');
      if (seg.p1NoTrip && throwingEvidence.p1TrippedSteps) missingActions.push('P1_TRIPPED');
      if (seg.p2HitDamage !== undefined && !p2Hits.some(h => Math.abs(h.damage - seg.p2HitDamage) < .01)) missingActions.push(`P2_HIT:${seg.p2HitDamage}`);
      if (seg.p2HitAngle !== undefined && !p2Hits.some(h => h.angle === seg.p2HitAngle)) missingActions.push(`P2_ANGLE:${seg.p2HitAngle}`);
      if (seg.mustFuse && !throwingEvidence.fuses.includes(seg.mustFuse)) missingActions.push(`FUSE:${seg.mustFuse}`);
      const heldMismatch = seg.mustHeldEnd !== undefined && (itemEvidence.heldAtEnd !== null) !== seg.mustHeldEnd ? [`HELD_END:${seg.mustHeldEnd}`] : [];
      if(seg.hammerLock){
        const locked=records.filter(r=>r.p1.hammer);
        if(locked.some(r=>r.p1.attack||r.p1.itemAction||r.p1.shield.name!=='idle'||['run','initialDash'].includes(r.p1.locomotion)))missingActions.push('HAMMER_CONTROL_ESCAPE');
      }
      if(records.some(r=>r.p1.hammer&&r.p1.heldVisual&&r.p1.hitstun===0&&
        Math.hypot(r.p1.heldVisual.x-r.p1.itemSocket.x,r.p1.heldVisual.y-r.p1.itemSocket.y)>.1))missingActions.push('HAMMER_RENDER_SOCKET_NOT_CURRENT');
      if(seg.hammerVariant && p2Hits.length)missingActions.push('MALFUNCTION_DAMAGED_TARGET');
      if(seg.hammerVariant && !records.some(r=>r.p1.hammer?.malfunction===seg.hammerVariant))missingActions.push(`HAMMER_VARIANT:${seg.hammerVariant}`);
      if(seg.name.includes('hammer-jump-lock')){
        const afterGroundJump=records.filter(r=>r.phase===3&&!r.p1.grounded),retry=records.filter(r=>r.phase===4&&!r.p1.grounded);
        if(!afterGroundJump.length||!retry.length||retry.some(r=>r.p1.jumpsUsed!==1)||afterGroundJump.some(r=>r.p1.jumpsUsed!==1))missingActions.push('EXTRA_AIR_JUMP');
      }
      if(seg.name.includes('golden-float')){
        const taps=records.filter(r=>r.phase>=6&&r.keys.includes('w')&&!r.p1.grounded);
        if(!taps.length||!taps.some(r=>r.p1.velocity.y<0)||taps.some(r=>r.p1.jumpsUsed!==1))missingActions.push('NO_TAP_FLOAT');
        const first=taps[0],before=first&&records[first.step-1];
        if(!before||before.p1.velocity.y<=0||first.p1.velocity.y>=0)missingActions.push('FLOAT_NO_DESCENDING_REVERSAL');
      }
      if(seg.name.includes('golden-')){
        const drawings=records.filter(r=>r.p1.hammer&&r.p1.sheet.startsWith('item_hammer_'));
        if(new Set(drawings.map(r=>r.p1.frame)).size<2)missingActions.push('GOLDEN_SINGLE_DRAWING');
        if(drawings.some(r=>{const age=(r.p1.hammer.motionElapsed*2)%16;return r.p1.frame!==(age<8?0:age<15?1:2);}))missingActions.push('GOLDEN_CADENCE_MISMATCH');
      }
      if(seg.name.includes('hammer-wait')&&!records.some(r=>r.p1.sheet==='item_hammer_wait'&&r.p1.frame===2))missingActions.push('NORMAL_THIRD_DRAWING_ABSENT');
      if(seg.hammerProtectedTarget){
        const owned=records.filter(r=>r.p1.hammer&&r.phase===seg.phases.length-1);
        const progress=owned.length?owned.at(-1).p1.hammer.motionElapsed-owned[0].p1.hammer.motionElapsed:0;
        if(throwingEvidence.p2DamageEnd!==undefined&&throwingEvidence.p2DamageEnd!==0)missingActions.push('PROTECTED_TARGET_DAMAGED');
        if(records.at(-1)?.p2.damage!==0)missingActions.push('PROTECTED_TARGET_DAMAGED');
        if(seg.hammerProtectedTarget==='revival'){
          if(owned.some(r=>r.p1.hitlag)||progress<170)missingActions.push('REVIVAL_CONTACT_FROZE_HOLDER');
        }else{
          if(!owned.some(r=>r.p1.hitlag))missingActions.push('INVINCIBLE_CONTACT_MISSING_HITLAG');
          if(progress<20)missingActions.push('CONTACT_FREEZE_RETRIGGERED_BEFORE_MOTION_INTERVAL');
        }
      }
      let recoveryEvidence=null;
      if(seg.recovery){
        const variant=start.p1.items.find(i=>i.type==='food')?.foodVariant??records.flatMap(r=>r.p1.items).find(i=>i.type==='food')?.foodVariant;
        const amount=seg.recovery.food?FOOD_SOURCE_TABLE[variant]:seg.recovery.amount??0;
        const hits=records.flatMap(r=>r.hitsOnP1).filter(h=>h.outcome==='landed'),incoming=hits.reduce((n,h)=>n+(h.damageApplied??0),0);
        const expected=seg.setup.p1Damage+incoming-(seg.recovery.flinch?0:amount),actual=records.at(-1)?.p1.damage;
        const eating=records.filter(r=>r.p1.eating),healing=records.filter(r=>r.p1.healing);
        recoveryEvidence={variant,sourceAmount:amount,incomingDamageApplied:incoming,expectedEnd:expected,actualEnd:actual,
          eatDrawings:[...new Set(eating.map(r=>r.p1.frame))],healingSteps:healing.length,realHitCount:hits.length,
          preservedWeapon:seg.recovery.heldWeapon??null};
        if(!Number.isFinite(expected)||Math.abs(actual-expected)>.011)missingActions.push(`HEAL_END:${actual}!=${expected}`);
        if(seg.recovery.expectedVariant&&variant!==seg.recovery.expectedVariant)missingActions.push(`FOOD_VARIANT:${variant}!=${seg.recovery.expectedVariant}`);
        if(seg.recovery.gradual&&!healing.length)missingActions.push('HEALING_NOT_GRADUAL');
        if(seg.recovery.contact&&!hits.length)missingActions.push('HEALING_NO_REAL_CONTACT');
        if(seg.recovery.flinch&&(!hits.length||!records.some(r=>r.p1.items.some(i=>i.type==='food'&&i.state==='falling'))))missingActions.push('FOOD_FLINCH_DROP_ABSENT');
        if(seg.recovery.noTouch&&records.slice(0,seg.recovery.noTouch).some(r=>r.p1.damage!==seg.setup.p1Damage))missingActions.push('RECOVERY_CONSUMED_ON_TOUCH');
        if(seg.recovery.walking&&Math.abs(records.at(-1).p1.position.x-start.p1.position.x)<5)missingActions.push('WALK_EAT_DID_NOT_MOVE');
        if(seg.recovery.heldWeapon){
          if(eating.some(r=>r.p1.held!==seg.recovery.heldWeapon||r.p1.ammo!==16||r.p1.heldVisual?.visible!==false))missingActions.push('RECOVERY_WEAPON_NOT_STOWED_OR_PRESERVED');
          if(records.at(-1).p1.heldVisual?.visible!==true)missingActions.push('RECOVERY_WEAPON_NOT_RESTORED');
        }
      }
      const grounded = records.filter(r => r.p1.grounded);
      const summary = {
        name: seg.name, facing: seg.facing ?? 1, simulatedInput: seg.simulatedTilt || seg.phases.some(p => p.tilt !== undefined)
          ? 'analog stick via getMoveVector override (buttons are real keyboard events)' : 'real keyboard events',
        hitsOnP1: records.flatMap(r => r.hitsOnP1.map(hit => ({ step: r.step, hit }))),
        hitsOnP2: records.flatMap(r => r.hitsOnP2.map(hit => ({ step: r.step, dkAttack: r.p1.attack, dkSheet: r.p1.sheet, dkFrame: r.p1.frame, hit }))),
        p2DamageEnd: records.at(-1)?.p2.damage ?? null, missedShots: [...ageShots, ...hitShots].filter(w => !w.taken).map(w => w.label),
        row: seg.row ?? null, expect: seg.expect ?? null, punch: seg.punch ?? null,
        steps: records.length, startGrounded: start.grounded, sheets, intendedSheets: [...new Set(records.map(r => r.p1.intendedSheet))],
        missingMust: [...missing, ...missingAny, ...present.map(m => `NOT:${m}`), ...missingActions, ...heldMismatch], itemEvidence, stars, itemShots, throwingEvidence,recoveryEvidence, shouldSeen: Object.fromEntries((seg.should ?? []).map(k => [k, seen.has(k)])),
        optionalSeen: Object.fromEntries((seg.optional ?? []).map(k => [k, seen.has(k)])),
        groundedFeetMinusBodyBottom: range(grounded.map(r => r.p1.feetMinusBodyBottom).filter(v => v !== null)),
        groundedFeetMinusFloorTop: range(grounded.map(r => r.p1.feetMinusFloorTop).filter(v => v !== null)),
        rootMinusBodyBottom: range(records.map(r => r.p1.rootMinusBodyBottom)),
        opaqueHeight: range(records.map(r => r.p1.opaque?.height).filter(v => v !== undefined)),
        centreXOffset: range(records.map(r => r.p1.centreXOffset).filter(v => v !== null)),
        opponentOpaqueHeight: range(records.map(r => r.p2.opaque?.height).filter(v => v !== undefined)),
        screenshots: shots,
      };
      part.segments.push({ ...summary, records });
    }
  } finally {
    await page.close();
  }
}

try {
  // A fresh page every 4 selected segments: a long-lived probe match eventually ends/restarts (world null) and kills the run.
  const all = FAMILY_SEGMENTS[family].filter(seg => !only || only.includes(seg.name));
  // Segments with a `p2Char` (e.g. DK's own down tilt trips DK) run in their own parts against that opponent.
  // Segments with a `p1Char` (Pikachu regressions of a universal rule) run with that fighter as P1.
  const pair = seg => `${seg.p1Char ?? 'donkeykong'}|${seg.p2Char ?? opponent}`;
  for (const key of [...new Set(all.map(pair))]) {
    const [p1, p2] = key.split('|'), group = all.filter(seg => pair(seg) === key);
    for (let i = 0; i < group.length; i += 4) await runPart(`${p1 === 'donkeykong' ? 'dk' : p1}-vs-${p2}`, p1, p2, group.slice(i, i + 4), 810101);
  }
  if (!skipPikachu) await runPart(`${regressionChar}-regression`, regressionChar, regressionChar, PIKACHU_SEGMENTS, 810102);
} finally {
  await browser.close();
  await writeFile(`${outDir}/dk-rework-family-probe.json`, `${JSON.stringify(report, null, 1)}\n`);
}

const lines = [`build: engineVersion=${report.engineVersion} bundleSha256=${report.bundleSha256 ?? 'n/a'} url=${url}`];
let failed = report.errors.length > 0;
for (const part of report.parts) for (const seg of part.segments) {
  const bad = seg.missingMust.length > 0;
  failed ||= bad;
  lines.push(`${part.part}/${seg.name}: ${seg.steps} steps, sheets=${seg.sheets.map(r => r.sheet).join('>')}` +
    `${bad ? `  MISSING ${seg.missingMust.join(',')}` : ''}  feet-body ${JSON.stringify(seg.groundedFeetMinusBodyBottom)}`);
}
lines.push(`errors: ${report.errors.length}  failedResponses: ${report.failedResponses.length}  output: ${outDir}`);
console.log(lines.join('\n'));
process.exit(strict && failed ? 1 : 0);
