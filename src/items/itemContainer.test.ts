import { describe, expect, it } from 'vitest';
import { CRATE_DEFINITION } from './Crate';
import { BARREL_DEFINITION } from './Barrel';
import { CAPSULE_DEFINITION } from './Capsule';
import { ItemEntity } from './ItemEntity';
import { containerBreakOutcome, containerBreaksOnImpact, eligibleContainerContents, stepContainerRoll } from './itemContainer';
import { ITEM_SPAWN_TABLE } from './itemCatalog';
import { foodDefinition } from './Food';
import { ItemRegistry } from './ItemRegistry';
import { Rng } from '../utils/Rng';
import { thrownItemHit } from './nativeItemThrow';

const draws = { explosionRoll: .5, countRoll: .99, contentsType: 'food' };
describe.each([[CRATE_DEFINITION,15],[BARREL_DEFINITION,14],[CAPSULE_DEFINITION,1]] as const)
('%s container lifecycle against pinned Ultimate HP', (definition,hp) => {
  it('accumulates real positive damage to the independently sourced threshold', () => {
    const item = new ItemEntity(1,definition,0,{x:0,y:0});
    expect(item.getContainerState()?.hp).toBe(hp);
    expect(item.damageContainer(NaN)).toBe(false);
    expect(item.damageContainer(-10)).toBe(false);
    expect(item.damageContainer(hp/2)).toBe(false);
    expect(item.getContainerState()?.hp).toBe(hp/2);
    expect(item.damageContainer(hp/2)).toBe(true);
  });
  it.each(['falling','grounded','held'] as const)('opens once from %s, clears holder and keeps retirement clock', state => {
    const item = new ItemEntity(1,definition,0,{x:0,y:0});
    if(state!=='falling')item.markGrounded(1,{x:0,y:0});
    if(state==='held')item.markHeld(2,1,{x:0,y:0});
    const before=item.getSnapshot();
    expect(item.resolveContainerBreak(8,{x:10,y:20},draws)?.kind).toBe('contents');
    expect(item.isBroken()).toBe(true);
    expect(item.getSnapshot()).toEqual({state:'broken',holderPlayerIndex:null,position:{x:10,y:20},stateEnteredFrame:8});
    expect(before.state).toBe(state);
    expect(item.resolveContainerBreak(9,{x:99,y:99},{...draws,explosionRoll:0})).toBeNull();
    expect(item.damageContainer(999)).toBe(false);
    expect(item.shouldDespawn(27)).toBe(false);
    expect(item.shouldDespawn(28)).toBe(true);
  });
});

describe('seeded container outcomes, without promoting authored loot weights to native parity', () => {
  it.each([CRATE_DEFINITION,BARREL_DEFINITION,CAPSULE_DEFINITION])('has exactly one explosive eighth at the draw boundary', definition => {
    const spec=definition.container!;
    for(let eighth=0;eighth<8;eighth++)expect(containerBreakOutcome(spec,{...draws,explosionRoll:eighth/8}).kind)
      .toBe(eighth===0?'explosion':'contents');
    expect(containerBreakOutcome(spec,{...draws,explosionRoll:1/8-Number.EPSILON}).kind).toBe('explosion');
    expect(containerBreakOutcome(spec,{...draws,explosionRoll:1/8}).kind).toBe('contents');
  });
  it('repeats one selected seeded Food variant for all three Crate contents', () => {
    const replay = () => {
      const rng=new Rng(1011),food=foodDefinition('Salisbury steak'),registry=new ItemRegistry();
      const outcome=containerBreakOutcome(CRATE_DEFINITION.container!,{...draws,explosionRoll:rng.next(),countRoll:.99});
      expect(outcome.kind).toBe('contents');
      if(outcome.kind!=='contents')throw new Error('wrong seeded fixture');
      const items=Array.from({length:outcome.count},()=>registry.spawn(food,{x:0,y:0},1,ItemEntity));
      expect(items).toHaveLength(3);
      expect(items.every(item=>item.definition===food)).toBe(true);
      expect(items.map(item=>item.definition.recovery?.amount)).toEqual([7,7,7]);
      return [rng.getState(),...items.map(item=>item.definition.foodVariant)];
    };
    expect(replay()).toEqual(replay());
  });
  it('respects enabled nonheavy loot and the explicit authored self-Capsule exclusion', () => {
    const crateLoot=eligibleContainerContents(CRATE_DEFINITION.container!,ITEM_SPAWN_TABLE);
    expect(crateLoot.map(item=>item.type)).toContain('capsule');
    expect(crateLoot.some(item=>item.heavy)).toBe(false);
    expect(eligibleContainerContents(CAPSULE_DEFINITION.container!,ITEM_SPAWN_TABLE).map(item=>item.type)).not.toContain('capsule');
    expect(containerBreakOutcome(CRATE_DEFINITION.container!,{...draws,contentsType:null})).toEqual({kind:'contents',type:null,count:0});
  });
  it('caps each source-specified content maximum; Barrel one remains authored', () => {
    for(const [definition,max] of [[CRATE_DEFINITION,3],[BARREL_DEFINITION,1],[CAPSULE_DEFINITION,1]] as const){
      expect(containerBreakOutcome(definition.container!,{...draws,countRoll:0})).toMatchObject({count:1});
      expect(containerBreakOutcome(definition.container!,{...draws,countRoll:1-Number.EPSILON})).toMatchObject({count:max});
    }
  });
});

describe('impact, roll and Capsule packet contracts', () => {
  it('Barrel terrain rolls; fighter impact opens all three; Capsule stays light', () => {
    for(const def of [CRATE_DEFINITION,BARREL_DEFINITION,CAPSULE_DEFINITION])expect(containerBreaksOnImpact(def.container!,'fighter')).toBe(true);
    expect(containerBreaksOnImpact(BARREL_DEFINITION.container!,'terrain')).toBe(false);
    expect(containerBreaksOnImpact(CAPSULE_DEFINITION.container!,'terrain')).toBe(true);
    expect(CAPSULE_DEFINITION.heavy).toBe(false);
  });
  it('rolling blocks pickup until the authored near-zero stop, retaining native cap/friction', () => {
    const item=new ItemEntity(1,BARREL_DEFINITION,0,{x:0,y:0});item.markGrounded(1,{x:0,y:0});
    item.startContainerRoll(-100);expect(item.getContainerState()?.rolling?.vx).toBe(-15);
    expect(item.isPickable()).toBe(false);
    let state=item.getContainerState()!.rolling;
    const first=stepContainerRoll(BARREL_DEFINITION.container!.rolling!,state!);
    expect(first?.vx).toBeCloseTo(-14.99,10);
    let frames=0;
    while(state&&frames++<1600)state=stepContainerRoll(BARREL_DEFINITION.container!.rolling!,state);
    expect(state).toBeNull();expect(frames).toBeLessThan(1600);
    item.setContainerRolling(state);expect(item.isPickable()).toBe(true);
    // Edge support is a Scene concern: switching grounded→falling clears pickability.
    item.markFalling(1601,{x:100,y:0});expect(item.isPickable()).toBe(false);expect(item.isCatchable()).toBe(true);
  });
  it('consumes explicit Capsule normal/action blast rows once, preserving native fallback and down immunity flag', () => {
    const hit=thrownItemHit(CAPSULE_DEFINITION,'throw-ground-forward-strong',{vx:100,vy:100},1,1,true);
    expect(hit.damage).toBe(21);
    const boom=containerBreakOutcome(CAPSULE_DEFINITION.container!,{...draws,explosionRoll:0,throwAction:'throw-ground-forward-strong'});
    expect(boom).toMatchObject({kind:'explosion',explosion:{damage:53}});
    expect(containerBreakOutcome(CAPSULE_DEFINITION.container!,{...draws,explosionRoll:0})).toMatchObject({explosion:{damage:22}});
    expect(CAPSULE_DEFINITION.container?.downThrowOwnerImmune).toBe(true);
    expect(CRATE_DEFINITION.container?.downThrowOwnerImmune).toBeUndefined();
  });
});
