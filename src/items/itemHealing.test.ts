import {describe,it,expect} from 'vitest';
import {beginEating,stepEating,beginHealing,stepHealing} from './itemHealing';
import {FOOD_HEAL_AMOUNTS,FOOD_VARIANTS,foodDefinition} from './Food';
import {HEART_CONTAINER_DEFINITION} from './HeartContainer';
import {MAXIM_TOMATO_DEFINITION} from './MaximTomato';

describe('Ultimate recovery items',()=>{
  it('keeps all 36 regular food varieties and excludes character-only foods',()=>{
    expect(FOOD_VARIANTS).toHaveLength(36);
    expect(FOOD_HEAL_AMOUNTS.Cherries).toBe(1);expect(FOOD_HEAL_AMOUNTS.Turkey).toBe(15);
    expect(FOOD_HEAL_AMOUNTS['Strawberry shortcake']).toBe(11);
    expect(FOOD_VARIANTS).not.toContain('Daisy');expect(FOOD_VARIANTS).not.toContain('Power Pellet');
    expect(foodDefinition('Bread').recovery?.amount).toBe(10);
  });
  it('drops unconsumed food on a flinch and never heals from the aborted eat',()=>{
    let eat=beginEating(FOOD_HEAL_AMOUNTS.Apple,17,false);
    eat=stepEating(eat,{frozen:false,flinched:false}).state!;
    const result=stepEating(eat,{frozen:false,flinched:true});
    expect(result.state).toBeNull();expect(result.event).toBe('drop');expect(result.amount).toBe(0);
  });
  it('freezes the temporary hold on hitlag and consumes exactly once',()=>{
    let eat=beginEating(7,3,true);
    expect(stepEating(eat,{frozen:true,flinched:false}).state).toEqual(eat);
    let heals=0;
    for(let f=0;f<11;f++){const r=stepEating(eat,{frozen:false,flinched:false});heals+=r.amount;if(r.state)eat=r.state;else break;}
    expect(heals).toBe(7);
  });
  it('heals the live meter so an intervening attack reduces net recovery once',()=>{
    let state=beginHealing(MAXIM_TOMATO_DEFINITION.recovery!),percent=120,total=0;
    for(let f=0;f<80;f++){
      if(f===20)percent+=10;
      const r=stepHealing(state,percent,false);state=r.state;percent=r.percent;total+=r.healed;
    }
    expect(percent).toBe(80);expect(total).toBe(50);expect(state).toBeNull();
  });
  it('heart heals gradually up to 100 and hitlag pauses its clock',()=>{
    const state=beginHealing(HEART_CONTAINER_DEFINITION.recovery!);
    expect(stepHealing(state,150,true)).toEqual({state,percent:150,healed:0});
    expect(stepHealing(state,150,false).percent).toBe(149);
    let current=state,percent=150;
    for(let f=0;f<100;f++){const r=stepHealing(current,percent,false);current=r.state;percent=r.percent;}
    expect(percent).toBe(50);expect(current).toBeNull();
  });
  it('discards excess healing at zero rather than shielding future damage',()=>{
    const r=stepHealing(beginHealing(HEART_CONTAINER_DEFINITION.recovery!),.25,false);
    expect(r.percent).toBe(0);expect(r.healed).toBe(.25);expect(r.state).toBeNull();
    expect(stepHealing(r.state,10,false).percent).toBe(10);
  });
});
