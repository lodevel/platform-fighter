/**
 * B4 (docs/review/2026-10-15/b4-diagnosis.md): Link with held items against Donkey Kong under identical input, in a
 * real Matter world (itemPhysicsFixture). Every item rule is shared (CLAUDE.md "Items"; Ultimate rules in
 * docs/review/2026-10-11/ultimate-items/), so each case asserts the shared contract on both fighters: per-fighter
 * differences are only the item planner's per-fighter data (FIGHTER_ITEM_PROFILES) and the drawn hand socket.
 * Sources: SmashWiki > UFD > native, as cited in each item's definition file.
 */
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from '../characters/DonkeyKong';
import { Link } from '../characters/Link';
import type { Character, CharacterInput } from '../characters/Character';
import { heavyItemPlan } from '../characters/donkeykongHeavyItems';
import { heldItemMuzzle } from '../characters/heldItemSocket';
import { itemPhysicsFixture, NEUTRAL_INPUT as neutral, type ItemFixtureFighter } from './itemPhysicsFixture';
import type { AttackMove } from '../characters/attacks';
import type { ItemDefinition } from './ItemDefinition';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
import { HAMMER_DEFINITION } from './Hammer';
import { RAY_GUN_DEFINITION } from './RayGun';
import { SUPER_SCOPE_DEFINITION } from './SuperScope';
import { FIRE_FLOWER_DEFINITION } from './FireFlower';
import { BOB_OMB_DEFINITION } from './BobOmb';
import { CRATE_DEFINITION } from './Crate';
import { fighterItemProfile, getItemActionPlan, itemReleaseVelocity, type ItemAction } from './itemActions';

const FIGHTERS = [['donkeykong', DonkeyKong], ['link', Link]] as const;
type Fixture = ReturnType<typeof itemPhysicsFixture>;
/** Forward = within 45° of horizontal in the facing direction (Phaser degrees, 0 = up, 90 = forward facing right). */
const pointsForward = (angle: number, facing: 1 | -1) => Math.abs(angle * facing - 90) < 45;
/** Step index (0-based, after the entry step) on which a native callback at `eventFrame` fires at motion `rate`. */
const callbackStep = (eventFrame: number, rate = 1) => Math.ceil((eventFrame - 1) / rate) - 1;

/** Drive a press, then step until the use's swing has ended; the victim stands `spacing` px in front. */
function swing(Fighter: ItemFixtureFighter, def: ItemDefinition, use: 'jab' | 'ftilt' | 'dashAttack' | 'fsmash', spacing: number) {
  const f = itemPhysicsFixture(Fighter, def, { victimAt: spacing });
  if (use === 'dashAttack') {
    for (let n = 0; n < 20; n++) f.step({ ...neutral, moveX: 1 });
    const p = f.actor.getPosition(), v = f.victim!.getPosition();
    f.victim!.setPosition(p.x + spacing, v.y);
    f.contacts.length = 0;
  }
  const press: CharacterInput = use === 'jab' ? { ...neutral, attack: true } : use === 'ftilt' ? { ...neutral, moveX: .5, attack: true }
    : use === 'dashAttack' ? { ...neutral, moveX: 1, attack: true } : { ...neutral, attackHeavy: true };
  f.step(press);
  const firstLive: number[] = [];
  for (let n = 0; n < 120; n++) {
    const a = f.actor.getActiveAttack();
    if (a?.hitboxBody && firstLive.length === 0) firstLive.push(a.framesElapsed);
    if (n > 5 && !a) break;
    f.step(use === 'dashAttack' ? { ...neutral, moveX: 1 } : neutral);
  }
  return { f, firstLive: firstLive[0] ?? null };
}

describe.each(FIGHTERS)('%s picks a light item up through the shared planner', (id, Fighter) => {
  it.each(['pickup-standing', 'pickup-walking'] as const)('%s: the pickup callback on the profile frame, drawn in hand throughout', action => {
    const f = itemPhysicsFixture(Fighter, BEAM_SWORD_DEFINITION);
    f.inventory.drop(1, f.actor.getPosition());
    expect(f.actor.beginItemAction(action, f.frame())).toBe(true);
    const plan = getItemActionPlan(action, fighterItemProfile(id));
    const events: number[] = [];
    for (let n = 0; n < plan.durationFrames + 2; n++) {
      if (f.actor.getItemActionState()) expect(f.actor.getHeldItemSocket().angle, `${action} step ${n}`).not.toBeNull();
      f.step(action === 'pickup-walking' ? { ...neutral, moveX: .4 } : neutral);
      for (const e of f.actor.drainItemActionEvents()) if (e.kind === 'pickup') events.push(n);
    }
    expect(events).toEqual([callbackStep(plan.sourceEventFrame, plan.nativeMotionRate)]);
  });
});

describe.each(FIGHTERS)('%s swings a battering item into a Donkey Kong', (_id, Fighter) => {
  // Spacing between body centres. 110 px is the link-playable-probe spacing; the Home-Run Bat's authored box
  // (offsetX 36, width 56: front edge 64 px) cannot reach a DK hurtbox at 110 px for any fighter, so the bat is
  // checked at 80 px (diagnosis §1).
  const cases = [
    [BEAM_SWORD_DEFINITION, 110], [HOME_RUN_BAT_DEFINITION, 80],
  ] as const;
  for (const [def, spacing] of cases) {
    it.each(['jab', 'ftilt', 'dashAttack', 'fsmash'] as const)(`${def.type} %s at ${spacing} px: one hit, cited damage and angle, first active frame`, use => {
      const move = def.uses![use] as AttackMove;
      const { f, firstLive } = swing(Fighter, def, use, spacing);
      expect(firstLive).toBe(move.startupFrames);
      expect(f.contacts.map(c => ({ moveId: c.moveId, frame: c.attackFrame, damage: c.damage, angle: c.angle }))).toEqual([
        { moveId: move.id, frame: move.startupFrames, damage: move.damage, angle: move.knockback.reference!.angle },
      ]);
    });
  }
});

describe.each(FIGHTERS)('%s draws a held battering item in the drawn hand along the blade axis', (_id, Fighter) => {
  it.each([BEAM_SWORD_DEFINITION, HOME_RUN_BAT_DEFINITION])('$type: every carry and swing step has a socket row near the body', def => {
    for (const press of [{ attack: true }, { moveX: .5, attack: true }, { attackHeavy: true }] as const) {
      const f = itemPhysicsFixture(Fighter, def);
      const carry = f.actor.getHeldItemSocket();
      expect(carry.angle, 'carry').not.toBeNull();
      f.step({ ...neutral, ...press });
      for (let n = 0; n < 90 && f.actor.getActiveAttack(); n++) {
        const s = f.actor.getHeldItemSocket(), p = f.actor.getPosition();
        expect(s.angle, `${JSON.stringify(press)} step ${n}`).not.toBeNull();
        expect(Math.hypot(s.x - p.x, s.y - p.y)).toBeLessThan(110);
        f.step();
      }
    }
  });

  it.each([1, -1] as const)('Beam Sword forward smash: blade forward on the first live hitbox frame (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, BEAM_SWORD_DEFINITION);
    f.actor.setFacing(facing);
    f.step({ ...neutral, attackHeavy: true });
    f.step();
    for (let n = 0; n < 40 && !f.actor.getActiveAttack()?.hitboxBody; n++) f.step();
    expect(f.actor.getActiveAttack()?.hitboxBody).toBeTruthy();
    const angle = f.actor.getHeldItemSocket().angle!;
    expect(pointsForward(angle, facing), `angle ${angle}`).toBe(true);
  });
});

describe.each(FIGHTERS)('%s swings a Hammer from the drawn hand', (_id, Fighter) => {
  it('over one 16-frame swing the head passes in front of the body at hurtbox height', () => {
    const f = itemPhysicsFixture(Fighter, HAMMER_DEFINITION);
    f.bat.startHammer(.5);
    let front = false;
    for (let n = 0; n < 16; n++) {
      f.step();
      const p = f.actor.getPosition();
      for (const a of f.actor.getHammerDamageAreas(HAMMER_DEFINITION.hammer!)) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
        if (a.x - p.x > 30 && Math.abs(a.y - p.y) < 60) front = true;
      }
    }
    expect(front).toBe(true);
  });
});

/** The drawn muzzle (heldItemMuzzle: the renderer's sprite length along the socket axis). */
const muzzle = (a: Character, def: ItemDefinition) => heldItemMuzzle(a.getHeldItemSocket(), def.visual!)!;
function shotSteps(Fighter: ItemFixtureFighter, def: ItemDefinition, presses: (n: number) => CharacterInput, steps: number) {
  const f = itemPhysicsFixture(Fighter, def);
  const out: { step: number; id: string; damage: number }[] = [];
  for (let n = 0; n < steps; n++) {
    f.step(presses(n));
    for (const s of f.actor.consumeItemShots()) out.push({ step: n, id: s.shot.id, damage: s.shot.damage });
  }
  return { out, ammo: f.bat.getAmmo() };
}

describe('Link fires shooting items exactly like Donkey Kong (one shared shooting session)', () => {
  const schedules: [string, ItemDefinition, (n: number) => CharacterInput, number][] = [
    ['Ray Gun, a press every 25 frames', RAY_GUN_DEFINITION, n => ({ ...neutral, attack: n % 25 === 0 }), 80],
    ['Ray Gun, presses 12 frames apart (inside the 24-frame session)', RAY_GUN_DEFINITION, n => ({ ...neutral, attack: n % 12 === 0 }), 80],
    ['Super Scope tap', SUPER_SCOPE_DEFINITION, n => ({ ...neutral, attack: n === 0 }), 80],
    ['Super Scope full hold', SUPER_SCOPE_DEFINITION, n => ({ ...neutral, attack: n < 120 }), 180],
    ['Fire Flower held while walking', FIRE_FLOWER_DEFINITION, n => ({ ...neutral, attack: n < 40, moveX: n ? 1 : 0 }), 60],
  ];
  it.each(schedules)('%s', (_n, def, presses, steps) => {
    const dk = shotSteps(DonkeyKong, def, presses, steps), link = shotSteps(Link, def, presses, steps);
    expect(dk.out.length).toBeGreaterThan(0);
    expect(link).toEqual(dk);
  });
});

describe.each(FIGHTERS)('%s shoots from the drawn item', (_id, Fighter) => {
  it.each([1, -1] as const)('Ray Gun: barrel forward when the shot leaves (facing %i)', facing => {
    const f = itemPhysicsFixture(Fighter, RAY_GUN_DEFINITION);
    f.actor.setFacing(facing);
    f.step({ ...neutral, attack: true });
    for (let n = 0; n < 8; n++) f.step();
    expect(f.actor.consumeItemShots()).toHaveLength(1);
    const angle = f.actor.getHeldItemSocket().angle!;
    expect(pointsForward(angle, facing), `angle ${angle}`).toBe(true);
  });

  // Target of the shared shot-origin fix (diagnosis §4): Character.queueItemShot places shots at a fixed body offset
  // (ItemShot.spawnOffsetX/Y) for every fighter, not at the drawn item. Expected red on both fighters until then.
  it.each([RAY_GUN_DEFINITION, SUPER_SCOPE_DEFINITION, FIRE_FLOWER_DEFINITION])('$type: the shot leaves the drawn muzzle', def => {
    const f = itemPhysicsFixture(Fighter, def);
    let checked = 0;
    for (let n = 0; n < 60 && checked === 0; n++) {
      f.step({ ...neutral, attack: def === SUPER_SCOPE_DEFINITION ? n === 0 : n < 30 });
      const m = muzzle(f.actor, def);
      for (const s of f.actor.consumeItemShots()) {
        expect(Math.hypot(s.x - m.x, s.y - m.y), `${def.type} shot (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) muzzle (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`).toBeLessThan(8);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe.each(FIGHTERS)('%s throws a light item (Bob-omb) through the shared planner', (id, Fighter) => {
  const profile = fighterItemProfile(id);
  const grounded: ItemAction[] = ['throw-ground-forward-ordinary', 'throw-ground-back-ordinary', 'throw-ground-up-ordinary',
    'throw-ground-down-ordinary', 'throw-ground-forward-strong', 'throw-ground-back-strong', 'throw-ground-up-strong',
    'throw-ground-down-strong', 'ground-drop', 'dash-throw'];
  it.each(grounded)('%s: release on the profile frame from the drawn hand, along the throw profile', action => {
    const f = itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION);
    expect(f.actor.beginItemAction(action, f.frame(), 1)).toBe(true);
    const plan = getItemActionPlan(action, profile);
    const releases: number[] = [];
    for (let n = 0; n < plan.durationFrames + 2; n++) {
      const socket = f.actor.getHeldItemSocket();
      f.step();
      for (const e of f.actor.drainItemActionEvents()) if (e.kind === 'release') {
        releases.push(n);
        expect(socket.angle, 'release drawn in hand').not.toBeNull();
      }
    }
    expect(releases).toEqual([callbackStep(plan.sourceEventFrame, plan.nativeMotionRate)]);
    const v = itemReleaseVelocity(plan, 1, profile);
    if (action.includes('-forward-') || action === 'dash-throw') expect(v.x).toBeGreaterThan(0);
    if (action.includes('-back-')) expect(v.x).toBeLessThan(0);
    if (action.includes('-up-')) expect(v.y).toBeLessThan(0);
    if (action.includes('-down-')) expect(v.y).toBeGreaterThan(0);
    if (action.endsWith('-strong')) expect(Math.hypot(v.x, v.y))
      .toBeGreaterThan(Math.hypot(itemReleaseVelocity(getItemActionPlan(action.replace('strong', 'ordinary') as ItemAction, profile), 1, profile).x,
        itemReleaseVelocity(getItemActionPlan(action.replace('strong', 'ordinary') as ItemAction, profile), 1, profile).y));
  });

  it('an air Z-drop releases on its entry, with no motion', () => {
    const f = itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION);
    f.step({ ...neutral, jump: true });
    for (let n = 0; n < 12; n++) f.step();
    expect(f.actor.isGrounded()).toBe(false);
    expect(f.actor.beginItemAction('air-z-drop', f.frame())).toBe(true);
    expect(f.actor.drainItemActionEvents().map(e => e.kind)).toEqual(['release']);
  });
});

describe.each(FIGHTERS)('%s lifts and throws a heavy item (Crate)', (id, Fighter) => {
  it.each(['pickup', 'throw-forward-ordinary', 'throw-back-ordinary', 'throw-up-strong', 'throw-down-ordinary'] as const)('%s: one callback on the plan frame', action => {
    const f = itemPhysicsFixture(Fighter, CRATE_DEFINITION);
    if (action === 'pickup') f.inventory.drop(1, f.actor.getPosition()); else f.actor.syncDonkeyKongHeavyItem(true);
    expect(f.actor.beginDonkeyKongHeavyItemAction(action, f.frame())).toBe(true);
    const plan = heavyItemPlan(id, action);
    const events: number[] = [];
    for (let n = 0; n < plan.durationFrames + 2; n++) {
      f.step();
      for (const e of f.actor.drainDonkeyKongHeavyItemActionEvents()) if (e.kind !== 'reverse-facing') events.push(n);
    }
    expect(events).toEqual([callbackStep(plan.sourceEventFrame, plan.selectedMotionRate)]);
  });
});

describe.each(FIGHTERS)('%s offers the shared item catch windows', (_id, Fighter) => {
  const contextAfter = (f: Fixture, inputs: CharacterInput[]) => { for (const i of inputs) f.step(i); return f.actor.getItemCatchContext(); };
  const empty = (f: Fixture) => { f.inventory.drop(1, f.actor.getPosition()); return f; };
  it('dash attack, tilt, aerial and air dodge report their catch context from the first frame', () => {
    const dash = empty(itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION));
    expect(contextAfter(dash, [...Array.from({ length: 20 }, () => ({ ...neutral, moveX: 1 })), { ...neutral, moveX: 1, attack: true }]))
      .toMatchObject({ context: 'dash-attack', age: 0, externallyBlocked: false });
    const tilt = empty(itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION));
    expect(contextAfter(tilt, [{ ...neutral, moveX: .5, attack: true }])).toMatchObject({ context: 'tilt', age: 0, externallyBlocked: false });
    const air = empty(itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION));
    expect(contextAfter(air, [{ ...neutral, jump: true }, ...Array.from({ length: 12 }, () => neutral)]))
      .toMatchObject({ context: 'air-stationary', externallyBlocked: false });
    expect(contextAfter(air, [{ ...neutral, attack: true }])).toMatchObject({ context: 'aerial', age: 0 });
    const dodge = empty(itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION));
    expect(contextAfter(dodge, [{ ...neutral, jump: true }, ...Array.from({ length: 12 }, () => neutral), { ...neutral, shield: true }]))
      .toMatchObject({ context: 'air-dodge', age: 0 });
  });

  it('holding an item reports no catch context', () => {
    expect(itemPhysicsFixture(Fighter, BOB_OMB_DEFINITION).actor.getItemCatchContext()).toBeNull();
  });
});
