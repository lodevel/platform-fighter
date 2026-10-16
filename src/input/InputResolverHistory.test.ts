/** Prepared for the coordinated final phase; not executed during preparation. */
import {describe,it,expect} from 'vitest';
import {InputResolver,buildCharacterInputFromResolver,parseInputResolverHistoryState} from './InputResolver';
import {DeviceInputDispatcher,type GamepadSource} from './DeviceInputDispatcher';
import {InputBindingsStore} from './InputBindingsStore';
import {KEY_CODE} from './keyCodes';
const harness=()=>{const keys=new Set<number>();
  const gamepad:GamepadSource={isConnected:()=>false,getButton:()=>({pressed:false,value:0}),getAxis:()=>0};
  const dispatcher=new DeviceInputDispatcher({keyboard:{isDown:code=>keys.has(code)},gamepad,bindings:new InputBindingsStore()});
  return {keys,resolver:new InputResolver({dispatcher,slots:[1]})};};
describe('authoritative resolver continuation cache',()=>{
  it('does not invent a second C-stick smash edge after restoring a held stick',()=>{
    const axis={x:0},pad:GamepadSource={isConnected:()=>true,getButton:()=>({pressed:false,value:0}),getAxis:(_pad,which)=>which===2?axis.x:0};
    const create=()=>new InputResolver({dispatcher:new DeviceInputDispatcher({keyboard:{isDown:()=>false},gamepad:pad,
      bindings:new InputBindingsStore()}),slots:[3]});
    const original=create();original.update(0);buildCharacterInputFromResolver(original,3);
    axis.x=1;original.update(1);expect(buildCharacterInputFromResolver(original,3).attackHeavy).toBe(true);
    const restored=create();restored.restoreHistoryState(JSON.parse(JSON.stringify(original.captureHistoryState())));
    for(const resolver of [original,restored]){resolver.update(2);expect(buildCharacterInputFromResolver(resolver,3).attackHeavy).toBe(false);}
    axis.x=0;for(const resolver of [original,restored]){resolver.update(3);buildCharacterInputFromResolver(resolver,3);}
    axis.x=1;for(const resolver of [original,restored]){resolver.update(4);expect(buildCharacterInputFromResolver(resolver,3).attackHeavy).toBe(true);}
  });
  it('restores a pending first down tap and produces the same genuine second physical tap',()=>{
    const a=harness();a.resolver.update(0);buildCharacterInputFromResolver(a.resolver,1);
    a.keys.add(KEY_CODE.S);a.resolver.update(1);expect(buildCharacterInputFromResolver(a.resolver,1).dropThrough).toBe(false);
    a.keys.clear();a.resolver.update(2);buildCharacterInputFromResolver(a.resolver,1);
    const snapshot=JSON.parse(JSON.stringify(a.resolver.captureHistoryState()));const b=harness();b.resolver.restoreHistoryState(snapshot);
    for(const h of [a,b]){h.keys.add(KEY_CODE.S);h.resolver.update(3);expect(buildCharacterInputFromResolver(h.resolver,1).dropThrough).toBe(true);}
    expect(b.resolver.captureHistoryState()).toEqual(a.resolver.captureHistoryState());
  });
  it('reset retires a pending down-tap window rather than leaking it into another session',()=>{
    const h=harness();h.resolver.update(0);buildCharacterInputFromResolver(h.resolver,1);
    h.keys.add(KEY_CODE.S);h.resolver.update(1);buildCharacterInputFromResolver(h.resolver,1);h.resolver.reset();
    h.keys.clear();h.resolver.update(2);buildCharacterInputFromResolver(h.resolver,1);
    h.keys.add(KEY_CODE.S);h.resolver.update(3);expect(buildCharacterInputFromResolver(h.resolver,1).dropThrough).toBe(false);
  });
  it('rejects duplicate/untracked slots, malformed axes and an invented future first tap',()=>{
    const h=harness(),s=h.resolver.captureHistoryState(),row=s.slots[0]!;
    expect(()=>parseInputResolverHistoryState({...s,slots:[row,row]})).toThrow();
    expect(()=>parseInputResolverHistoryState({...s,slots:[{...row,state:{...row.state,moveX:NaN}}]})).toThrow();
    expect(()=>parseInputResolverHistoryState({...s,slots:[{...row,dropThrough:{prevDown:false,lastDownPressFrame:2,frameCounter:2}}]})).toThrow();
    expect(()=>h.resolver.restoreHistoryState({...s,slots:[{...row,slot:2}]})).toThrow();
  });
});
