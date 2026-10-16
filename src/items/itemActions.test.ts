import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beginItemAction, getItemActionPlan, selectGroundPickup,
  selectItemThrow, selectHeldItemPress, tickItemAction,
  advanceItemFlick, itemFlickStrength, EMPTY_ITEM_FLICK,
  eligibleItemThrowContext, itemReleaseVelocity,
  FIGHTER_ITEM_PROFILES, resolveItemThrowDirection, itemActionSheet,
  type ItemAction } from './itemActions';

const DK = FIGHTER_ITEM_PROFILES.donkeykong!;
const PIKACHU = FIGHTER_ITEM_PROFILES.pikachu!;
const throws: ItemAction[] = [];
for (const situation of ['ground', 'air'] as const) for (const direction of ['forward', 'back', 'up', 'down'] as const)
  for (const strength of ['ordinary', 'strong'] as const) throws.push(`throw-${situation}-${direction}-${strength}`);
const actions: ItemAction[] = ['pickup-standing', 'pickup-walking', ...throws, 'dash-throw', 'ground-drop', 'air-z-drop'];
const nativeParam = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
const fighterScalar = (kind: string, name: string) => {
  const entry = nativeParam.struct.list.struct.find((row: { hash40: { '@hash': string; '#text': string }[] }) =>
    row.hash40.some(field => field['@hash'] === 'fighter_kind' && field['#text'] === kind));
  return Number(entry.float.find((row: { '@hash': string }) => row['@hash'] === name)['#text']);
};
/** Release / reverse callback frames and motion rate of each plan, read from the fighter's native item scripts. */
function scriptEvents(raw: string) {
  const game = raw.split('unsafe extern "C" fn')[1]!;
  let frame = 0, eventFrame = 0, reverseFrame = 0;
  for (const line of game.split('\n')) {
    const clock = /frame\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
    if (clock) frame = Number(clock[1]);
    if (/(?:pickup_item|THROW_ITEM_OFFSET|THROW_ITEM_arg3)/.test(line)) eventFrame = frame;
    if (line.includes('REVERSE_LR(')) reverseFrame = frame;
  }
  const rate = /FT_MOTION_RATE\(agent, ([\d.]+)\)/.exec(game);
  return { eventFrame, reverseFrame, rate: rate ? Number(rate[1]) : 1 };
}

describe('shared item planner: per-fighter native declarations and the Ultimate common rules', () => {
  it('copies all18 throw vectors/powers from the parsed research table, identical for every fighter', () => {
    const source = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources/items/analyzed-throw-values.json', 'utf8'));
    for (const profile of [DK, PIKACHU]) for (const action of [...throws, 'dash-throw', 'ground-drop'] as ItemAction[]) {
      const plan = getItemActionPlan(action, profile);
      const row = source.values.find((r: { motion: string }) => r.motion === plan.motion);
      expect(row, action).toBeDefined();
      expect(plan.throwParameters, action).toEqual({ speedNative: row.speed, angleDegrees: row.angle, power: row.power });
    }
  });
  it('takes toss strength and item range from the native fighter param export (SmashWiki 1+(w-100)/300)', () => {
    for (const [kind, profile, weight] of [['fighter_kind_donkey', DK, 127], ['fighter_kind_pikachu', PIKACHU, 79]] as const) {
      expect(profile.tossSpeedMultiplier).toBe(fighterScalar(kind, 'throw_item_speed_mul'));
      expect(profile.tossSpeedMultiplier).toBeCloseTo(1 + (weight - 100) / 300, 2);
      expect(profile.tossPowerMultiplier).toBe(fighterScalar(kind, 'throw_item_power_mul'));
      for (const [situation, range] of Object.entries(profile.catchRange)) {
        const prefix = situation === 'air' ? 'item_range_air_' : 'item_range_';
        for (const [field, value] of Object.entries(range)) {
          const suffix = field === 'height' ? 'h' : field === 'offsetY' ? 'offset_y' : field === 'frontMax' ? 'front_max' : field;
          expect(value, `${kind}.${situation}.${field}`).toBe(fighterScalar(kind, prefix + suffix));
        }
      }
    }
  });
  it('pins DK and Pikachu callback frames to their native item scripts (= SmashWiki Item_throw release frames)', () => {
    const dkPins = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources/items/verified.json', 'utf8')) as { script: string; path: string; sha256: string }[];
    for (const [profile, read] of [
      [DK, (script: string) => { const pin = dkPins.find(row => row.script === script)!; const raw = readFileSync(pin.path, 'utf8');
        expect(createHash('sha256').update(raw).digest('hex')).toBe(pin.sha256); return raw; }],
      [PIKACHU, (script: string) => readFileSync(`docs/review/2026-10-06/pikachu-character/sources/scripts/pikachu/${script}.txt`, 'utf8')],
    ] as const) for (const action of actions) {
      const plan = getItemActionPlan(action, profile);
      if (action === 'air-z-drop') { expect(plan.nativeScript).toBeNull(); continue; }
      const events = scriptEvents(read(plan.nativeScript!));
      expect(plan.sourceEventFrame, action).toBe(events.eventFrame);
      expect(plan.sourceReverseFrame ?? 0, action).toBe(events.reverseFrame);
      expect(plan.nativeMotionRate, action).toBe(events.rate);
    }
    // SmashWiki Item_throw (Ultimate carries the grounded release frames over): DK 10/14/15/8/6/7, Pikachu 12/14/15/8/5/7.
    expect(DK.events).toMatchObject({ forward: 10, back: 14, up: 15, down: 8, dash: 6, drop: 7 });
    expect(PIKACHU.events).toMatchObject({ forward: 12, back: 14, up: 15, down: 8, dash: 5, drop: 7 });
  });
  it('uses the Ultimate totals for every fighter: 24/24/23/19, drop 23, dash 29', () => {
    for (const profile of [DK, PIKACHU]) {
      const total = (a: ItemAction) => getItemActionPlan(a, profile).durationFrames;
      for (const s of ['ground', 'air'] as const) for (const st of ['ordinary', 'strong'] as const) {
        expect(total(`throw-${s}-forward-${st}`)).toBe(24); expect(total(`throw-${s}-back-${st}`)).toBe(24);
        expect(total(`throw-${s}-up-${st}`)).toBe(23); expect(total(`throw-${s}-down-${st}`)).toBe(19);
      }
      expect(total('ground-drop')).toBe(23); expect(total('dash-throw')).toBe(29);
      expect(total('pickup-standing')).toBe(7); expect(total('pickup-walking')).toBe(19);
    }
  });
  it('resolves one throw direction from the stick and entry facing', () => {
    expect(resolveItemThrowDirection(0, 0, 1)).toBe('drop');
    expect(resolveItemThrowDirection(.4, .4, 1)).toBe('drop');
    expect(resolveItemThrowDirection(1, 0, 1)).toBe('forward');
    expect(resolveItemThrowDirection(1, 0, -1)).toBe('back');
    expect(resolveItemThrowDirection(-1, 0, -1)).toBe('forward');
    expect(resolveItemThrowDirection(.5, -.9, 1)).toBe('up');
    expect(resolveItemThrowDirection(-.5, .9, 1)).toBe('down');
    expect(resolveItemThrowDirection(.7, .7, -1)).toBe('back');
  });
  it('maps each action to its body sheet', () => {
    expect(itemActionSheet(getItemActionPlan('pickup-standing', DK))).toBe('item_pickup_stand');
    expect(itemActionSheet(getItemActionPlan('pickup-walking', PIKACHU))).toBe('item_pickup_walk');
    expect(itemActionSheet(getItemActionPlan('throw-air-back-strong', DK))).toBe('item_throw_air_b4');
    expect(itemActionSheet(getItemActionPlan('dash-throw', PIKACHU))).toBe('item_throw_dash');
  });

  it('selects all16 ground/air ordinary/strong branches, dash and distinct droppable-ground/aerial-neutral policies', () => {
    for (const situation of ['ground', 'air'] as const) for (const direction of ['forward', 'back', 'up', 'down'] as const)
      for (const strength of ['ordinary', 'strong'] as const) expect(selectItemThrow({ airborne: situation === 'air', direction, strength }))
        .toBe(`throw-${situation}-${direction}-${strength}`);
    expect(selectItemThrow({ airborne: false, direction: 'forward', strength: 'ordinary', dashing: true })).toBe('dash-throw');
    expect(selectItemThrow({ airborne: false, direction: 'forward', strength: 'strong', dashing: true })).toBe('throw-ground-forward-strong');
    expect(selectItemThrow({ airborne: false, direction: 'drop', strength: 'ordinary', groundDropAllowed: true })).toBe('ground-drop');
    expect(selectItemThrow({ airborne: false, direction: 'drop', strength: 'ordinary', groundDropAllowed: false })).toBe('throw-ground-forward-ordinary');
    expect(selectItemThrow({ airborne: true, direction: 'drop', strength: 'ordinary' })).toBe('air-z-drop');
  });

  it('emits ordinary/strong release once on source age, with source back reversal preceding it for both facings', () => {
    for (const profile of [DK, PIKACHU]) for (const action of throws) for (const facing of [-1, 1] as const) {
      let state = beginItemAction(action, facing, profile).state!;
      const plan = state.plan, events: { age: number; kind: string; facing: number }[] = [];
      for (let age = 1; age < plan.durationFrames; age++) {
        const step = tickItemAction(state); state = step.state!;
        events.push(...step.events.map(event => ({ age, ...event })));
      }
      const backwards = action.includes('-back-');
      expect(events.filter(e => e.kind === 'release'), action).toEqual([{ age: plan.sourceEventFrame - 1,
        kind: 'release', facing: backwards ? -facing : facing }]);
      expect(events.filter(e => e.kind === 'reverse-facing'), action).toEqual(backwards
        ? [{ age: profile.backReverseFrame - 1, kind: 'reverse-facing', facing: -facing }] : []);
      expect(tickItemAction(state).state).toBeNull();
    }
  });

  it('keeps dash rate conversion separate from callback frame and common total', () => {
    let state = beginItemAction('dash-throw', 1, DK).state!;
    for (let age = 1; age <= 6; age++) {
      const step = tickItemAction(state); state = step.state!;
      expect(step.events.some(e => e.kind === 'release'), `age${age}`).toBe(age === 6);
      expect(state.nativeFrame).toBeCloseTo(1 + .92 * age, 8);
    }
    expect(state.plan.durationFrames).toBe(29);
  });

  it('delays source pickup to second sample, preserves freeze, and interruption never emits pickup/release', () => {
    for (const action of ['pickup-standing', 'pickup-walking'] as const) {
      const start = beginItemAction(action, -1, DK);
      expect(start.events).toEqual([]);
      expect(tickItemAction(start.state!, { frozen: true })).toEqual({ state: start.state, events: [] });
      expect(tickItemAction(start.state!, { interrupted: true })).toEqual({ state: null, events: [] });
      expect(tickItemAction(start.state!).events).toEqual([{ kind: 'pickup', facing: -1 }]);
    }
    const throwing = beginItemAction('throw-ground-forward-ordinary', 1, DK).state!;
    expect(tickItemAction(throwing, { interrupted: true })).toEqual({ state: null, events: [] });
  });

  it('aerial neutral releases immediately without entering a throw commitment or consuming jump/dodge resources', () => {
    expect(beginItemAction('air-z-drop', -1, DK)).toEqual({ state: null, events: [{ kind: 'release', facing: -1 }] });
    const ground = beginItemAction('ground-drop', 1, DK);
    expect(ground.state?.plan.durationFrames).toBe(23);
    expect(ground.events).toEqual([]);
  });

  it('uses source6/8 flick-age windows with explicit stick hysteresis and never refreshes a held full stick', () => {
    let state = advanceItemFlick(EMPTY_ITEM_FLICK, { moveX: 1, moveY: 0 });
    expect(itemFlickStrength(state, false, 'forward', 1)).toBe('strong');
    for (let age = 1; age <= 8; age++) {
      state = advanceItemFlick(state, { moveX: 1, moveY: 0 });
      expect(state.flickAge).toBe(age);
      expect(itemFlickStrength(state, false, 'forward', 1)).toBe(age < 6 ? 'strong' : 'ordinary');
      expect(itemFlickStrength(state, true, 'forward', 1)).toBe(age < 8 ? 'strong' : 'ordinary');
    }
    expect(itemFlickStrength(state, true, 'back', 1)).toBe('ordinary');
    state = advanceItemFlick(state, { moveX: 0, moveY: 0 });
    state = advanceItemFlick(state, { moveX: -1, moveY: 0 });
    expect(state.flickAge).toBe(0);
    expect(itemFlickStrength(state, false, 'back', 1)).toBe('strong');
    expect(itemFlickStrength(state, false, 'forward', -1)).toBe('strong');
    expect(advanceItemFlick(state, { moveX: -1, moveY: 0, frozen: true })).toEqual(state);
  });

  it('admits source shield/jumpsquat/roll first3 and neutral-air-dodge Zdrop first3 without allowing spot/directional dodge or externally blocked recipients', () => {
    const base = { airborne: false, normalActionable: false, direction: 'forward' as const };
    expect(eligibleItemThrowContext({ ...base, shielding: true })).toBe('shield-cancel');
    expect(eligibleItemThrowContext({ ...base, jumpSquatActive: true })).toBe('jump-cancel');
    for (const dodgeKind of ['roll', 'back-roll'] as const) for (let age = 0; age <= 3; age++)
      expect(eligibleItemThrowContext({ ...base, dodgeKind, dodgeAge: age })).toBe(age < 3 ? 'roll-cancel' : null);
    expect(eligibleItemThrowContext({ ...base, dodgeKind: 'spot', dodgeAge: 1 })).toBeNull();
    expect(eligibleItemThrowContext({ ...base, airborne: true, direction: 'drop', dodgeKind: 'air-neutral', dodgeAge: 2 })).toBe('air-z-drop-cancel');
    expect(eligibleItemThrowContext({ ...base, airborne: true, dodgeKind: 'air-neutral', dodgeAge: 2 })).toBeNull();
    expect(eligibleItemThrowContext({ ...base, airborne: true, direction: 'drop', dodgeKind: 'air-directional', dodgeAge: 1 })).toBeNull();
    expect(eligibleItemThrowContext({ ...base, shielding: true, externallyBlocked: true })).toBeNull();
  });

  it('uses per-variant initial native speed×DK1.09, actual ground/air angles and entry-facing back direction, item factors applied separately (nativeItemReleaseVelocity)', () => {
    const ordinary = itemReleaseVelocity(getItemActionPlan('throw-ground-forward-ordinary', DK), 1, DK);
    const strong = itemReleaseVelocity(getItemActionPlan('throw-ground-forward-strong', DK), 1, DK);
    expect(Math.hypot(ordinary.x, ordinary.y)).toBeCloseTo(2.6 * 1.09 * 5, 8);
    expect(Math.hypot(strong.x, strong.y)).toBeCloseTo(3.64 * 1.09 * 5, 8);
    expect(Math.atan2(-ordinary.y, ordinary.x) * 180 / Math.PI).toBeCloseTo(17, 8);
    const air = itemReleaseVelocity(getItemActionPlan('throw-air-forward-ordinary', DK), 1, DK);
    expect(Math.atan2(-air.y, air.x) * 180 / Math.PI).toBeCloseTo(14, 8);
    const back = itemReleaseVelocity(getItemActionPlan('throw-ground-back-ordinary', DK), 1, DK);
    expect(back.x).toBeCloseTo(-ordinary.x, 8); expect(back.y).toBeCloseTo(ordinary.y, 8);
    expect(itemReleaseVelocity(getItemActionPlan('air-z-drop', DK), 1, DK)).toEqual({ x: 0, y: 0, power: 1 });
    expect(itemReleaseVelocity(getItemActionPlan('ground-drop', DK), 1, DK).power).toBe(.5);
    const pikachu = itemReleaseVelocity(getItemActionPlan('throw-ground-forward-ordinary', PIKACHU), 1, PIKACHU);
    expect(Math.hypot(pikachu.x, pikachu.y)).toBeCloseTo(2.6 * .93 * 5, 8);
  });
});

// SmashWiki Item (https://www.ssbwiki.com/Item): "Characters can pick up items by standing near one and pressing the
// attack button ... Brawl onward further ease item grabbing by allowing it during the start of air dodges, dash attacks,
// and aerial attacks, with a window of 5 frames for each, causing the user to obtain the item while proceeding with their
// action." Attack from a dash or run is the dash attack, which takes the item through its catch window.
describe('ground pickup selection by locomotion', () => {
  it('stands or walks into the pickup, but leaves a dash/run attack to the dash-attack catch window', () => {
    expect(selectGroundPickup({ moveX: 0, locomotion: 'standing' })).toBe('pickup-standing');
    expect(selectGroundPickup({ moveX: 0.5, locomotion: 'walk' })).toBe('pickup-walking');
    expect(selectGroundPickup({ moveX: 1, locomotion: 'initialDash' })).toBeNull();
    expect(selectGroundPickup({ moveX: 1, locomotion: 'run' })).toBeNull();
  });
});

describe('held-item presses (universal-rules.json attackInput.throwingItemAttackButton)', () => {
  const press = (over: Partial<Parameters<typeof selectHeldItemPress>[0]>) => selectHeldItemPress({
    releasePress: false, attackPress: false, smashPress: false, itemClass: 'throwing', airborne: false, dashing: false,
    moveX: 0, moveY: 0, entryFacing: 1, flick: EMPTY_ITEM_FLICK, ...over });
  it('the attack button throws a throwing item: neutral = forward, stick = that direction, dash = dash throw', () => {
    expect(press({ attackPress: true })).toBe('throw-ground-forward-ordinary');
    expect(press({ attackPress: true, moveY: -1 })).toBe('throw-ground-up-ordinary');
    expect(press({ attackPress: true, moveY: 1 })).toBe('throw-ground-down-ordinary');
    expect(press({ attackPress: true, moveX: -1 })).toBe('throw-ground-back-ordinary');
    expect(press({ attackPress: true, moveX: 1, dashing: true })).toBe('dash-throw');
    expect(press({ attackPress: true, airborne: true })).toBe('throw-air-forward-ordinary');
    expect(press({ attackPress: true, airborne: true, moveY: 1 })).toBe('throw-air-down-ordinary');
  });
  it('the smash button is a smash throw; a fresh flick with attack too', () => {
    expect(press({ smashPress: true, moveY: 1 })).toBe('throw-ground-down-strong');
    expect(press({ smashPress: true, airborne: true })).toBe('throw-air-forward-strong');
    const flick = advanceItemFlick(EMPTY_ITEM_FLICK, { moveX: 1, moveY: 0 });
    expect(press({ attackPress: true, moveX: 1, flick })).toBe('throw-ground-forward-strong');
  });
  it('other items: the attack button is not a throw (their uses / native moves run); grab releases every item', () => {
    for (const itemClass of ['battering', 'shooting', 'container'] as const) expect(press({ itemClass, attackPress: true })).toBeNull();
    expect(press({ itemClass: 'battering', releasePress: true })).toBe('ground-drop');
    expect(press({ releasePress: true })).toBe('throw-ground-forward-ordinary');
    expect(press({ releasePress: true, airborne: true })).toBe('air-z-drop');
    expect(press({})).toBeNull();
  });
});
