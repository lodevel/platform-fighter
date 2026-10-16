import type { FinalRun, FinalControllerEvent } from './finalSmashSchema';
import { FinalSmashController } from './FinalSmashController';
import type { FinalSmashActorControl } from './finalSmashActorControl';
import { beginJungleRush, stepJungleRush, confirmJungleRushTargets, jungleRushDetectionActive,
  jungleRushHitWindow, jungleRushCanCancel, type JungleRushState } from './donkeykongJungleRush';
import { beginVoltTackle, stepVoltTackle, confirmVoltTackleTargets, voltSavedHitPosition,
  voltTackleWorldPolicy, voltCameraBoundary, voltBoundaryReflectAngle,
  type VoltTackleState, type VoltTacklePolicy } from './pikachuVoltTackle';
import { beginLinkAncientFinal, stepLinkAncientFinal,parseLinkAncientFinalState, type LinkAncientFinalState,
  type LinkAncientFinalEvent } from '../characters/linkAncientFinal';
import {beginFinalCapturedVictimPresentation,confirmFinalVictimLinkingHit,stepFinalCapturedVictimPresentation,
  parseFinalVictimPresentationState,type FinalCapturedVictimState,type FinalVictimPresentationState,type FinalVictimOwnerPhase} from './finalVictimPresentation';
import type { LinkEquipmentState } from '../characters/linkEquipment';
import {beginPikachuFinalOrientation,stepPikachuFinalOrientation,parsePikachuFinalOrientationState,type PikachuFinalOrientationState} from './pikachuFinalOrientation';
export interface FinalActorView { readonly playerIndex: number; readonly generation: number;
  readonly root: Readonly<{ x: number; y: number }>; readonly centre: Readonly<{ x: number; y: number }>; readonly facing: 1 | -1;
  readonly fighter?:string; readonly grounded: boolean; readonly hitlag: boolean; readonly eligibleVictim: boolean; }
export interface FinalContact { readonly target: number; readonly packetId: number; readonly damageMultiplier: number;
  readonly contactCapsuleWorld?:import('../characters/capsuleGeometry').CollisionCapsule; }
export interface FinalChoreographyWorld {
  actor(playerIndex: number): FinalActorView | null;
  equipment(playerIndex: number): LinkEquipmentState | null;
  victimPresentation?(playerIndex:number,state:FinalVictimPresentationState|null):void;
  retainBodyTail(owner:number,sheet:string,age:number,advance:number,endAge:number,runId:number,frame:number):void;
  lease(playerIndex: number, control: FinalSmashActorControl | null): void;
  moveRoot(playerIndex: number, position: { x: number; y: number }, runId: number): void;
  /** Paired new source geometry supplies exact contacts. Missing profiles
   * cannot become a guessed body-wide detector or article rectangle. */
  contacts(owner: number, sheet: string, age: number, packet: string): readonly FinalContact[];
  hit(run: FinalRun, strike: string, contact: FinalContact, packet: string): boolean;
  groundRay(root: { x: number; y: number }, length: number): boolean;
  /** Actual grounded support/hull projection; source cliff intent is owned
   * by the choreography, stage contact margins by this explicit2D adapter. */
  cliffStopVelocity(owner:number,velocity:{x:number;y:number},run:FinalRun):{x:number;y:number};
  captureAnchor(owner: number, sheet: string, age: number): { x: number; y: number } | null;
  captureRoot(recipient:number,pocket:{x:number;y:number},run:FinalRun):{x:number;y:number}|null;
  linkEvent(owner: number, event: LinkAncientFinalEvent, run: FinalRun): void;
  camera(run: FinalRun | null, anchor: { x: number; y: number } | null): void;
}
type Timeline = { kind: 'donkeykong'; state: JungleRushState }
  | { kind: 'pikachu'; state: VoltTackleState; policy: VoltTacklePolicy;orientation:PikachuFinalOrientationState }
  | { kind: 'link'; state: LinkAncientFinalState };
export interface FinalChoreographySnapshot { readonly runId: number | null; readonly bornFrame: number; readonly currentFrame:number;
  readonly ownerClockAdvances:boolean;
  readonly facing: 1 | -1; readonly timeline: Timeline | null; readonly ownerPhaseRevision:number;
  readonly victimPresentations:readonly FinalCapturedVictimState[]; readonly strikeReceipts: readonly string[];
  readonly rehitReceipts: readonly { readonly key: string; readonly age: number }[];
  readonly captureRoots: readonly { readonly playerIndex: number; readonly generation: number;
    readonly root: { readonly x: number; readonly y: number } }[]; }
export class FinalSmashChoreography {
  private runId: number | null = null;
  private bornFrame = -1;
  private facing: 1 | -1 = 1;
  private timeline: Timeline | null = null;
  private ownerPhaseRevision=0;
  private currentFrame=0;
  private ownerClockAdvances=false;
  private readonly victimPresentations=new Map<number,FinalCapturedVictimState>();
  private strikeReceipts = new Set<string>();
  private rehitReceipts = new Map<string, number>();
  private captureRoots = new Map<number, { generation: number; root: { x: number; y: number } }>();
  constructor(readonly controller: FinalSmashController, readonly world: FinalChoreographyWorld,
    readonly pixelsPerUnit: number, readonly simulationViewportAspect: number) {}
  consume(events: readonly FinalControllerEvent[], frame: number): void {
    this.currentFrame=frame;
    for (const event of events) {
      if (event.kind === 'activate') this.begin(event.run, event.airborne, frame, event.intendedFacing);
      else if (event.kind === 'release') {
        const actor = this.world.actor(event.target.playerIndex);
        if (actor?.generation === event.target.generation) this.world.lease(event.target.playerIndex, null);
        this.captureRoots.delete(event.target.playerIndex);
        this.victimPresentations.delete(event.target.playerIndex);this.world.victimPresentation?.(event.target.playerIndex,null);
      } else if (event.kind === 'exit') {
        if (event.reason !== 'complete' && this.timeline?.kind === 'link') this.world.linkEvent(event.run.owner.playerIndex,
          { kind: 'complete', equipmentBeforeEntry: this.timeline.state.equipmentBeforeEntry }, event.run);
        this.world.lease(event.run.owner.playerIndex, null); this.world.camera(null, null);
        for(const target of this.victimPresentations.keys())this.world.victimPresentation?.(target,null);
        this.victimPresentations.clear();
        this.timeline = null; this.runId = null; this.captureRoots.clear(); this.strikeReceipts.clear(); this.rehitReceipts.clear();
      }
    }
  }
  private begin(run: FinalRun, airborne: boolean, frame: number, intendedFacing?:1|-1): void {
    const actor = this.world.actor(run.owner.playerIndex); if (!actor || actor.generation !== run.owner.generation) return;
    this.ownerPhaseRevision=0;this.currentFrame=frame;this.ownerClockAdvances=true;this.victimPresentations.clear();
    this.runId = run.id; this.bornFrame = frame; this.facing = intendedFacing ?? actor.facing;
    this.strikeReceipts.clear(); this.rehitReceipts.clear(); this.captureRoots.clear();
    if (run.owner.fighter === 'donkeykong') this.timeline = { kind: 'donkeykong', state: beginJungleRush(airborne) };
    else if (run.owner.fighter === 'pikachu') this.timeline = { kind: 'pikachu', state: beginVoltTackle(airborne, this.facing),
      orientation:beginPikachuFinalOrientation({runId:run.id,ownerIndex:run.owner.playerIndex,ownerGeneration:run.owner.generation,frame,
        facing:this.facing,phaseRevision:this.ownerPhaseRevision}),
      policy: { startupFrames: 63, finishRecoveryFrames: airborne ? 39 : 94,
        missRecoveryFrames: airborne ? 61 : 90, pixelsPerUnit: this.pixelsPerUnit,
        simulationViewportAspect: this.simulationViewportAspect } };
    else if (run.owner.fighter === 'link') {
      const equipment=this.world.equipment(run.owner.playerIndex);
      if(!equipment)throw new Error('Fresh Link Final admission requires actual equipment snapshot');
      const entry = beginLinkAncientFinal(airborne, equipment, 1);
      this.timeline = { kind: 'link', state: entry.state };
      for (const event of entry.events) this.world.linkEvent(run.owner.playerIndex, event, run);
    }
    else {
      this.timeline = null; this.runId = null;
      throw new Error(`Unsupported Final fighter: ${run.owner.fighter}`);
    }
    this.present(run);
  }
  private capture(run: FinalRun, target: number): boolean {
    const actor = this.world.actor(target); if (!actor?.eligibleVictim) return false;
    const events = this.controller.capture(run.id, { playerIndex: target, generation: actor.generation });
    if (!events.length) return false;
    this.captureRoots.set(target, { generation: actor.generation, root: { ...actor.root } });
    return true;
  }
  private releaseAll(run: FinalRun): void {
    for (const captive of this.controller.getActive()?.captures ?? [])
      this.consume(this.controller.release(run.id, captive.playerIndex), this.currentFrame);
  }
  private fitJungleCaptive(run:FinalRun,target:number,sheet:string,age:number):void {
    const captive=this.controller.getActive()?.captures.find(c=>c.playerIndex===target),view=this.world.actor(target);
    if(!captive||!view||view.generation!==captive.generation)return;
    const anchor=this.world.captureAnchor(run.owner.playerIndex,sheet,age);
    const root=anchor?this.world.captureRoot(target,anchor,run):null;
    if(root){
      this.captureRoots.set(target,{generation:captive.generation,root:{...root}});
      this.world.moveRoot(target,root,run.id);
    }
  }
  private onceHit(run: FinalRun, strike: string, contact: FinalContact, packet: string,
    actorAge?: number, rehitFrames?: number): boolean {
    const key = `${strike}:${contact.target}`;
    if (actorAge !== undefined && rehitFrames !== undefined) {
      const last = this.rehitReceipts.get(key);
      if (last !== undefined && actorAge - last < rehitFrames) return false;
    } else if (this.strikeReceipts.has(key)) return false;
    if (!this.world.hit(run, strike, contact, packet)) return false;
    const victim=this.victimPresentations.get(contact.target);
    if(victim&&(packet==='dk-early'||packet==='dk-late'||packet==='pika-loop'||packet==='pika-loop-finish')){
      const receiptId=JSON.stringify([run.id,strike,contact.target,contact.packetId,actorAge??null,this.currentFrame]);
      const next=confirmFinalVictimLinkingHit(victim,{...victim,frame:this.currentFrame,acceptedHit:true,receiptId,
        packetRole:packet==='dk-early'?'dk-early':packet==='dk-late'?'dk-late':'pika-loop'});
      this.victimPresentations.set(contact.target,next);this.world.victimPresentation?.(contact.target,next);
      // The accepted contact belongs to the genuinely queried old receiving.
      // Its confirmed reaction selects new same-drawing receiving/Hip now;
      // keep that new anchor on the actual pocket in this very fixed tick.
      if((packet==='dk-early'||packet==='dk-late')&&this.timeline?.kind==='donkeykong')
        this.fitJungleCaptive(run,contact.target,this.sheet(),this.timeline.state.nativeFrame-1);
    }
    if (actorAge !== undefined) this.rehitReceipts.set(key, actorAge); else this.strikeReceipts.add(key);
    return true;
  }
  beforeStep(frame: number, ownerCancelIntent: boolean): void {
    this.currentFrame=frame;
    const run = this.controller.getActive(), timeline = this.timeline;
    if (!run || run.id !== this.runId || !timeline) return;
    const actor = this.world.actor(run.owner.playerIndex);
    if (!actor || actor.generation !== run.owner.generation) {
      this.consume(this.controller.finish(run.id, 'owner-reset'), frame); return;
    }
    this.ownerClockAdvances=!actor.hitlag;
    if (frame !== this.bornFrame && !actor.hitlag) {
      if (timeline.kind === 'donkeykong') {
        if (ownerCancelIntent && jungleRushCanCancel(timeline.state)) {
          this.consume(this.controller.finish(run.id, 'complete'), frame); return;
        }
        const next = stepJungleRush(timeline.state, true);
        if(next.state.phase!==timeline.state.phase)this.ownerPhaseRevision++;
        timeline.state = next.state;
        if (next.events.some(event => event.kind === 'finish')) {
          if(next.state.targets.length)this.world.retainBodyTail(run.owner.playerIndex,
            next.state.airborne?'final_air_end':'final_end',next.state.nativeFrame-1,next.state.nativeAdvance,
            next.state.airborne?48:88,run.id,frame);
          this.consume(this.controller.finish(run.id, 'complete'), frame); return;
        }
      } else if (timeline.kind === 'pikachu') {
        const state = timeline.state;
        const targetLease = run.captures.find(c => c.playerIndex === state.firstTarget);
        const target = targetLease ? this.world.actor(targetLease.playerIndex) : null;
        const liveRoot = target?.generation === targetLease?.generation ? target?.root ?? null : null;
        const boundary = state.clipBounds ? voltCameraBoundary(actor.root, state.velocity, state.age + 1, state.clipBounds) : null;
        const next = stepVoltTackle(state, timeline.policy, { clockAdvances: true, substatusTicks: true,
          nativeStatusFrame: state.age + 1, hitMotionEnded: state.phase === 'hit' && state.age + 1 >= 6,
          cameraBoundaryReached: boundary?.reached === true,
          nativeReflectAngleDegrees: boundary?.reached && boundary.angleBasisNative ? voltBoundaryReflectAngle(state.velocity, boundary.angleBasisNative) : state.reflectAngleDegrees,
          selfRoot: actor.root, primaryVictimRoot: liveRoot });
        if(next.events.some(event=>event.kind==='phase'))this.ownerPhaseRevision++;
        timeline.state = next.state;
        for (const event of next.events) if (event.kind === 'snap') this.world.moveRoot(run.owner.playerIndex, event.position, run.id);
        if (next.events.some(event => event.kind === 'complete')) {
          this.consume(this.controller.finish(run.id, 'complete'), frame); return;
        }
      } else {
        const end = timeline.state.sheet === 'final_air' ? 102 : 130;
        const next = stepLinkAncientFinal(timeline.state, { frozen: false,
          // Present the terminal raw sample before the next advancing step
          // admits completion; native common end scheduling remains a gap.
          nativeMotionEnded: timeline.state.clock.nativeFrame >= end });
        // Lease this step's clock before its callbacks: shoot-ancient-arrow (native
        // frame 60) spawns from the owner's data release point (linkArticles).
        if(next.state){timeline.state=next.state;this.present(run);}
        for (const event of next.events) this.world.linkEvent(run.owner.playerIndex, event, run);
        if (!next.state) { this.consume(this.controller.finish(run.id, 'complete'), frame); return; }
      }
    }
    this.present(this.controller.getActive() ?? run);
  }
  afterPhysics(frame: number): void {
    this.currentFrame=frame;
    const run = this.controller.getActive(), timeline = this.timeline; if (!run || !timeline || this.runId !== run.id) return;
    const owner = run.owner.playerIndex, actor = this.world.actor(owner); if (!actor) return;
    if (timeline.kind === 'donkeykong') {
      const state = timeline.state, sheet = this.sheet();
      if (jungleRushDetectionActive(state)) {
        const contacts = this.world.contacts(owner, sheet, state.nativeFrame - 1, 'dk-detection');
        const accepted = contacts.filter(contact => this.onceHit(run, 'detect', contact, 'dk-detection') && this.capture(run, contact.target));
        timeline.state = confirmJungleRushTargets(state, accepted.map(c => c.target)).state;
      }
      // Engine cutscene fit: keep victim centres in the paired punch pocket
      // before querying contacts, including End before the final uppercut.
      if (timeline.state.phase === 'success' || timeline.state.phase === 'end') {
        for (const captive of this.controller.getActive()?.captures ?? []) {
          this.fitJungleCaptive(run,captive.playerIndex,sheet,state.nativeFrame-1);
        }
      }
      const hit = jungleRushHitWindow(timeline.state);
      if (hit) {
        if (hit.packet === 'finisher') this.releaseAll(run);
        for (const contact of this.world.contacts(owner, sheet, state.nativeFrame - 1, 'dk-' + hit.packet))
          this.onceHit(run, hit.strikeId, contact, 'dk-' + hit.packet);
      }
    } else if (timeline.kind === 'pikachu') {
      const state = timeline.state, sheet = this.sheet();
      let packet: string | null = null, strike: string | null = null;
      if (state.phase === 'startup' && state.age >= 9 && state.age <= 48) {
        packet = state.age >= 46 && state.age <= 48 ? 'pika-start-transition' : 'pika-start';
        strike = 'startup'; // ATTACK0/1 replacement47 preserves native rehit history
      } else if (state.phase === 'dash') { packet = 'pika-dash'; strike = 'dash'; }
      else if (state.phase === 'attack' || state.phase === 'attack2' || state.phase === 'attack-finish') {
        packet = state.phase === 'attack-finish' ? 'pika-loop-finish' : 'pika-loop';
        strike = `loop-${state.phase}-${state.totalReflections}`; // actual source status/ATTACK entry lifetime
      } else if (state.phase === 'finish' && state.age <= 1) { packet = 'pika-finish-pre'; strike = 'finish-pre'; }
      else if (state.phase === 'finish' && state.age >= 9 && state.age <= 10) { packet = 'pika-finisher'; strike = 'finisher'; }
      if (packet && strike) {
        if (packet === 'pika-finisher') this.releaseAll(run);
        const contacts = this.world.contacts(owner, sheet, state.age, packet);
        const rehit = state.phase === 'startup' ? 6 : (state.phase === 'dash' || state.phase === 'attack' ||
          state.phase === 'attack2' || state.phase === 'attack-finish') ? 50 : undefined;
        const accepted = contacts.filter(contact => this.onceHit(run, strike!, contact, packet!,
          rehit === undefined ? undefined : state.age, rehit));
        if (state.phase === 'dash') {
          const captured = accepted.filter(c => this.capture(run, c.target)).map(c => c.target);
          const next = confirmVoltTackleTargets(state, captured, voltSavedHitPosition(actor.root,
            this.world.groundRay(actor.root, 20 * this.pixelsPerUnit), this.pixelsPerUnit), timeline.policy);
          if(next.state.phase!==state.phase)this.ownerPhaseRevision++;
          timeline.state = next.state;
          if (next.state.savedHitPosition) this.world.camera(run, next.state.savedHitPosition);
        }
      }
    }
    this.present(this.controller.getActive() ?? run);
  }
  private sheet(): string {
    const t = this.timeline!;
    if (t.kind === 'link') return t.state.sheet;
    if (t.kind === 'donkeykong') return `${t.state.airborne ? 'final_air_' : 'final_'}${t.state.phase === 'start' ? 'start' : t.state.phase === 'success' ? 'attack' : 'end'}`;
    const prefix = t.state.airborne ? 'final_air' : 'final';
    return t.state.phase === 'startup' ? prefix : t.state.phase === 'finish' ? prefix + '2'
      : t.state.phase === 'miss' ? prefix + '_dash_end' : 'final_dash';
  }
  private present(run: FinalRun): void {
    const t = this.timeline; if (!t) return;
    if(t.kind==='pikachu'){
      const orientation=stepPikachuFinalOrientation(t.orientation,{runId:run.id,ownerIndex:run.owner.playerIndex,ownerGeneration:run.owner.generation,
        frame:this.currentFrame,phase:t.state.phase,phaseRevision:this.ownerPhaseRevision,
        actualOwnerTransition:t.orientation.phaseRevision!==this.ownerPhaseRevision,
        clockAdvances:this.ownerClockAdvances,velocity:{basis:'world',...t.state.velocity}});
      if(!orientation)throw new Error('Live Pika Final requires matching actual status-entry posture ownership');
      t.orientation=orientation;this.facing=orientation.facing;
    }
    const age = t.kind === 'link' ? t.state.clock.nativeFrame : t.kind === 'donkeykong' ? t.state.nativeFrame - 1 : t.state.motionAge;
    const phase = t.kind === 'link' ? 'ancient-bow' : t.state.phase;
    const worldPolicy = t.kind === 'pikachu' ? voltTackleWorldPolicy(t.state) : null;
    const proposedVelocity=t.kind==='pikachu'?t.state.velocity:{x:0,y:0};
    const velocity=worldPolicy?.groundCliffStop&&this.world.actor(run.owner.playerIndex)?.grounded?
      this.world.cliffStopVelocity(run.owner.playerIndex,proposedVelocity,run):proposedVelocity;
    this.controller.commitPhase(run.id, phase, Math.floor(age));
    this.world.lease(run.owner.playerIndex, { runId: run.id, role: 'owner', phase, age, sheet: this.sheet(), facing: this.facing,
      ...(t.kind==='pikachu'?{rotationDegrees:t.orientation.rotationDegrees}:{}),
      // Published startup/execution protection supplies DK common-entry policy;
      // the unavailable native protection type/window remains a fidelity limit.
      intangible: true, noDead: worldPolicy?.noDead ?? false,
      terrainBypass: worldPolicy?.terrainBypass ?? false, jostle: worldPolicy?.jostle ?? false, gravityDisabled: worldPolicy?.disableStageGravity ?? false,
      ...(t.kind==='pikachu'&&t.state.phase==='miss'?{inheritVerticalVelocity:true}:{}),velocity });
    for (const captive of this.controller.getActive()?.captures ?? []) {
      const actor = this.world.actor(captive.playerIndex); if (actor?.generation !== captive.generation) continue;
      if(t.kind==='link')throw new Error('AncientArrow has no cinematic capture lease');
      const ownerPhase=phase as FinalVictimOwnerPhase;
      let victim=this.victimPresentations.get(captive.playerIndex);
      if(!victim){
        const fighter=(actor as FinalActorView & {fighter?:string}).fighter;
        if(fighter==='link'||fighter==='donkeykong'||fighter==='pikachu')victim=beginFinalCapturedVictimPresentation({
          runId:run.id,ownerPlayerIndex:run.owner.playerIndex,ownerGeneration:run.owner.generation,
          victimPlayerIndex:captive.playerIndex,victimGeneration:captive.generation,victimFighter:fighter,
          frame:this.currentFrame,facing:actor.facing,ownerFighter:t.kind,acceptedCapture:true,
          phaseAge:age,ownerPhase,ownerPhaseRevision:this.ownerPhaseRevision})??undefined;
      }else{
        const semantic=t.kind==='donkeykong'?(ownerPhase==='start'?'jungle-entry':ownerPhase==='success'?'jungle-barrage':'jungle-uppercut-pre'):
          ownerPhase==='hit'?'volt-caught':ownerPhase==='finish'?'volt-burst-pre':'volt-vortex';
        victim=stepFinalCapturedVictimPresentation(victim,{...victim,frame:this.currentFrame,ownerClockAdvances:!this.world.actor(run.owner.playerIndex)?.hitlag,
          actualOwnerTransition:victim.ownerPhaseRevision!==this.ownerPhaseRevision,phase:semantic,phaseAge:age,
          ownerPhase,ownerPhaseRevision:this.ownerPhaseRevision,releasedBeforeFinisher:false,interrupted:false})??undefined;
      }
      if(victim){this.victimPresentations.set(captive.playerIndex,victim);this.world.victimPresentation?.(captive.playerIndex,victim);}
      this.world.lease(captive.playerIndex, { runId: run.id, role: 'captured', phase, age, sheet: null,
        facing: victim?.facing??actor.facing, intangible: false, noDead: true, terrainBypass: true, jostle: false, gravityDisabled: true, velocity: { x: 0, y: 0 } });
      const root = this.captureRoots.get(captive.playerIndex);
      if (t.kind === 'pikachu' && root?.generation === captive.generation) this.world.moveRoot(captive.playerIndex, root.root, run.id);
    }
  }
  snapshot(): FinalChoreographySnapshot { return structuredClone({ runId: this.runId, bornFrame: this.bornFrame,currentFrame:this.currentFrame,
    ownerClockAdvances:this.ownerClockAdvances,
    facing: this.facing, timeline: this.timeline, ownerPhaseRevision:this.ownerPhaseRevision,
    victimPresentations:[...this.victimPresentations.values()],strikeReceipts: [...this.strikeReceipts].sort(),
    rehitReceipts: [...this.rehitReceipts].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,age])=>({key,age})),
    captureRoots: [...this.captureRoots].map(([playerIndex, value]) => ({ playerIndex, ...value })) }); }
  restore(snapshot: FinalChoreographySnapshot): void {
    const value = structuredClone(snapshot);
    if(value.timeline?.kind==='link'){
      value.timeline.state=parseLinkAncientFinalState(value.timeline.state);
      if(this.controller.getActive()?.owner.fighter!=='link'||this.controller.getActive()?.id!==value.runId)
        throw new Error('Restore actual Link Final owner before raw-clock choreography');
    }
    if(!Number.isSafeInteger(value.currentFrame)||value.currentFrame<0||typeof value.ownerClockAdvances!=='boolean'||!Number.isSafeInteger(value.ownerPhaseRevision)||value.ownerPhaseRevision<0||!Array.isArray(value.victimPresentations))
      throw new Error('Final cinematic clock revision/recipient checkpoint required');
    const recipients=value.victimPresentations.map(row=>parseFinalVictimPresentationState(row));
    if(recipients.some(row=>row.kind!=='captured')||new Set(recipients.map(row=>row.victimPlayerIndex)).size!==recipients.length)
      throw new Error('Invalid unique Final cinematic capture checkpoint');
    const active=this.controller.getActive();
    if(value.timeline?.kind==='pikachu'){
      const orientation=parsePikachuFinalOrientationState(value.timeline.orientation);
      if(!orientation||!active||active.id!==orientation.runId||active.owner.playerIndex!==orientation.ownerIndex||
        active.owner.generation!==orientation.ownerGeneration||orientation.phase!==value.timeline.state.phase||
        orientation.phaseRevision!==value.ownerPhaseRevision||orientation.lastFrame>value.currentFrame||orientation.facing!==value.facing)
        throw new Error('Pika posture checkpoint must match actual owner/status revision');
      value.timeline.orientation=orientation;
    }
    const clock=value.timeline&&value.timeline.kind!=='link'?value.timeline:null;
    const actualAge=clock?.kind==='donkeykong'?clock.state.nativeFrame-1:clock?.kind==='pikachu'?clock.state.motionAge:undefined;
    const expectedRecipients=(active?.captures??[]).filter(c=>['link','donkeykong','pikachu'].includes(this.world.actor(c.playerIndex)?.fighter??''));
    if(expectedRecipients.length!==recipients.length)throw new Error('Every actual supported Final captive requires its own saved cinematic lease');
    for(const row of recipients){if(row.kind!=='captured'||!active||row.runId!==active.id||row.ownerPlayerIndex!==active.owner.playerIndex||
      row.ownerGeneration!==active.owner.generation||row.ownerFighter!==active.owner.fighter||row.ownerPhaseRevision!==value.ownerPhaseRevision||row.ownerPhase!==clock?.state.phase||row.phaseAge!==actualAge||
      !active.captures.some(c=>c.playerIndex===row.victimPlayerIndex&&c.generation===row.victimGeneration)||
      this.world.actor(row.victimPlayerIndex)?.generation!==row.victimGeneration)throw new Error('Restore actual matching Final capture before cinematic pose');}
    this.victimPresentations.clear();for(const row of recipients)if(row.kind==='captured')this.victimPresentations.set(row.victimPlayerIndex,row);
    this.ownerPhaseRevision=value.ownerPhaseRevision;
    if(recipients.some(row=>row.lastFrame>value.currentFrame))throw new Error('Cinematic receipt is newer than actual choreography frame');
    this.currentFrame=value.currentFrame;
    this.ownerClockAdvances=value.ownerClockAdvances;
    this.runId = value.runId; this.bornFrame = value.bornFrame;
    this.facing = value.facing; this.timeline = value.timeline; this.strikeReceipts = new Set(value.strikeReceipts);
    this.rehitReceipts = new Map(value.rehitReceipts.map(r => [r.key,r.age]));
    this.captureRoots = new Map(value.captureRoots.map(c => [c.playerIndex, { generation: c.generation, root: c.root }]));
    const run = this.controller.getActive(); if (run && this.runId === run.id) this.present(run);
  }
}
