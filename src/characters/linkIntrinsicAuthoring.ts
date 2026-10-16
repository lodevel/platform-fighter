/** Source-default intrinsic packets plus explicit current authoring overrides.
 * This is an engine authoring adapter, not a claim that custom laws are native.
 * Geometry remains in its authored coordinate system for the actual consumer.
 */
import type { AttackMove } from './attacks';
import { parseAttackMoveSnapshot, parseAttackCollisionHitsSnapshot, parseKnockbackSnapshot } from './characterSerializer';
import { parseAttackHeightMetadata } from './attackHeightMetadata';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { ChargeSpec } from './chargeSchema';
import { computeChargeTFromSpec, computeChargedDamageFromSpec, computeChargedKnockbackFromSpec } from './chargeSchema';
import type { ProjectileChargeSpec, NeutralSpecialProjectileSpec } from './specialSchema';
import type { BoomerangSideSpecialMove } from './sideSpecialSchema';
import type { LinkArrowLaunchPlan } from './linkBow';
import { LINK_BOW_SOURCE_PARAMETERS } from './linkBow';
import type { LinkSwordBeamPlan } from './linkSwordBeam';
import { FRESH_LINK_NEUTRAL_SPECIAL } from './linkFreshSpecials';
import { FRESH_LINK_NORMALS } from './linkFreshNormals';

export type LinkIntrinsicAuthoringMove = AttackMove & {
  /** Existing hitbox/special authoring extension; generic AttackMove itself
   * does not declare it, but the real HitboxSpec/HitInfo consumer does. */
  readonly unblockable?: boolean;
  readonly charge?: ChargeSpec;
  readonly chargedProjectile?: ProjectileChargeSpec;
  readonly projectile?: NeutralSpecialProjectileSpec;
  readonly boomerang?: BoomerangSideSpecialMove['boomerang'];
};
export interface LinkIntrinsicGeometryOverride {
  readonly collisionHits?: AttackMove['collisionHits'];
  readonly hitbox?: AttackMove['hitbox'];
  readonly articleRectangle?: { readonly width: number; readonly height: number };
}
export type LinkIntrinsicFlagOverrides = Partial<Pick<AttackMove,
  'direct' | 'reflectable' | 'absorbable' | 'hitlagMultiplier' | 'sdiMultiplier' | 'shieldDamage'
  | 'nativeCollisionAttribute' | 'nativeForceReaction' | 'electricCollision' | 'minHitstunFrames'
  | 'tripChance' | 'setoff' | 'launchDirection' | 'groundedKnockback' | 'shieldSetoffMultiplier'
  | 'nativeAttackHeight' | 'nativeAttackHeightSource'>>
  & { readonly unblockable?: boolean };
export interface LinkIntrinsicAuthoringMetadata {
  readonly authoredKnockback?: AttackMove['knockback'];
  readonly authoredGeometry?: LinkIntrinsicGeometryOverride;
  readonly authoredSpawnOffset?: { readonly x: number; readonly y: number };
  readonly flags: LinkIntrinsicFlagOverrides;
  readonly precision: 'source-defaults-preserved-current-authoring-adapter';
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Readonly<Record<string, unknown>>, y = b as Readonly<Record<string, unknown>>;
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
  return keys.every(k => same(x[k], y[k]));
}
function nonnegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid intrinsic authoring ${name}`);
  return value;
}
function held(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Intrinsic held frames must be nonnegative integer');
  return value;
}
function customCharge(move: LinkIntrinsicAuthoringMove, stock: LinkIntrinsicAuthoringMove): ChargeSpec | null {
  const current = move.chargedProjectile?.charge ?? move.charge;
  const baseline = stock.chargedProjectile?.charge ?? stock.charge;
  return current && !same(current, baseline) ? current : null;
}
function damageRatio(current: number, stock: number): number {
  nonnegative(current, 'current damage'); nonnegative(stock, 'stock damage');
  if (stock === 0) {
    if (current === 0) return 1;
    throw new Error('Zero-stock intrinsic amplitude requires an explicit nonzero packet/trap baseline');
  }
  return current / stock;
}
function sameKnockback(a: AttackMove['knockback'], b: AttackMove['knockback']): boolean {
  // Legacy fields are inactive while reference exists. Never replace a double
  // Arrow's distinct source record merely because an inactive vector changed.
  if (a.reference && b.reference) {
    const x = a.reference, y = b.reference;
    return x.angle === y.angle && x.base === y.base && x.growth === y.growth
      && (x.fixed ?? 0) === (y.fixed ?? 0) && (x.setWeight ?? false) === (y.setWeight ?? false)
      && (x.additionalHitstunFrames ?? 0) === (y.additionalHitstunFrames ?? 0);
  }
  return same(a, b);
}
export function selectLinkIntrinsicAuthoredKnockback(move: LinkIntrinsicAuthoringMove,
  stock: LinkIntrinsicAuthoringMove, heldFrames = 0): AttackMove['knockback'] | undefined {
  held(heldFrames);
  const spec = customCharge(move, stock);
  if (spec?.knockbackMode === 'damage-only' && heldFrames >= spec.maxChargeFrames && spec.fullChargeKnockback)
    return spec.fullChargeKnockback;
  if (spec && spec.knockbackMode !== 'damage-only')
    return computeChargedKnockbackFromSpec(spec, heldFrames, move.knockback);
  return sameKnockback(move.knockback, stock.knockback) ? undefined : move.knockback;
}
export function selectLinkIntrinsicAuthoringMetadata(move: LinkIntrinsicAuthoringMove,
  stock: LinkIntrinsicAuthoringMove, heldFrames = 0): LinkIntrinsicAuthoringMetadata {
  const authoredKnockback = selectLinkIntrinsicAuthoredKnockback(move, stock, heldFrames);
  const projectile = move.projectile, stockProjectile = stock.projectile;
  const bodyGeometry = move.collisionHits !== undefined ? { collisionHits: move.collisionHits }
    : !same(move.hitbox, stock.hitbox) ? { hitbox: move.hitbox } : null;
  const articleRectangle = projectile && stockProjectile
    && (projectile.width !== stockProjectile.width || projectile.height !== stockProjectile.height)
    ? { width: projectile.width, height: projectile.height } : null;
  const authoredGeometry = bodyGeometry || articleRectangle
    ? { ...(bodyGeometry ?? {}), ...(articleRectangle ? { articleRectangle } : {}) } : undefined;
  const authoredSpawnOffset = projectile && stockProjectile
    && (projectile.spawnOffsetX !== stockProjectile.spawnOffsetX || projectile.spawnOffsetY !== stockProjectile.spawnOffsetY)
    ? { x: projectile.spawnOffsetX, y: projectile.spawnOffsetY } : undefined;
  const flags: LinkIntrinsicFlagOverrides = {};
  // Undefined fields remain source-owned. No inferred projectile-ID defaults.
  const mutableFlags = flags as { -readonly [K in keyof LinkIntrinsicFlagOverrides]: LinkIntrinsicFlagOverrides[K] };
  for (const key of ['direct', 'reflectable', 'absorbable', 'hitlagMultiplier', 'sdiMultiplier',
    'shieldDamage', 'nativeCollisionAttribute', 'nativeForceReaction', 'electricCollision', 'minHitstunFrames',
    'tripChance', 'setoff', 'launchDirection', 'groundedKnockback', 'shieldSetoffMultiplier',
    'nativeAttackHeight', 'nativeAttackHeightSource', 'unblockable'] as const) {
    const value = move[key];
    if (value !== undefined && !same(value, stock[key])) Object.assign(mutableFlags, { [key]: value });
  }
  return Object.freeze({ ...(authoredKnockback ? { authoredKnockback } : {}),
    ...(authoredGeometry ? { authoredGeometry: Object.freeze(authoredGeometry) } : {}),
    ...(authoredSpawnOffset ? { authoredSpawnOffset: Object.freeze(authoredSpawnOffset) } : {}),
    flags: Object.freeze(flags), precision: 'source-defaults-preserved-current-authoring-adapter' });
}

/** Input sourcePacketDamage excludes charge but includes its actual phase/
 * regional strength. Custom charge replaces amplitude, never stacks source
 * charge again. A zero global stock damage must use an explicit packet basis. */
export function tuneIntrinsicPacketDamage(sourcePacketDamage: number, move: LinkIntrinsicAuthoringMove,
  stock: LinkIntrinsicAuthoringMove, options: { readonly heldFrames?: number; readonly sourceChargeMultiplier?: number;
    readonly currentAmplitude?: number; readonly stockAmplitude?: number } = {}): number {
  nonnegative(sourcePacketDamage, 'source packet damage');
  const frames = held(options.heldFrames ?? 0), spec = customCharge(move, stock);
  const baseline = options.stockAmplitude ?? stock.damage;
  const amplitude = spec ? computeChargedDamageFromSpec(spec, frames) : options.currentAmplitude ?? move.damage;
  const factor = spec ? 1 : nonnegative(options.sourceChargeMultiplier ?? 1, 'source charge multiplier');
  return sourcePacketDamage * factor * damageRatio(amplitude, baseline);
}
function selectedLifetime(current: NeutralSpecialProjectileSpec | undefined,
  stock: NeutralSpecialProjectileSpec | undefined, source: number): number {
  const selected = current && current.lifetimeFrames !== stock?.lifetimeFrames ? current.lifetimeFrames : source;
  if (!Number.isSafeInteger(selected) || selected < 1) throw new TypeError('Intrinsic article lifetime must be positive integer');
  return selected;
}
function nativeSpeedFromCurrent(current: NeutralSpecialProjectileSpec | undefined,
  stock: NeutralSpecialProjectileSpec | undefined, sourceSpeed: number, ppu: number): number {
  if (!Number.isFinite(ppu) || ppu <= 0) throw new TypeError('Intrinsic article scale must be positive');
  if (!current || !stock || current.speed === stock.speed) return sourceSpeed;
  if (stock.speed <= 0) throw new Error('Missing source speed amplitude for authored article');
  // Both descriptor speeds are WORLD. Their ratio preserves existing source
  // charge/second-arrow multipliers; one physical conversion occurs in Scene.
  return sourceSpeed * nonnegative(current.speed, 'article speed') / stock.speed;
}

export function tuneArrowPlan(plan: LinkArrowLaunchPlan, move: LinkIntrinsicAuthoringMove, chargeFrames: number,
  options: { readonly doubleArrow: boolean; readonly pixelsPerUnit?: number }): {
  readonly plan: LinkArrowLaunchPlan; readonly sourcePlan: LinkArrowLaunchPlan;
  readonly authoredCollisionDamageFactor: number;
  readonly metadata: LinkIntrinsicAuthoringMetadata;
} {
  const frames = held(chargeFrames), stock = FRESH_LINK_NEUTRAL_SPECIAL;
  const spec = customCharge(move, stock), ppu = options.pixelsPerUnit ?? 5;
  if (!Number.isFinite(ppu) || ppu <= 0) throw new TypeError('Intrinsic article scale must be positive');
  const damage = spec ? computeChargedDamageFromSpec(spec, frames) * (options.doubleArrow ? .8 : 1)
    : plan.damage * damageRatio(move.damage, stock.damage);
  const projectileCharge = move.chargedProjectile;
  const speedNative = projectileCharge && spec
    ? (nonnegative(move.projectile?.speed ?? stock.projectile.speed, 'article speed')
      + (nonnegative(projectileCharge.maxSpeed, 'max article speed') - (move.projectile?.speed ?? stock.projectile.speed))
        * computeChargeTFromSpec(spec, frames)) / ppu * (plan.arrowIndex === 1 ? .9 : 1)
    : spec ? nativeSpeedFromCurrent(move.projectile, stock.projectile,
      (LINK_BOW_SOURCE_PARAMETERS.unchargedSpeedNative
        + (LINK_BOW_SOURCE_PARAMETERS.fullyChargedSpeedNative - LINK_BOW_SOURCE_PARAMETERS.unchargedSpeedNative)
          * computeChargeTFromSpec(spec, frames)) * (plan.arrowIndex === 1 ? .9 : 1), ppu)
      : nativeSpeedFromCurrent(move.projectile, stock.projectile, plan.speedNative, ppu);
  return Object.freeze({ plan: Object.freeze({ ...plan, damage, speedNative,
    lifetimeFrames: selectedLifetime(move.projectile, stock.projectile, plan.lifetimeFrames) }), sourcePlan: plan,
    // Absolute per-ID authored damage is an uncharged amplitude. It does not
    // inherit global damage edits, including an explicitly edited global zero.
    authoredCollisionDamageFactor: spec
      ? computeChargedDamageFromSpec(spec, frames) / (move.damage > 0 ? move.damage : stock.damage)
        * (options.doubleArrow ? .8 : 1) : plan.damage / stock.damage,
    metadata: selectLinkIntrinsicAuthoringMetadata(move, stock, frames) });
}

export function tuneBeamPlan(plan: LinkSwordBeamPlan, currentSmash: AttackMoveWithAnimation, heldFrames: number): {
  readonly plan: LinkSwordBeamPlan; readonly sourcePlan: LinkSwordBeamPlan;
  readonly authoredCollisionDamageFactor: number;
  readonly metadata: LinkIntrinsicAuthoringMetadata;
} {
  const frames = held(heldFrames), stock = FRESH_LINK_NORMALS['link.smash'];
  const spec = customCharge(currentSmash, stock);
  // Caller supplies registered uncharged descriptor. Stock1.4 body charge and
  // source5→13 Beam law are different; neither is multiplied in twice.
  const damage = spec ? 5 * damageRatio(computeChargedDamageFromSpec(spec, frames), stock.damage)
    : plan.damage * damageRatio(currentSmash.damage, stock.damage);
  const unchargedBeamAmplitude = 5 * damageRatio(currentSmash.damage, stock.damage);
  return Object.freeze({ plan: Object.freeze({ ...plan, damage }), sourcePlan: plan,
    authoredCollisionDamageFactor: spec ? damage / (unchargedBeamAmplitude > 0 ? unchargedBeamAmplitude : 5) : plan.damage / 5,
    metadata: selectLinkIntrinsicAuthoringMetadata(currentSmash, stock, frames) });
}

function snapshotObject(value: unknown, path: string, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const row = value as Record<string, unknown>;
  if (keys && Object.keys(row).some(key => !keys.includes(key))) throw new TypeError(`${path} contains an unknown field`);
  return row;
}
function snapshotNumber(value: unknown, path: string, minimum?: number, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== undefined && value < minimum)
    || (positive && value <= 0)) throw new TypeError(`${path} must be a finite ${positive ? 'positive' : 'valid'} number`);
  return value;
}
function snapshotKnockback(value: unknown, path: string): AttackMove['knockback'] {
  const row = snapshotObject(value, path, ['x', 'y', 'scaling', 'reference', 'baseMagnitude', 'damageGrowth']);
  if (row.reference !== undefined) snapshotObject(row.reference, `${path}.reference`,
    ['angle', 'base', 'growth', 'fixed', 'setWeight', 'additionalHitstunFrames']);
  return parseKnockbackSnapshot(value, path);
}

/** Strict current article checkpoint boundary. No native producer/attribute,
 * omitted geometry, or charge specification is fabricated during restoration. */
export function parseLinkIntrinsicAuthoringMetadata(value: unknown,
  path = 'intrinsic.metadata'): LinkIntrinsicAuthoringMetadata {
  const row = snapshotObject(value, path, ['authoredKnockback', 'authoredGeometry', 'authoredSpawnOffset', 'flags', 'precision']);
  if (row.precision !== 'source-defaults-preserved-current-authoring-adapter') throw new TypeError(`${path}.precision is invalid`);
  const rawFlags = snapshotObject(row.flags, `${path}.flags`, ['direct', 'reflectable', 'absorbable', 'unblockable',
    'hitlagMultiplier', 'sdiMultiplier', 'shieldDamage', 'nativeCollisionAttribute', 'nativeForceReaction',
    'electricCollision', 'minHitstunFrames', 'tripChance', 'setoff', 'launchDirection', 'groundedKnockback',
    'shieldSetoffMultiplier', 'nativeAttackHeight', 'nativeAttackHeightSource']);
  const flags: Record<string, unknown> = { ...parseAttackHeightMetadata(rawFlags, `${path}.flags`) };
  for (const [key, field] of Object.entries(rawFlags)) {
    if (field === undefined) throw new TypeError(`${path}.flags.${key} must be omitted rather than undefined`);
    const at = `${path}.flags.${key}`;
    if (['direct', 'reflectable', 'absorbable', 'unblockable', 'nativeForceReaction', 'electricCollision'].includes(key)) {
      if (typeof field !== 'boolean') throw new TypeError(`${at} must be boolean`);
      flags[key] = field;
    } else if (['hitlagMultiplier', 'sdiMultiplier', 'shieldSetoffMultiplier', 'tripChance', 'minHitstunFrames', 'shieldDamage'].includes(key)) {
      const n = snapshotNumber(field, at, key === 'shieldDamage' ? undefined : 0);
      if (key === 'tripChance' && n > 1 || key === 'minHitstunFrames' && (!Number.isSafeInteger(n) || n > 120))
        throw new TypeError(`${at} is outside the authoring range`);
      flags[key] = n;
    } else if (key === 'setoff' || key === 'launchDirection') {
      const allowed = key === 'setoff' ? ['on', 'off', 'through'] : ['forward', 'back', 'position'];
      if (typeof field !== 'string' || !allowed.includes(field)) throw new TypeError(`${at} is invalid`);
      flags[key] = field;
    } else if (key === 'nativeCollisionAttribute') {
      if (typeof field !== 'string' || !field.trim()) throw new TypeError(`${at} must be a nonempty string`);
      flags[key] = field;
    } else if (key === 'groundedKnockback') flags[key] = snapshotKnockback(field, at);
  }
  let geometry: LinkIntrinsicGeometryOverride | undefined;
  if (row.authoredGeometry !== undefined) {
    const g = snapshotObject(row.authoredGeometry, `${path}.authoredGeometry`, ['collisionHits', 'hitbox', 'articleRectangle']);
    const rectangle = (value: unknown, name: string, body: boolean) => {
      const r = snapshotObject(value, name, body ? ['offsetX', 'offsetY', 'width', 'height'] : ['width', 'height']);
      return { ...(body ? { offsetX: snapshotNumber(r.offsetX, `${name}.offsetX`), offsetY: snapshotNumber(r.offsetY, `${name}.offsetY`) } : {}),
        width: snapshotNumber(r.width, `${name}.width`, undefined, true), height: snapshotNumber(r.height, `${name}.height`, undefined, true) };
    };
    geometry = Object.freeze({ ...(g.collisionHits === undefined ? {} : {
      collisionHits: parseAttackCollisionHitsSnapshot(g.collisionHits, `${path}.authoredGeometry.collisionHits`) }),
      ...(g.hitbox === undefined ? {} : { hitbox: rectangle(g.hitbox, `${path}.authoredGeometry.hitbox`, true) as AttackMove['hitbox'] }),
      ...(g.articleRectangle === undefined ? {} : { articleRectangle: rectangle(g.articleRectangle, `${path}.authoredGeometry.articleRectangle`, false) }) });
  }
  let spawn: { x: number; y: number } | undefined;
  if (row.authoredSpawnOffset !== undefined) {
    const r = snapshotObject(row.authoredSpawnOffset, `${path}.authoredSpawnOffset`, ['x', 'y']);
    spawn = { x: snapshotNumber(r.x, `${path}.authoredSpawnOffset.x`), y: snapshotNumber(r.y, `${path}.authoredSpawnOffset.y`) };
  }
  return Object.freeze({ ...(row.authoredKnockback === undefined ? {} : { authoredKnockback: snapshotKnockback(row.authoredKnockback, `${path}.authoredKnockback`) }),
    ...(geometry ? { authoredGeometry: geometry } : {}), ...(spawn ? { authoredSpawnOffset: Object.freeze(spawn) } : {}),
    flags: Object.freeze(flags) as LinkIntrinsicFlagOverrides, precision: row.precision });
}

/** Full move parsing delegates to the actual saved authoring schema, including
 * charge/projectile/Boomerang/trap fields, with explicit source-effect guards. */
export function parseLinkIntrinsicAuthoringMove(value: unknown,
  path = 'intrinsic.sourceMove'): LinkIntrinsicAuthoringMove {
  const raw = snapshotObject(value, path);
  const parsed = parseAttackMoveSnapshot(value, path);
  if (raw.unblockable !== undefined && typeof raw.unblockable !== 'boolean') throw new TypeError(`${path}.unblockable must be boolean`);
  return Object.freeze({ ...parsed, ...(raw.unblockable === undefined ? {} : { unblockable: raw.unblockable as boolean }) });
}
