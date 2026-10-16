/** Ultimate container data and deterministic state. Source distinctions and
 * authored adapters are recorded in ultimate-items/phase-8/sources.json. */
import type { ItemAction } from './itemActions';
import type { ItemExplosionSpec } from './BobOmb';

export const ITEM_CONTAINER_RNG_STREAM = 'item-container' as const;
export interface ContainerRollingSpec {
  /** World px/frame; native item_common outer limit ×5. */
  readonly maxSpeed: number;
  readonly groundBrake: number;
  /** Authored near-zero adapter; native stop_limit3 is not a proven roll stop threshold. */
  readonly stopSpeed: number;
  readonly radius: number;
}
export interface ContainerSpec {
  readonly kind: 'crate' | 'barrel' | 'capsule';
  readonly hp: number;
  readonly contentCountMaximum: number;
  readonly explosionChance: number;
  readonly explosion: ItemExplosionSpec;
  readonly explosionDamageByAction?: Readonly<Partial<Record<ItemAction, number>>>;
  readonly rolling?: ContainerRollingSpec;
  readonly downThrowOwnerImmune?: true;
}
export interface ContainerRollingState { readonly vx: number; readonly angle: number }
export interface ContainerState {
  readonly hp: number;
  readonly resolved: boolean;
  readonly rolling: ContainerRollingState | null;
}
export interface ContainerBreakDraws {
  /** Supplied seeded draws in [0,1), never drawn by this module. */
  readonly explosionRoll: number;
  readonly countRoll: number;
  /** Caller chooses ONE eligible definition/food variant and duplicates it. */
  readonly contentsType: string | null;
  readonly throwAction?: ItemAction;
}
export type ContainerBreakOutcome =
  | { readonly kind: 'explosion'; readonly explosion: ItemExplosionSpec }
  | { readonly kind: 'contents'; readonly type: string | null; readonly count: number };

export function beginContainer(spec: ContainerSpec): ContainerState {
  return Object.freeze({ hp: spec.hp, resolved: false, rolling: null });
}
export function containerBreakOutcome(spec: ContainerSpec, draws: ContainerBreakDraws): ContainerBreakOutcome {
  if (draws.explosionRoll < spec.explosionChance) {
    const damage = draws.throwAction === undefined ? undefined : spec.explosionDamageByAction?.[draws.throwAction];
    return { kind: 'explosion', explosion: damage === undefined ? spec.explosion : { ...spec.explosion, damage } };
  }
  // Count probabilities are source-silent: uniform 1..maximum is authored.
  const count = draws.contentsType === null ? 0 : 1 + Math.min(spec.contentCountMaximum - 1,
    Math.floor(Math.max(0, draws.countRoll) * spec.contentCountMaximum));
  return { kind: 'contents', type: draws.contentsType, count };
}
/** Capsules are allowed inside Crates/Barrels; heavy containers are excluded
 * from supported loot. Respect the caller's enabled Item Switch catalog. */
export function eligibleContainerContents<T extends {readonly type:string;readonly heavy?:boolean;readonly containerEligible?:boolean}>(
  spec: ContainerSpec, enabled: readonly T[]): T[] {
  // Self-Capsule recursion is not specified: exclude it as explicit local authoring.
  return enabled.filter(def => def.containerEligible!==false&&!def.heavy && !(spec.kind === 'capsule' && def.type === 'capsule'));
}
/** All free thrown fighter impacts open containers; Barrel terrain contact
 * starts rolling instead. Crate terrain break is an authored impact policy. */
export function containerBreaksOnImpact(spec: ContainerSpec, target: 'fighter' | 'terrain'): boolean {
  return target === 'fighter' || !spec.rolling;
}
/** Native friction/cap with authored rotation from travel distance. Runtime
 * owns terrain support, slope acceleration and falling transitions. */
export function stepContainerRoll(spec: ContainerRollingSpec, state: ContainerRollingState): ContainerRollingState | null {
  const vx = Math.sign(state.vx) * Math.max(0, Math.min(spec.maxSpeed, Math.abs(state.vx)) - spec.groundBrake);
  if (Math.abs(vx) <= spec.stopSpeed) return null;
  return { vx, angle: state.angle + vx / spec.radius * 180 / Math.PI };
}
