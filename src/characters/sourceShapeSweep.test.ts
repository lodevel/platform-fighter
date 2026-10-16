/** Prepared for the final verification, not executed during authoring.
 * Independent analytical cases cover shapes that a leading-cap/outer-circle
 * approximation loses. Scene arbitration and real contacts remain live gates. */
import {describe,it,expect} from 'vitest';
import {sweepTranslatedSourceShape as sweep} from './sourceShapeSweep';
const from={x:0,y:0},to={x:20,y:0};
describe('exact translating source shape',()=>{
  it('sweeps the entire capsule against a perpendicular target capsule',()=>{
    const hit=sweep({from,to,shape:{kind:'capsule',start:{x:0,y:-5},end:{x:0,y:5},radius:1},
      target:{kind:'capsule',start:{x:10,y:0},end:{x:15,y:0},radius:1}})!;
    expect(hit.fraction).toBeCloseTo(.4,12);expect(hit.origin.x).toBeCloseTo(8,12);
  });
  it('retains rectangle MODELROOT offsets instead of returning the contact point',()=>{
    const hit=sweep({from,to,shape:{kind:'rectangle',offsetX:3,offsetY:0,width:2,height:4},
      target:{kind:'capsule',start:{x:10,y:0},end:{x:10,y:0},radius:1}})!;
    expect(hit.fraction).toBeCloseTo(.25,12);expect(hit.origin).toEqual({x:5,y:0});
  });
  it('finds oblique interior capsule contact that neither end cap can represent',()=>{
    const hit=sweep({from,to,shape:{kind:'capsule',start:{x:-4,y:-4},end:{x:4,y:4},radius:.5},
      target:{kind:'bounds',min:{x:10,y:0},max:{x:12,y:2}}})!;
    expect(hit.origin.x).toBeCloseTo(8-.5*Math.sqrt(2),12);
  });
  it('rejects a swept bounding-circle false positive for a long thin capsule',()=>{
    expect(sweep({from,to,shape:{kind:'capsule',start:{x:-8,y:0},end:{x:8,y:0},radius:1},
      target:{kind:'capsule',start:{x:10,y:8},end:{x:10,y:8},radius:1}})).toBeNull();
  });
  it('keeps rounded terrain corners rather than the expanded AABB corner',()=>{
    const hit=sweep({from:{x:0,y:8.1},to:{x:20,y:8.1},shape:{kind:'capsule',start:from,end:from,radius:2},
      target:{kind:'bounds',min:{x:10,y:10},max:{x:12,y:12}}})!;
    expect(hit.origin.x).toBeCloseTo(10-Math.sqrt(4-1.9**2),11);
    expect(hit.origin.x).toBeGreaterThan(9);
  });
  it('supports stationary initial overlap, misses and an exact tangent',()=>{
    const shape={kind:'rectangle' as const,offsetX:0,offsetY:0,width:2,height:2};
    expect(sweep({from,to:from,shape,target:{kind:'bounds',min:{x:1,y:-1},max:{x:2,y:1}}})?.fraction).toBe(0);
    expect(sweep({from,to:from,shape,target:{kind:'bounds',min:{x:3,y:-1},max:{x:4,y:1}}})).toBeNull();
    const hit=sweep({from:{x:0,y:2},to:{x:20,y:2},shape:{kind:'capsule',start:from,end:from,radius:1},
      target:{kind:'capsule',start:{x:10,y:0},end:{x:10,y:0},radius:1}})!;
    expect(hit.fraction).toBeCloseTo(.5,12);
  });
  it('handles already-mirrored geometry without applying facing again',()=>{
    const hit=sweep({from,to:{x:-20,y:0},shape:{kind:'rectangle',offsetX:-3,offsetY:0,width:2,height:4},
      target:{kind:'capsule',start:{x:-10,y:0},end:{x:-10,y:0},radius:1}})!;
    expect(hit.fraction).toBeCloseTo(.25,12);expect(hit.origin.x).toBeCloseTo(-5,12);
  });
  it('rejects invalid geometry and unrepresentable finite arithmetic',()=>{
    const shape={kind:'capsule' as const,start:from,end:from,radius:1},target={kind:'bounds' as const,min:from,max:to};
    expect(()=>sweep({from,to,shape:{...shape,radius:NaN},target})).toThrow();
    expect(()=>sweep({from,to,shape:{kind:'rectangle',offsetX:0,offsetY:0,width:0,height:1},target})).toThrow();
    expect(()=>sweep({from,to,shape,target:{...target,min:{x:3,y:0},max:{x:2,y:0}}})).toThrow();
    expect(()=>sweep({from,to,shape:{...shape,start:{x:-Number.MAX_VALUE,y:0},end:{x:-Number.MAX_VALUE,y:0}},
      target:{kind:'capsule',start:{x:Number.MAX_VALUE,y:0},end:{x:Number.MAX_VALUE,y:0},radius:1}})).toThrow();
  });
});
