/**
 * B3 phase A — Link vs Donkey Kong defence and ledge parity in a real Matter world.
 *
 * Both fighters are built through the registry (`instantiateFighter`), stand on the
 * same solid stage (right ledge corner at x=400, top y=90) and receive IDENTICAL
 * CharacterInput sequences. Every expectation is a published Ultimate value for that
 * fighter; where a fighter currently misses it the test FAILS on purpose (phase B
 * of docs/review/2026-10-15/b3-diagnosis.md fixes the code, not the test).
 *
 * Frame convention: the step that carries the press is frame 1 (elapsed 0), so a
 * source window "intangible on frames a–b" means steps a..b inclusive.
 *
 * Sources (cached copies in the repo, SmashWiki wins a disagreement):
 *  - UFD Link / DK "Dodges / Rolls" tables:
 *    docs/review/2026-10-12/link-character/rework/sources/ufd/moves.json (Link)
 *    docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/remaining-gaps/sources/ufd-donkey_kong.html (DK)
 *  - UFD "Ledge Stats" (Neutral Getup / Roll / Jump / Attack per fighter):
 *    docs/review/2026-10-12/link-character/rework/sources/ufd/stats.html#ledgestats
 *  - SmashWiki Link (SSBU)/Edge attack: intangible 1-22 / 1-18 / 1-11, interruptible 56
 *    (wiki-move-captures.json). SmashWiki DK/Edge_attack: intangible 1-25, interruptible 56.
 *  - SmashWiki Shield (Ultimate row): 50 HP, depletion 0.15/frame, 37.5 HP after a break,
 *    shield drop 11 frames (UFD "Shield Drop — 11 frames (universal)"). SmashWiki Shield
 *    break / Shield jump: the fighter is launched upward (intangible during the shield
 *    jump), lands, then is stunned for 400 − percent frames (Stun, "Shield break").
 *    Cached: docs/review/2026-10-12/link-character/rework/sources/shield-break-phases/wiki-capture.json
 *  - Trip: native motion list (same rows for DK and Link)
 *    docs/review/2026-10-12/link-character/rework/sources/native/{,donkey/}motion_list.yml:
 *    slip_down xlu 1..6 (intangible frames 1-5), slip_stand xlu 1..17 (1-16), cancel 22.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Character, CharacterInput } from './Character';
import { instantiateFighter } from './fighterRegistry';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { ledgeCandidatesFromPlatform } from './ledgeDetection';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { defaultDodgeResolver } from '../input/InputService';
import { LINK_TUNING } from './Link';
import { LINK_HANG_DEPTH_PX } from './linkLedgeRootMotion';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

type Id = 'donkeykong' | 'link';
const N: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const STAGE = { id: 'stage', centerX: 0, centerY: 100, width: 800, height: 20 };
const STAGE_TOP = STAGE.centerY - STAGE.height / 2;
const EDGE_X = STAGE.centerX + STAGE.width / 2;
/** What InputResolver emits for shield + stick (defaultDodgeResolver sets `dodge`). */
const SHIELD_CHORD = (moveX: number, moveY: number): CharacterInput =>
  ({ ...N, moveX, moveY, shield: true, dodge: true });

/** Per-fighter published values (see the file header for the sources). */
const SOURCE = {
  donkeykong: {
    spot: { total: 26, iframes: [3, 17] }, fwdRoll: { total: 30, iframes: [4, 15] }, backRoll: { total: 35, iframes: [5, 16] },
    neutralAirDodge: { total: 48, iframes: [4, 32] },
    ledgeGetup: { total: 34, iframes: [1, 33] }, ledgeRoll: { total: 45, iframes: [1, 28] },
    ledgeJump: { iframes: [1, 12] }, ledgeAttack: { total: 55, iframes: [1, 25] },
  },
  link: {
    spot: { total: 26, iframes: [3, 17] }, fwdRoll: { total: 30, iframes: [4, 15] }, backRoll: { total: 35, iframes: [5, 16] },
    neutralAirDodge: { total: 49, iframes: [3, 30] },
    ledgeGetup: { total: 34, iframes: [1, 33] }, ledgeRoll: { total: 45, iframes: [1, 26] },
    ledgeJump: { iframes: [1, 12] }, ledgeAttack: { total: 55, iframes: [1, 22] },
  },
} as const;
/** Native cliff_catch cancel frame 20 for both fighters: the hang is actionable from catch frame 20. */
const LEDGE_CATCH_ACTIONABLE_FRAME = 20;
const TRIP_FALL_IFRAMES = [1, 5];
const TRIP_STAND = { iframes: [1, 16], actionableFrame: 22 } as const;

function world(id: Id, spawn?: { x: number; y: number; facing: 1 | -1 }) {
  const engine = Engine.create();
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, o: object) {
    const b = Bodies.rectangle(x, y, w, h, o); Composite.add(engine.world, b); return b; } }, world: {
    on(n: string, f: (...a: any[]) => void) { Events.on(engine, names[n] ?? n, f); },
    off(n: string, f: (...a: any[]) => void) { Events.off(engine, names[n] ?? n, f); },
    remove(b: any) { Composite.remove(engine.world, b); } } } };
  Composite.add(engine.world, Bodies.rectangle(STAGE.centerX, STAGE.centerY, STAGE.width, STAGE.height, { isStatic: true,
    label: PLATFORM_LABELS.solid, plugin: { platformId: STAGE.id }, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const ch: Character = instantiateFighter(scene, id, { spawnX: spawn?.x ?? 0, spawnY: spawn?.y ?? 0 });
  if (!spawn) Body.setPosition(ch.body, { x: 0, y: STAGE_TOP - ch.getTuning().height / 2 - 1 });
  ch.setFacing(spawn?.facing ?? 1);
  ch.setLedgeCandidates(ledgeCandidatesFromPlatform(STAGE));
  let frame = 0;
  const step = (input: CharacterInput = N) => {
    ch.applyInput(input, frame++);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: GAME_CONFIG.fixedTimestepMs, stepWorld: d => Engine.update(engine, d) });
  };
  return { ch, step };
}
type World = ReturnType<typeof world>;

function grounded(id: Id): World {
  const w = world(id);
  for (let i = 0; i < 20; i++) w.step();
  expect(w.ch.isGrounded()).toBe(true);
  return w;
}

/** Steps `input` once, then neutral; returns one sample per frame (index 0 = frame 1). */
function record<T>(w: World, input: CharacterInput, frames: number, sample: (ch: Character) => T): T[] {
  const out: T[] = [];
  w.step(input); out.push(sample(w.ch));
  for (let f = 2; f <= frames; f++) { w.step(); out.push(sample(w.ch)); }
  return out;
}

/** The 1-based [first, last] frames on which `flags` is true (must be one run), or null. */
function window(flags: readonly boolean[]): number[] | null {
  const first = flags.indexOf(true);
  if (first < 0) return null;
  const last = flags.lastIndexOf(true);
  expect(flags.slice(first, last + 1).every(Boolean), `one contiguous window, got ${flags.map(Number).join('')}`).toBe(true);
  return [first + 1, last + 1];
}

/** Falls straight down beside the right ledge with the body side touching the stage wall. */
function hang(id: Id): World {
  const half = world(id).ch.getTuning().width / 2;
  const w = world(id, { x: EDGE_X + half, y: -80, facing: -1 });
  let caught = false;
  for (let i = 0; i < 120 && !caught; i++) { w.step(); caught = w.ch.getLedgeHangState().name === 'hanging'; }
  expect(caught, `${id} never caught the ledge`).toBe(true);
  return w;
}

/** Hangs past the catch and past the hang-intangibility budget (max 123 frames). */
function settledHang(id: Id): World {
  const w = hang(id);
  for (let i = 0; i < 130; i++) w.step();
  expect(w.ch.getLedgeHangState().name).toBe('hanging');
  expect(w.ch.isInvincible()).toBe(false);
  return w;
}

const IDS = ['donkeykong', 'link'] as const;

describe('input contract: the shield chord is resolved upstream into dodge', () => {
  // TRIAGE "roll / spot dodge broken": the probe replaced InputResolver.isActionHeld, so the
  // `dodge` bit that defaultDodgeResolver computes inside InputResolver.update was never read.
  it('shield + side / down resolves to dodge; shield alone does not', () => {
    const base = { slot: 1 as never, jump: false, attack: false, special: false, grab: false, held: {} as never };
    expect(defaultDodgeResolver({ ...base, shield: true, move: { x: 1, y: 0 } })).toBe(true);
    expect(defaultDodgeResolver({ ...base, shield: true, move: { x: 0, y: 1 } })).toBe(true);
    expect(defaultDodgeResolver({ ...base, shield: true, move: { x: 0, y: 0 } })).toBe(false);
  });

  it.each(IDS)('%s: shield + side WITHOUT the resolved dodge bit only holds shield (the probe artefact)', id => {
    const w = grounded(id);
    for (let i = 0; i < 4; i++) w.step({ ...N, shield: true });
    const x = w.ch.getPosition().x;
    for (let i = 0; i < 10; i++) w.step({ ...N, shield: true, moveX: 1 });
    expect(w.ch.isDodging()).toBe(false);
    expect(w.ch.isShielding()).toBe(true);
    expect(Math.abs(w.ch.getPosition().x - x)).toBeLessThan(1);
  });
});

describe.each(IDS)('%s ground dodges (UFD Dodges / Rolls)', id => {
  const src = SOURCE[id];
  const run = (fighter: Id, moveX: number, moveY: number) => {
    const w = grounded(fighter);
    for (let i = 0; i < 4; i++) w.step({ ...N, shield: true });
    const x0 = w.ch.getPosition().x;
    const rows = record(w, SHIELD_CHORD(moveX, moveY), 60, ch => ({ dodging: ch.isDodging(), inv: ch.isInvincible(), x: ch.getPosition().x }));
    return { rows, x0 };
  };
  it.each([
    ['spot dodge (shield + down)', 0, 1, 'spot'],
    ['forward roll (shield + forward)', 1, 0, 'fwdRoll'],
    ['back roll (shield + back)', -1, 0, 'backRoll'],
  ] as const)('%s: duration and intangibility', (_name, moveX, moveY, key) => {
    const { rows, x0 } = run(id, moveX, moveY);
    const s = src[key];
    expect(rows.findIndex(r => !r.dodging) + 1, 'first frame no longer dodging').toBe(s.total + 1);
    expect(window(rows.map(r => r.inv))).toEqual(s.iframes);
    const travel = rows[s.total - 1]!.x - x0;
    if (key === 'spot') expect(Math.abs(travel)).toBeLessThan(1);
    else expect(Math.sign(travel)).toBe(moveX);
  });
  it('a forward roll travels as far as Donkey Kong\'s (shared slide calibration)', () => {
    const own = run(id, 1, 0), ref = run('donkeykong', 1, 0);
    expect(Math.abs((own.rows[29]!.x - own.x0) - (ref.rows[29]!.x - ref.x0))).toBeLessThan(5);
  });
});

describe.each(IDS)('%s neutral air dodge (UFD)', id => {
  it('duration and intangibility off-stage', () => {
    const w = world(id, { x: 3000, y: -2000, facing: 1 });
    w.step();
    const rows = record(w, { ...N, shield: true }, 60, ch => ({ dodging: ch.isDodging(), inv: ch.isInvincible() }));
    const s = SOURCE[id].neutralAirDodge;
    expect(rows.findIndex(r => !r.dodging) + 1).toBe(s.total + 1);
    expect(window(rows.map(r => r.inv))).toEqual(s.iframes);
  });
});

describe.each(IDS)('%s shield hold / release (SmashWiki Shield; UFD shield drop 11)', id => {
  it('depletes 0.15 HP per held frame', () => {
    const w = grounded(id);
    for (let i = 0; i < 20; i++) w.step({ ...N, shield: true });
    expect(w.ch.isShielding()).toBe(true);
    expect((w.ch.getShieldState() as { health: number }).health).toBeCloseTo(50 - 20 * 0.15, 1);
  });
  it.each([[11, false], [12, true]] as const)('an attack pressed on release frame %i starts=%s', (k, starts) => {
    const w = grounded(id);
    for (let i = 0; i < 20; i++) w.step({ ...N, shield: true });
    for (let f = 1; f < k; f++) w.step();
    w.step({ ...N, attack: true });
    expect(w.ch.getActiveAttack() !== null).toBe(starts);
  });
});

describe.each(IDS)('%s shield break (SmashWiki Shield break / Shield jump / Stun)', id => {
  const broken = () => {
    const w = grounded(id);
    let held = 0;
    for (; held < 500 && !w.ch.isShieldBroken(); held++) w.step({ ...N, shield: true });
    return { w, held };
  };
  it('breaks after ceil(50 / 0.15) held frames', () => {
    expect(broken().held).toBe(Math.ceil(50 / 0.15));
  });
  it('shield-jumps upward, intangible while rising', () => {
    const { w } = broken();
    const rows = record(w, N, 20, ch => ({ airborne: !ch.isGrounded(), vy: ch.getVelocity().y, inv: ch.isInvincible() }));
    const rising = rows.filter(r => r.airborne && r.vy < 0);
    expect(rising.length, 'launched upward').toBeGreaterThan(0);
    expect(rising.every(r => r.inv), 'intangible during the shield jump').toBe(true);
  });
  it('is stunned 400 − percent frames after the landing knockdown, wakes up, then has 37.5 HP', () => {
    const { w } = broken();
    w.step();
    for (let f = 0; f < 200 && !w.ch.isGrounded(); f++) w.step();
    // SmashWiki: "knocking them down on the ground before stunning them"; the stun
    // timer (400 − p, mash aside) starts once that landing motion (≤ 50 frames) is over.
    const stunNow = () => (w.ch.getShieldState() as { stunRemaining: number }).stunRemaining;
    for (let f = 0; f < 60 && stunNow() < 400 - 1; f++) w.step();
    const stun = stunNow();
    expect(stun, 'stun 400 − 0%').toBeGreaterThanOrEqual(400 - 1);
    expect(stun).toBeLessThanOrEqual(400);
    w.step({ ...N, attack: true });
    expect(w.ch.getActiveAttack(), 'locked during the stun').toBeNull();
    for (let i = 1; i < stun; i++) w.step();
    // SmashWiki Stun: the 400 − p formula "does not consider the animation for regaining
    // consciousness" (native furafura_end, cancel frame 34 for both fighters), so a press on
    // the first frame after the timer is still locked out.
    w.step({ ...N, attack: true });
    expect(w.ch.getActiveAttack(), 'wake-up animation after the stun timer').toBeNull();
    for (let i = 0; i < 40; i++) w.step();
    expect(w.ch.isShieldBroken()).toBe(false);
    expect((w.ch.getShieldState() as { health: number }).health).toBeCloseTo(37.5, 0);
  });
});

describe.each(IDS)('%s ledge (UFD Ledge Stats; SmashWiki Edge attack)', id => {
  const src = SOURCE[id];
  it('catches the ledge when falling with the body against the stage wall', () => {
    expect(hang(id).ch.isHangingOnLedge()).toBe(true);
  });
  it.each([[LEDGE_CATCH_ACTIONABLE_FRAME - 1, false], [LEDGE_CATCH_ACTIONABLE_FRAME, true]] as const)(
    'a get-up pressed on catch frame %i is accepted=%s (native cliff_catch cancel 20)', (k, accepted) => {
      const w = hang(id); // the catching step is catch frame 1
      for (let f = 2; f < k; f++) w.step();
      w.step({ ...N, moveY: -1 });
      expect(w.ch.getLedgeHangState().name === 'climbing').toBe(accepted);
    });
  it('neutral get-up: duration and intangibility, ends standing on the stage', () => {
    const w = settledHang(id);
    const rows = record(w, { ...N, moveY: -1 }, 60, ch => ({ climbing: ch.getLedgeHangState().name === 'climbing', inv: ch.isInvincible() }));
    expect(rows.filter(r => r.climbing).length).toBe(src.ledgeGetup.total);
    expect(window(rows.map(r => r.inv))).toEqual(src.ledgeGetup.iframes);
    expect(w.ch.isGrounded()).toBe(true);
    expect(w.ch.getPosition().x).toBeLessThan(EDGE_X);
  });
  it('ledge roll: duration and intangibility, ends standing on the stage', () => {
    const w = settledHang(id);
    const rows = record(w, { ...N, moveX: -1 }, 70, ch => ({ rolling: ch.getLedgeHangState().name === 'rolling', inv: ch.isInvincible() }));
    expect(rows.filter(r => r.rolling).length).toBe(src.ledgeRoll.total);
    expect(window(rows.map(r => r.inv))).toEqual(src.ledgeRoll.iframes);
    expect(w.ch.isGrounded()).toBe(true);
    expect(w.ch.getPosition().x).toBeLessThan(EDGE_X);
  });
  it('ledge jump: intangibility, rises above the stage', () => {
    const w = settledHang(id);
    const rows = record(w, { ...N, jump: true }, 40, ch => ({ inv: ch.isInvincible(), y: ch.getPosition().y }));
    expect(window(rows.map(r => r.inv))).toEqual(src.ledgeJump.iframes);
    expect(Math.min(...rows.map(r => r.y))).toBeLessThan(STAGE_TOP - 40);
  });
  if (id === 'link') it('the ledge-attack root track is projected onto Link\'s real hang depth', () => {
    expect(LINK_HANG_DEPTH_PX).toBe(LINK_TUNING.height);
  });
  it('ledge attack: climbs onto the stage, duration and first-grab intangibility', () => {
    const w = settledHang(id);
    const rows = record(w, { ...N, attack: true }, 80, ch => ({ attacking: ch.getActiveAttack()?.move.id === `${id}.ledgeAttack`, inv: ch.isInvincible() }));
    expect(rows.filter(r => r.attacking).length).toBe(src.ledgeAttack.total);
    expect(window(rows.map(r => r.inv))).toEqual(src.ledgeAttack.iframes);
    expect(w.ch.isGrounded(), 'standing on the stage after the ledge attack').toBe(true);
    expect(w.ch.getPosition().y).toBeLessThan(STAGE_TOP);
  });
});

describe.each(IDS)('%s trip (native slip / slip_stand rows, identical for DK and Link)', id => {
  it('slip_down is intangible on frames 1-5 only', () => {
    const w = grounded(id);
    w.ch.applyTrip();
    expect(w.ch.isTripped()).toBe(true);
    expect(window(record(w, N, 30, ch => ch.isInvincible()))).toEqual(TRIP_FALL_IFRAMES);
  });
  /** Runs the trip to the step on which knockdown ends: slip_stand frame 1. */
  const standing = () => {
    const w = grounded(id);
    w.ch.applyTrip();
    for (let f = 0; f < 400 && w.ch.isKnockedDown(); f++) w.step();
    expect(w.ch.isKnockedDown()).toBe(false);
    return w;
  };
  it('auto stand (slip_stand) is intangible on frames 1-16', () => {
    const w = standing();
    const inv = [w.ch.isInvincible()];
    for (let f = 2; f <= 30; f++) { w.step(); inv.push(w.ch.isInvincible()); }
    expect(window(inv)).toEqual(TRIP_STAND.iframes);
  });
  it.each([[TRIP_STAND.actionableFrame - 1, false], [TRIP_STAND.actionableFrame, true]] as const)(
    'an attack pressed on stand frame %i starts=%s (slip_stand cancel 22)', (k, starts) => {
      const w = standing();
      for (let f = 2; f < k; f++) w.step();
      w.step({ ...N, attack: true });
      expect(w.ch.getActiveAttack() !== null).toBe(starts);
    });
  it('the trip attack is reachable from the trip (shared route)', () => {
    const w = grounded(id);
    w.ch.applyTrip();
    for (let i = 0; i < 45; i++) w.step();
    w.step({ ...N, attack: true });
    expect(w.ch.getActiveAttack()?.move.id).toBe(`${id}.tripAttack`);
  });
});
