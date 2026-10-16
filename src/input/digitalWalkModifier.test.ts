import {describe,it,expect} from 'vitest';
import {DeviceInputDispatcher,DIGITAL_WALK_MAGNITUDE,type GamepadSource} from './DeviceInputDispatcher';
import {InputBindingsStore} from './InputBindingsStore';
import {InputResolver,buildCharacterInputFromResolver} from './InputResolver';
import {deserializePlayerBindings,serializePlayerBindings} from './InputBindingsSerializer';
import {createLocomotionState,resolveLocomotionTuning,tickLocomotion} from '../characters/locomotionState';
import {KEY_CODE} from './keyCodes';

describe('actual remappable digital walk/tilt control',()=>{
  const harness=()=>{const keys=new Set<number>(),store=new InputBindingsStore(),axis={x:0};
    const gamepad:GamepadSource={isConnected:()=>true,getAxis:(_index,which)=>which===0?axis.x:0,getButton:()=>({pressed:false,value:0})};
    const dispatcher=new DeviceInputDispatcher({bindings:store,keyboard:{isDown:key=>keys.has(key)},gamepad}),
      resolver=new InputResolver({dispatcher,slots:[1,2,3]});
    return {keys,store,axis,dispatcher,resolver};};
  it('passes a genuine held keyboard modifier into the normal resolver and walk admission',()=>{
    const h=harness();h.resolver.update(0);h.keys.add(KEY_CODE.D);h.keys.add(KEY_CODE.SHIFT);h.resolver.update(1);
    const input=buildCharacterInputFromResolver(h.resolver,1);
    expect(input.moveX).toBe(DIGITAL_WALK_MAGNITUDE);
    expect(tickLocomotion(createLocomotionState(),{...input,moveY:0,prevMoveX:0,grounded:true,facing:1},resolveLocomotionTuning()).name).toBe('walk');
    h.keys.delete(KEY_CODE.SHIFT);h.resolver.update(2);
    expect(buildCharacterInputFromResolver(h.resolver,1).moveX).toBe(1);
    h.keys.add(KEY_CODE.A);h.resolver.update(3);expect(buildCharacterInputFromResolver(h.resolver,1).moveX).toBe(0);
  });
  it('saves/reloads a custom modifier and preserves older layouts without a new default binding',()=>{
    const h=harness(),original=h.store.get(1),custom={...original,bindings:{...original.bindings,walk:[{kind:'keyboard' as const,keyCode:KEY_CODE.CTRL}]}};
    h.store.set(1,deserializePlayerBindings(serializePlayerBindings(custom),1));h.keys.add(KEY_CODE.A);h.keys.add(KEY_CODE.CTRL);
    expect(h.dispatcher.sampleMoveX(1)).toBe(-DIGITAL_WALK_MAGNITUDE);
    const legacy=JSON.parse(serializePlayerBindings(original));delete legacy.data.bindings.walk;
    const restored=deserializePlayerBindings(JSON.stringify(legacy),1);expect(restored.bindings.walk).toEqual([]);
    h.store.set(1,restored);expect(h.dispatcher.sampleMoveX(1)).toBe(-1);
  });
  it('keeps analog input and P2 vertical/jump controls intact',()=>{
    const h=harness();h.axis.x=.6;expect(h.dispatcher.sampleMoveX(3)).toBe(.6);
    h.keys.add(KEY_CODE.NUMPAD_8);h.keys.add(KEY_CODE.ARROW_LEFT);h.keys.add(KEY_CODE.ARROW_UP);
    expect(h.dispatcher.sampleMoveX(2)).toBe(-DIGITAL_WALK_MAGNITUDE);
    expect(h.dispatcher.sampleMoveY(2)).toBe(-1);expect(h.dispatcher.isActionHeld(2,'jump')).toBe(true);
  });
});
