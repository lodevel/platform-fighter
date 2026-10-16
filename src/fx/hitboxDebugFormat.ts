/**
 * Pure formatter helpers for the F3 hitbox debug overlay.
 *
 * A toggleable diagnostic layer that draws the collision geometry the
 * simulation actually uses, so a developer can SEE what they're tuning:
 *
 *   • active attack hitboxes — red translucent rects, mirrored by
 *     facing, derived from the REAL spawn geometry so the box is
 *     truthful (it sits exactly where {@link computeHitboxCenter} puts
 *     the Matter sensor).
 *   • each fighter's hurtbox / body — green outline (the box that takes
 *     damage).
 *   • active grab ranges — yellow, mirrored by facing, drawn only while
 *     a grab's range sensor is live (`whiffActive`).
 *
 * It is a pure visualisation — no simulation effect. The Phaser layer is
 * a single `Phaser.GameObjects.Graphics` redrawn each frame while the
 * overlay is enabled and cleared when disabled.
 *
 * Why a separate, pure-function module
 * ------------------------------------
 *
 *   • The Phaser-touching component (`HitboxDebugLayer.ts`) imports
 *     Phaser; the box-derivation logic that needs unit coverage lives
 *     behind that import line — same split as every other overlay.
 *   • Determinism — every box is a pure projection of (body position,
 *     authored geometry, facing). No `Math.random()`, no wall-clock
 *     reads. The overlay is render-only and never feeds the sim, but the
 *     geometry it draws is itself replay-deterministic.
 *
 * Boundaries
 * ----------
 *
 *   • Pure presentation. The formatter reads snapshots the scene hands
 *     it (positions, active-attack geometry, hurtbox sets, grab state)
 *     and returns a flat list of coloured rectangles in WORLD space. The
 *     Phaser layer strokes / fills them.
 */

import type { AttackMove, HitboxPlugin } from '../characters/attacks';
import { computeHitboxCenter, HITBOX_LABEL } from '../characters/attacks';
import type { Hurtbox } from '../characters/moveSchema';
import { capsuleBounds, posedCapsule, type CollisionCapsule } from '../characters/capsuleGeometry';

// ---------------------------------------------------------------------------
// Tuning constants (frozen)
// ---------------------------------------------------------------------------

/** Fill / stroke colour for an active attack hitbox (red). */
export const HITBOX_DEBUG_ATTACK_COLOR = 0xff3030;

/** Fill alpha for an attack hitbox rect (translucent so overlaps read). */
export const HITBOX_DEBUG_ATTACK_FILL_ALPHA = 0.25;

/** Stroke alpha for an attack hitbox rect. */
export const HITBOX_DEBUG_ATTACK_STROKE_ALPHA = 0.9;

/** Stroke / outline colour for a fighter's hurtbox / body (green). */
export const HITBOX_DEBUG_HURTBOX_COLOR = 0x30ff60;

/** Hurtboxes are outline-only (no fill) so the sprite stays readable. */
export const HITBOX_DEBUG_HURTBOX_FILL_ALPHA = 0;

/** Stroke alpha for a hurtbox outline. */
export const HITBOX_DEBUG_HURTBOX_STROKE_ALPHA = 0.85;

/** Fill / stroke colour for an active grab range sensor (yellow). */
export const HITBOX_DEBUG_GRAB_COLOR = 0xffe030;

/** Fill alpha for a grab range rect. */
export const HITBOX_DEBUG_GRAB_FILL_ALPHA = 0.2;

/** Stroke alpha for a grab range rect. */
export const HITBOX_DEBUG_GRAB_STROKE_ALPHA = 0.9;

/** Stroke thickness (px) shared by every debug box. */
export const HITBOX_DEBUG_STROKE_WIDTH = 1.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Kind discriminator for a debug box — drives the legend / colour. */
export type HitboxDebugBoxKind = 'attack' | 'hurtbox' | 'grab';

/**
 * A single resolved debug box in WORLD space. The Phaser layer fills +
 * strokes it directly (`x`/`y` are the box CENTRE so a `Graphics`
 * `fillRect(x - w/2, y - h/2, w, h)` lands it correctly).
 */
export interface HitboxDebugBox {
  readonly kind: HitboxDebugBoxKind;
  /** Box centre, world space (px). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Exact world-space collision shape; x/y/width/height are its broad enclosure. */
  readonly capsule?: CollisionCapsule;
  readonly color: number;
  readonly fillAlpha: number;
  readonly strokeColor: number;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
}

/**
 * Per-fighter snapshot the scene hands the formatter each frame for one
 * slot. Decoupled from the live `Character` so the geometry derivation
 * stays Node-testable.
 *
 *   • `bodyX` / `bodyY` — the fighter's body centre, world space.
 *   • `facing`          — latched body facing (mirrors grab geometry).
 *   • `hurtboxes`       — the fighter's live hurtbox set
 *                         (`Character.getActiveHurtboxes()`); each box's
 *                         `offsetX`/`offsetY` is body-relative.
 *   • `activeAttack`    — the in-flight attack, or `null`. Only the
 *                         `'active'` phase contributes an attack box; its
 *                         own latched `facing` mirrors the hitbox.
 *   • `activeGrab`      — the live grab range sensor, or `null`. Present
 *                         only while the grab is in its `whiffActive`
 *                         window.
 */
export interface HitboxDebugFighterSnapshot {
  readonly bodyX: number;
  readonly bodyY: number;
  readonly facing: 1 | -1;
  readonly hurtboxes: ReadonlyArray<Hurtbox>;
  readonly activeAttack: {
    readonly move: AttackMove;
    readonly facing: 1 | -1;
    readonly phase: 'startup' | 'active' | 'recovery';
  } | null;
  readonly activeGrab: {
    readonly hitbox: {
      readonly offsetX: number;
      readonly offsetY: number;
      readonly width: number;
      readonly height: number;
    };
  } | null;
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/**
 * Build the world-space attack-hitbox box for a fighter, or `null` when
 * no hitbox is live. Reuses {@link computeHitboxCenter} — the SAME math
 * `spawnHitbox` runs — so the red rect lands exactly on the Matter
 * sensor, mirrored by the attack's latched facing.
 */
export function attackDebugBox(
  snapshot: HitboxDebugFighterSnapshot,
): HitboxDebugBox | null {
  const active = snapshot.activeAttack;
  if (!active || active.phase !== 'active') return null;
  const center = computeHitboxCenter(
    { x: snapshot.bodyX, y: snapshot.bodyY },
    active.move,
    active.facing,
  );
  return {
    kind: 'attack',
    x: center.x,
    y: center.y,
    width: active.move.hitbox.width,
    height: active.move.hitbox.height,
    color: HITBOX_DEBUG_ATTACK_COLOR,
    fillAlpha: HITBOX_DEBUG_ATTACK_FILL_ALPHA,
    strokeColor: HITBOX_DEBUG_ATTACK_COLOR,
    strokeAlpha: HITBOX_DEBUG_ATTACK_STROKE_ALPHA,
    strokeWidth: HITBOX_DEBUG_STROKE_WIDTH,
  };
}

/** Live sensors include detached articles and conditional special hitboxes.
 * Draw narrowphase capsules rather than their broadphase enclosing rectangle.
 * Origin recovery mirrors HitboxDamageHandler; attached contacts use the owner.
 */
export function attackSensorDebugBoxes(sensor: {
  readonly label: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly bounds: { readonly min: { readonly x: number; readonly y: number }; readonly max: { readonly x: number; readonly y: number } };
  readonly plugin?: Partial<HitboxPlugin>;
}, ownerPosition?: { readonly x: number; readonly y: number }): HitboxDebugBox[] {
  if (sensor.label !== HITBOX_LABEL) return [];
  const plugin = sensor.plugin;
  const style = { kind: 'attack' as const, color: HITBOX_DEBUG_ATTACK_COLOR,
    fillAlpha: HITBOX_DEBUG_ATTACK_FILL_ALPHA, strokeColor: HITBOX_DEBUG_ATTACK_COLOR,
    strokeAlpha: HITBOX_DEBUG_ATTACK_STROKE_ALPHA, strokeWidth: HITBOX_DEBUG_STROKE_WIDTH };
  if (plugin?.collisionHits?.length && plugin.hitbox && plugin.facing !== undefined) {
    const origin = plugin.ownerAnchoredContact && ownerPosition ? ownerPosition : {
      x: sensor.position.x - plugin.hitbox.offsetX * plugin.facing,
      y: sensor.position.y - plugin.hitbox.offsetY,
    };
    return analyticAttackDebugBoxes(plugin.collisionHits.map(row => posedCapsule(row.capsule, origin, plugin.facing!)));
  }
  return [{ ...style, x: (sensor.bounds.min.x + sensor.bounds.max.x) / 2,
    y: (sensor.bounds.min.y + sensor.bounds.max.y) / 2,
    width: sensor.bounds.max.x - sensor.bounds.min.x, height: sensor.bounds.max.y - sensor.bounds.min.y }];
}

/** World capsules actually queried by a simulation-owned analytical attack,
 * including Final contacts that do not allocate a Matter sensor body. */
export function analyticAttackDebugBoxes(capsules: readonly CollisionCapsule[]): HitboxDebugBox[] {
  return capsules.map(capsule => {
    const bounds = capsuleBounds(capsule);
    return {kind: 'attack' as const, capsule, x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2, width: bounds.max.x - bounds.min.x,
      height: bounds.max.y - bounds.min.y, color: HITBOX_DEBUG_ATTACK_COLOR,
      fillAlpha: HITBOX_DEBUG_ATTACK_FILL_ALPHA, strokeColor: HITBOX_DEBUG_ATTACK_COLOR,
      strokeAlpha: HITBOX_DEBUG_ATTACK_STROKE_ALPHA, strokeWidth: HITBOX_DEBUG_STROKE_WIDTH};
  });
}

/**
 * Build the world-space hurtbox outline boxes for a fighter. A hurtbox
 * is authored body-relative and mirrored by the defender facing. Returns one
 * box per live hurtbox (usually just the body default, more during a
 * move with per-phase hurtbox modifiers).
 */
export function hurtboxDebugBoxes(
  snapshot: HitboxDebugFighterSnapshot,
): HitboxDebugBox[] {
  const boxes: HitboxDebugBox[] = [];
  for (const hb of snapshot.hurtboxes) {
    const capsule = hb.capsule ? posedCapsule(hb.capsule, { x: snapshot.bodyX, y: snapshot.bodyY }, snapshot.facing) : undefined;
    const bounds = capsule ? capsuleBounds(capsule) : undefined;
    boxes.push({
      kind: 'hurtbox',
      x: bounds ? (bounds.min.x + bounds.max.x) / 2 : snapshot.bodyX + hb.offsetX * snapshot.facing,
      y: bounds ? (bounds.min.y + bounds.max.y) / 2 : snapshot.bodyY + hb.offsetY,
      width: bounds ? bounds.max.x - bounds.min.x : hb.width,
      height: bounds ? bounds.max.y - bounds.min.y : hb.height,
      ...(capsule ? { capsule } : {}),
      color: HITBOX_DEBUG_HURTBOX_COLOR,
      fillAlpha: HITBOX_DEBUG_HURTBOX_FILL_ALPHA,
      strokeColor: HITBOX_DEBUG_HURTBOX_COLOR,
      strokeAlpha: HITBOX_DEBUG_HURTBOX_STROKE_ALPHA,
      strokeWidth: HITBOX_DEBUG_STROKE_WIDTH,
    });
  }
  return boxes;
}

/**
 * Build the world-space grab-range box for a fighter, or `null` when no
 * grab range sensor is live. Mirrors `offsetX` by the fighter's body
 * facing exactly as {@link spawnGrabHitbox} does, takes `offsetY`
 * as-is.
 */
export function grabDebugBox(
  snapshot: HitboxDebugFighterSnapshot,
): HitboxDebugBox | null {
  const grab = snapshot.activeGrab;
  if (!grab) return null;
  return {
    kind: 'grab',
    x: snapshot.bodyX + grab.hitbox.offsetX * snapshot.facing,
    y: snapshot.bodyY + grab.hitbox.offsetY,
    width: grab.hitbox.width,
    height: grab.hitbox.height,
    color: HITBOX_DEBUG_GRAB_COLOR,
    fillAlpha: HITBOX_DEBUG_GRAB_FILL_ALPHA,
    strokeColor: HITBOX_DEBUG_GRAB_COLOR,
    strokeAlpha: HITBOX_DEBUG_GRAB_STROKE_ALPHA,
    strokeWidth: HITBOX_DEBUG_STROKE_WIDTH,
  };
}

/**
 * Resolve every debug box for one fighter for one frame: its hurtbox
 * outlines (green), its active attack hitbox (red) when live, and its
 * active grab range (yellow) when live. Order is hurtboxes → attack →
 * grab so the attack / grab fills read on top of the hurtbox outline.
 */
export function computeFighterDebugBoxes(
  snapshot: HitboxDebugFighterSnapshot,
): HitboxDebugBox[] {
  const boxes: HitboxDebugBox[] = hurtboxDebugBoxes(snapshot);
  const attack = attackDebugBox(snapshot);
  if (attack) boxes.push(attack);
  const grab = grabDebugBox(snapshot);
  if (grab) boxes.push(grab);
  return boxes;
}
