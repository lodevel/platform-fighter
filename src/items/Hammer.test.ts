import { describe, expect, it } from 'vitest';
import { HAMMER_DEFINITION, GOLDEN_HAMMER_DEFINITION, HAMMER_HEAD_DEFINITION, beginHammer, stepHammer, hammerMotion } from './Hammer';
import {thrownItemHit} from './nativeItemThrow';
import { ItemEntity } from './ItemEntity';

describe('Ultimate hammer lock replaces the test swipe', () => {
  it('has no player-triggered uses or 3-use break count', () => {
    expect(HAMMER_DEFINITION.uses).toBeUndefined();
    expect(HAMMER_DEFINITION.ammo).toBeUndefined();
    expect(HAMMER_DEFINITION.hammer?.durationFrames).toBe(480);
    expect(GOLDEN_HAMMER_DEFINITION.hammer?.swingRate).toBe(2);
    expect(GOLDEN_HAMMER_DEFINITION.hammer?.durationFrames).toBe(920);
  });
  it('expires at exactly 480 fixed steps, including interrupted steps', () => {
    let s=beginHammer(HAMMER_DEFINITION.hammer!,0.5);
    for(let i=0;i<479;i++)s=stepHammer(HAMMER_DEFINITION.hammer!,s).state;
    expect(s.elapsed).toBe(479);
    expect(stepHammer(HAMMER_DEFINITION.hammer!,s).expired).toBe(true);
  });
  it('headless is exactly the one-eighth boundary; golden squeaky is independently labelled', () => {
    expect(beginHammer(HAMMER_DEFINITION.hammer!,0.124999).malfunction).toBe('headless');
    expect(beginHammer(HAMMER_DEFINITION.hammer!,0.125).malfunction).toBeNull();
    expect(beginHammer(GOLDEN_HAMMER_DEFINITION.hammer!,0).malfunction).toBe('squeaky');
  });
  it('one item record owns the state and retains its elapsed timer after a drop/catch', () => {
    const item=new ItemEntity(1,HAMMER_DEFINITION,0,{x:0,y:0});
    item.markGrounded(0,{x:0,y:0});item.markHeld(1,0,{x:0,y:0});
    item.startHammer(0.5);item.setHammerState({...item.getHammerState()!,elapsed:100});
    item.markDropped(2,{x:0,y:0});item.markHeld(3,1,{x:0,y:0});item.startHammer(0);
    expect(item.getHammerState()).toMatchObject({elapsed:100,malfunction:null});
  });
  it('golden podium denies ground pickup and catches until fully grown', () => {
    const item=new ItemEntity(1,GOLDEN_HAMMER_DEFINITION,0,{x:0,y:0});item.markGrounded(0,{x:0,y:0});
    expect(item.isPickable()).toBe(false);expect(item.isCatchable()).toBe(false);
    item.advanceHammerGrowth(59);expect(item.isPickable()).toBe(false);
    item.advanceHammerGrowth(60);expect(item.isPickable()).toBe(true);
  });
  it('shared thrown-hit consumer uses actual head dash/Z-drop/ordinary planner keys',()=>{
    const hit=(action:'dash-throw'|'air-z-drop'|'throw-ground-forward-ordinary')=>thrownItemHit(HAMMER_HEAD_DEFINITION,action,{vx:2,vy:-1},1,1,true);
    expect(hit('dash-throw').damage).toBe(41.7);
    expect(hit('air-z-drop').damage).toBe(39);
    expect(hit('throw-ground-forward-ordinary').damage).toBe(38.7);
  });
  it('native wait/move/air clips share one clock, Golden twice as fast', () => {
    const s={...beginHammer(HAMMER_DEFINITION.hammer!,0.5),elapsed:6,motionElapsed:6};
    expect(hammerMotion(HAMMER_DEFINITION.hammer!,s,true,0)).toEqual({sheet:'item_hammer_wait',age:6});
    expect(hammerMotion(GOLDEN_HAMMER_DEFINITION.hammer!,s,false,1)).toEqual({sheet:'item_hammer_jump',age:12});
  });
});
