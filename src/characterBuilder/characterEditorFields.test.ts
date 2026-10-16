import { describe, expect, it } from 'vitest';

import { getAuthorableCharacterSpec } from '../characters/authorableCharacterRegistry';
import { DONKEYKONG_JAB } from '../characters/DonkeyKong';
import {
  buildCharacterEditorFields,
  listEditableMoves,
  stepCharacterEditorField,
} from './characterEditorFields';

const donkeykong = getAuthorableCharacterSpec('donkeykong');
// Every kept roster fighter authors a short-hop impulse; a Lab spec without
// one still edits the legacy jump-cut factor.
const pikachu = getAuthorableCharacterSpec('pikachu');
const { shortHopImpulse: _shortHopImpulse, ...jumpCutMovement } = pikachu.movement;
const jumpCutSpec = { ...pikachu, movement: jumpCutMovement };

describe('characterEditorFields', () => {
  it('exposes bounded movement and body fields', () => {
    const movement = buildCharacterEditorFields(jumpCutSpec, 'movement');
    const body = buildCharacterEditorFields(donkeykong, 'body');
    expect(movement.map((field) => field.path[0])).toContain('jumpCutFactor');
    expect(body.map((field) => field.path[0])).toEqual(['width', 'height', 'chamfer']);
    const jumpCut = movement.find((field) => field.path[0] === 'jumpCutFactor')!;
    expect(stepCharacterEditorField({ ...jumpCut, value: 1 }, 1)).toBe(1);
  });

  it('discovers every numeric leaf on authored moves', () => {
    // Every roster jab authors per-hit capsules, which hide the rectangle;
    // a Lab jab without capsules edits the rectangle directly.
    const { collisionHits: _capsules, ...rectangleJab } = DONKEYKONG_JAB;
    const spec = { ...donkeykong, moves: { ...donkeykong.moves, jab: rectangleJab } };
    expect(listEditableMoves(spec)).toContain('jab');
    const fields = buildCharacterEditorFields(spec, 'move', 'jab');
    expect(fields.find((field) => field.id === 'damage')?.value).toBe(DONKEYKONG_JAB.damage);
    expect(fields.find((field) => field.id === 'hitbox.offsetX')?.value).toBe(DONKEYKONG_JAB.hitbox.offsetX);
    expect(fields.find((field) => field.id === 'animation.startupFrames')?.value)
      .toBe(DONKEYKONG_JAB.animation?.startupFrames);
    expect(buildCharacterEditorFields(donkeykong, 'move', 'jab').some((field) => field.id === 'hitbox.offsetX')).toBe(false);
  });

  it('exposes Link’s authored jump arcs without inactive or undefined controls', () => {
    const fields = buildCharacterEditorFields(getAuthorableCharacterSpec('link'), 'movement');
    expect(fields.map(f=>f.path[0])).toEqual(expect.arrayContaining([
      'maxAirSpeed','shortHopImpulse','riseAccel','shortHopRiseAccel',
      'airJumpImpulse','airJumpRiseAccel','softLandingFrames','hardLandingFrames','hardLandingSpeedFrames',
    ]));
    expect(fields.some(f=>f.path[0] === 'jumpCutFactor')).toBe(false);
    expect(fields.every(f=>Number.isFinite(f.value))).toBe(true);
    expect(buildCharacterEditorFields(jumpCutSpec,'movement').some(f=>f.path[0] === 'shortHopImpulse')).toBe(false);
  });

  it('walks nested properties used by special-move families', () => {
    const fields = buildCharacterEditorFields(donkeykong, 'move', 'upSpecial');
    expect(fields.some((field) => field.id === 'multiHitRising.hitCount')).toBe(true);
  });
});
