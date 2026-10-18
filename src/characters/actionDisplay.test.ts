import { describe, expect, it } from 'vitest';
import { clipDrawingAt, clipOfSheet, describeActionDisplay, sheetDisplay } from './actionDisplay';
import type { ActionPose, SimulationAnimationSnapshot } from './simulationSpriteAnimation';

const snapshot = (characterId: string) => ({ characterId, facing: 1, pikachuSpecial: null }) as unknown as SimulationAnimationSnapshot;

describe('action display', () => {
  it('names the clip a texture holds', () => {
    expect(clipOfSheet('pikachu', 'tilt')).toBe('ftilt');
    expect(sheetDisplay('pikachu', 'tilt', -3, -1)).toEqual({ action: 'ftilt', tick: 0, facing: -1 });
  });

  it('shows a generic fallback drawing at the first tick its clip shows it', () => {
    const pose: ActionPose = { state: 'landing', sheets: ['crouch', 'idle'], hold: 'last', scaleY: 0.92 };
    const last = clipDrawingAt('pikachu', 'crouch', 10_000)!.artFrameIndex;
    const display = describeActionDisplay(snapshot('pikachu'), pose, { sheet: 'crouch', frameIndex: last }, null, 37)!;
    expect(clipDrawingAt('pikachu', 'crouch', display.tick)!.artFrameIndex).toBe(last);
    expect(clipDrawingAt('pikachu', 'crouch', display.tick - 1)?.artFrameIndex).not.toBe(last);
    expect(display).toMatchObject({ action: 'crouch', facing: 1, scale: { x: 1, y: 0.92 } });
  });

  it('keeps the pose clock when the clip agrees and has no display for a drawing no exported clip shows', () => {
    const pose: ActionPose = { state: 'idle', sheets: ['idle'], frame: 0, hold: 'first' };
    expect(describeActionDisplay(snapshot('donkeykong'), pose, { sheet: 'idle', frameIndex: 0 }, null, 0)).toEqual({ action: 'idle', tick: 0, facing: 1 });
    // DK's legacy `attack` strip has no timing data and is not exported.
    expect(describeActionDisplay(snapshot('donkeykong'), { state: 'x', sheets: ['attack'], hold: 'first' }, { sheet: 'attack', frameIndex: 0 }, null, 0)).toBeNull();
  });
});
