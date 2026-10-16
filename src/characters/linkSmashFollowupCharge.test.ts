/** Prepared import/schema and charge inheritance boundaries; unrun until final gate. */
import {describe,it,expect} from 'vitest';
import {FRESH_LINK_NORMALS} from './linkFreshNormals';
import {parseAttackMoveSnapshot} from './characterSerializer';
import {realizeLinkSmashFollowupCharge} from './linkSmashFollowupCharge';
const first=FRESH_LINK_NORMALS['link.smash'],second=FRESH_LINK_NORMALS['link.smash2'];
describe('uncharged second forward-smash admission',()=>{
  it('has no impossible hold point and satisfies the actual strict move parser',()=>{
    expect(Object.hasOwn(second,'chargeStartFrame')).toBe(false);expect(Object.hasOwn(second,'charge')).toBe(false);
    expect(second.startupFrames).toBe(9);expect(second.sourcePoseId).toBe('link.smash2');
    expect(parseAttackMoveSnapshot(second,'followup')).toMatchObject({id:'link.smash2',startupFrames:9});
  });
  it('inherits actual first-held damage once and retains second packet launch/timing',()=>{
    const full=realizeLinkSmashFollowupCharge(first,60,second);
    expect(full.damage).toBeCloseTo(18.2,10);expect(realizeLinkSmashFollowupCharge(first,0,second).damage).toBe(13);
    expect(full.knockback).toBe(second.knockback);expect(full.hitbox).toBe(second.hitbox);
    // Data-driven windows carry their own damage: scaled by the inherited 1.4x, timing and groups unchanged.
    expect(full.hitWindows!.map(w=>[w.startFrame,w.endFrame,w.group])).toEqual(second.hitWindows!.map(w=>[w.startFrame,w.endFrame,w.group]));
    full.hitWindows!.forEach((w,i)=>{expect(w.damage).toBeCloseTo(second.hitWindows![i]!.damage!*1.4,10);
      expect(w.collisionHits!.map(h=>h.knockback)).toEqual(second.hitWindows![i]!.collisionHits!.map(h=>h.knockback));});
    expect(full.sourcePoseId).toBe(second.sourcePoseId);
    expect(realizeLinkSmashFollowupCharge(full,60,full)).toBe(full);
  });
  it('preserves independently edited second KB while scaling its explicit damage and harmless empty geometry',()=>{
    const ownKB={x:4,y:-5,scaling:0},capsule={start:{x:0,y:0},end:{x:10,y:0},radius:2};
    const edited={...second,knockback:ownKB,collisionHits:[{id:0,damage:3,capsule}],
      hitWindows:[{startFrame:9,endFrame:11,damage:7,collisionHits:[]}]};
    const full=realizeLinkSmashFollowupCharge(first,60,edited);
    expect(full.knockback).toBe(ownKB);expect(full.collisionHits![0]!.damage).toBeCloseTo(4.2,10);
    expect(full.hitWindows![0]!.damage).toBeCloseTo(9.8,10);expect(full.hitWindows![0]!.collisionHits).toEqual([]);
  });
  it('retains a deliberately authored second charge consumer and rejects invented held count',()=>{
    const authored={...second,charge:first.charge};expect(realizeLinkSmashFollowupCharge(first,60,authored)).toBe(authored);
    expect(()=>realizeLinkSmashFollowupCharge(first,.5,second)).toThrow();
    expect(realizeLinkSmashFollowupCharge(first,null,second)).toBe(second);
  });
});
