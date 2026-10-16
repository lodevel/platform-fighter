import {describe,it,expect} from 'vitest';
import {beginGrabDamageTransaction,commitGrabDamageTransaction,grabDamageTransactionMatches} from './grabDamageTransaction';
const entry={transactionKey:'actual-entry-4',queueMoveId:'link.grab.throw.forward',staleMultiplier:1.05,actorGeneration:2,targetGeneration:3,captureId:4,entryFrame:10};
describe('admitted capture damage transaction',()=>{
 it('keeps one admitted factor and queue commit across prehit and release',()=>{
  const initial=beginGrabDamageTransaction(entry),pre=commitGrabDamageTransaction(initial,3*1.05*1.2),release=commitGrabDamageTransaction(pre.state,2.5*1.05*1.2);
  expect(pre.enqueue).toBe(true);expect(release.enqueue).toBe(false);expect(release.state.staleMultiplier).toBe(1.05);
 });
 it('never commits a failed or harmless attempt, but retains an accepted prehit when release is interrupted',()=>{
  const initial=beginGrabDamageTransaction(entry);expect(commitGrabDamageTransaction(initial,0).enqueue).toBe(false);
  const pre=commitGrabDamageTransaction(initial,3.78);expect(commitGrabDamageTransaction(pre.state,0).state.committed).toBe(true);
 });
 it('requires the original capture and both participant generations',()=>{
  const initial=beginGrabDamageTransaction(entry);expect(grabDamageTransactionMatches(initial,{actorGeneration:2,targetGeneration:3,captureId:4})).toBe(true);
  for(const changed of [{actorGeneration:3,targetGeneration:3,captureId:4},{actorGeneration:2,targetGeneration:4,captureId:4},{actorGeneration:2,targetGeneration:3,captureId:5}])expect(grabDamageTransactionMatches(initial,changed)).toBe(false);
 });
 it('creates independent pummel entries with their own actual queue factor',()=>{
  const first=commitGrabDamageTransaction(beginGrabDamageTransaction({...entry,queueMoveId:'link.grab.pummel'}),1.638);
  const second=beginGrabDamageTransaction({...entry,queueMoveId:'link.grab.pummel',transactionKey:'actual-entry-5',entryFrame:30,staleMultiplier:.91});
  expect(first.enqueue).toBe(true);expect(second.committed).toBe(false);expect(commitGrabDamageTransaction(second,1.3*.91*1.2).enqueue).toBe(true);
 });
});
