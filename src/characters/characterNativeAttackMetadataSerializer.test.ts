import {describe,expect,it} from 'vitest';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import {LINK_JAB} from './Link';
import {resolveAttackHitWindow} from './attackHitWindows';
const baseline=()=>serializeCharacterDataSpec(getAuthorableCharacterSpec('link'));
const capsule={start:{x:0,y:0},end:{x:0,y:0},radius:2};
describe('native collision metadata save and selected strike authority',()=>{
 it('roundtrips known/unknown attributes and false/true/absent separately at all three packet levels',()=>{
  const jab={...LINK_JAB,nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false,
   collisionHits:[{id:0,capsule,nativeCollisionAttribute:'collision_attr_future',nativeForceReaction:true},{id:1,capsule}],
   hitWindows:[{startFrame:LINK_JAB.startupFrames,endFrame:LINK_JAB.startupFrames+LINK_JAB.activeFrames,
    nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false,
    collisionHits:[{id:2,capsule,nativeCollisionAttribute:'collision_attr_bury',nativeForceReaction:false}]}]};
  const loaded=parseCharacterDataFile({...baseline(),moves:{jab}});
  const saved=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(loaded))));
  expect(saved.moves?.jab).toEqual(jab);
  expect(saved.moves?.jab?.collisionHits?.[1]).not.toHaveProperty('nativeForceReaction');
 });
 it('selected window with unknown metadata clears inherited normal/false instead of qualifying it',()=>{
  const base={...LINK_JAB,nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false,
   collisionHits:[{id:0,capsule,damage:6,nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false}]};
  const selected=resolveAttackHitWindow(base,base,{startFrame:3,endFrame:4});
  expect(selected.nativeCollisionAttribute).toBeUndefined();expect(selected.nativeForceReaction).toBeUndefined();
  expect(selected.collisionHits).toEqual([{id:0,capsule,damage:6}]);
  expect(base.collisionHits[0]!.nativeCollisionAttribute).toBe('collision_attr_elec');
  const forced=resolveAttackHitWindow(base,base,{startFrame:3,endFrame:4,nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:true});
  expect(forced.nativeForceReaction).toBe(true);expect(forced.nativeCollisionAttribute).toBe('collision_attr_elec');
 });
 it.each([{nativeForceReaction:0},{nativeForceReaction:'false'},{nativeCollisionAttribute:4},{nativeCollisionAttribute:''}])('rejects malformed packet metadata %j',metadata=>{
  expect(()=>parseCharacterDataFile({...baseline(),moves:{jab:{...LINK_JAB,...metadata}}})).toThrow(/native/);
 });
});
