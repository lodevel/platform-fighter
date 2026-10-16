import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beginDonkeyKongHeavyItemAction, tickDonkeyKongHeavyItemAction, heavyItemPlan,
  selectDonkeyKongHeavyThrow, donkeyKongHeavyReleaseVelocity, DONKEYKONG_HEAVY_CARRY_PARAMETERS,
  getDonkeyKongHeavyCarryPolicy, getDonkeyKongHeavyCarryMotion,
  canDonkeyKongStartHeavyPickup, type DonkeyKongHeavyItemAction, type DonkeyKongHeavyCarryPhase } from './donkeykongHeavyItems';

const sourceDirectory = 'docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources/items';
const throws: DonkeyKongHeavyItemAction[] = [];
for (const direction of ['forward', 'back', 'up', 'down'] as const)
  for (const strength of ['ordinary', 'strong'] as const) throws.push(`throw-${direction}-${strength}`);
const phases: DonkeyKongHeavyCarryPhase[] = ['wait', 'walk-slow', 'walk-middle', 'walk-fast', 'turn',
  'jump-squat', 'jump', 'fall', 'landing'];
function nativeMotionBlock(motion: string): string {
  const yaml = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/motion-list.yml', 'utf8');
  const block = new RegExp(`^  ${motion}:\\n([\\s\\S]*?)(?=^  \\w+:)`, 'm').exec(yaml)?.[1];
  if (!block) throw new Error(`Missing native motion ${motion}`);
  return block;
}

describe('DK heavy-item source commands and explicit status boundaries', () => {
  it('independently verifies all nine command captures, callbacks, offsets, reverse order and native cancels', () => {
    const pins = JSON.parse(readFileSync(`${sourceDirectory}/weapon-heavy-verified.json`, 'utf8')) as
      { script: string; path?: string; sha256?: string }[];
    for (const action of ['pickup', ...throws] as DonkeyKongHeavyItemAction[]) {
      const plan = heavyItemPlan('donkeykong', action), pin = pins.find(p => p.script === plan.nativeScript && p.sha256);
      if (!pin?.path) throw new Error(`Missing primary command ${plan.nativeScript}`);
      const raw = readFileSync(pin.path, 'utf8');
      expect(createHash('sha256').update(raw).digest('hex')).toBe(pin.sha256);
      const game = raw.split('unsafe extern "C" fn')[1];
      if (!game) throw new Error(`Missing game function ${plan.nativeScript}`);
      let frame = 0, callbackFrame = 0, reverseFrame = 0;
      for (const line of game.split('\n')) {
        const clock = /frame\(agent.lua_state_agent, ([\d.]+)\)/.exec(line);
        if (clock) frame = Number(clock[1]);
        if (/pickup_item|THROW_ITEM_OFFSET/.test(line)) callbackFrame = frame;
        if (line.includes('REVERSE_LR(')) reverseFrame = frame;
      }
      expect(plan.sourceEventFrame, action).toBe(callbackFrame);
      const offset = /THROW_ITEM_OFFSET\(agent, (-?[\d.]+), (-?[\d.]+)/.exec(game);
      expect(plan.sourceOffset, action).toEqual(offset ? { x: Number(offset[1]), y: Number(offset[2]) } : undefined);
      expect(plan.sourceReverseAfterRelease ?? false, action).toBe(reverseFrame !== 0);
      if (reverseFrame) {
        expect(reverseFrame).toBe(callbackFrame);
        expect(game.indexOf('THROW_ITEM_OFFSET')).toBeLessThan(game.indexOf('REVERSE_LR'));
      }
      expect(game).not.toContain('FT_MOTION_RATE');
      const cancel = /cancel_frame: (\d+)/.exec(nativeMotionBlock(plan.motion))?.[1];
      if (!cancel) throw new Error(`Missing cancel frame ${plan.motion}`);
      expect(plan.nativeCancelFrame, action).toBe(Number(cancel));
      expect(plan.durationFrames).toBe(Number(cancel) - 1);
    }
  });

  it('copies heavy vectors with pinned Wiki precedence over the earlier native-angle adaptation', () => {
    const source = JSON.parse(readFileSync(`${sourceDirectory}/analyzed-throw-values.json`, 'utf8'));
    const wiki = JSON.parse(readFileSync('docs/review/2026-10-11/ultimate-items/spec/items.json', 'utf8'));
    const strengths = wiki.items.find((item: {id:string}) => item.id === 'crate').thrown.other
      .find((rule: {rule?:string}) => rule.rule === 'heavyThrowStrengths_Ultimate').value;
    for (const action of throws) {
      const plan = heavyItemPlan('donkeykong', action);
      const row = source.values.find((r: { motion: string }) => r.motion === plan.motion);
      expect(row, action).toBeDefined();
      const [, direction, strength] = action.split('-');
      const table = strengths[direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'Forward/back'];
      const angles = String(table.angle_deg).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const angle = angles[strength === 'strong' && angles.length > 1 ? 1 : 0];
      expect(plan.throwParameters).toEqual({ speedNative: row.speed, angleDegrees: angle, power: row.power });
    }
  });

  it('fires once at the sourced callback on the selected unit clock, releasing backward before changing facing', () => {
    for (const action of throws) for (const facing of [-1, 1] as const) {
      let state = beginDonkeyKongHeavyItemAction(action, facing).state;
      const plan = state.plan, observed: { age: number; kind: string; facing: number }[] = [];
      for (let age = 1; age < plan.durationFrames; age++) {
        const next = tickDonkeyKongHeavyItemAction(state);
        expect(next.state).not.toBeNull(); state = next.state!;
        observed.push(...next.events.map(event => ({ age, ...event })));
      }
      const expected: {age:number;kind:string;facing:number}[] = [{ age: plan.sourceEventFrame - 1, kind: 'release', facing }];
      if (action.startsWith('throw-back-')) expected.push({ age: plan.sourceEventFrame - 1, kind: 'reverse-facing', facing: -facing });
      expect(observed, action).toEqual(expected);
      expect(tickDonkeyKongHeavyItemAction(state)).toEqual({ state: null, events: [] });
    }
  });

  it('reserves pickup without acquisition until sample5; freezes and interrupted actions emit nothing', () => {
    let state = beginDonkeyKongHeavyItemAction('pickup', -1).state;
    for (let age = 1; age <= 4; age++) {
      expect(tickDonkeyKongHeavyItemAction(state, { frozen: true })).toEqual({ state, events: [] });
      expect(tickDonkeyKongHeavyItemAction(state, { interrupted: true })).toEqual({ state: null, events: [] });
      const next = tickDonkeyKongHeavyItemAction(state); state = next.state!;
      expect(next.events).toEqual(age === 4 ? [{ kind: 'pickup', facing: -1 }] : []);
    }
    expect(tickDonkeyKongHeavyItemAction(state).events).toEqual([]);
    for (const action of throws) expect(tickDonkeyKongHeavyItemAction(beginDonkeyKongHeavyItemAction(action, 1).state,
      { interrupted: true })).toEqual({ state: null, events: [] });
  });

  it('selects ordinary/strong all four directions with source6/8 windows and neutral forward instead of Z-drop', () => {
    for (const direction of ['forward', 'back', 'up', 'down'] as const) for (const airborne of [false, true]) {
      const boundary = airborne ? 8 : 6;
      expect(selectDonkeyKongHeavyThrow({ direction, airborne, directionFlickAge: boundary - 1 })).toBe(`throw-${direction}-strong`);
      expect(selectDonkeyKongHeavyThrow({ direction, airborne, directionFlickAge: boundary })).toBe(`throw-${direction}-ordinary`);
      expect(selectDonkeyKongHeavyThrow({ direction, airborne, directionFlickAge: null })).toBe(`throw-${direction}-ordinary`);
    }
    expect(selectDonkeyKongHeavyThrow({ direction: 'drop', airborne: true, directionFlickAge: 0 })).toBe('throw-forward-ordinary');
  });

  it('uses native heavy speed×DK scalar×unit conversion with entry-facing direction and finite vertical vectors', () => {
    for (const action of throws) for (const facing of [-1, 1] as const) {
      const plan = heavyItemPlan('donkeykong', action), velocity = donkeyKongHeavyReleaseVelocity(plan, facing);
      expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(plan.throwParameters!.speedNative * 1.09 * 5);
      expect(velocity.power).toBe(1);
      if (action.includes('-up-')) { expect(velocity.x).toBe(0); expect(velocity.y).toBeLessThan(0); }
      else if (action.includes('-down-')) {
        if (action.endsWith('-ordinary')) expect(velocity.x).toBe(0);
        else expect(velocity.x).toBeCloseTo(Math.cos(70 * Math.PI / 180) * 6 * 1.09 * 5 * facing);
        expect(velocity.y).toBeGreaterThan(0);
      }
      else expect(Math.sign(velocity.x)).toBe(action.startsWith('throw-back-') ? -facing : facing);
    }
    expect(() => donkeyKongHeavyReleaseVelocity(heavyItemPlan('donkeykong', 'pickup'), 1)).toThrow();
  });

  it('copies lift coefficients independently, keeping unknown armor/jump/gravity explicit', () => {
    const raw = JSON.parse(readFileSync('docs/review/2026-09-22/combat-parity/defense/sources/native-fighter-param.json', 'utf8'));
    const fighter = raw.struct.list.struct.find((r: { hash40: { '@hash': string; '#text': string }[] }) =>
      r.hash40.some(f => f['@hash'] === 'fighter_kind' && f['#text'] === 'fighter_kind_donkey'));
    const value = (name: string) => Number(fighter.float.find((r: { '@hash': string }) => r['@hash'] === name)['#text']);
    expect(DONKEYKONG_HEAVY_CARRY_PARAMETERS).toEqual({ accelerationMultiplierNative: value('item_lift_accel_mul'),
      accelerationAddNative: value('item_lift_accel_add'), maximumSpeedNative: value('item_lift_speed_max'),
      armorThresholdNative: null, jumpVelocityNative: null, gravityScaleNative: null });
  });

  it('routes all nine status-owned motions without turning native cancel0 or missing status rate into a fixed source commitment', () => {
    for (const phase of phases) {
      const plan = getDonkeyKongHeavyCarryMotion(phase), block = nativeMotionBlock(plan.motion);
      expect(block).toContain('cancel_frame: 0');
      expect(plan.nativeCancelFrame).toBe(0);
      expect(plan.durationFrames).toBe(phase === 'turn' ? 12 : phase === 'jump-squat' ? 6 : phase === 'landing' ? 18 : null);
      expect(plan.nativeStatusRate).toBe(phase.startsWith('walk-') ? null : 1); expect(plan.authoredDrawingRate).toBe(1);
      expect(plan.loop).toBe(/loop: true/.test(block));
    }
    const available = { grounded: true, holdingItem: false, candidateHeavy: true, candidateAvailable: true, actionable: true };
    expect(canDonkeyKongStartHeavyPickup(available)).toBe(true);
    for (const override of [{ grounded: false }, { holdingItem: true }, { candidateHeavy: false },
      { candidateAvailable: false }, { actionable: false }, { externallyBlocked: true }])
      expect(canDonkeyKongStartHeavyPickup({ ...available, ...override })).toBe(false);
    expect(getDonkeyKongHeavyCarryPolicy(true, false).canJump).toBe(true);
    expect(getDonkeyKongHeavyCarryPolicy(false, false).canJump).toBe(false);
    expect(getDonkeyKongHeavyCarryPolicy(false, false).canThrow).toBe(true);
    expect(getDonkeyKongHeavyCarryPolicy(false, false).canRetainOnLedgeFall).toBe(true);
    expect(getDonkeyKongHeavyCarryPolicy(true, true).canThrow).toBe(false);
    expect(getDonkeyKongHeavyCarryPolicy(true, false).canDash).toBe(false);
    expect(getDonkeyKongHeavyCarryPolicy(false, false).canZDrop).toBe(false);
  });
});
