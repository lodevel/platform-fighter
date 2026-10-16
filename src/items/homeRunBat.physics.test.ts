/**
 * Battering item input routing on the two qualified fighters (DK, Pikachu) in a real Matter world: the Home-Run Bat
 * (docs/review/2026-10-11/ultimate-items/phase-1/sources.json), the Beam Sword and the Star Rod (phase-3/sources.json).
 */
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Pikachu } from '../characters/Pikachu';
import type { Character, CharacterInput } from '../characters/Character';
import { HOME_RUN_BAT_DEFINITION, HOME_RUN_BAT_FSMASH, HOME_RUN_BAT_FSMASH_PIKACHU } from './HomeRunBat';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { STAR_ROD_DEFINITION } from './StarRod';
import type { ItemDefinition } from './ItemDefinition';
import { captureSimulationAnimation, resolveSimulationAction } from '../characters/simulationSpriteAnimation';
import { itemPhysicsFixture, NEUTRAL_INPUT, type ItemFixtureFighter } from './itemPhysicsFixture';

const neutral: CharacterInput = NEUTRAL_INPUT;
const uses = HOME_RUN_BAT_DEFINITION.uses!;
const fixture = (Fighter: ItemFixtureFighter, def: ItemDefinition = HOME_RUN_BAT_DEFINITION) => itemPhysicsFixture(Fighter, def);
const activeId = (a: Character) => a.getActiveAttack()?.move.id ?? null;

describe.each([['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const)('%s holding the Home-Run Bat', (_id, Fighter) => {
  it('neutral attack swings the bat jab', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, attack: true });
    expect(activeId(f.actor)).toBe(uses.jab!.id);
  });

  it('a forward tilt swings the bat forward tilt', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, moveX: 0.5, attack: true });
    expect(activeId(f.actor)).toBe(uses.ftilt!.id);
  });

  it('a dash attack swings the bat dash attack', () => {
    const f = fixture(Fighter);
    for (let n = 0; n < 20; n++) f.step({ ...neutral, moveX: 1 });
    f.step({ ...neutral, moveX: 1, attack: true });
    expect(activeId(f.actor)).toBe(uses.dashAttack!.id);
  });

  it('forward smash is the fixed 51-frame swing: no charge stance, first live hitbox on frame 51', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, attackHeavy: true });
    expect(activeId(f.actor)).toBe(uses.fsmash!.id);
    expect(f.actor.getAnimationActionState().chargingMove).toBeNull();
    let firstLive: number | null = null;
    for (let n = 0; n < 90 && firstLive === null; n++) {
      // Holding the button never charges the bat.
      f.step({ ...neutral, attackHeavy: true });
      expect(f.actor.getAnimationActionState().chargingMove).toBeNull();
      const a = f.actor.getActiveAttack();
      if (a?.hitboxBody) firstLive = a.framesElapsed;
    }
    expect(firstLive).toBe(50);
  });

  it.each([
    ['up tilt', { moveY: -0.5 }],
    ['down tilt', { moveY: 0.6 }],
  ] as const)('%s keeps the fighter\'s own move (SmashWiki silent beyond the four swipes)', (_n, stick) => {
    const f = fixture(Fighter);
    f.step({ ...neutral, ...stick });
    f.step({ ...neutral, ...stick, attack: true });
    const id = activeId(f.actor);
    expect(id).not.toBeNull();
    expect(id!.startsWith('item.')).toBe(false);
  });

  it('aerials keep the fighter\'s own aerials', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, jump: true });
    for (let n = 0; n < 12; n++) f.step();
    expect(f.actor.isGrounded()).toBe(false);
    f.step({ ...neutral, attack: true });
    const id = activeId(f.actor);
    expect(id).not.toBeNull();
    expect(id!.startsWith('item.')).toBe(false);
  });

  it('dropping the bat restores the native jab', () => {
    const f = fixture(Fighter);
    f.inventory.drop(1, f.actor.getPosition());
    f.step({ ...neutral, attack: true });
    expect(activeId(f.actor)!.startsWith('item.')).toBe(false);
  });

  it('a reflect during the forward smash wind-up swings at once', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, attackHeavy: true });
    for (let n = 0; n < 10; n++) f.step();
    expect(f.actor.getActiveAttack()!.framesElapsed).toBeLessThan(20);
    f.actor.noteProjectileReflected();
    f.step();
    const a = f.actor.getActiveAttack()!;
    expect(a.framesElapsed).toBe(uses.fsmash!.startupFrames);
    expect(a.hitboxBody).not.toBeNull();
  });

  // universal-rules.json attackInput.smashAttacksThrowItem: a smash attack input with an item is a smash throw.
  it.each([
    ['up', { moveY: -1 }, 'throw-ground-up-strong'],
    ['down', { moveY: 1 }, 'throw-ground-down-strong'],
  ] as const)('an %s smash input smash-throws the bat through the shared planner', (_d, stick, action) => {
    const f = fixture(Fighter);
    f.step({ ...neutral, ...stick, attackHeavy: true });
    expect(activeId(f.actor)).toBeNull();
    expect(f.actor.getItemActionState()?.plan.action).toBe(action);
    const events: string[] = [];
    for (let n = 0; n < 30; n++) { events.push(...f.actor.drainItemActionEvents().map(e => e.kind)); f.step(); }
    expect(events).toEqual(['release']);
  });

  // dropToss eligibility: an item throw cancels a jump squat (W is both up and jump on a keyboard).
  it('an up toss pressed with a tap jump stays a grounded up toss (the throw cancels the jump squat)', () => {
    const f = fixture(Fighter);
    // The match begins the toss before the fighter's input step of the same frame (MatchScene.prepareItemInput).
    expect(f.actor.beginItemAction('throw-ground-up-strong', 21)).toBe(true);
    f.step({ ...neutral, moveY: -1, jump: true });
    for (let n = 0; n < 8; n++) { f.step(); expect(f.actor.isGrounded(), `step ${n}`).toBe(true); }
    expect(f.actor.getItemActionState()?.plan.action).toBe('throw-ground-up-strong');
  });

  it('the forward smash swing reflects with the fighter\'s own native reflector box', () => {
    const f = fixture(Fighter);
    f.step({ ...neutral, attackHeavy: true });
    const expected = (Fighter === Pikachu ? HOME_RUN_BAT_FSMASH_PIKACHU : HOME_RUN_BAT_FSMASH).reflectWindow!.body;
    expect(f.actor.getActiveAttack()!.move.reflectWindow!.body).toEqual(expected);
  });
});

describe.each([['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const)('%s draws the held bat at the drawn hand socket', (_id, Fighter) => {
  it('every step of every bat swing and of the carry has a native socket row with an angle', () => {
    for (const press of [{ attack: true }, { attackHeavy: true }, { moveX: 0.5, attack: true }] as const) {
      const f = fixture(Fighter);
      const p = f.actor.getPosition(), standing = f.actor.getHeldItemSocket();
      expect(standing.angle, 'carry').not.toBeNull();
      expect(standing).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
      expect(Math.hypot(standing.x - p.x, standing.y - p.y)).toBeLessThan(80);
      f.step({ ...neutral, ...press });
      for (let n = 0; n < 40 && f.actor.getActiveAttack(); n++) {
        expect(f.actor.getHeldItemSocket().angle, `${JSON.stringify(press)} step ${n}`).not.toBeNull();
        f.step();
      }
    }
  });
});

describe('Pikachu item actions draw its sparse native item bodies', () => {
  it('a walking pickup keeps body, socket and receiving on the one sparse drawing for the whole action', () => {
    const f = fixture(Pikachu);
    f.inventory.drop(1, f.actor.getPosition());
    expect(f.actor.beginItemAction('pickup-walking', 100)).toBe(true);
    for (let n = 0; n < 20; n++) {
      const item = (f.actor as Pikachu).getPikachuItemPresentationState();
      if (f.actor.getItemActionState()) expect(item).toMatchObject({ sheet: 'item_pickup_walk', nativeSample: 2 });
      expect(() => f.actor.getActiveHurtboxes()).not.toThrow();
      f.step({ ...neutral, moveX: 0.5 });
    }
  });

  it('a smash throw shows the ordinary throw drawing (no strong strip) for the whole action', () => {
    const f = fixture(Pikachu);
    f.step({ ...neutral, moveY: -1, attackHeavy: true });
    const seen = new Set<string>();
    for (let n = 0; n < 20; n++) { seen.add((f.actor as Pikachu).getPikachuItemPresentationState()?.sheet ?? 'none'); f.step(); }
    expect([...seen]).toEqual(['item_throw_hi']);
  });
});


const sheetOf = (a: Character) => resolveSimulationAction(captureSimulationAnimation(a, 0, false)).sheets[0];

describe.each([['donkeykong', DonkeyKong], ['pikachu', Pikachu]] as const)('%s holding a Beam Sword or a Star Rod', (_id, Fighter) => {
  it.each([BEAM_SWORD_DEFINITION, STAR_ROD_DEFINITION])('$type: jab / forward tilt / dash attack play the shared native swing files', def => {
    const u = def.uses!;
    const cases: [CharacterInput[], string, string][] = [
      [[{ ...neutral, attack: true }], u.jab!.id, 'item_bat_swing_1'],
      [[{ ...neutral, moveX: 0.5, attack: true }], u.ftilt!.id, 'item_bat_swing_3'],
      [[...Array.from({ length: 20 }, () => ({ ...neutral, moveX: 1 })), { ...neutral, moveX: 1, attack: true }], u.dashAttack!.id, 'item_bat_swing_dash'],
    ];
    for (const [inputs, id, clip] of cases) {
      const f = fixture(Fighter, def);
      for (const input of inputs) f.step(input);
      expect(activeId(f.actor)).toBe(id);
      expect(sheetOf(f.actor)).toBe(clip);
      expect(f.actor.getHeldItemSocket().angle).not.toBeNull();
    }
  });

  it.each([BEAM_SWORD_DEFINITION, STAR_ROD_DEFINITION])('$type: forward smash charges on the swing\'s hold loop and fires charged', def => {
    const f = fixture(Fighter, def), held = { ...neutral, attackHeavy: true };
    f.step(held);
    expect(f.actor.getActiveAttack()).toBeNull();
    expect(sheetOf(f.actor)).toBe('item_sword_swing_4');
    for (let n = 0; n < 6 + 60; n++) f.step(held);
    expect(f.actor.getActiveAttack()).toBeNull();
    expect(sheetOf(f.actor)).toBe('item_sword_swing_4_hold');
    expect(f.actor.getHeldItemSocket().angle).not.toBeNull();
    f.step();
    const active = f.actor.getActiveAttack()!;
    expect(active.move.id).toBe(def.uses!.fsmash!.id);
    expect(active.chargeHeldFrames).toBe(60);
    expect(active.framesElapsed).toBe(6);
    expect(sheetOf(f.actor)).toBe('item_sword_swing_4');
  });

  it('the empty Star Rod keeps swinging every item swipe', () => {
    const f = fixture(Fighter, STAR_ROD_DEFINITION);
    while (f.bat.spendShot()) { /* empty the rod */ }
    expect(f.bat.getAmmo()).toBe(0);
    f.step({ ...neutral, moveX: 0.5, attack: true });
    expect(activeId(f.actor)).toBe(STAR_ROD_DEFINITION.uses!.ftilt!.id);
  });
});
