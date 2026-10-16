/**
 * Runtime per-item entity state — T3 items framework, AC 10-19.
 *
 * Pairs an {@link ItemDefinition} (frozen authoring data) with the
 * per-instance mutable state every live item carries: lifecycle snapshot,
 * ammo, position / velocity, throw-after impact tracking. The
 * entity is the single source of truth for "this specific bat / ray
 * gun / bomb on the stage right now". Renderers keep their handles in
 * separate maps keyed by entity id, so this state remains serializable.
 *
 * Determinism contract
 * --------------------
 *
 * Every state mutation is a pure function of (current snapshot,
 * current frame, supplied event). No `Math.random()`, no wall-clock
 * reads — the runtime drives every transition through method calls
 * the test harness can replay deterministically.
 */

import type { HeldItemHandle, ItemDefinition } from './ItemDefinition';
import {beginHammer,type HammerState} from './Hammer';
import { BOB_OMB_INITIAL_STATE, type BobOmbState } from './BobOmb';
import { beginContainer, containerBreakOutcome, type ContainerState, type ContainerRollingState,
  type ContainerBreakDraws, type ContainerBreakOutcome } from './itemContainer';
import {
  type ItemLifecycleSnapshot,
  transitionToBroken,
} from './itemLifecycle';
/** Selected engine to_item timer binding, separate from native constructor
 * parity. Ordinary definitions/TTL rules never acquire this clock. */
export interface GeneratedArrowLifetime {
  readonly phase:'world'|'thrown';readonly remaining:number;readonly lastAdvancedFrame:number;
}

/**
 * Mutable per-item runtime state. One instance per spawned item; the
 * {@link ItemRegistry} owns the array of live entities.
 */
export class ItemEntity implements HeldItemHandle {
  /** Stable monotonic id; assigned by the {@link ItemRegistry} on spawn. */
  readonly id: number;

  /** Frozen per-type declaration (Bat/RayGun/Bomb). */
  readonly definition: ItemDefinition;

  /**
   * Current lifecycle snapshot. Updated by transition methods below.
   * Frozen at every transition so callers can stash references for
   * replay capture without worrying about retroactive mutation.
   */
  private snapshot: ItemLifecycleSnapshot;

  /**
   * Remaining uses before the item breaks (`definition.ammo`; shots for an
   * `ammoSpentOnShot` item), or null for an item with no count. Only
   * {@link noteUse} / {@link spendShot} decrement it. Not
   * part of any rewind snapshot: replays re-simulate from frame 0.
   */
  private ammoRemaining: number | null;

  /**
   * Frame the item entered the world. Used by the TTL despawn check
   * (`frame - spawnedAtFrame >= ttlFrames` ⇒ despawn an unpicked
   * grounded item).
   */
  readonly spawnedAtFrame: number;

  /** Bob-omb fuse / walk state (BobOmb.ts); null for other items. */
  private bobOmbState: BobOmbState | null;
  private hammerState: HammerState | null = null;
  private hammerGrowthReady = false;
  private containerState: ContainerState | null;

  /** Slips and throws left (`definition.durability`, Banana Peel); null = no count. */
  private durabilityLeft: number | null;

  /** The last fighter that held it (the item's user: SmashWiki "never harms the user", the peel's placer). */
  private ownerPlayerIndex: number | null = null;
  private generatedArrowLifetime:GeneratedArrowLifetime|null=null;
  initializeGeneratedArrowLifetime(remainingSourceLife:number,frame:number):void {
    if(this.definition.generated?.kind!=='link-arrow'||!Number.isSafeInteger(remainingSourceLife)||remainingSourceLife<=0||
      !Number.isSafeInteger(frame)||frame<0||this.generatedArrowLifetime)throw new Error('Invalid generated Arrow lifetime initialization');
    this.generatedArrowLifetime={phase:'world',remaining:remainingSourceLife,lastAdvancedFrame:frame};
  }
  beginGeneratedArrowThrowLifetime(frame:number):void {
    if(!this.generatedArrowLifetime)return;
    if(!Number.isSafeInteger(frame)||frame<this.generatedArrowLifetime.lastAdvancedFrame)throw new Error('Arrow throw clock rewind requires restore');
    this.generatedArrowLifetime={phase:'thrown',remaining:40,lastAdvancedFrame:frame};
  }
  getGeneratedArrowLifetimeSnapshot():GeneratedArrowLifetime|null {return this.generatedArrowLifetime?{...this.generatedArrowLifetime}:null;}
  restoreGeneratedArrowLifetime(value:GeneratedArrowLifetime|null):void {
    if(value&&(this.definition.generated?.kind!=='link-arrow'||!['world','thrown'].includes(value.phase)||
      !Number.isSafeInteger(value.remaining)||value.remaining<0||!Number.isSafeInteger(value.lastAdvancedFrame)||value.lastAdvancedFrame<0))
      throw new Error('Malformed generated Arrow lifetime checkpoint');
    this.generatedArrowLifetime=value?{...value}:null;
  }

  constructor(
    id: number,
    definition: ItemDefinition,
    spawnedAtFrame: number,
    spawnPosition: { readonly x: number; readonly y: number },
  ) {
    this.id = id;
    this.definition = definition;
    this.spawnedAtFrame = spawnedAtFrame;
    this.ammoRemaining = definition.ammo ?? null;
    this.hammerGrowthReady = !definition.hammer?.growthFrames;
    this.bobOmbState = definition.bobOmb ? BOB_OMB_INITIAL_STATE : null;
    this.durabilityLeft = definition.durability ?? null;
    this.containerState = definition.container ? beginContainer(definition.container) : null;
    this.snapshot = Object.freeze({
      state: 'falling' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: spawnPosition.x, y: spawnPosition.y }),
      stateEnteredFrame: spawnedAtFrame,
    });
  }

  // -------------------------------------------------------------------------
  // Read-only accessors
  // -------------------------------------------------------------------------

  getHistoryEvidence(){return {id:this.id,type:this.definition.type,spawnedAtFrame:this.spawnedAtFrame,
    lifecycle:this.snapshot,ammo:this.ammoRemaining,durability:this.durabilityLeft,ownerPlayerIndex:this.ownerPlayerIndex,
    bobOmb:this.bobOmbState,hammer:this.hammerState,hammerGrowthReady:this.hammerGrowthReady,container:this.containerState,
    generatedArrowLifetime:this.generatedArrowLifetime};}
  getSnapshot(): ItemLifecycleSnapshot {
    return this.snapshot;
  }

  /** Uses left before the item breaks; null = no break count. */
  getAmmo(): number | null {
    return this.ammoRemaining;
  }

  /** The holder may start one of this item's uses: while it has ammo; an empty battering item still swings
   * (SmashWiki Star Rod), an empty shooting item is thrown instead (SmashWiki Item). */
  canUse(): boolean {
    return this.snapshot.state === 'held' && (this.ammoRemaining === null || this.ammoRemaining > 0 ||
      (this.definition.ammoSpentOnShot === true && this.definition.itemClass !== 'shooting'));
  }

  /** A shooting item out of ammo (SmashWiki Item#Item_drop_chance: dropped almost surely when hit, gone on landing). */
  isEmptyShooter(): boolean {
    return this.definition.itemClass === 'shooting' && this.ammoRemaining === 0;
  }

  /** Count one started use; the last one breaks the item where the holder stands (shot ammo is spent by {@link spendShot}). */
  noteUse(frame: number, position: { readonly x: number; readonly y: number }): void {
    if (this.ammoRemaining === null || this.definition.ammoSpentOnShot) return;
    this.ammoRemaining = Math.max(0, this.ammoRemaining - 1);
    if (this.ammoRemaining === 0) this.markBroken(frame, { x: position.x, y: position.y });
  }

  /** Spend `cost` of a shot-ammo item's ammo; false when not enough is left (nothing is fired). */
  spendShot(cost = 1): boolean {
    if (!this.definition.ammoSpentOnShot) return false;
    if (this.ammoRemaining === null) return true;
    if (this.ammoRemaining < cost) return false;
    this.ammoRemaining -= cost;
    return true;
  }

  startHammer(roll:number):void { if(this.definition.hammer && !this.hammerState) this.hammerState=beginHammer(this.definition.hammer,roll); }
  getHammerState():HammerState|null { return this.hammerState; }
  setHammerState(state:HammerState):void { this.hammerState=state; }
  /** Contact intervals use the unfrozen owning motion clock, as repeating fighter attacks do. */
  canHammerContact(target:number):boolean {
    return !!this.hammerState && this.hammerState.motionElapsed>=(this.hammerState.contactFrames[target]??0);
  }
  confirmHammerContact(target:number):void {
    if(this.hammerState&&this.definition.hammer)this.hammerState={...this.hammerState,
      contactFrames:{...this.hammerState.contactFrames,[target]:this.hammerState.motionElapsed+this.definition.hammer.rehitFrames}};
  }
  advanceHammerGrowth(frame:number):void { if(this.definition.hammer && frame-this.spawnedAtFrame>=this.definition.hammer.growthFrames) this.hammerGrowthReady=true; }

  getBobOmbState(): BobOmbState | null {
    return this.bobOmbState;
  }

  setBobOmbState(state: BobOmbState): void {
    if (this.bobOmbState !== null) this.bobOmbState = state;
  }

  getDurability(): number | null {
    return this.durabilityLeft;
  }

  getContainerState(): ContainerState | null { return this.containerState; }
  /** Positive real damage only; caller deduplicates attack identities. */
  damageContainer(damage: number): boolean {
    if (!this.containerState || this.containerState.resolved || !Number.isFinite(damage) || damage <= 0) return false;
    this.containerState = Object.freeze({ ...this.containerState, hp: Math.max(0, this.containerState.hp - damage) });
    return this.containerState.hp === 0;
  }
  resolveContainerBreak(frame: number, position: { x: number; y: number }, draws: ContainerBreakDraws): ContainerBreakOutcome | null {
    if (!this.containerState || !this.definition.container || this.containerState.resolved || this.isBroken() || this.isDespawned()) return null;
    const outcome = containerBreakOutcome(this.definition.container, draws);
    this.containerState = Object.freeze({ ...this.containerState, resolved: true, rolling: null });
    // Container impact opening also applies in flight; the generic break
    // helper intentionally accepts only held/grounded item-use retirement.
    this.snapshot = Object.freeze({ state: 'broken' as const, holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }), stateEnteredFrame: frame });
    return outcome;
  }
  /** Caller supplies actual release/attack horizontal world velocity. */
  startContainerRoll(vx: number): void {
    const spec = this.definition.container?.rolling;
    if (!spec || !this.containerState || this.containerState.resolved) return;
    this.setContainerRolling({ vx: Math.max(-spec.maxSpeed, Math.min(spec.maxSpeed, vx)), angle: 0 });
  }
  setContainerRolling(rolling: ContainerRollingState | null): void {
    if (this.containerState && !this.containerState.resolved) this.containerState = Object.freeze({ ...this.containerState,
      rolling: rolling === null ? null : Object.freeze({ ...rolling }) });
  }

  /** Count one slip or throw; true when that was the last one (the item disappears). */
  wearOut(): boolean {
    if (this.durabilityLeft === null) return false;
    this.durabilityLeft = Math.max(0, this.durabilityLeft - 1);
    return this.durabilityLeft === 0;
  }

  getOwnerPlayerIndex(): number | null {
    return this.ownerPlayerIndex;
  }

  /** True iff the item is still pickable (lifecycle === 'grounded'). */
  isPickable(): boolean {
    return this.hammerGrowthReady && this.containerState?.rolling == null && this.snapshot.state === 'grounded';
  }

  /** Falling and actively thrown free objects can be caught. The caller owns
   * the finite action window, overlap, holdability and airborne-heavy rules. */
  isCatchable(): boolean {
    return this.hammerGrowthReady && (this.snapshot.state === 'grounded' || this.snapshot.state === 'falling');
  }

  isHeld(): boolean {
    return this.snapshot.state === 'held';
  }

  isBroken(): boolean {
    return this.snapshot.state === 'broken';
  }

  isDespawned(): boolean {
    return this.snapshot.state === 'despawned';
  }

  getPosition(): { readonly x: number; readonly y: number } {
    return this.snapshot.position;
  }

  getHolderPlayerIndex(): number | null {
    return this.snapshot.holderPlayerIndex;
  }

  // -------------------------------------------------------------------------
  // Lifecycle transitions
  // -------------------------------------------------------------------------

  /**
   * Transition `falling → grounded` once the item lands on the floor.
   * Caller (Phaser physics layer) detects ground contact and calls
   * this; the runtime stamps the entry frame.
   */
  markGrounded(currentFrame: number, position: { x: number; y: number }): void {
    if (this.snapshot.state !== 'falling') return;
    this.snapshot = Object.freeze({
      state: 'grounded' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /** Ground pickup, or explicit action-window catch of a free item. */
  markHeld(currentFrame: number, holderPlayerIndex: number, holderPos: { x: number; y: number }, acquisition: 'ground'|'catch'='ground'): void {
    if (acquisition==='catch' ? !this.isCatchable() : !this.isPickable()) return;
    this.ownerPlayerIndex = holderPlayerIndex;
    this.setContainerRolling(null);
    this.snapshot = Object.freeze({
      state: 'held' as const,
      holderPlayerIndex,
      position: Object.freeze({ x: holderPos.x, y: holderPos.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /** Update the held item's position (tracks the holder's hand each tick). */
  updateHeldPosition(holderPos: { x: number; y: number }): void {
    if (this.snapshot.state !== 'held') return;
    this.snapshot = Object.freeze({
      state: 'held' as const,
      holderPlayerIndex: this.snapshot.holderPlayerIndex,
      position: Object.freeze({ x: holderPos.x, y: holderPos.y }),
      stateEnteredFrame: this.snapshot.stateEnteredFrame,
    });
  }

  /**
   * Transition `held → grounded` on intact drop (e.g. holder
   * voluntarily drops, gets KO'd while holding, or the item is thrown
   * with the `'drop'` direction).
   */
  markDropped(currentFrame: number, dropPosition: { x: number; y: number }): void {
    if (this.snapshot.state !== 'held') return;
    this.snapshot = Object.freeze({
      state: 'grounded' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: dropPosition.x, y: dropPosition.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /** A released or displaced item needs an explicit catch until it lands. */
  markFalling(currentFrame: number, position: { x: number; y: number }): void {
    if (this.snapshot.state !== 'grounded') return;
    this.snapshot = Object.freeze({
      state: 'falling' as const,
      holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }),
      stateEnteredFrame: currentFrame,
    });
  }

  /**
   * Drop the item inert at `dropPosition` and stamp the broken-frame
   * for the despawn timer. Composes the pure
   * {@link transitionToBroken} helper from `itemLifecycle.ts`.
   */
  markBroken(currentFrame: number, dropPosition: { x: number; y: number }): void {
    const result = transitionToBroken({
      snapshot: this.snapshot,
      currentFrame,
      dropPosition,
    });
    if (result.ok) {
      this.snapshot = result.next;
    }
  }

  /**
   * Transition `broken → despawned` once the broken-debris timer has
   * elapsed. Also valid from `grounded` (TTL expiry on an unpicked
   * item) and from `falling` (defensive — never happens today).
   */
  markDespawned(currentFrame: number): void {
    if (this.snapshot.state === 'despawned') return;
    this.snapshot = Object.freeze({
      state: 'despawned' as const,
      holderPlayerIndex: null,
      position: this.snapshot.position,
      stateEnteredFrame: currentFrame,
    });
  }

  // -------------------------------------------------------------------------
  // Per-tick updates
  // -------------------------------------------------------------------------

  /**
   * Per-tick free-position update for `falling` / `grounded` items
   * (tracks the Matter body's centre); the registry runs this every
   * frame for non-held items so the snapshot stays in sync with the
   * physics body.
   */
  updateFreePosition(position: { x: number; y: number }): void {
    if (this.snapshot.state === 'held' || this.snapshot.state === 'despawned') {
      return;
    }
    this.snapshot = Object.freeze({
      state: this.snapshot.state,
      holderPlayerIndex: null,
      position: Object.freeze({ x: position.x, y: position.y }),
      stateEnteredFrame: this.snapshot.stateEnteredFrame,
    });
  }

  /**
   * Pure-data despawn check — returns true iff the item should be
   * reclaimed this tick. Used by the registry to drive
   * {@link markDespawned}; pure so unit tests pin every transition
   * without booting Phaser.
   */
  shouldDespawn(currentFrame: number): boolean {
    if (this.snapshot.state === 'despawned') return false;
    const arrow=this.generatedArrowLifetime;
    if(arrow){
      if(currentFrame<arrow.lastAdvancedFrame)throw new Error('Generated Arrow timer rewind requires restore');
      const remaining=Math.max(0,arrow.remaining-(currentFrame-arrow.lastAdvancedFrame));
      this.generatedArrowLifetime={...arrow,remaining,lastAdvancedFrame:currentFrame};
      if(remaining<=0)return true;
    }
    if (this.snapshot.state === 'broken') {
      const stateFrame = this.snapshot.stateEnteredFrame;
      if (stateFrame === null) return false;
      return currentFrame - stateFrame >= this.definition.brokenDespawnFrames;
    }
    if (this.snapshot.state === 'grounded') {
      const stateFrame = this.snapshot.stateEnteredFrame;
      if (stateFrame === null) return false;
      return currentFrame - stateFrame >= this.definition.ttlFrames;
    }
    return false;
  }
}
