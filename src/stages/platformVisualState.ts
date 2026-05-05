/**
 * Platform visual-state computation — Sub-AC 4 of AC 90304.
 *
 * Single source of truth for "given a platform's authored behavior +
 * its current runtime lifecycle state, what visual properties should
 * its sprite/rectangle GameObject have on this fixed step?". Lives
 * next to {@link ./platformBehavior platformBehavior.ts} (Phaser-free,
 * Sub-AC 1 of AC 90301) and {@link ./platformCollisionToggle
 * platformCollisionToggle.ts} (Sub-AC 3 of AC 90303) so the stage
 * renderer, the stage builder preview, the replay scrubber, and the
 * AI debug overlay can all read the same computation without
 * forking the visual rule into four places.
 *
 * Why a *visual* layer at all (rather than baking everything into the
 * existing `StageRenderer` flat-colour path):
 *
 *   - `StageRenderer` paints platforms once at scene boot. The three
 *     {@link PlatformBehavior} types and the four hazard variants on
 *     top of them all *change visual state at runtime*:
 *
 *       • `solid` / `pass-through` platforms are static unless wrapped
 *         by a crumbling-platform / multi-stage / periodic entity, in
 *         which case the wobble + alpha + crack overlay must be applied
 *         each frame from the entity's `getRenderState()`.
 *       • `moving` platforms shift along their path each frame; the
 *         sprite must follow the kinematic body (AI / replay tooling
 *         needs an authoritative position for stage-builder preview
 *         that doesn't have a Matter body to read).
 *       • Drop-through "in flight" frames flip the pass-through
 *         platform into a distinct cyan-tinted style so the player can
 *         confirm their drop input registered.
 *       • Inactive (crumble fallen / debug-off) platforms must visibly
 *         disappear — a non-collidable platform that *looks* solid is
 *         the worst possible UX.
 *
 *   - Tests can pin every (behavior, runtime-state) → visual triplet
 *     without instantiating Phaser or Matter — the computation is a
 *     pure function of the inputs.
 *
 *   - The stage builder's M3 preview and the M4 replay scrubber both
 *     need to render a platform's *future* visual state without
 *     advancing the live entity (they fast-forward a hypothetical
 *     `frame` to preview "what does this platform look like 60 frames
 *     from now"). Folding the visual rule into a Phaser-free pure
 *     function is what makes that scrubbing trivial.
 *
 * Responsibilities:
 *
 *   1. {@link computePlatformVisualState} — pure function that returns
 *      the canonical visual hint set for a platform's *current* state
 *      across all three base behaviors plus the three hazard variants.
 *      No Phaser import, fully unit-testable.
 *
 *   2. {@link computeMovingPlatformOffset} — pure function returning
 *      the (x, y) design-pixel offset a moving platform's body should
 *      be at on a given fixed frame, given its motion config. Honours
 *      `phaseFrames`, `cycleFrames`, `mode` (`ping-pong` / `loop`), and
 *      `easing` (`linear` / `sine`). Drives both the visual binder and
 *      the kinematic body-position update.
 *
 *   3. {@link PLATFORM_VISUAL_TINTS} — frozen palette of canonical
 *      tint colours for each behavior × runtime-state pair, exported
 *      so tests, the stage builder UI, and balance docs can reference
 *      the values without hard-coding magic numbers.
 *
 * Determinism: every output is a pure function of the inputs. No
 * `Math.random()`, no wall-clock reads, no Phaser side-effects. The
 * wobble jitter pattern is generated from a deterministic
 * `frame`-based hash so two simulations with identical fixed-step
 * inputs produce identical visual states on every frame — required
 * for replay byte-equivalence with the M4 VCR.
 */

import type {
  MovingPlatformMotion,
  PlatformBehavior,
} from '../types';
import type { CrumblingRenderState } from '../entities/CrumblingPlatform';
import type { MultiStageCrumblingRenderState } from '../entities/MultiStageCrumblingPlatform';
import type { PeriodicRenderState } from '../entities/PeriodicPlatform';
import { resolveMovingPlatformMotion } from './platformBehavior';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Visual hint set produced by {@link computePlatformVisualState}.
 * Every field is a pure function of the inputs; the binder applies
 * them to a Phaser GameObject in one call.
 *
 *   - `visible`         : whether the GameObject should render at all.
 *                         False only for `gone` lifecycle phases (the
 *                         platform has fully disappeared).
 *   - `alpha`           : opacity in [0, 1].
 *   - `tint`            : 0xRRGGBB fill colour for the platform body.
 *                         Combines the base behavior colour with any
 *                         active hazard overlay (warning / crack /
 *                         break / phasing) according to `tintBlend`.
 *   - `tintBlend`       : 0..1 — how much of `overlayTint` is mixed
 *                         into `baseTint`. 0 = pure base; 1 = pure
 *                         overlay. Stored separately so tests can
 *                         verify the *raw* blend factor without
 *                         reverse-engineering it from `tint`.
 *   - `baseTint`        : the unblended base behavior colour. Useful
 *                         for renderers that prefer to do their own
 *                         blending (e.g. shader-based) and want the
 *                         two endpoint colours.
 *   - `overlayTint`     : the unblended hazard / runtime overlay
 *                         colour. Same rationale as `baseTint`.
 *   - `wobbleOffsetX`   : design-pixel X-offset for the per-frame
 *                         wobble shake (0 outside warning windows).
 *   - `wobbleOffsetY`   : design-pixel Y-offset for the wobble shake.
 *   - `dropOffsetX`     : design-pixel X-offset for moving platforms
 *                         (kinematic motion offset relative to the
 *                         authored base position). 0 outside `moving`.
 *   - `dropOffsetY`     : design-pixel Y-offset. For `moving` this is
 *                         the kinematic motion offset; for `falling`
 *                         crumble platforms it is the visual drop. The
 *                         two never overlap because a crumble can only
 *                         be `falling` when its base behavior is solid
 *                         or pass-through, never `moving`.
 *   - `scaleX`          : horizontal scale applied to the platform's
 *                         visual width. < 1 only during multi-stage
 *                         crumble degradation (`crack` / `break`).
 *   - `scaleY`          : vertical scale (currently always 1; reserved
 *                         for future hazard variants that crush the
 *                         platform vertically).
 *   - `outlineMode`     : whether to draw the platform as a
 *                         filled body, an outline-only ghost
 *                         (periodic `warnAppear`), or both.
 *   - `outlineIntensity`: 0..1 strength of the outline-only style
 *                         (0 = no outline, 1 = full outline). 0 except
 *                         during periodic `warnAppear`.
 *   - `solidActive`     : convenience boolean — true iff the platform
 *                         is currently in a *physically solid*
 *                         lifecycle phase. Mirrors the runtime collider
 *                         toggle's `mode === 'solid'/'pass-through'/`...`
 *                         and is exposed here so a renderer that wants
 *                         to draw a thicker stroke for "you can stand
 *                         on this" can do so without re-querying the
 *                         entity.
 *   - `warning`         : true iff the platform is currently telegraphing
 *                         an imminent state change (crumble triggered /
 *                         shake / crack / break, periodic warnDisappear /
 *                         warnAppear). Audio adapters use this to drive
 *                         a continuous warning loop across both
 *                         transition directions.
 */
export interface PlatformVisualState {
  readonly visible: boolean;
  readonly alpha: number;
  readonly tint: number;
  readonly tintBlend: number;
  readonly baseTint: number;
  readonly overlayTint: number;
  readonly wobbleOffsetX: number;
  readonly wobbleOffsetY: number;
  readonly dropOffsetX: number;
  readonly dropOffsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly outlineMode: PlatformOutlineMode;
  readonly outlineIntensity: number;
  readonly solidActive: boolean;
  readonly warning: boolean;
}

/**
 * How the renderer should treat the platform's visual style.
 *
 *   - `'fill'`    : draw the platform as a filled body (the default
 *                   for solid / pass-through / moving in their normal
 *                   active phase).
 *   - `'ghost'`   : draw an outline-only ghost (periodic `warnAppear`).
 *                   `outlineIntensity` ramps the stroke alpha so the
 *                   ghost fades in gradually as the platform
 *                   materialises.
 *   - `'fill+overlay'` : draw the filled body but layer a translucent
 *                        warning-tinted overlay on top (used during
 *                        any "still solid but warning" phase — crumble
 *                        triggered, multi-stage shake/crack/break,
 *                        periodic warnDisappear). Renderers that don't
 *                        support overlay compositing can fall back to
 *                        pure `'fill'` with the blended `tint` colour.
 */
export type PlatformOutlineMode = 'fill' | 'ghost' | 'fill+overlay';

/**
 * Inputs to {@link computePlatformVisualState}. Every runtime-state
 * field is mutually exclusive — at most one of `crumble` /
 * `multiStageCrumble` / `periodic` should be set per call (the platform
 * can't simultaneously be a baseline crumbler and a periodic phaser).
 * The function does NOT enforce that as a hard error so the stage
 * builder can pre-compute states for hypothetical entity attachments
 * without first instantiating the entity.
 */
export interface PlatformVisualInput {
  /**
   * Canonical platform behavior, as resolved by
   * {@link ./platformBehavior.getPlatformBehavior}. The visual layer
   * does NOT re-derive this — callers are expected to feed the
   * resolved value so a bug in behavior resolution surfaces in one
   * place, not three.
   */
  readonly behavior: PlatformBehavior;
  /**
   * Whether a fighter is currently mid-drop-through on this platform.
   * Pass-through platforms switch to a cyan-tinted style while at least
   * one fighter is dropping through, so the player gets a visible
   * confirmation their drop input registered. Ignored when the base
   * behavior is `solid`.
   *
   * Default `false`.
   */
  readonly dropping?: boolean;
  /**
   * Whether the platform is currently in a *physically solid*
   * lifecycle phase (`true` for a crumbling platform's `intact` /
   * `triggered`, a periodic platform's `solid` / `warnDisappear`, etc.;
   * `false` once it falls / vanishes). Defaults to `true` so callers
   * that don't wrap an entity (plain solid / pass-through / moving
   * platforms) get the sensible "always collidable" behaviour without
   * having to set the flag.
   */
  readonly isSolid?: boolean;
  /**
   * Crumbling-platform render hints, when this platform is wrapped by
   * a {@link CrumblingPlatform} entity. The visual layer reads
   * `alpha`, `wobbleNorm`, and `dropOffset` to drive the warning
   * shake + drop animation.
   */
  readonly crumble?: CrumblingRenderState;
  /**
   * Multi-stage crumbling render hints, when wrapped by a
   * {@link MultiStageCrumblingPlatform}. Adds `crackLevel`,
   * `chunkLevel`, `boundsScale`, and `fragile` on top of the baseline
   * crumble fields.
   */
  readonly multiStageCrumble?: MultiStageCrumblingRenderState;
  /**
   * Periodic platform render hints, when wrapped by a
   * {@link PeriodicPlatform}. Adds `blinkNorm`, `outlineNorm`, and
   * the `solid` / `warning` flags. Triggers the outline-only ghost
   * style during `warnAppear`.
   */
  readonly periodic?: PeriodicRenderState;
  /**
   * Fixed-step frame counter — used to drive the wobble jitter
   * pattern deterministically. The wobble pattern is a hash of
   * `frame`, so two simulations with identical fixed-step inputs
   * produce identical wobble offsets on every frame. Default `0`.
   */
  readonly frame?: number;
  /**
   * Moving platform motion config, when behavior is `'moving'`. Used
   * to compute `dropOffsetX` / `dropOffsetY` from the cycle position.
   * Ignored for non-moving behaviors. Required when behavior is
   * `'moving'` — a moving platform without motion config is a schema
   * error caught by `validateStagePlatform`.
   */
  readonly motion?: MovingPlatformMotion;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical tint palette for every (behavior × runtime-state) pair.
 * Exported so tests, the stage builder UI, and balance docs reference
 * the same values. Colours are 0xRRGGBB integers (Phaser/CSS hex).
 *
 *   - `solid.active`        — dark slate base for static ground.
 *   - `solid.inactive`      — desaturated near-black when collision
 *                             is off (crumble fallen, debug-toggled).
 *   - `passThrough.active`  — brighter slate for thin platforms.
 *   - `passThrough.inactive`— desaturated when collision is off.
 *   - `passThrough.dropping`— cyan-tinted while a fighter is dropping
 *                             through (visual confirmation of the
 *                             drop-through input).
 *   - `moving.active`       — purple tint that reads as "kinematic /
 *                             carrying" — distinguishes movers from
 *                             static platforms at a glance.
 *   - `moving.inactive`     — desaturated mover when collision is off.
 *   - `crumble.warning`     — amber overlay for the `triggered` /
 *                             `shake` / `crack` warning windows. Reads
 *                             as "this floor is failing".
 *   - `crumble.fragile`     — bright red-orange overlay during the
 *                             multi-stage `break` sub-phase, the
 *                             "imminent failure" cue.
 *   - `periodic.warning`    — yellow flicker overlay for both
 *                             `warnDisappear` and `warnAppear`. Audio
 *                             adapters drive the same loop across both.
 */
export const PLATFORM_VISUAL_TINTS = Object.freeze({
  solid: Object.freeze({
    active: 0x2a2a3c,
    inactive: 0x1a1a24,
  }),
  passThrough: Object.freeze({
    active: 0x3a3a52,
    inactive: 0x202030,
    dropping: 0x4a8aaa,
  }),
  moving: Object.freeze({
    active: 0x6a4a8a,
    inactive: 0x3a2a4a,
  }),
  crumble: Object.freeze({
    warning: 0xffaa44,
    fragile: 0xff5544,
  }),
  periodic: Object.freeze({
    warning: 0xffcc66,
  }),
} as const);

/**
 * Maximum design-pixel amplitude of the per-frame wobble jitter at
 * `wobbleNorm = 1`. Tuned so a wobbling crumble platform reads as
 * shaking but doesn't visually overlap into adjacent platforms on a
 * crowded stage layout.
 */
export const PLATFORM_WOBBLE_MAX_PX = 4;

/**
 * Default frame counter used when `input.frame` is omitted. Exposed
 * so tests can verify the "deterministic-zero" baseline without
 * inlining the magic.
 */
export const PLATFORM_WOBBLE_DEFAULT_FRAME = 0;

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute the canonical visual state for a platform on the current
 * fixed step. Pure function — no Phaser, no Matter, no
 * `Math.random()`. Decision tree:
 *
 *   1. Resolve `baseTint` from `behavior` + `dropping` + `isSolid`.
 *   2. If a hazard runtime-state is provided (crumble / multi-stage /
 *      periodic), overlay its alpha / tint / wobble / scale on top of
 *      the base.
 *   3. If behavior is `'moving'` and `motion` is set, layer the
 *      kinematic motion offset onto `dropOffsetX/Y`.
 *
 * The wobble jitter is generated from a deterministic hash of `frame`
 * so replays produce identical visuals across runs.
 */
export function computePlatformVisualState(
  input: PlatformVisualInput,
): PlatformVisualState {
  const isSolid = input.isSolid !== false; // default true
  const dropping = input.dropping === true;
  const frame = input.frame ?? PLATFORM_WOBBLE_DEFAULT_FRAME;

  // ---- Resolve base tint -------------------------------------------------
  const baseTint = resolveBaseTint(input.behavior, dropping, isSolid);

  // ---- Hazard overlay (mutually exclusive: crumble / multi / periodic) ---
  let alpha = 1;
  let overlayTint = baseTint;
  let tintBlend = 0;
  let wobbleNorm = 0;
  let dropOffsetX = 0;
  let dropOffsetY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let outlineMode: PlatformOutlineMode = 'fill';
  let outlineIntensity = 0;
  let solidActive = isSolid;
  let warning = false;
  let visible = true;

  if (input.crumble) {
    const c = input.crumble;
    alpha = c.alpha;
    visible = c.alpha > 0;
    wobbleNorm = c.wobbleNorm;
    dropOffsetY = c.dropOffset;
    if (c.wobbleNorm > 0) {
      // The baseline crumble has a *single* warning phase (`triggered`)
      // — the wobble is the cue, no fragile sub-state. Use the warning
      // tint with intensity tracking the wobble ramp.
      overlayTint = PLATFORM_VISUAL_TINTS.crumble.warning;
      tintBlend = c.wobbleNorm;
      warning = true;
      outlineMode = 'fill+overlay';
    }
    // While falling, the platform is no longer solid — the entity's
    // `isSolid()` already reflects this, but if the caller fed
    // `isSolid: true` (e.g. they pre-resolved it incorrectly), we
    // honour the render state's authoritative `alpha < 1` signal.
    if (alpha < 1) {
      solidActive = false;
    }
  } else if (input.multiStageCrumble) {
    const m = input.multiStageCrumble;
    alpha = m.alpha;
    visible = m.alpha > 0;
    wobbleNorm = m.wobbleNorm;
    dropOffsetY = m.dropOffset;
    scaleX = m.boundsScale > 0 ? m.boundsScale : 1;
    if (m.fragile) {
      // `break` sub-stage — bright red-orange "imminent failure" cue.
      overlayTint = PLATFORM_VISUAL_TINTS.crumble.fragile;
      tintBlend = Math.max(m.crackLevel, m.chunkLevel);
      warning = true;
      outlineMode = 'fill+overlay';
    } else if (m.crackLevel > 0 || m.wobbleNorm > 0) {
      // `shake` / `crack` — amber warning, blend tracks crack ramp
      // (or wobble during the shake-only window before any cracks).
      overlayTint = PLATFORM_VISUAL_TINTS.crumble.warning;
      tintBlend = Math.max(m.wobbleNorm, m.crackLevel);
      warning = true;
      outlineMode = 'fill+overlay';
    }
    if (alpha < 1 || m.boundsScale === 0) {
      solidActive = false;
    }
  } else if (input.periodic) {
    const p = input.periodic;
    alpha = p.alpha;
    visible = p.alpha > 0 || p.outlineNorm > 0;
    if (p.warning) {
      overlayTint = PLATFORM_VISUAL_TINTS.periodic.warning;
      // During warnDisappear we use blinkNorm; during warnAppear we
      // use the outline ramp (alpha tracks the same value, but the
      // outline reads as a distinct visual cue).
      tintBlend = Math.max(p.blinkNorm, p.outlineNorm);
      warning = true;
    }
    if (p.outlineNorm > 0) {
      // warnAppear — outline-only ghost style. Outline intensity ramps
      // with `outlineNorm` so the ghost stabilises into the solid form.
      outlineMode = 'ghost';
      outlineIntensity = p.outlineNorm;
    } else if (p.warning) {
      // warnDisappear — still filled, just with the warning overlay.
      outlineMode = 'fill+overlay';
    }
    solidActive = p.solid;
  }

  // ---- Moving platform motion ------------------------------------------
  if (input.behavior === 'moving' && input.motion) {
    const offset = computeMovingPlatformOffset(input.motion, frame);
    dropOffsetX += offset.x;
    dropOffsetY += offset.y;
  }

  // ---- Wobble jitter ----------------------------------------------------
  const wobble =
    wobbleNorm > 0
      ? computeWobbleOffset(frame, wobbleNorm)
      : { x: 0, y: 0 };
  const wobbleOffsetX = wobble.x;
  const wobbleOffsetY = wobble.y;

  // ---- Blend the overlay tint into the base for the canonical `tint` ----
  const tint = blendTint(baseTint, overlayTint, tintBlend);

  return {
    visible,
    alpha,
    tint,
    tintBlend,
    baseTint,
    overlayTint,
    wobbleOffsetX,
    wobbleOffsetY,
    dropOffsetX,
    dropOffsetY,
    scaleX,
    scaleY,
    outlineMode,
    outlineIntensity,
    solidActive,
    warning,
  };
}

/**
 * Resolve the per-frame design-pixel offset of a moving platform's
 * body, given its motion config and the current fixed-step frame.
 *
 *   - `frame` is reduced modulo `cycleFrames` after applying
 *     `phaseFrames`, so the function works for arbitrarily large
 *     frame counters without wrapping issues.
 *   - `mode === 'ping-pong'` : the cycle is interpreted as a full
 *     there-and-back trip; the second half mirrors the first.
 *   - `mode === 'loop'`      : the cycle is one forward traversal;
 *     after the last waypoint the platform teleports back to the
 *     first.
 *   - `easing === 'sine'`    : the per-segment interpolation parameter
 *     `t` is mapped through `0.5 - 0.5 * cos(πt)` so velocity is
 *     smooth at the waypoints.
 *   - `easing === 'linear'`  : `t` is used unchanged (constant speed).
 *
 * Pure function — no `Math.random()`, no Phaser/Matter side-effects.
 */
export function computeMovingPlatformOffset(
  motion: MovingPlatformMotion,
  frame: number,
): { readonly x: number; readonly y: number } {
  const resolved = resolveMovingPlatformMotion(motion);
  const { waypoints, cycleFrames, phaseFrames, mode, easing } = resolved;
  if (waypoints.length < 2) {
    // Schema validation should catch this at construction time; we
    // guard here so a hot-loaded custom stage with a malformed motion
    // config doesn't crash the renderer.
    return { x: 0, y: 0 };
  }

  // Reduce frame modulo cycle, accounting for phase offset. The two
  // modulo passes guarantee a non-negative result for negative frames
  // and a < cycleFrames result for any input.
  const cycleLen = cycleFrames;
  let cyclePos = ((frame + phaseFrames) % cycleLen + cycleLen) % cycleLen;

  // For ping-pong, the *effective* path length is `2 * (waypoints-1)`
  // segments — forward through waypoints, then reverse. We map cyclePos
  // onto the doubled path then fold the second half back to mirror.
  const segCount = waypoints.length - 1;

  let pathT: number;
  if (mode === 'ping-pong') {
    // Position within the doubled path in [0, 2 * segCount).
    pathT = (cyclePos / cycleLen) * (2 * segCount);
    if (pathT > segCount) {
      // Second half — fold back so the platform retraces its steps.
      pathT = 2 * segCount - pathT;
    }
  } else {
    // Loop mode: one forward traversal per cycle.
    pathT = (cyclePos / cycleLen) * segCount;
  }

  // pathT is now in [0, segCount]. Identify which segment we're in
  // and the local interpolation parameter t in [0, 1].
  const segIndex = Math.min(segCount - 1, Math.floor(pathT));
  const localT = pathT - segIndex;

  // Apply easing.
  const t = easing === 'sine' ? 0.5 - 0.5 * Math.cos(Math.PI * localT) : localT;

  const a = waypoints[segIndex]!;
  const b = waypoints[segIndex + 1]!;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pick the canonical base-tint colour for a (behavior × dropping ×
 * isSolid) triple. Pure function — no I/O.
 */
function resolveBaseTint(
  behavior: PlatformBehavior,
  dropping: boolean,
  isSolid: boolean,
): number {
  if (!isSolid) {
    switch (behavior) {
      case 'solid':
        return PLATFORM_VISUAL_TINTS.solid.inactive;
      case 'pass-through':
        return PLATFORM_VISUAL_TINTS.passThrough.inactive;
      case 'moving':
        return PLATFORM_VISUAL_TINTS.moving.inactive;
    }
  }
  switch (behavior) {
    case 'solid':
      return PLATFORM_VISUAL_TINTS.solid.active;
    case 'pass-through':
      return dropping
        ? PLATFORM_VISUAL_TINTS.passThrough.dropping
        : PLATFORM_VISUAL_TINTS.passThrough.active;
    case 'moving':
      return PLATFORM_VISUAL_TINTS.moving.active;
  }
}

/**
 * Linearly blend two RGB tints by `t` in [0, 1]. `t = 0` returns `a`
 * exactly; `t = 1` returns `b` exactly. Per-channel arithmetic on the
 * 0xRRGGBB integer; the result is rounded to the nearest integer per
 * channel for byte-stable replay snapshots.
 *
 * Exported indirectly via `computePlatformVisualState.tint`; not in
 * the public surface because callers should compose at the visual-
 * state level rather than re-blending tints downstream.
 */
function blendTint(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (bl & 0xff);
}

/**
 * Deterministic per-frame wobble jitter. Hash the frame counter into
 * a pseudo-random `(sx, sy)` pair in [-1, 1], then scale by
 * `intensity * PLATFORM_WOBBLE_MAX_PX`.
 *
 * The hash is a small integer mix (xorshift-style); using a fully
 * deterministic integer hash avoids any reliance on `Math.sin`
 * floating-point precision (which can vary by +/- 1 ULP across
 * platforms and would break the M4 replay byte-equivalence
 * guarantee).
 */
function computeWobbleOffset(
  frame: number,
  intensity: number,
): { readonly x: number; readonly y: number } {
  if (intensity <= 0) return { x: 0, y: 0 };
  const clamped = Math.min(1, Math.max(0, intensity));

  // Two independent integer hashes for x / y. The constants are
  // arbitrary primes chosen so the resulting pattern looks random
  // and doesn't visibly cycle within the first few hundred frames.
  // Coerce to a finite int first so non-finite frames (e.g. NaN from
  // a corrupted snapshot) collapse to zero rather than NaN-propagate.
  const f = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const hx = mix32(f, 0x9e3779b1);
  const hy = mix32(f, 0x85ebca77);

  // Map the unsigned 32-bit hashes to [-1, 1]. We divide by 2^31 - 1
  // and subtract 1 so 0 → -1 and 0xffffffff → ~1, giving a balanced
  // range without bias.
  const sx = (hx / 0xffffffff) * 2 - 1;
  const sy = (hy / 0xffffffff) * 2 - 1;
  const amp = clamped * PLATFORM_WOBBLE_MAX_PX;
  return { x: sx * amp, y: sy * amp };
}

/**
 * Tiny xorshift-style integer hash. Deterministic, no floating-point
 * dependency, fast enough that calling it twice per platform per
 * frame is a non-issue. Returns an unsigned 32-bit integer.
 */
function mix32(value: number, seed: number): number {
  // `Math.imul` gives integer multiplication semantics that wrap at
  // 32 bits — what we want for a stable hash that doesn't depend on
  // V8's float→int boxing behaviour.
  let x = (value ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
