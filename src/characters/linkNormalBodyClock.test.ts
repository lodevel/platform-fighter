/** Body-art clock of the stock normals: pose one native frame before the script frame. */
import {describe,it,expect} from 'vitest';
import {linkNormalNativeFrame,linkNormalScriptNativeFrame,linkNormalSourcePhase} from './linkNormalBodyClock';
describe('Link normal body clock',()=>{
  it.each([
    ['link.jab',[6,7,8],[7,8,9],[8,9,10]],
    ['link.jab2',[4,5,6],[4,5,6],[5,6,7]],
    ['link.jab3',[5,6,7],[5,6,7],[6,7,8]],
    ['link.dtilt',[9,10,11],[12,13,14],[13,14,15]],
    ['link.tilt',[14,15,18,19],[14,15,18,19],[15,16,19,20]],
    ['link.utilt',[7,8,9,10,11,12],[7,8,9,10,11,12],[8,9,10,11,12,13]],
  ] as const)('%s: pose and script landmarks around the strike',(id,ages,poses,scripts)=>{
    expect(ages.map(age=>linkNormalNativeFrame(id,age))).toEqual(poses);
    expect(ages.map(age=>linkNormalScriptNativeFrame(id,age))).toEqual(scripts);
    expect(linkNormalNativeFrame(id,0)).toBe(0);
    expect(linkNormalSourcePhase(id,ages[1]!)).not.toBeNull();
    expect(linkNormalSourcePhase(id,ages.at(-1)!)).toBeNull();
  });
  it('Bair Hit 2 holds pose 14..16 then clears to pose 18; script frames stay continuous',()=>{
    expect([5,7,8,14,16,17].map(age=>linkNormalNativeFrame('link.bair',age))).toEqual([5,7,8,14,16,18]);
    expect([5,7,8,14,16,17].map(age=>linkNormalScriptNativeFrame('link.bair',age))).toEqual([6,8,9,15,17,18]);
    expect(linkNormalSourcePhase('link.bair',8)).toBeNull();
    expect(linkNormalSourcePhase('link.bair',14)?.role).toBe('Hit 2');
  });
});
