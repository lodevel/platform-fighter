import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCOMOTION_DEFAULTS, type LocomotionState, type LocomotionInput } from './locomotionState';
import { tickDonkeyKongTurnBrake, donkeyKongTurnBrakeNativeMarkers, donkeyKongTurnBrakeFacing,
  donkeyKongTurnBrakeVelocity, donkeyKongRunGaitSide, DONKEYKONG_TURN_BRAKE_DURATIONS } from './donkeykongTurnBrake';
const tuning = { ...LOCOMOTION_DEFAULTS, initialDashSpeed: 10.45, dashDanceWindowFrames: 16 };
const run: LocomotionState = { name: 'run', facing: 1, dashFacing: 1, framesElapsed: 23 };
const input: LocomotionInput = { moveX: -1, prevMoveX: 1, moveY: 0, grounded: true, facing: 1 };
describe('DK source turn clocks and explicit common-status adapters', () => {
  it('reads cancel clocks and separate native run-turn extent from retained source records', () => {
    const yaml = readFileSync('docs/review/2026-10-06/dk-all-attack-values/sources/motion-list.yml', 'utf8');
    const cancel = (motion: string) => {
      const block = new RegExp(`^  ${motion}:\\n([\\s\\S]*?)(?=^  \\w+:)`, 'm').exec(yaml)?.[1];
      if (!block) throw new Error(`Native motion missing: ${motion}`);
      const value = /cancel_frame: (\d+)/.exec(block)?.[1];
      if (value === undefined) throw new Error(`Native cancel field missing: ${motion}`);
      return Number(value);
    };
    expect(DONKEYKONG_TURN_BRAKE_DURATIONS.dashTurn).toBe(cancel('turn_dash') - 1);
    expect(DONKEYKONG_TURN_BRAKE_DURATIONS.runBrake).toBe(cancel('run_brake_r') - 1);
    expect(cancel('run_brake_l')).toBe(20);
    expect(cancel('turn_run')).toBe(0);
    const extents = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/runtime/context-native-clip-extents.json', 'utf8'));
    expect(DONKEYKONG_TURN_BRAKE_DURATIONS.runTurn).toBe(extents.motions.find((r: { file: string }) => r.file.endsWith('a02turnrun.nuanmb')).nativeLastSample);
  });
  it('pins native flag phases3/18/15 independently and does not confuse the18 run transition with cancel22', () => {
    const source = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/sources/dk-scripts.json', 'utf8'));
    const markerFrame = (script: string, fn: string, flag: string) => source.files[script].functions[fn]
      .find((command: { raw: string }) => command.raw.includes(flag)).frame;
    expect(markerFrame('TurnDash', 'game_turndash', 'FIGHTER_STATUS_DASH_FLAG_TURN_DASH')).toBe(3);
    expect(markerFrame('TurnDash', 'game_turndash', 'FIGHTER_STATUS_TRANSITION_TERM_ID_DASH_TO_RUN')).toBe(18);
    expect(markerFrame('TurnRun', 'game_turnrun', 'FIGHTER_STATUS_RUN_BRAKE_FLAG_STOP')).toBe(15);
    const dash = tickDonkeyKongTurnBrake(null, { ...run, name: 'initialDash', framesElapsed: 3 }, input, tuning, true)!;
    expect(donkeyKongTurnBrakeFacing(dash)).toBe(1);
    expect(donkeyKongTurnBrakeFacing({ ...dash, framesElapsed: 1 })).toBe(1);
    expect(donkeyKongTurnBrakeFacing({ ...dash, framesElapsed: 2 })).toBe(-1);
    expect(donkeyKongTurnBrakeNativeMarkers({ ...dash, framesElapsed: 16 }).dashToRunEnabled).toBe(false);
    expect(donkeyKongTurnBrakeNativeMarkers({ ...dash, framesElapsed: 17 }).dashToRunEnabled).toBe(true);
    const turn = tickDonkeyKongTurnBrake(null, run, input, tuning, true)!;
    expect(donkeyKongTurnBrakeNativeMarkers({ ...turn, framesElapsed: 13 }).runBrakeStopFlag).toBe(false);
    expect(donkeyKongTurnBrakeNativeMarkers({ ...turn, framesElapsed: 14 }).runBrakeStopFlag).toBe(true);
  });
  it('handles both facings, gait branches, interruptions and frozen exact exits', () => {
    for (const facing of [1, -1] as const) {
      const state = tickDonkeyKongTurnBrake(null, { ...run, facing, dashFacing: facing },
        { ...input, moveX: -facing, prevMoveX: facing }, tuning, true)!;
      expect(state.targetFacing).toBe(-facing);
      expect(state.duration).toBe(33);
      expect(tickDonkeyKongTurnBrake(state, run, input, tuning, true, { frozen: true })).toBe(state);
      expect(tickDonkeyKongTurnBrake({ ...state, framesElapsed: 31 }, run, input, tuning, true)?.framesElapsed).toBe(32);
      expect(tickDonkeyKongTurnBrake({ ...state, framesElapsed: 32 }, run, input, tuning, true)).toBeNull();
      expect(tickDonkeyKongTurnBrake(state, run, input, tuning, false)).toBeNull();
      expect(tickDonkeyKongTurnBrake(state, run, { ...input, grounded: false }, tuning, true)).toBeNull();
      expect(tickDonkeyKongTurnBrake(state, run, { ...input, moveY: 1 }, tuning, true)).toBeNull();
      for (const [age, sheet] of [[10, 'run_brake'], [30, 'run_brake_left']] as const) expect(tickDonkeyKongTurnBrake(null,
        { ...run, facing, dashFacing: facing, framesElapsed: age }, { ...input, moveX: 0 }, tuning, true)?.sheet).toBe(sheet);
    }
  });
  it('derives the brake gait side from the run clip age (authored a02run foot-contact calibration)', () => {
    const side = (age: number) => donkeyKongRunGaitSide(age);
    expect([0, 6, 7, 15, 23, 24, 34, 35, 42, 58, 59].map(side)).toEqual(
      ['left', 'left', 'right', 'right', 'right', 'left', 'left', 'left', 'right', 'right', 'left']);
  });
  it('uses constant native traction for run-turn/brake and labelled caller acceleration for dash reversal', () => {
    const turn = tickDonkeyKongTurnBrake(null, run, input, tuning, true)!;
    expect(donkeyKongTurnBrakeVelocity(turn, 9, tuning, .68)).toBe(8.385);
    expect(donkeyKongTurnBrakeVelocity(turn, -.2, tuning, .68)).toBe(0);
    expect(donkeyKongTurnBrakeVelocity(turn, 9, tuning, .68, true)).toBe(9);
    const dash = tickDonkeyKongTurnBrake(null, { ...run, name: 'initialDash', framesElapsed: 3 }, input, tuning, true)!;
    expect(donkeyKongTurnBrakeVelocity(dash, 9, tuning, .68)).toBeCloseTo(8.32);
    expect(donkeyKongTurnBrakeVelocity(dash, -10.4, tuning, .68)).toBe(-10.45);
  });
});
