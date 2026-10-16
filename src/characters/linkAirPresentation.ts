/** Presentation only: actual takeoff/status observations select captured Link
 * resources. Sign-based drift and one advancing tick per raw motion tick are
 * explicit common-caller adapters, not recovered vanilla selector/rate proof.
 * The gameplay owner advances this reducer; render getters only read it. */
export interface LinkAirObservation {
  readonly generation:number; readonly frame:number; readonly clockAdvances:boolean;
  readonly grounded:boolean; readonly bodyAvailable:boolean;
  readonly helpless:boolean; readonly tumbling:boolean;
  readonly facing:1|-1; readonly velocity:{readonly x:number;readonly y:number};
  readonly jumpEventSerial:number;
  readonly jump:{readonly kind:'ground'|'air'|'ledge';readonly facing:1|-1;
    readonly moveX:number;readonly velocityX:number;readonly shortHop:boolean;readonly framesElapsed:number}|null;
  readonly fallOwner:'footstool'|'tumble'|'source-helpless'|'ordinary';
}
export interface LinkAirPresentationState {
  readonly generation:number;readonly lastFrame:number;readonly lastJumpEventSerial:number;
  readonly phase:'grounded'|'blocked'|'tumble'|'jump'|'fall';
  readonly motion:string|null;readonly rawAge:number;readonly facing:1|-1;
  readonly damageFall:boolean;
}
export function parseLinkAirPresentationState(value:unknown):LinkAirPresentationState|null {
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Malformed Link air checkpoint');
  const s=value as LinkAirPresentationState;
  if(![s.generation,s.lastFrame,s.lastJumpEventSerial,s.rawAge].every(n=>Number.isSafeInteger(n)&&n>=0)||
    !['grounded','blocked','tumble','jump','fall'].includes(s.phase)||![1,-1].includes(s.facing)||typeof s.damageFall!=='boolean')
    throw new TypeError('Malformed Link air checkpoint clock/status');
  const jumps=new Set(['jump_f','jump_b','jump_f_mini','jump_b_mini','jump_aerial_f','jump_aerial_b','cliff_jump_quick2']);
  const falls=new Set(['fall','fall_f','fall_b','fall_aerial','fall_aerial_f','fall_aerial_b',
    'fall_special','fall_special_f','fall_special_b','fall_damage']);
  if(s.phase==='jump'?!jumps.has(s.motion as string):s.phase==='fall'?!falls.has(s.motion as string):s.motion!==null)
    throw new TypeError('Malformed Link air checkpoint motion owner');
  if(s.damageFall&&(s.phase!=='fall'||s.motion!=='fall_damage')||!s.damageFall&&s.motion==='fall_damage')
    throw new TypeError('Malformed Link DamageFall checkpoint owner');
  return Object.freeze({...s});
}
function validate(o:LinkAirObservation):void {
  if(![o.generation,o.frame,o.jumpEventSerial].every(n=>Number.isSafeInteger(n)&&n>=0)||
    ![o.velocity.x,o.velocity.y].every(Number.isFinite)||![1,-1].includes(o.facing)||
    ![o.grounded,o.bodyAvailable,o.helpless,o.tumbling,o.clockAdvances].every(v=>typeof v==='boolean')||
    !['footstool','tumble','source-helpless','ordinary'].includes(o.fallOwner))throw new TypeError('Malformed actual Link air observation');
  const j=o.jump;
  if(j&&(!['ground','air','ledge'].includes(j.kind)||![1,-1].includes(j.facing)||
    ![j.moveX,j.velocityX].every(Number.isFinite)||typeof j.shortHop!=='boolean'||
    !Number.isSafeInteger(j.framesElapsed)||j.framesElapsed<0))throw new TypeError('Malformed actual Link takeoff observation');
}
/** No invented velocity epsilon: zero drift alone selects the neutral motion.
 * The native neutral/F/B deadzone and rate consumer remain unresolved. */
function drift(x:number,facing:1|-1):''|'_f'|'_b' {
  return x===0?'':Math.sign(x)===facing?'_f':'_b';
}
export function advanceLinkAirPresentation(previous:LinkAirPresentationState|null,o:LinkAirObservation):LinkAirPresentationState {
  validate(o);
  const p=previous?.generation===o.generation?previous:null;
  if(p&&o.frame<p.lastFrame)throw new RangeError('Link air presentation requires a restored checkpoint before rewind');
  if(p&&o.jumpEventSerial<p.lastJumpEventSerial)throw new RangeError('Link takeoff serial regressed within a generation');
  // Two consumers observing the same input frame cannot advance or relatch it.
  if(p&&o.frame===p.lastFrame)return p;
  const newJump=!!o.jump&&(!p||o.jumpEventSerial!==p.lastJumpEventSerial);
  const damageFall=!o.grounded&&!newJump&&!o.helpless&&!o.tumbling&&o.fallOwner!=='tumble'&&o.fallOwner!=='footstool'&&o.bodyAvailable&&
    (p?.phase==='tumble'||p?.damageFall===true);
  let phase:LinkAirPresentationState['phase'],motion:string|null=null,facing=o.facing;
  if(o.grounded)phase='grounded';
  else if(o.tumbling||o.fallOwner==='tumble')phase='tumble';
  else if(!o.bodyAvailable||o.fallOwner==='footstool')phase='blocked';
  else if(!o.helpless&&!damageFall&&o.jump&&o.velocity.y<0) {
    phase='jump';facing=o.jump.facing;
    const direction=o.jump.velocityX===0?Math.sign(o.jump.moveX):Math.sign(o.jump.velocityX);
    const suffix=direction!==0&&direction!==facing?'b':'f';
    motion=o.jump.kind==='ledge'?'cliff_jump_quick2':o.jump.kind==='air'?`jump_aerial_${suffix}`:
      `jump_${suffix}${o.jump.shortHop?'_mini':''}`;
  } else {
    phase='fall';
    motion=damageFall?'fall_damage':`${o.helpless?'fall_special':o.jump?.kind==='air'?'fall_aerial':'fall'}${drift(o.velocity.x,facing)}`;
  }
  // Falling begins at its own zero-age admission, never at stale jump age.
  // Changing drift resource admits a new drawing clock; stopped observations
  // update status bookkeeping but never accrue a dose or catch up missed ticks.
  const rawAge=phase==='jump'?o.jump!.framesElapsed:motion&&p?.phase===phase&&p.motion===motion&&p.facing===facing&&!newJump?
    p.rawAge+(o.clockAdvances?1:0):0;
  if(!Number.isSafeInteger(rawAge))throw new RangeError('Link air motion clock overflow');
  return Object.freeze({generation:o.generation,lastFrame:o.frame,lastJumpEventSerial:o.jumpEventSerial,
    phase,motion,rawAge,facing,damageFall});
}
export function selectLinkAirPresentation(state:LinkAirPresentationState|null):
  {readonly motion:string;readonly rawAge:number;readonly facing:1|-1;readonly terminal:boolean}|null {
  return state?.motion?Object.freeze({motion:state.motion,rawAge:state.rawAge,facing:state.facing,terminal:state.phase==='jump'}):null;
}
