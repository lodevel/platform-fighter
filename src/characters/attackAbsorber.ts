/** Supplied energy-absorption producer, separate from invincibility, counters
 * and ordinary shields. No current fighter gains a new move by defining this
 * schema. Source windows use the move's normalized runtime elapsed clock;
 * raw native animation indices must be mapped by their producer beforehand. */
import {posedCapsule, type CollisionCapsule, type CollisionPoint} from './capsuleGeometry';
import {sweptProjectileCapsuleEntry, sweptProjectileEntry} from './projectileMotion';
import {sweptCircleBoundsEntry, type ProjectileCircleBounds} from './projectileCircleSweep';

export interface AttackAbsorbWindow {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly coordinateOrigin: 'bodyCentre' | 'actorSourceRoot';
  readonly body?: {readonly offsetX: number; readonly offsetY: number; readonly width: number; readonly height: number};
  readonly capsules?: readonly CollisionCapsule[];
  readonly healingMultiplier: number;
  readonly minimumHealing?: number;
  readonly maximumHealing?: number;
  readonly sourceReceipt: string;
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
  return value;
}
function nonnegative(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new TypeError(`${path} must be nonnegative`);
  return result;
}
function point(value: unknown, path: string): CollisionPoint {
  const row = record(value, path);
  return Object.freeze({x: finite(row.x, `${path}.x`), y: finite(row.y, `${path}.y`)});
}
export function parseAttackAbsorbWindow(value: unknown, path = 'absorber'): AttackAbsorbWindow {
  const row = record(value, path);
  const startFrame = nonnegative(row.startFrame, `${path}.startFrame`), endFrame = finite(row.endFrame, `${path}.endFrame`);
  if (endFrame <= startFrame) throw new TypeError(`${path} must have a nonempty elapsed interval`);
  if (row.coordinateOrigin !== 'bodyCentre' && row.coordinateOrigin !== 'actorSourceRoot')
    throw new TypeError(`${path} must declare its actual coordinate origin`);
  if (typeof row.sourceReceipt !== 'string' || !row.sourceReceipt.trim())
    throw new TypeError(`${path}.sourceReceipt is required`);
  const healingMultiplier = nonnegative(row.healingMultiplier, `${path}.healingMultiplier`);
  const minimumHealing = row.minimumHealing === undefined ? undefined : nonnegative(row.minimumHealing, `${path}.minimumHealing`);
  const maximumHealing = row.maximumHealing === undefined ? undefined : nonnegative(row.maximumHealing, `${path}.maximumHealing`);
  if (minimumHealing !== undefined && maximumHealing !== undefined && minimumHealing > maximumHealing)
    throw new TypeError(`${path} has contradictory supplied healing bounds`);
  let body: AttackAbsorbWindow['body'];
  if (row.body !== undefined) {
    const raw = record(row.body, `${path}.body`), width = finite(raw.width, `${path}.body.width`), height = finite(raw.height, `${path}.body.height`);
    if (width <= 0 || height <= 0) throw new TypeError(`${path}.body must have positive dimensions`);
    body = Object.freeze({offsetX: finite(raw.offsetX, `${path}.body.offsetX`), offsetY: finite(raw.offsetY, `${path}.body.offsetY`), width, height});
  }
  let capsules: readonly CollisionCapsule[] | undefined;
  if (row.capsules !== undefined) {
    if (!Array.isArray(row.capsules)) throw new TypeError(`${path}.capsules must be an array`);
    capsules = Object.freeze(row.capsules.map((value, i) => {
      const p = `${path}.capsules[${i}]`, raw = record(value, p);
      return Object.freeze({start: point(raw.start, `${p}.start`), end: point(raw.end, `${p}.end`), radius: nonnegative(raw.radius, `${p}.radius`)});
    }));
  }
  if (!body && !capsules?.length) throw new TypeError(`${path} requires actual absorber geometry`);
  return Object.freeze({startFrame, endFrame, coordinateOrigin: row.coordinateOrigin,
    healingMultiplier, sourceReceipt: row.sourceReceipt, ...(body ? {body} : {}),
    ...(capsules === undefined ? {} : {capsules}),
    ...(minimumHealing === undefined ? {} : {minimumHealing}), ...(maximumHealing === undefined ? {} : {maximumHealing})});
}
export function activeAbsorber(attack: {
  readonly move: {readonly absorber?: AttackAbsorbWindow}; readonly phase: string; readonly framesElapsed: number;
} | null): AttackAbsorbWindow | null {
  if (!attack || !Number.isFinite(attack.framesElapsed)) return null;
  const window = attack.move.absorber;
  return window && attack.framesElapsed >= window.startFrame && attack.framesElapsed < window.endFrame ? window : null;
}
/** Offsets are world pixels from the actual article root, already oriented by
 * that article's facing. input.facing below belongs only to the absorber. */
export type AbsorbProjectileShape =
  | {readonly kind: 'circle'; readonly radius: number}
  | {readonly kind: 'rectangle'; readonly width: number; readonly height: number}
  | {readonly kind: 'horizontal-capsule'; readonly start: CollisionPoint; readonly end: CollisionPoint; readonly radius: number};

/** Only the actual source absorbable flag admits a packet. Caller supplies
 * the origin declared by the window, authored LR+ geometry and actual facing;
 * this selector never substitutes the fighter's receiving/body geometry. */
export function sweepAttackAbsorber(input: {
  readonly window: AttackAbsorbWindow; readonly origin: CollisionPoint; readonly facing: 1 | -1;
  readonly from: CollisionPoint; readonly to: CollisionPoint; readonly absorbable: boolean;
  readonly projectile: AbsorbProjectileShape;
}): {readonly fraction: number; readonly region: 'body' | 'capsule'; readonly index: number} | null {
  if (!input.absorbable) return null;
  if (input.facing !== 1 && input.facing !== -1) throw new TypeError('Absorber requires explicit facing');
  const {projectile} = input;
  let from = input.from, to = input.to, radius = 0, span = 0;
  if (projectile.kind === 'circle') radius = nonnegative(projectile.radius, 'projectile.radius');
  else if (projectile.kind === 'horizontal-capsule') {
    for (const p of [projectile.start, projectile.end]) {finite(p.x, 'projectile.x'); finite(p.y, 'projectile.y');}
    if (projectile.start.y !== projectile.end.y) throw new TypeError('Nonhorizontal article capsule requires its own sweep consumer');
    radius = nonnegative(projectile.radius, 'projectile.radius');
    span = Math.abs(projectile.end.x - projectile.start.x);
    const mid = projectile.start.x + (projectile.end.x - projectile.start.x) / 2;
    from = {x: from.x + mid, y: from.y + projectile.start.y};
    to = {x: to.x + mid, y: to.y + projectile.start.y};
  } else {
    nonnegative(projectile.width, 'projectile.width'); nonnegative(projectile.height, 'projectile.height');
  }
  finite(input.origin.x, 'origin.x'); finite(input.origin.y, 'origin.y');
  for (const p of [from, to]) {finite(p.x, 'sweep.x'); finite(p.y, 'sweep.y');}
  let nearest: ReturnType<typeof sweepAttackAbsorber> = null;
  const include = (fraction: number | null, region: 'body' | 'capsule', index: number) => {
    if (fraction !== null && (!nearest || fraction < nearest.fraction)) nearest = {fraction, region, index};
  };
  const body = input.window.body;
  if (body) {
    const x = input.origin.x + body.offsetX * input.facing, y = input.origin.y + body.offsetY;
    const bounds: ProjectileCircleBounds = {min: {x: x - body.width / 2 - span / 2, y: y - body.height / 2},
      max: {x: x + body.width / 2 + span / 2, y: y + body.height / 2}};
    include(projectile.kind === 'rectangle'
      ? sweptProjectileEntry(from, to, {x, y, width: body.width, height: body.height}, projectile)
      : sweptCircleBoundsEntry(from, to, bounds, radius), 'body', 0);
  }
  for (const [index, capsule] of (input.window.capsules ?? []).entries()) {
    const world = posedCapsule(capsule, input.origin, input.facing);
    include(sweptProjectileCapsuleEntry(from, to, {...world, radius: world.radius + radius},
      projectile.kind === 'rectangle' ? projectile : {width: span, height: 0}), 'capsule', index);
  }
  return nearest;
}
/** Authoritative consumer applies this amount once, clamped to actual percent.
 * Incoming source power excludes stale/freshness, per the source absorption
 * rule. Its charge/reflection power is supplied explicitly; healing earns no Final
 * Meter, count as dealt damage or inherit an unrelated global damage modifier. */
export function absorbedHealingAmount(window: AttackAbsorbWindow, sourcePacketDamageBeforeStale: number): number {
  const multiplier = nonnegative(window.healingMultiplier, 'healingMultiplier');
  const minimum = window.minimumHealing === undefined ? 0 : nonnegative(window.minimumHealing, 'minimumHealing');
  const maximum = window.maximumHealing === undefined ? Infinity : nonnegative(window.maximumHealing, 'maximumHealing');
  if (minimum > maximum) throw new TypeError('Contradictory absorber healing bounds');
  const amount = nonnegative(sourcePacketDamageBeforeStale, 'absorbed source power') * multiplier;
  if (!Number.isFinite(amount)) throw new TypeError('Nonfinite absorbed healing');
  return Math.min(maximum, Math.max(minimum, amount));
}
