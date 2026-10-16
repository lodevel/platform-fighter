/** Prepared for the final verification, not executed during authoring.
 * Input decisions alone do not prove controller admission or Final art. */
import {describe,expect,it} from 'vitest';
import {finalSmashCpuInput,type FinalCpuContext} from './finalSmashCpuPolicy';
import type {CharacterInput} from '../characters/Character';

const base:CharacterInput={moveX:.8,moveY:-1,jump:true,attack:true,attackHeavy:true,
  special:true,shield:true,grab:true,dodge:true,dropThrough:true,attackStickX:1,attackStickY:1};
function context():FinalCpuContext {
  return {self:{playerIndex:0,generation:7,position:{x:0,y:10},facing:1,grounded:true,
    active:true,eligible:true,legallyActionable:true},target:{playerIndex:1,generation:3,
    position:{x:100,y:10},active:true},availableResource:'ball',activeFinal:false,previousSpecialHeld:false};
}
describe('authored CPU Final input strategy',()=>{
  it('emits neutral special and clears conflicting actions without mutating base input',()=>{
    const decision=finalSmashCpuInput(base,context());
    expect(decision.strategy).toBe('activate-final');
    expect(decision.input).toMatchObject({moveX:0,moveY:0,special:true,jump:false,
      attack:false,attackHeavy:false,shield:false,grab:false,dodge:false,dropThrough:false,
      attackStickX:0,attackStickY:0,ledgeRelease:null,appeal:false});
    expect(base.moveX).toBe(.8);
    expect(base.attack).toBe(true);
  });
  it('turns through ground movement first, then uses actual facing to release and press a fresh edge',()=>{
    const first={...context(),target:{...context().target!,position:{x:-100,y:10}}};
    const turn=finalSmashCpuInput(base,first);
    expect(turn.strategy).toBe('face-target');
    expect(turn.input.moveX).toBe(-1);
    expect(turn.input.special).toBe(false);
    const faced={...first,self:{...first.self,facing:-1 as const},previousSpecialHeld:true};
    expect(finalSmashCpuInput(base,faced).strategy).toBe('release-special');
    expect(finalSmashCpuInput(base,{...faced,previousSpecialHeld:false}).strategy).toBe('activate-final');
  });
  it('allows aligned air activation and preserves directional recovery when facing away in the air',()=>{
    const air={...context(),self:{...context().self,grounded:false}};
    expect(finalSmashCpuInput(base,air).strategy).toBe('activate-final');
    const behind={...air,target:{...air.target!,position:{x:-100,y:10}}};
    expect(finalSmashCpuInput(base,behind).input).toBe(base);
    const neutral={...base,moveX:0,moveY:0};
    const waiting=finalSmashCpuInput(neutral,behind);
    expect(waiting.strategy).toBe('wait-air-facing');
    expect(waiting.input.special).toBe(false);
    expect(waiting.input.jump).toBe(true);
  });
  it('retains base decisions whenever admission, ownership, opponent or eligibility is absent',()=>{
    for(const ctx of [{...context(),availableResource:null},{...context(),activeFinal:true},
      {...context(),self:{...context().self,eligible:false}},
      {...context(),self:{...context().self,legallyActionable:false}},
      {...context(),self:{...context().self,active:false}}, {...context(),target:null},
      {...context(),target:{...context().target!,active:false}},
      {...context(),target:{...context().target!,playerIndex:0}}]){
      expect(finalSmashCpuInput(base,ctx).input).toBe(base);
      expect(finalSmashCpuInput(base,ctx).strategy).toBe('base');
    }
  });
  it('handles either facing and equal-X targets deterministically without pending clocks',()=>{
    const left={...context(),self:{...context().self,facing:-1 as const},
      target:{...context().target!,position:{x:-100,y:10}},availableResource:'meter' as const};
    expect(finalSmashCpuInput(base,left).strategy).toBe('activate-final');
    const vertical={...left,target:{...left.target!,position:{x:0,y:-100}}};
    expect(finalSmashCpuInput(base,vertical)).toEqual(finalSmashCpuInput(base,vertical));
    expect(finalSmashCpuInput(base,vertical).strategy).toBe('activate-final');
  });
  it('fails closed on malformed actor identities and nonfinite positions instead of creating a target',()=>{
    for(const ctx of [{...context(),self:{...context().self,generation:-1}},
      {...context(),target:{...context().target!,generation:NaN}},
      {...context(),self:{...context().self,position:{x:NaN,y:10}}},
      {...context(),target:{...context().target!,position:{x:100,y:Infinity}}}]){
      expect(finalSmashCpuInput(base,ctx).strategy).toBe('base');
    }
  });
});
