import { describe, expect, it } from 'vitest';
import { applyRegionalProtection } from './regionalProtection';
import type { Hurtbox } from './moveSchema';

const boxes: readonly Hurtbox[] = [
  {id: 'torso', region: 'hip', offsetX: 0, offsetY: 0, width: 20, height: 20},
  {id: 'arm', region: 'arml', offsetX: 40, offsetY: 0, width: 10, height: 10,
    capsule: {start: {x: 35,y: 0},end: {x: 45,y: 0},radius: 5}},
];
describe('anatomical protection boundaries', () => {
  const move = {protectionWindows: [{startFrame: 5,endFrame: 9,regions: ['arml']}]};
  it.each([4,5,8,9])('keeps torso vulnerable while limb window owns age %s', age => {
    const result = applyRegionalProtection(boxes,move,age);
    expect(result[0]?.intangible).toBeUndefined();
    expect(result[1]?.intangible === true).toBe(age >= 5 && age < 9);
    expect(result[1]?.capsule).toEqual(boxes[1]?.capsule);
  });
  it('preserves incoming geometry and leaves unnamed regions vulnerable', () => {
    expect(boxes[1]?.intangible).toBeUndefined();
    expect(applyRegionalProtection(boxes,null,5)).toBe(boxes);
    const unnamed = {...boxes[1]!, region: undefined};
    expect(applyRegionalProtection([unnamed],move,5)[0]?.intangible).toBeUndefined();
  });
});
