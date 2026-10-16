/** Published Ultimate ordinary-bury status. The numeric rules are secondary
 * SmashWiki technical evidence, not a captured native status implementation:
 * https://www.ssbwiki.com/Buried (checked 2026-10-08).
 * Logical mash thresholds/tie order reuse the reviewed capture adapter. */
import {
  initialCaptureMash, tickCaptureMash,
  type CaptureMashInput, type CaptureMashState,
} from './ultimateCapture';

export const ULTIMATE_BURY_ESCAPE_FRAMES = 12;
export const ULTIMATE_BURY_BREAK_KNOCKBACK = 90;

function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`);
  return value;
}

/** k is native reference knockback recomputed with target weight100. Percent
 * is already post-hit and includes the match's source damage multipliers.
 * Stock difference is attacker minus victim; omitted explicitly models ties. */
export function ultimateBuryFrames(postHitPercent: number, knockbackAtWeight100: number,
  attackerMinusVictimStocks = 0): number {
  const percent = nonnegative(postHitPercent, 'bury percent');
  const knockback = nonnegative(knockbackAtWeight100, 'bury native knockback');
  if (!Number.isInteger(attackerMinusVictimStocks)) throw new Error('bury stock difference must be an integer');
  const handicap = attackerMinusVictimStocks <= -2 ? 0.375 : attackerMinusVictimStocks === -1 ? 0.25 : 0;
  const rank = attackerMinusVictimStocks >= 2 ? 1.8 : attackerMinusVictimStocks === 1 ? 1.5 : 0;
  return Math.ceil(10 + 30 * handicap + 15 * (3 - rank) + 0.5 * percent + 1.5 * knockback);
}

/** All state is plain serializable data. TLaunch is the runtime's stored hit
 * payload/trajectory, kept losslessly until escape; this module does not invent
 * a second physics or knockback calculation. */
export interface BuriedState<TLaunch> {
  readonly phase: 'buried' | 'escaping';
  readonly initialFrames: number;
  readonly age: number;
  readonly mash: CaptureMashState;
  readonly storedLaunch: TLaunch | null;
  readonly escapeRemaining: number;
}

export function createBuriedState<TLaunch>(frames: number, initialInput: CaptureMashInput): BuriedState<TLaunch> {
  if (!Number.isInteger(frames) || frames <= 0) throw new Error('bury duration must be a positive integer');
  return { phase: 'buried', initialFrames: frames, age: 0, mash: initialCaptureMash(initialInput),
    storedLaunch: null, escapeRemaining: 0 };
}

export type BuryReleaseKind = 'escape-jump' | 'stored-launch' | 'floor-lost';
export interface BuriedTick<TLaunch> {
  readonly state: BuriedState<TLaunch> | null;
  readonly releaseKind: BuryReleaseKind | null;
  readonly launch: TLaunch | null;
}

/** Call once per unfrozen gameplay step. A freeze must not age the status,
 * register fresh mash edges, or consume its vulnerable twelve-frame escape. */
export function tickBuriedState<TLaunch>(state: BuriedState<TLaunch>, observation: {
  readonly input: CaptureMashInput;
  readonly grounded: boolean;
  readonly frozen?: boolean;
}): BuriedTick<TLaunch> {
  if (observation.frozen) return { state, releaseKind: null, launch: null };
  if (state.phase === 'escaping') {
    const escapeRemaining = state.escapeRemaining - 1;
    return { state: escapeRemaining > 0 ? { ...state, escapeRemaining } : null, releaseKind: null, launch: null };
  }
  if (!observation.grounded) return { state: null, releaseKind: 'floor-lost', launch: state.storedLaunch };
  const age = state.age + 1;
  const mash = tickCaptureMash(state.mash, observation.input, age);
  const remaining = state.initialFrames - age - mash.reduction;
  if (remaining > 0) return { state: { ...state, age, mash }, releaseKind: null, launch: null };
  // Stronger intervening hits apply immediately. A stored weak hit applies
  // when burial ends; its live hitstun replaces the neutral escape-jump lock.
  if (state.storedLaunch !== null) return { state: null, releaseKind: 'stored-launch', launch: state.storedLaunch };
  return { state: { ...state, phase: 'escaping', age, mash, escapeRemaining: ULTIMATE_BURY_ESCAPE_FRAMES },
    releaseKind: 'escape-jump', launch: null };
}

/** Incoming damage still connects. At native KB90 the ordinary launch wins;
 * weaker hits remain pinned and store their launch for later. Latest hit wins
 * in this explicit beta adapter; native pending-hit priority remains unmeasured.
 * Escape itself has no invincibility. */
export function receiveBuriedHit<TLaunch>(state: BuriedState<TLaunch>, nativeKnockback: number,
  launch: TLaunch): { readonly state: BuriedState<TLaunch> | null; readonly launch: TLaunch | null;
    readonly held: boolean } {
  const knockback = nonnegative(nativeKnockback, 'incoming native knockback');
  if (state.phase === 'escaping' || knockback >= ULTIMATE_BURY_BREAK_KNOCKBACK) {
    return { state: null, launch, held: false };
  }
  return { state: { ...state, storedLaunch: launch }, launch: null, held: true };
}
