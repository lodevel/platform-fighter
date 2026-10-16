import {describe,it,expect,vi} from 'vitest';
import {Inventory} from './Inventory';
import {ItemEntity} from './ItemEntity';
import {HOME_RUN_BAT_DEFINITION as BAT_DEFINITION} from './HomeRunBat';
import type {Character} from '../characters/Character';

const holder=()=>({equipItem:vi.fn(),unequipItem:vi.fn(),addAttack:vi.fn()}) as unknown as Character;
const point={x:20,y:30};
describe('Explicit item catch ownership versus ordinary ground pickup',()=>{
 it('ordinary pickup rejects a falling object; explicit catch commits lifecycle and callbacks',()=>{
  const actor=holder(),inventory=new Inventory(actor),item=new ItemEntity(1,BAT_DEFINITION,0,point);
  expect(inventory.pickup(item,1,0,point)).toBe(false);
  expect(inventory.pickup(item,2,0,point,'catch')).toBe(true);
  expect(item.getSnapshot()).toMatchObject({state:'held',holderPlayerIndex:0,stateEnteredFrame:2});
  expect(inventory.getHeldItem()).toBe(item);
  expect(actor.equipItem).toHaveBeenCalledWith(item);
  expect(actor.addAttack).toHaveBeenCalledTimes(Object.keys(BAT_DEFINITION.uses!).length);
 });
 it('contested catch installs one owner and cannot equip twice',()=>{
  const first=holder(),second=holder(),a=new Inventory(first),b=new Inventory(second),item=new ItemEntity(2,BAT_DEFINITION,0,point);
  expect(a.pickup(item,1,0,point,'catch')).toBe(true);
  expect(b.pickup(item,1,1,point,'catch')).toBe(false);
  expect(a.pickup(item,2,0,point,'catch')).toBe(false);
  expect(second.equipItem).not.toHaveBeenCalled();
  expect(item.getSnapshot().holderPlayerIndex).toBe(0);
 });
 it.each(['broken','despawned'] as const)('catch cannot resurrect %s lifecycle',state=>{
  const actor=holder(),inventory=new Inventory(actor),item=new ItemEntity(3,BAT_DEFINITION,0,point);
  if(state==='broken'){item.markGrounded(0,point);item.markBroken(1,point);}else item.markDespawned(1);
  expect(item.getSnapshot().state).toBe(state);
  expect(inventory.pickup(item,2,0,point,'catch')).toBe(false);
  expect(item.getSnapshot().state).toBe(state);
  expect(actor.equipItem).not.toHaveBeenCalled();
 });
 it('declared non-holdable object rejects ground pickup and air catch without lifecycle change',()=>{
  const inventory=new Inventory(holder()),item=new ItemEntity(4,{...BAT_DEFINITION,holdable:false},0,point);
  expect(inventory.pickup(item,1,0,point,'catch')).toBe(false);item.markGrounded(2,point);
  expect(inventory.pickup(item,3,0,point)).toBe(false);
  expect(item.getSnapshot().state).toBe('grounded');
 });
});
