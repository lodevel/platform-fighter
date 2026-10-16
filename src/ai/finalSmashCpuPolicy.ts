/** Authored CPU strategy, independent of Ultimate mechanics. The Scene
 * supplies current eligibility/resource/admission and records these same
 * CharacterInput records used by players. No resource grant, direct actor
 * facing write, private activation call, RNG or hidden phase clock lives here. */
import type {CharacterInput} from '../characters/Character';
import type {FinalResource} from '../finalSmash/finalSmashSchema';

export interface FinalCpuActor {
  readonly playerIndex:number;
  readonly generation:number;
  readonly position:{readonly x:number;readonly y:number};
  readonly facing:1|-1;
  readonly grounded:boolean;
  readonly active:boolean;
  readonly eligible:boolean;
  readonly legallyActionable:boolean;
}
export interface FinalCpuOpponent {
  readonly playerIndex:number;
  readonly generation:number;
  readonly position:{readonly x:number;readonly y:number};
  readonly active:boolean;
}
export interface FinalCpuContext {
  readonly self:FinalCpuActor;
  /** Nearest current active opponent selected by actual Scene perception.
   * There is no retained/captured target or target-generation lease here. */
  readonly target:FinalCpuOpponent|null;
  readonly availableResource:FinalResource|null;
  readonly activeFinal:boolean;
  /** The previous FINAL input record, including policy overrides, not the
   * underlying tier provider's previous unmodified button state. */
  readonly previousSpecialHeld:boolean;
}
export interface FinalCpuDecision {
  readonly input:CharacterInput;
  readonly strategy:'base'|'face-target'|'release-special'|'activate-final'|'wait-air-facing';
}
function liveIdentity(actor:FinalCpuActor|FinalCpuOpponent):boolean {
  return actor.active && Number.isSafeInteger(actor.playerIndex) && actor.playerIndex>=0
    && Number.isSafeInteger(actor.generation) && actor.generation>=0
    && Number.isFinite(actor.position.x) && Number.isFinite(actor.position.y);
}
function finalIntent(base:CharacterInput,moveX:number,special:boolean):CharacterInput {
  return Object.freeze({...base,moveX,moveY:0,jump:false,attack:false,attackHeavy:false,
    attackStickX:0,attackStickY:0,special,grab:false,shield:false,dodge:false,
    dropThrough:false,ledgeRelease:null,appeal:false});
}
export function finalSmashCpuInput(base:CharacterInput,context:FinalCpuContext):FinalCpuDecision {
  const {self,target}=context;
  const preserve=():FinalCpuDecision=>Object.freeze({input:base,strategy:'base'});
  if(!liveIdentity(self)||!self.eligible||!self.legallyActionable||context.activeFinal
    ||(context.availableResource!=='ball'&&context.availableResource!=='meter')
    ||(self.facing!==1&&self.facing!==-1)||!target||!liveIdentity(target)
    ||target.playerIndex===self.playerIndex)return preserve();
  const dx=target.position.x-self.position.x;
  const targetFacing:1|-1=dx===0?self.facing:dx>0?1:-1;
  if(targetFacing!==self.facing){
    if(self.grounded)return Object.freeze({input:finalIntent(base,targetFacing,false),strategy:'face-target'});
    // Air drift cannot turn an actor. Preserve the base recovery/navigation
    // commands; defer an accidental neutral special until actual facing or
    // grounding changes. Directional recovery specials stay available.
    const neutral=Math.abs(base.moveX)<.35&&Math.abs(base.moveY??0)<.35;
    return Object.freeze({input:neutral&&base.special===true?Object.freeze({...base,special:false}):base,
      strategy:'wait-air-facing'});
  }
  if(context.previousSpecialHeld)return Object.freeze({input:finalIntent(base,0,false),strategy:'release-special'});
  return Object.freeze({input:finalIntent(base,0,true),strategy:'activate-final'});
}
