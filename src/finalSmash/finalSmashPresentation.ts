/** STAGED. Read-only HUD model; current saved binding label is supplied by
 * input configuration, never a new hardcoded activation key or UI clock. */
import type {FinalResource} from './finalSmashSchema';
import type {FinalPlayerResource} from './FinalSmashController';
export interface FinalHudModel {readonly visible:boolean;readonly meterVisible:boolean;readonly fillRatio:number;
  readonly ready:boolean;readonly resource:FinalResource|null;readonly hint:string|null;}
export function finalHudModel(input:{readonly player:FinalPlayerResource;readonly meterEnabled:boolean;
  readonly availableResource:FinalResource|null;readonly specialBindingLabel:string;readonly gameplayFrame:number;}):FinalHudModel{
  const ready=input.availableResource!==null;
  const standbyAge = input.player.meter.standbySinceFrame === null ? null :
    Math.max(0, input.gameplayFrame - input.player.meter.standbySinceFrame);
  // Inferred display-only drain: source decrease starts600, removes1200;
  // actual native curve unavailable. Gameplay readiness remains independent.
  const displayRatio = !input.player.ballStandby && standbyAge !== null
    ? Math.max(0, Math.min(1, (1200 - standbyAge) / 600)) : input.player.meter.points / 2000;
  return Object.freeze({visible:input.meterEnabled||input.player.ballStandby,meterVisible:input.meterEnabled,
    fillRatio:Math.max(0,Math.min(1,displayRatio)),ready,resource:input.availableResource,
    hint:ready?'Final Smash · '+input.specialBindingLabel:null});
}
