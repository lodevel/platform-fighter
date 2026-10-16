/** Selected cinematic recipient presentation capability. Its eight profile
 * keys require new genuine authored rig/sample/SHA assets. No captured victim
 * NUANMB/caller or source-native pose rate is claimed by this reducer. */
export type FinalVictimFighter = 'donkeykong' | 'pikachu' | 'link';
export type CapturingFinalOwner = 'donkeykong' | 'pikachu';
export type FinalVictimOwnerPhase = 'start' | 'success' | 'end' | 'hit' | 'attack' | 'attack2' | 'attack-finish' | 'return' | 'finish';
export type FinalCapturedVictimPhase = 'jungle-entry' | 'jungle-barrage' | 'jungle-uppercut-pre'
  | 'volt-caught' | 'volt-vortex' | 'volt-burst-pre';
export type FinalVictimProfileKey = 'final_victim_jungle_entry' | 'final_victim_jungle_stagger_a'
  | 'final_victim_jungle_stagger_b' | 'final_victim_jungle_uppercut_pre' | 'final_victim_volt_caught'
  | 'final_victim_volt_vortex' | 'final_victim_volt_burst_pre' | 'final_victim_ancient_impact';
export interface FinalVictimIdentity {
  readonly runId: number; readonly ownerPlayerIndex: number; readonly ownerGeneration: number;
  readonly victimPlayerIndex: number; readonly victimGeneration: number; readonly victimFighter: FinalVictimFighter;
}
export interface FinalCapturedVictimState extends FinalVictimIdentity {
  readonly schema: 'final-victim-presentation/1'; readonly kind: 'captured'; readonly ownerFighter: CapturingFinalOwner;
  readonly entryFrame: number; readonly lastFrame: number; readonly facing: 1 | -1;
  readonly phase: FinalCapturedVictimPhase; readonly phaseAge: number;
  readonly ownerPhase: FinalVictimOwnerPhase; readonly ownerPhaseRevision: number;
  readonly jungleReactionKey: 0 | 1; readonly acceptedLinkingHitReceipts: readonly string[];
}
export interface FinalImpactVictimState extends FinalVictimIdentity {
  readonly schema: 'final-victim-presentation/1'; readonly kind: 'impact-stop'; readonly ownerFighter: 'link';
  readonly entryFrame: number; readonly lastFrame: number; readonly facing: 1 | -1; readonly stopPresentationAge: number;
  readonly packet: 'ancient-fighter-blast' | 'ancient-terrain-blast'; readonly acceptedHitReceipt: string;
}
export type FinalVictimPresentationState = FinalCapturedVictimState | FinalImpactVictimState;
function integer(v: unknown,p: string): number { if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new TypeError(`${p} must be nonnegative safe integer`);return v; }
function age(v: unknown,p: string): number { if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new TypeError(`${p} must be finite nonnegative actual source age`);return v; }
function text(v: unknown,p: string): string { if(typeof v!=='string'||!v.trim())throw new TypeError(`${p} must be actual receipt text`);return v; }
function bool(v: unknown,p: string): boolean { if(typeof v!=='boolean')throw new TypeError(`${p} must be explicit`);return v; }
function identity(v: FinalVictimIdentity): FinalVictimIdentity {
  const result={runId:integer(v.runId,'runId'),ownerPlayerIndex:integer(v.ownerPlayerIndex,'ownerPlayerIndex'),
    ownerGeneration:integer(v.ownerGeneration,'ownerGeneration'),victimPlayerIndex:integer(v.victimPlayerIndex,'victimPlayerIndex'),
    victimGeneration:integer(v.victimGeneration,'victimGeneration'),victimFighter:v.victimFighter};
  if(result.runId===0||result.ownerPlayerIndex===result.victimPlayerIndex||!['donkeykong','pikachu','link'].includes(result.victimFighter))
    throw new TypeError('Actual distinct run/recipient identity required');
  return result;
}
function facing(v: unknown): 1 | -1 { if(v!==1&&v!==-1)throw new TypeError('Capture-entry facing must be1/-1');return v; }
function phase(owner: CapturingFinalOwner,v: unknown): FinalCapturedVictimPhase {
  const allowed=owner==='donkeykong'?['jungle-entry','jungle-barrage','jungle-uppercut-pre']:
    owner==='pikachu'?['volt-caught','volt-vortex','volt-burst-pre']:[];
  if(!allowed.includes(v as string))throw new TypeError('Actual phase must belong to this capturing Final');return v as FinalCapturedVictimPhase;
}
function semanticOwnerPhase(owner: CapturingFinalOwner, actual: unknown): FinalCapturedVictimPhase {
  if(owner==='donkeykong'){
    if(actual==='start')return 'jungle-entry';
    if(actual==='success')return 'jungle-barrage';
    if(actual==='end')return 'jungle-uppercut-pre';
  }else if(owner==='pikachu'){
    if(actual==='hit')return 'volt-caught';
    if(['attack','attack2','attack-finish','return'].includes(actual as string))return 'volt-vortex';
    if(actual==='finish')return 'volt-burst-pre';
  }
  throw new TypeError('Actual owner status must belong to this capturing Final');
}
export function finalVictimIdentityMatches(state: FinalVictimIdentity,live: FinalVictimIdentity): boolean {
  identity(live);return (['runId','ownerPlayerIndex','ownerGeneration','victimPlayerIndex','victimGeneration','victimFighter'] as const)
    .every(key=>state[key]===live[key]);
}
export function beginFinalCapturedVictimPresentation(input: FinalVictimIdentity & {
  readonly frame: number; readonly facing: 1 | -1; readonly ownerFighter: CapturingFinalOwner; readonly acceptedCapture: boolean;
  readonly phaseAge: number;
  readonly ownerPhase: FinalVictimOwnerPhase; readonly ownerPhaseRevision: number;
}): FinalCapturedVictimState | null {
  const id=identity(input),frame=integer(input.frame,'frame'),f=facing(input.facing),phaseAge=age(input.phaseAge,'phaseAge');
  if(input.ownerFighter!=='donkeykong'&&input.ownerFighter!=='pikachu')throw new TypeError('AncientArrow has no selected long capture lease');
  if(!bool(input.acceptedCapture,'acceptedCapture'))return null;
  const selectedPhase=semanticOwnerPhase(input.ownerFighter,input.ownerPhase),revision=integer(input.ownerPhaseRevision,'ownerPhaseRevision');
  return Object.freeze({...id,schema:'final-victim-presentation/1',kind:'captured',ownerFighter:input.ownerFighter,
    entryFrame:frame,lastFrame:frame,facing:f,phase:selectedPhase,ownerPhase:input.ownerPhase,ownerPhaseRevision:revision,
    phaseAge,jungleReactionKey:0,acceptedLinkingHitReceipts:Object.freeze([])});
}
/** Actual hit receipt, never attempted packet/camera/video frame, selects DK
 * reaction key. A same-step hitstop can begin after this receipt; no time tick
 * or independent victim animation clock is manufactured here. */
export function confirmFinalVictimLinkingHit(state: FinalCapturedVictimState,input: FinalVictimIdentity & {
  readonly frame: number; readonly acceptedHit: boolean; readonly receiptId: string;
  readonly packetRole: 'dk-early' | 'dk-late' | 'pika-loop';
}): FinalCapturedVictimState {
  const frame=integer(input.frame,'hit.frame'),receipt=text(input.receiptId,'hit.receiptId');
  if(frame<state.lastFrame||!bool(input.acceptedHit,'acceptedHit')||!finalVictimIdentityMatches(state,input))return state;
  if(state.ownerFighter==='donkeykong'?!['dk-early','dk-late'].includes(input.packetRole):input.packetRole!=='pika-loop')
    throw new TypeError('Detector/finisher/nonmatching packets never advance linking reaction');
  if(state.acceptedLinkingHitReceipts.includes(receipt))return state;
  return Object.freeze({...state,jungleReactionKey:state.ownerFighter==='donkeykong'?(state.jungleReactionKey===0?1:0):0,
    acceptedLinkingHitReceipts:Object.freeze([...state.acceptedLinkingHitReceipts,receipt])});
}
export function stepFinalCapturedVictimPresentation(state: FinalCapturedVictimState,input: FinalVictimIdentity & {
  readonly frame: number; readonly ownerClockAdvances: boolean; readonly actualOwnerTransition: boolean;
  readonly phase: FinalCapturedVictimPhase; readonly phaseAge: number;
  readonly ownerPhase: FinalVictimOwnerPhase; readonly ownerPhaseRevision: number;
  readonly releasedBeforeFinisher: boolean; readonly interrupted: boolean;
}): FinalCapturedVictimState | null {
  const frame=integer(input.frame,'frame'),nextAge=age(input.phaseAge,'phaseAge'),nextPhase=phase(state.ownerFighter,input.phase);
  const nextRevision=integer(input.ownerPhaseRevision,'ownerPhaseRevision');
  if(nextPhase!==semanticOwnerPhase(state.ownerFighter,input.ownerPhase))throw new TypeError('Victim semantic profile disagrees with actual owner status');
  bool(input.ownerClockAdvances,'ownerClockAdvances');bool(input.actualOwnerTransition,'actualOwnerTransition');
  if(!finalVictimIdentityMatches(state,input)||bool(input.releasedBeforeFinisher,'releasedBeforeFinisher')||bool(input.interrupted,'interrupted'))return null;
  if(frame<state.lastFrame)throw new TypeError('Victim clock rewind needs actual snapshot restore');
  const changed=input.ownerPhase!==state.ownerPhase||nextRevision!==state.ownerPhaseRevision;
  if(changed&&(!input.actualOwnerTransition||nextRevision<=state.ownerPhaseRevision))throw new TypeError('Victim clock reset requires actual owner transition and advancing revision');
  if(!changed&&input.actualOwnerTransition)throw new TypeError('Actual owner transition needs its distinct source clock identity');
  if(!changed&&(nextAge<state.phaseAge||(!input.ownerClockAdvances||frame===state.lastFrame)&&nextAge!==state.phaseAge))
    throw new TypeError('Victim borrowed owner clock advanced while stopped/duplicate or backwards');
  return Object.freeze({...state,lastFrame:frame,phase:nextPhase,phaseAge:nextAge,ownerPhase:input.ownerPhase,ownerPhaseRevision:nextRevision});
}
export function beginFinalImpactVictimPresentation(input: FinalVictimIdentity & {
  readonly frame: number; readonly facing: 1 | -1; readonly acceptedHit: boolean; readonly genuineVictimHitstop: boolean;
  readonly packet: FinalImpactVictimState['packet']; readonly acceptedHitReceipt: string;
}): FinalImpactVictimState | null {
  const id=identity(input),frame=integer(input.frame,'frame'),f=facing(input.facing),receipt=text(input.acceptedHitReceipt,'acceptedHitReceipt');
  if(!['ancient-fighter-blast','ancient-terrain-blast'].includes(input.packet))throw new TypeError('Fly0 detector is not cinematic blast damage');
  if(!bool(input.acceptedHit,'acceptedHit')||!bool(input.genuineVictimHitstop,'genuineVictimHitstop'))return null;
  return Object.freeze({...id,schema:'final-victim-presentation/1',kind:'impact-stop',ownerFighter:'link',
    entryFrame:frame,lastFrame:frame,facing:f,stopPresentationAge:0,packet:input.packet,acceptedHitReceipt:receipt});
}
export function stepFinalImpactVictimPresentation(state: FinalImpactVictimState,input: {
  readonly frame: number; readonly victimGeneration: number; readonly genuineVictimHitstop: boolean;
  readonly ownStopPresentationAdvances: boolean; readonly globallyPaused: boolean; readonly interrupted: boolean;
}): FinalImpactVictimState | null {
  const frame=integer(input.frame,'frame');integer(input.victimGeneration,'victimGeneration');
  bool(input.genuineVictimHitstop,'genuineVictimHitstop');bool(input.ownStopPresentationAdvances,'ownStopPresentationAdvances');bool(input.globallyPaused,'globallyPaused');
  if(input.victimGeneration!==state.victimGeneration||bool(input.interrupted,'interrupted')||!input.genuineVictimHitstop)return null;
  if(frame<state.lastFrame)throw new TypeError('Impact stop clock rewind needs actual snapshot restore');
  return Object.freeze({...state,lastFrame:frame,stopPresentationAge:state.stopPresentationAge+
    (frame!==state.lastFrame&&input.ownStopPresentationAdvances&&!input.globallyPaused?1:0)});
}
export function selectFinalVictimPresentation(state: FinalVictimPresentationState): {
  readonly targetFighter: FinalVictimFighter; readonly profileKey: FinalVictimProfileKey; readonly authoredAge: number;
  readonly facing: 1 | -1; readonly sampleBasis: 'authored-final-victim-recipe-index'; readonly nativeSample: null;
} {
  const profileKey:FinalVictimProfileKey=state.kind==='impact-stop'?'final_victim_ancient_impact':
    state.phase==='jungle-entry'?'final_victim_jungle_entry':state.phase==='jungle-barrage'?
      state.jungleReactionKey===0?'final_victim_jungle_stagger_a':'final_victim_jungle_stagger_b':
    state.phase==='jungle-uppercut-pre'?'final_victim_jungle_uppercut_pre':state.phase==='volt-caught'?'final_victim_volt_caught':
    state.phase==='volt-vortex'?'final_victim_volt_vortex':'final_victim_volt_burst_pre';
  return Object.freeze({targetFighter:state.victimFighter,profileKey,authoredAge:state.kind==='captured'?state.phaseAge:state.stopPresentationAge,
    facing:state.facing,sampleBasis:'authored-final-victim-recipe-index',nativeSample:null});
}
export function parseFinalVictimPresentationState(value: unknown,path='finalVictim'): FinalVictimPresentationState {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be object`);
  const r=value as Record<string,unknown>,common=['schema','kind','runId','ownerPlayerIndex','ownerGeneration','victimPlayerIndex','victimGeneration','victimFighter','ownerFighter','entryFrame','lastFrame','facing'];
  const fields=r.kind==='captured'?[...common,'phase','phaseAge','ownerPhase','ownerPhaseRevision','jungleReactionKey','acceptedLinkingHitReceipts']:
    r.kind==='impact-stop'?[...common,'stopPresentationAge','packet','acceptedHitReceipt']:[];
  if(r.schema!=='final-victim-presentation/1'||Object.keys(r).length!==fields.length||fields.some(key=>!Object.hasOwn(r,key)))throw new TypeError(`${path} closed state invalid`);
  const id=identity({runId:r.runId as number,ownerPlayerIndex:r.ownerPlayerIndex as number,ownerGeneration:r.ownerGeneration as number,
    victimPlayerIndex:r.victimPlayerIndex as number,victimGeneration:r.victimGeneration as number,victimFighter:r.victimFighter as FinalVictimFighter});
  const entryFrame=integer(r.entryFrame,'entryFrame'),lastFrame=integer(r.lastFrame,'lastFrame');if(lastFrame<entryFrame)throw new TypeError('Victim frame precedes admission');
  const f=facing(r.facing);
  if(r.kind==='captured'){
    if(r.ownerFighter!=='donkeykong'&&r.ownerFighter!=='pikachu'||!Array.isArray(r.acceptedLinkingHitReceipts)||r.jungleReactionKey!==0&&r.jungleReactionKey!==1)
      throw new TypeError(`${path} invalid real capture state`);
    const receipts=r.acceptedLinkingHitReceipts.map((v,i)=>text(v,`receipts[${i}]`));
    if(phase(r.ownerFighter,r.phase)!==semanticOwnerPhase(r.ownerFighter,r.ownerPhase))throw new TypeError('Victim semantic phase disagrees with restored real owner status');
    if(new Set(receipts).size!==receipts.length||r.jungleReactionKey!==(r.ownerFighter==='donkeykong'?receipts.length%2:0))throw new TypeError('Victim reaction must match unique actually accepted linking receipts');
    return Object.freeze({...id,schema:'final-victim-presentation/1',kind:'captured',ownerFighter:r.ownerFighter,entryFrame,lastFrame,facing:f,
      phase:phase(r.ownerFighter,r.phase),phaseAge:age(r.phaseAge,'phaseAge'),ownerPhase:r.ownerPhase as FinalVictimOwnerPhase,
      ownerPhaseRevision:integer(r.ownerPhaseRevision,'ownerPhaseRevision'),jungleReactionKey:r.jungleReactionKey,acceptedLinkingHitReceipts:Object.freeze(receipts)});
  }
  if(r.ownerFighter!=='link'||!['ancient-fighter-blast','ancient-terrain-blast'].includes(r.packet as string))throw new TypeError('Actual Ancient blast recipient required');
  return Object.freeze({...id,schema:'final-victim-presentation/1',kind:'impact-stop',ownerFighter:'link',entryFrame,lastFrame,facing:f,
    stopPresentationAge:integer(r.stopPresentationAge,'stopPresentationAge'),packet:r.packet as FinalImpactVictimState['packet'],acceptedHitReceipt:text(r.acceptedHitReceipt,'acceptedHitReceipt')});
}
