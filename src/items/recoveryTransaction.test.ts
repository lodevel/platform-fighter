/** Independent exact-entity boundary fixtures, deferred until final checks. */
import {describe,it,expect} from 'vitest';
import {recoveryTransactionAccepted,parseRecoveryTransactionEvent,parseRecoveryEatingState,parseRecoveryHealingState} from './recoveryTransaction';
const spec={amount:7,mode:'instant' as const,delayFrames:0,pointsPerFrame:0,eat:true};
const event={itemId:14,entityGeneration:23,actorGeneration:2,entryFrame:30,kind:'consume' as const,spec,amount:7};
const live={playerIndex:0,actorGeneration:2,itemId:14,entityGeneration:23,heldByPlayer:0,despawned:false,recovery:spec};
describe('atomic recovery transaction identity',()=>{
  it('admits real instant Food with zero healing rate and a distinct gradual budget unchanged',()=>{
    expect(recoveryTransactionAccepted(event,live)).toBe(true);
    const gradual={amount:100,mode:'gradual' as const,delayFrames:0,pointsPerFrame:1,eat:false};
    expect(recoveryTransactionAccepted({...event,spec:gradual,amount:100},{...live,recovery:gradual})).toBe(true);
  });
  it('rejects expired, stolen, replaced and owner-generation mismatches before healing',()=>{
    for(const changed of [{despawned:true},{heldByPlayer:1},{itemId:15},{entityGeneration:24},{actorGeneration:3}])
      expect(recoveryTransactionAccepted(event,{...live,...changed})).toBe(false);
  });
  it('rejects forged amounts/specs and restored callbacks from another spawn',()=>{
    expect(recoveryTransactionAccepted({...event,amount:100},live)).toBe(false);
    expect(recoveryTransactionAccepted({...event,spec:{...spec,amount:8},amount:8},live)).toBe(false);
    const restored=parseRecoveryTransactionEvent(JSON.parse(JSON.stringify(event)));
    expect(recoveryTransactionAccepted(restored,{...live,entityGeneration:24})).toBe(false);
  });
  it('drop/discard consume no healing and must still own the exact original object',()=>{
    expect(recoveryTransactionAccepted({...event,kind:'drop',amount:0},live)).toBe(true);
    expect(recoveryTransactionAccepted({...event,kind:'discard',amount:0},{...live,heldByPlayer:1})).toBe(false);
    expect(recoveryTransactionAccepted({...event,kind:'drop',amount:7},live)).toBe(false);
  });
  it('rejects nonfinite or unknown checkpoint fields and invalid gradual budgets',()=>{
    expect(()=>parseRecoveryTransactionEvent({...event,entityGeneration:Infinity})).toThrow();
    expect(()=>parseRecoveryTransactionEvent({...event,callbackAlreadyApplied:true})).toThrow();
    expect(()=>parseRecoveryHealingState({remaining:20,delay:0,rate:0})).toThrow();
    expect(()=>parseRecoveryEatingState({itemId:14,amount:7,age:0,walking:false,consumed:false,entryFrame:30,facing:1,
      spec,entityGeneration:23,actorGeneration:Infinity},2,5)).toThrow();
  });
});
