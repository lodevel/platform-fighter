import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beginDonkeyKongHeavyCarry, tickDonkeyKongHeavyCarry, DONKEYKONG_HEAVY_STATUS_RULES,
  resolveDonkeyKongHeavyCarryDamage, donkeyKongHeavyCarryMayGrabLedge,
  type DonkeyKongHeavyCarryState, type DonkeyKongHeavyCarryObservation } from './donkeykongHeavyCarry';

const base = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics';
const ground: DonkeyKongHeavyCarryObservation = { grounded: true, holdingHeavy: true };
const air: DonkeyKongHeavyCarryObservation = { grounded: false, holdingHeavy: true };
function step(state: DonkeyKongHeavyCarryState, input: Partial<DonkeyKongHeavyCarryObservation> = {}) {
  return tickDonkeyKongHeavyCarry(state, { ...ground, ...input });
}

describe('DK native heavy carry status controller', () => {
  it('pins captured status/private functions and native parameter cell pointers independently', () => {
    const pins = JSON.parse(readFileSync(`${base}/sources/heavy-status/verified.json`, 'utf8'));
    for (const pin of pins.files as { path: string; sha256: string }[])
      expect(createHash('sha256').update(readFileSync(pin.path)).digest('hex')).toBe(pin.sha256);
    const source = JSON.parse(readFileSync(`${base}/common-item-workbook-extraction.json`, 'utf8'));
    const field = (name: string) => {
      const record = [...source.common, ...source.reaction_thresholds].find((r: {
        researcher_name: string; name_crc_matches_hash: boolean; value: number;
      }) => r.researcher_name === name);
      if (!record) throw new Error(`Missing workbook field ${name}`);
      expect(record.name_crc_matches_hash).toBe(true); return record.value;
    };
    expect(DONKEYKONG_HEAVY_STATUS_RULES.walkStick).toBe(field('walk_stick_x'));
    expect(DONKEYKONG_HEAVY_STATUS_RULES.turnStick).toBe(field('turn_stick_x'));
    expect(DONKEYKONG_HEAVY_STATUS_RULES.turnTimer).toBe(field('turn_frame'));
    expect(DONKEYKONG_HEAVY_STATUS_RULES.passStickY).toBe(field('pass_stick_y'));
    expect(DONKEYKONG_HEAVY_STATUS_RULES.passFlickFrames).toBe(field('pass_flick_y'));
    expect(DONKEYKONG_HEAVY_STATUS_RULES.reactionFlyThresholdFrames).toBe(field('damage_level3'));
    expect(readFileSync(`${base}/sources/heavy-status/SuperLiftWait/main_loop.c`, 'utf8')).toContain('0xcf44ba9e5');
    expect(readFileSync(`${base}/sources/heavy-status/SuperLiftJump/pre.c`, 'utf8')).toContain('SITUATION_KIND_AIR');
    expect(readFileSync(`${base}/sources/heavy-status/functions/FUN_7100025d70.c`, 'utf8')).toContain('MotionModule__is_end_impl');
  });

  it('uses DK common walk.18 and reverse−.2 rather than generic heavy item thresholds', () => {
    for (const facing of [-1, 1] as const) {
      const start = beginDonkeyKongHeavyCarry(true, facing);
      expect(step(start, { nativeStickX: .179 * facing }).state?.phase).toBe('wait');
      const walking = step(start, { nativeStickX: .18 * facing }).state!;
      expect(walking.phase).toBe('walk');
      expect(step(walking, { nativeStickX: .18 * facing }).state?.phase).toBe('walk');
      expect(step(walking, { nativeStickX: .179 * facing }).state?.phase).toBe('wait');
      expect(step(start, { nativeStickX: -.199 * facing }).state?.phase).toBe('wait');
      expect(step(start, { nativeStickX: -.2 * facing }).state?.phase).toBe('turn');
    }
  });

  it('reverses once on the third unfrozen turn callback and enables turn attack only afterwards', () => {
    for (const facing of [-1, 1] as const) {
      let state = step(beginDonkeyKongHeavyCarry(true, facing), { nativeStickX: -facing }).state!;
      expect(state.age).toBe(0); expect(state.facing).toBe(facing);
      for (let age = 1; age <= 12; age++) {
        expect(step(state, { frozen: true })).toEqual({ state, events: [] });
        const next = step(state); state = next.state!;
        expect(next.events).toEqual(age === 3 ? [{ kind: 'reverse-facing', facing: -facing }] : []);
        expect(state.facing).toBe(age < 3 ? facing : -facing);
        expect(state.phase).toBe(age < 12 ? 'turn' : 'wait');
      }
      const turning = step(beginDonkeyKongHeavyCarry(true, facing), { nativeStickX: -facing }).state!;
      expect(step(turning, { freshAttack: true }).events).toEqual([]);
      const preFlip = step(step(turning).state!).state!;
      expect(step(preFlip, { freshAttack: true }).events).toEqual([
        { kind: 'reverse-facing', facing: -facing }, { kind: 'throw', facing: -facing }]);
    }
  });

  it('commits six squat samples before ground jump, reserves mini on release and never creates air jump', () => {
    let state = step(beginDonkeyKongHeavyCarry(true, 1), { freshJump: true, jumpHeld: true }).state!;
    expect(state.phase).toBe('jump-squat');
    for (let age = 1; age <= 6; age++) {
      const next = step(state, { jumpHeld: age < 2 }); state = next.state!;
      expect(next.events).toEqual(age === 6 ? [{ kind: 'ground-jump', mini: true }] : []);
      expect(state.phase).toBe(age < 6 ? 'jump-squat' : 'jump');
    }
    expect(tickDonkeyKongHeavyCarry(state, { ...air, freshJump: true }).events).toEqual([]);
    expect(tickDonkeyKongHeavyCarry(beginDonkeyKongHeavyCarry(false, 1), { ...air, freshJump: true }).state?.phase).toBe('fall');
  });

  it('uses jump motion end then fall and18 landing samples, while floor loss cancels landing immediately', () => {
    const jumping: DonkeyKongHeavyCarryState = { ...beginDonkeyKongHeavyCarry(false, -1), phase: 'jump' };
    expect(tickDonkeyKongHeavyCarry(jumping, { ...air, motionEnded: false }).state?.phase).toBe('jump');
    const falling = tickDonkeyKongHeavyCarry(jumping, { ...air, motionEnded: true }).state!;
    expect(falling.phase).toBe('fall');
    let state = step(falling).state!; expect(state.phase).toBe('landing');
    expect(tickDonkeyKongHeavyCarry(state, air).state?.phase).toBe('fall');
    for (let age = 1; age <= 18; age++) {
      const next = step(state, { freshAttack: true, freshJump: true }); state = next.state!;
      expect(next.events).toEqual([]); expect(state.phase).toBe(age < 18 ? 'landing' : 'wait');
    }
    let resource = jumping;
    for (let age = 1; age <= 26; age++) {
      resource = tickDonkeyKongHeavyCarry(resource, air).state!;
      expect(resource.phase).toBe(age < 26 ? 'jump' : 'fall');
    }
  });

  it('permits native fresh airborne attacks to throw while blocking cliff catch and preserving attack priority', () => {
    const state = beginDonkeyKongHeavyCarry(false, -1);
    expect(tickDonkeyKongHeavyCarry(state, { ...air, freshAttack: true }).events).toEqual([{ kind: 'throw', facing: -1 }]);
    expect(tickDonkeyKongHeavyCarry(state, { ...air, freshAttack: false }).events).toEqual([]);
    expect(donkeyKongHeavyCarryMayGrabLedge()).toBe(false);
    const source = readFileSync(`${base}/sources/heavy-status/functions/FUN_7100025150.c`, 'utf8');
    expect(source).toContain('ControlModule__check_button_trigger_impl');
    expect(source).toContain('FIGHTER_STATUS_KIND_ITEM_THROW_HEAVY');
    expect(source).not.toContain('cliff');
    expect(step(beginDonkeyKongHeavyCarry(true, 1), { freshAttack: true, freshJump: true }).events).toEqual([{ kind: 'throw', facing: 1 }]);
  });

  it('passes only a passable floor with qualified down flick and preserves the heavy item', () => {
    const state = beginDonkeyKongHeavyCarry(true, 1);
    const input = { nativeStickY: -.6875, downFlickAge: 5, passableFloor: true };
    const next = step(state, input);
    expect(next.state?.phase).toBe('pass'); expect(next.events).toEqual([{ kind: 'pass-platform' }]);
    for (const override of [{ passableFloor: false }, { downFlickAge: 6 }, { downFlickAge: null }, { nativeStickY: -.6874 }])
      expect(step(state, { ...input, ...override }).events).toEqual([]);
    expect(tickDonkeyKongHeavyCarry(next.state!, air).state?.phase).toBe('pass');
  });

  it('resists reaction frames strictly below32 except sleep, with high/sleep hits dropping the item', () => {
    expect(resolveDonkeyKongHeavyCarryDamage(31.999, 'collision_attr_normal')).toEqual({ resistsReaction: true, dropItem: false });
    expect(resolveDonkeyKongHeavyCarryDamage(32, 'collision_attr_normal')).toEqual({ resistsReaction: false, dropItem: true });
    for (const attribute of ['collision_attr_sleep', 'collision_attr_sleep_ex'])
      expect(resolveDonkeyKongHeavyCarryDamage(0, attribute)).toEqual({ resistsReaction: false, dropItem: true });
    expect(() => resolveDonkeyKongHeavyCarryDamage(NaN, 'collision_attr_normal')).toThrow();
    expect(() => resolveDonkeyKongHeavyCarryDamage(-1, 'collision_attr_normal')).toThrow();
  });

  it('external item loss restores ordinary ground/air destination and freezes do not advance transitions', () => {
    const state = beginDonkeyKongHeavyCarry(true, -1);
    expect(step(state, { frozen: true, freshJump: true, freshAttack: true, nativeStickX: 1 })).toEqual({ state, events: [] });
    expect(step(state, { holdingHeavy: false })).toEqual({ state: null, events: [{ kind: 'release-carry-state', destination: 'wait' }] });
    expect(tickDonkeyKongHeavyCarry(state, { ...air, holdingHeavy: false })).toEqual({ state: null,
      events: [{ kind: 'release-carry-state', destination: 'fall' }] });
  });
});
