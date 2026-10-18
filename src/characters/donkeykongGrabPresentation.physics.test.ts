/**
 * Grab / throw / cargo presentation on a real Matter world: DK's sprite (sheet:drawing) per fixed step through the
 * MatchScene sprite driver, a Pikachu captive, the capture attachment coordinator, and a floor with an edge.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import type { CharacterInput } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { coordinateCaptureAttachments } from './captureAttachmentCoordinator';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { captureSimulationAnimation, createSimulationSpriteAnimationDriver } from './simulationSpriteAnimation';
import frames from '../../assets/characters/donkeykong/gameplay.json';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

const clips = frames.animations as Record<string, { frameCount: number; nativeSampleIndices?: number[] }>;
const lastDrawing = (sheet: string) => clips[sheet]!.frameCount - 1;
/** Floor: x in [-FLOOR_HALF, FLOOR_HALF], top at y = 42 (DK spawns standing at 0). */
const FLOOR_HALF = 600;

function fixture(facing: 1 | -1 = 1, victimDx = 55) {
  const engine = Engine.create(); engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, o: object) {
    const b = Bodies.rectangle(x, y, w, h, o); Composite.add(engine.world, b); return b; } },
  world: { on(n: string, f: any) { Events.on(engine, names[n] ?? n, f); }, off(n: string, f: any) { Events.off(engine, names[n] ?? n, f); },
    remove(b: any) { Composite.remove(engine.world, b); } } } };
  const dk = new DonkeyKong(scene, { spawnX: 0, spawnY: 0 }), victim = new Pikachu(scene, { spawnX: victimDx * facing, spawnY: 17 });
  dk.setFacing(facing); victim.setFacing((-facing) as 1 | -1);
  Composite.add(engine.world, Bodies.rectangle(0, 52, FLOOR_HALF * 2, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const fighters = [dk, victim];
  for (const c of fighters) c.setLedgeCandidates([{ platformId: 'floor', side: 'left', x: -FLOOR_HALF, y: 42 },
    { platformId: 'floor', side: 'right', x: FLOOR_HALF, y: 42 }]);
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (context.kind === 'grab') { dk.resolveGrabConnect(victim); return { confirmed: victim.getGrabbedBy() === dk }; }
    return { confirmed: fighters[index]!.applyHitDetailed(hit).outcome === 'landed' };
  });
  handler.registerPlayer(0, dk.body); handler.registerPlayer(1, victim.body); handler.setFacingLookup(i => fighters[i]!.getFacing());
  handler.setGroundedLookup(i => fighters[i]!.isGrounded()); handler.setHurtboxLookup(i => fighters[i]!.getActiveHurtboxes());
  for (const n of ['collisionStart', 'collisionActive']) Events.on(engine, n, (e: any) => handler.handleCollisionStart(e));
  const animations = new Map(Object.entries(clips).map(([sheet, clip]) =>
    [`donkeykong.${sheet}.anim`, { frames: Array.from({ length: clip.frameCount }, (_, i) => ({ i })) }]));
  const anims: any = { currentAnim: null, currentFrame: null, pause() {}, setCurrentFrame(f: unknown) { anims.currentFrame = f; } };
  const sprite = { anims, play(key: string) { anims.currentAnim = { key }; } };
  const catalog = { exists: (key: string) => animations.has(key), get: (key: string) => animations.get(key) };
  let frame = 0;
  const driver = createSimulationSpriteAnimationDriver(() => captureSimulationAnimation(dk, frame, false),
    sprite as unknown as SimulationSpriteSurface, catalog as unknown as SimulationAnimationCatalog);
  /** One fixed step; returns DK's presented `sheet:drawing`. */
  const step = (input: Partial<CharacterInput> = {}) => {
    frame += 1;
    dk.applyInput({ moveX: 0, jump: false, ...input }, frame); victim.applyInput({ moveX: 0, jump: false }, frame);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: GAME_CONFIG.fixedTimestepMs, stepWorld: d => Engine.update(engine, d), afterSubstep: () => coordinateCaptureAttachments(fighters) });
    handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
    const pose = driver.tick()!;
    return `${pose.key.split('.')[1]}:${pose.frameIndex}`;
  };
  const steps = (n: number, input: Partial<CharacterInput> = {}) => Array.from({ length: n }, () => step(input));
  dk.setInvincibility(0); victim.setInvincibility(0);
  for (let i = 0; i < 20; i++) step();
  dk.setFacing(facing);
  const capture = () => {
    const seq = [step({ grab: true })];
    for (let n = 0; n < 18 && !victim.isGrabbed(); n++) seq.push(step());
    expect(victim.getGrabbedBy()).toBe(dk);
    return seq;
  };
  /** Holding -> forward stick enters cargo; runs the entry to its carry. */
  const cargo = () => { capture(); step({ attack: true, moveX: facing }); expect(dk.getGrabState().active?.cargo).toBe(true); return steps(30); };
  const clean = () => { dk.destroy(); victim.destroy(); Engine.clear(engine); Composite.clear(engine.world, false); };
  return { dk, victim, step, steps, capture, cargo, clean };
}

/** Drawings of `sheet` in order of appearance (consecutive repeats collapsed). */
function drawings(seq: readonly string[], sheet: string): number[] {
  const out: number[] = [];
  for (const pose of seq) {
    const [name, drawing] = pose.split(':');
    if (name === sheet && out.at(-1) !== Number(drawing)) out.push(Number(drawing));
  }
  return out;
}

describe('DK grab / throw tails (Matter)', () => {
  it.each([1, -1] as const)('a whiffed standing grab finishes its drawings, then idle starts at drawing 0 (face %s)', facing => {
    const f = fixture(facing, 600);
    try {
      const seq = [f.step({ grab: true }), ...f.steps(80)];
      expect(drawings(seq, 'grab').at(-1)).toBe(lastDrawing('grab'));
      const last = seq.lastIndexOf(seq.filter(p => p.startsWith('grab:')).at(-1)!);
      expect(seq[last + 1]).toBe('idle:0');
    } finally { f.clean(); }
  });
  it.each([['back', -1, 'bthrow'], ['up', 0, 'uthrow']] as const)('the %s throw finishes its drawings after the release', (_name, stickX, sheet) => {
    const f = fixture();
    try {
      f.capture(); f.steps(3);
      const seq = [f.step(stickX ? { moveX: stickX } : { moveY: -1 }), ...f.steps(90)];
      expect(f.victim.isGrabbed()).toBe(false);
      expect(drawings(seq, sheet).at(-1)).toBe(lastDrawing(sheet));
      expect(seq.at(-1)).toMatch(/^idle:/);
    } finally { f.clean(); }
  });
  it('a new action interrupts a throw tail', () => {
    const f = fixture();
    try {
      f.capture(); f.steps(3); f.step({ moveX: -1 });
      // Run to the first drawing past the throw's end (the tail), then jump.
      let pose = '';
      for (let i = 0; i < 80 && f.dk.getGrabState().name !== 'idle'; i++) pose = f.step();
      expect(f.step().startsWith('bthrow:'), pose).toBe(true);
      expect(f.step({ jump: true }).startsWith('bthrow:')).toBe(false);
    } finally { f.clean(); }
  });
  it('pummel finishes its drawings, then the hold restarts at drawing 0', () => {
    const f = fixture();
    try {
      f.capture(); f.steps(25);
      const seq = [f.step({ attack: true }), ...f.steps(45)];
      expect(drawings(seq, 'pummel')).toEqual([0, 1, 2, 3, 4]);
      const after = seq.findIndex((p, i) => i > 0 && seq[i - 1]!.startsWith('pummel:') && !p.startsWith('pummel:'));
      expect(seq[after]).toBe('grab_hold:0');
    } finally { f.clean(); }
  });
  it('the hold starts at its own drawing 0 when the pull ends', () => {
    const f = fixture();
    try {
      const seq = [...f.capture(), ...f.steps(40)];
      const first = seq.findIndex(p => p.startsWith('grab_hold:'));
      expect(seq[first - 1]).toMatch(/^grab_pull:/);
      expect(seq[first]).toBe('grab_hold:0');
    } finally { f.clean(); }
  });
  it.each([['forward', { attack: true, moveX: 1 }, 'cargo_fthrow'], ['back', { attack: true, moveX: -1 }, 'cargo_bthrow'],
    ['up', { attack: true, moveY: -1 }, 'cargo_uthrow'], ['down', { attack: true, moveY: 1 }, 'cargo_dthrow']] as const)(
    'the cargo %s throw finishes its drawings', (_name, input, sheet) => {
      const f = fixture();
      try {
        f.cargo();
        const seq = [f.step(input), ...f.steps(90)];
        expect(f.victim.isGrabbed()).toBe(false);
        expect(drawings(seq, sheet).at(-1)).toBe(lastDrawing(sheet));
      } finally { f.clean(); }
    });
});

describe('DK pivot grab (Matter)', () => {
  it.each([1, -1] as const)('stops on the turn instead of sliding (native CatchTurn has no Trans travel) face %s', facing => {
    const f = fixture(facing, -600);
    try {
      f.steps(10, { moveX: facing });
      f.step({ moveX: -facing, grab: true });
      expect(f.dk.getGrabPresentationState()?.variant).toBe('pivot');
      const x0 = f.dk.getPosition().x;
      f.steps(20);
      expect(Math.abs(f.dk.getPosition().x - x0)).toBeLessThan(1);
    } finally { f.clean(); }
  });
  it('catches an unpinned target that stands behind the run', () => {
    const f = fixture(1, -40);
    try {
      f.steps(5, { moveX: 1 });
      f.step({ moveX: -1, grab: true });
      for (let i = 0; i < 20 && !f.victim.isGrabbed(); i++) f.step();
      expect(f.victim.getGrabbedBy()).toBe(f.dk);
    } finally { f.clean(); }
  });
});

describe('DK cargo presentation (Matter)', () => {
  it('after the cargo jump drawings, the airborne carry shows cargo_hold_air', () => {
    const f = fixture();
    try {
      f.cargo();
      const seq: string[] = [f.step({ jump: true })];
      for (let i = 0; i < 120 && (seq.length < 5 || !f.dk.isGrounded()); i++) seq.push(f.step());
      expect(drawings(seq, 'cargo_jump').at(-1)).toBe(lastDrawing('cargo_jump'));
      // From the last cargo_jump drawing's end to the landing, the carry shows cargo_hold_air from its drawing 0.
      const air = seq.slice(seq.findIndex(p => p.startsWith('cargo_hold_air:')), -1);
      expect(air.length).toBeGreaterThan(0);
      expect(air[0]).toBe('cargo_hold_air:0');
      expect(air.filter(p => !p.startsWith('cargo_hold_air:'))).toEqual([]);
    } finally { f.clean(); }
  });
  it.each([1, -1] as const)('walking off the edge while carrying shows only cargo_hold_air in the air (face %s)', facing => {
    const f = fixture(facing);
    try {
      f.cargo();
      const seq: string[] = [];
      for (let i = 0; i < 400 && f.dk.isGrounded(); i++) f.step({ moveX: facing });
      for (let i = 0; i < 20; i++) seq.push(f.step({ moveX: facing }));
      expect(f.dk.getGrabState().active?.cargo).toBe(true);
      expect(seq.filter(p => !p.startsWith('cargo_hold_air:'))).toEqual([]);
    } finally { f.clean(); }
  });
});

describe('DK held-opponent grips (Matter, Pikachu captive)', () => {
  /** Captive centre relative to DK's centre, in DK's facing. */
  const relative = (f: ReturnType<typeof fixture>, facing: 1 | -1) => {
    const d = f.dk.getPosition(), v = f.victim.getPosition();
    return { x: (v.x - d.x) * facing, y: v.y - d.y };
  };
  it.each([1, -1] as const)('the hold pairs the captive at the drawing grip (face %s)', facing => {
    const f = fixture(facing);
    try {
      f.capture(); f.steps(30);
      expect(f.dk.getCaptureAttachmentDiagnostic()?.status).toBe('paired');
    } finally { f.clean(); }
  });
  it.each([1, -1] as const)('pummel drawings carry grip rows for the held and the hit captive (face %s)', facing => {
    const f = fixture(facing);
    try {
      f.capture(); f.steps(25); f.step({ attack: true });
      const reasons = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const pose = f.step(), r = f.dk.getCaptureAttachmentDiagnostic();
        if (pose.startsWith('pummel:')) reasons.add(r?.status === 'fallback' ? r.reason : r?.status ?? 'none');
      }
      // DK's grip is found on every pummel drawing; while Pikachu shows its hit reaction (captured_hit) the gap is
      // Pikachu's (no reviewed anchor for that drawing), never DK's.
      expect([...reasons].filter(r => r !== 'paired' && r !== 'missing-recipient-anchor')).toEqual([]);
      for (let i = 0; i < 40 && f.dk.getCaptureAttachmentDiagnostic()?.status !== 'paired'; i++) f.step();
      expect(f.dk.getCaptureAttachmentDiagnostic()?.status).toBe('paired');
      expect(relative(f, facing).x).toBeGreaterThan(70);
    } finally { f.clean(); }
  });
  it.each([1, -1] as const)('the carried captive rides overhead in DK raised hand, paired (face %s)', facing => {
    const f = fixture(facing);
    try {
      f.cargo();
      expect(f.dk.getCaptureAttachmentDiagnostic()?.status).toBe('paired');
      expect(relative(f, facing).y).toBeLessThan(-45);
      f.steps(20, { moveX: facing });
      expect(f.dk.getCaptureAttachmentDiagnostic()?.status).toBe('paired');
    } finally { f.clean(); }
  });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';
