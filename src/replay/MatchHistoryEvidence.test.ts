/** Prepared independent identity/nonfinite cases; deferred until final checks. */
import {describe,it,expect} from 'vitest';
import {canonicalMatchHistoryEvidence} from './MatchHistoryEvidence';
import {GameLoop} from '../engine/GameLoop';
describe('actual history reconstruction evidence',()=>{
  it('normalizes real body creation identity without normalizing participants or item identities',()=>{
    const a=canonicalMatchHistoryEvidence({bodyId:115,ownerBodyId:102,itemId:7,playerIndex:1,key:'strike.118'},100);
    const b=canonicalMatchHistoryEvidence({bodyId:815,ownerBodyId:802,itemId:7,playerIndex:1,key:'strike.818'},800);
    expect(a).toBe(b);
    expect(a).not.toBe(canonicalMatchHistoryEvidence({bodyId:815,ownerBodyId:802,itemId:8,playerIndex:1,key:'strike.818'},800));
  });
  it('retains genuine unbounded physics/lifetime and missing-vs-null while rejecting corrupt geometry',()=>{
    expect(canonicalMatchHistoryEvidence({inertia:Infinity,framesRemaining:Infinity},0)).toContain('$unbounded');
    expect(JSON.parse(canonicalMatchHistoryEvidence({throwProfile:{maxSpeedX:Infinity,maxSpeedY:Infinity}},0)))
      .toEqual({throwProfile:{maxSpeedX:{$unbounded:'maxSpeedX'},maxSpeedY:{$unbounded:'maxSpeedY'}}});
    expect(canonicalMatchHistoryEvidence({point:null},0)).not.toBe(canonicalMatchHistoryEvidence({point:undefined},0));
    expect(()=>canonicalMatchHistoryEvidence({point:{x:NaN,y:0}},0)).toThrow();
    expect(()=>canonicalMatchHistoryEvidence({radius:Infinity},0)).toThrow();
  });
  it('restores residue/pause only at the already reconstructed frame and continues normally',()=>{
    const loop=new GameLoop();let calls=0;
    loop.tick(1000/60,()=>calls++);
    expect(()=>loop.restoreReconstructedClock({frame:2,accumulatorMs:0,paused:false})).toThrow();
    loop.restoreReconstructedClock({frame:1,accumulatorMs:4,paused:true});
    loop.tick(500,()=>calls++);expect(calls).toBe(1);expect(loop.getAccumulatorMs()).toBe(4);
    loop.resume();loop.tick(1000/60,()=>calls++);expect(calls).toBe(2);
  });
});
