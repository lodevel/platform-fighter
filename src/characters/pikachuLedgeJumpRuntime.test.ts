import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {PIKACHU_MOVEMENT_PROFILE} from './pikachuMovement';
import {pikachuAuxiliarySourceStatus} from './pikachuAuxiliaryBody';
import {
  advancePikachuLedgeJump, beginPikachuLedgeJump, pikachuLedgeJumpBetaImpulse,
  pikachuLedgeJumpProtected, pikachuLedgeJumpStartOffset,
  PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL, selectPikachuLedgeJumpBody,
} from './pikachuLedgeJumpRuntime';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

describe('source ledge-jump stages and explicit beta travel calibration', () => {
  it('keeps twelve protected Trans samples separate from 27 cancellable flight drawings', () => {
    const source = pikachuAuxiliarySourceStatus('ledge_jump_start');
    expect(source).toEqual({cancelFrame: null, intangibilityStartFrame: 1, intangibilityEndExclusive: 13});
    let state = beginPikachuLedgeJump(-1);
    for (let age = 0; age < 12; age++) {
      expect(state).toEqual({phase: 'start', framesElapsed: age, facing: -1});
      expect(pikachuLedgeJumpProtected(state)).toBe(true);
      const pose = selectPikachuLedgeJumpBody(state)!;
      expect(pose.sheet).toBe('ledge_jump_start');
      expect(pose.hurtboxes).toHaveLength(12);
      expect(pose.artFrameIndex).toBe(age < 5 ? 0 : age < 11 ? 1 : 2);
      state = advancePikachuLedgeJump(state)!;
    }
    for (let age = 0; age < 27; age++) {
      expect(state).toEqual({phase: 'flight', framesElapsed: age, facing: -1});
      expect(pikachuLedgeJumpProtected(state)).toBe(false);
      const pose = selectPikachuLedgeJumpBody(state)!;
      expect(pose.sheet).toBe('ledge_jump');
      expect(pose.sourceRootDelta).toEqual({x: 0, y: 0});
      expect(pose.hurtboxes).toHaveLength(12);
      const next = advancePikachuLedgeJump(state);
      if (age === 26) expect(next).toBeNull();
      else state = next!;
    }
    expect(pikachuAuxiliarySourceStatus('ledge_jump')?.cancelFrame).toBeNull();
  });

  it('uses absolute source Trans and geometric standing height at the actual ledge corner', () => {
    expect(pikachuLedgeJumpStartOffset(0, 25)).toEqual({x: -8.999999761581421, y: 25.236501693725586});
    expect(pikachuLedgeJumpStartOffset(9, 25)).toEqual({x: -8.999999761581421, y: -25});
    expect(pikachuLedgeJumpStartOffset(11, 25)).toEqual({x: 0, y: -25});
    expect(pikachuLedgeJumpStartOffset(12, 25)).toBeNull();
    expect(pikachuLedgeJumpStartOffset(11, 40)).toEqual({x: 0, y: -40});
  });

  it.each([1, -1] as const)('calibrates sourced height against real Matter ordinary rise, facing %s', facing => {
    const engine = Engine.create();
    const body = Bodies.rectangle(0, 0, 40, 50, {frictionAir: 0});
    Composite.add(engine.world, body);
    const worldDose = engine.gravity.y * engine.gravity.scale * (1000 / 60) ** 2;
    const riseDose = PIKACHU_MOVEMENT_PROFILE.riseAccel!;
    const impulse = pikachuLedgeJumpBetaImpulse(worldDose + riseDose);
    Body.setVelocity(body, {x: PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL.speedX * facing, y: -impulse});
    let apex = 0;
    let steps = 0;
    while (body.velocity.y < 0 && steps++ < 100) {
      Body.setVelocity(body, {x: body.velocity.x, y: body.velocity.y + riseDose});
      Engine.update(engine, 1000 / 60);
      apex = Math.min(apex, body.position.y);
    }
    expect(-apex).toBeCloseTo(188.75, 8);
    expect(body.position.x).toBeCloseTo(steps * 3 * facing, 8);
  });
});
