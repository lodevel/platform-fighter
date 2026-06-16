/**
 * Ledge / edge-grab geometric detection — AC 60403 Sub-AC 3.
 *
 * Pure helpers that classify "is this fighter overlapping a grabbable
 * ledge right now?" against a flat description of the stage's solid
 * platforms. The runtime feeds in:
 *
 *   • The fighter's body bounds (centre + width / height).
 *   • The fighter's velocity (only descending fighters can edge-grab —
 *     a rising fighter would clip the platform top, which is the regular
 *     "land on" path).
 *   • The fighter's facing (the canonical Smash rule is "you grab the
 *     ledge in front of you" — a left-facing fighter passing a right-
 *     side ledge is *not* attempting to grab it).
 *   • A list of ledge candidates extracted from the stage's solid
 *     platforms — each ledge is the (x, y) corner of a platform top
 *     plus a side flag (`'left'` / `'right'`) noting which corner.
 *
 * The detector's output drives the (later) {@link LedgeHangState}
 * machine inside the `Character` class: a positive detection on a
 * descending, non-tethered, free fighter latches them into the
 * `'hanging'` state.
 *
 * Why a separate file
 * -------------------
 *
 *   • Pure functions, no Phaser, no Matter — the replay layer can
 *     re-run a recorded match through this helper and confirm identical
 *     edge-grab transitions across runs. Determinism is the M4 contract;
 *     this module sits inside it.
 *   • Easy unit tests with no scene fixtures — the test suite hand-rolls
 *     the `LedgeCandidate` records and `FighterBounds` snapshot.
 *   • Mirrors the structure of `dodgeState.ts` and `shieldState.ts` —
 *     pure modules per state machine, wired into `Character` from a
 *     single per-frame tick.
 *
 * Boundaries
 * ----------
 *
 * Out of scope for this module (handled by `ledgeHangState.ts` or
 * `Character.ts` itself):
 *
 *   • The state machine that owns "I am currently hanging, here is the
 *     tether-occupied flag, here is my get-up timer." The detector
 *     answers the geometric question "do I touch a ledge?"; the state
 *     machine decides what to do about it.
 *   • Multi-fighter ledge-conflict resolution ("only one fighter can
 *     hang on a ledge at a time"). The runtime composes per-fighter
 *     detections and rejects the second contender via a separate
 *     mediator (the "edge-grab conflict resolved by first-come-first-
 *     served or push-off rule" line item in the project Seed).
 *   • Tether-up-special line geometry (Bear's hookshot reaches a ledge
 *     from afar). That's a separate detection path (line-vs-ledge
 *     intersection) layered on top of this module's bounds-vs-ledge
 *     overlap test.
 *
 * Determinism: every helper here is a pure function of integer / float
 * coordinates and frozen ledge records. No `Math.random()`, no
 * `Date.now()`, no Matter / Phaser side effects. Identical inputs always
 * produce identical outputs.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Which corner of a platform a {@link LedgeCandidate} describes. The
 * runtime extracts both corners of each solid platform — fighters
 * approaching from the right grab the right corner, fighters approaching
 * from the left grab the left corner.
 */
export type LedgeSide = 'left' | 'right';

/**
 * A single grabbable ledge corner. The runtime builds one of these per
 * (platform × side) pair when a stage loads (or when a custom stage's
 * platforms shift in the moving-platform path) and keeps the array in
 * sync with the live geometry.
 *
 * Coordinates are in the same world-space units the fighter's body
 * `position` reads in (Matter px). `x` is the corner's X coordinate
 * (the platform's leftEdge for `'left'` ledges, rightEdge for `'right'`
 * ledges); `y` is the platform top's Y coordinate (canonical Phaser
 * screen-space, positive Y = downward).
 *
 * `platformId` is a stable identifier matching the `StagePlatform.id`
 * field — used by the state machine to remember which ledge a fighter
 * is currently hanging on so a frame-perfect re-detection cycle (the
 * fighter is *just* still overlapping the ledge corner) doesn't double-
 * latch.
 */
export interface LedgeCandidate {
  readonly platformId: string;
  readonly side: LedgeSide;
  readonly x: number;
  readonly y: number;
}

/**
 * Live snapshot of a fighter's body geometry + velocity / facing for
 * the detection pass. Authored as a flat record so callers don't need
 * to import the full `Character` class — replays, AI predictors, and
 * the unit tests synthesise these directly.
 *
 *   • `centerX` / `centerY`: body centre, world-space.
 *   • `halfWidth` / `halfHeight`: half-extents — the fighter's bounding
 *     box runs `[centerX - halfWidth, centerX + halfWidth]` on X and
 *     `[centerY - halfHeight, centerY + halfHeight]` on Y.
 *   • `velocityY`: positive = falling. Only descending fighters can
 *     edge-grab; a rising fighter passing a ledge is doing the
 *     "double-jump-onto-platform" gesture, not an edge grab.
 *   • `facing`: 1 = right, -1 = left. Used to gate the "ledge is in
 *     front of me" rule.
 */
export interface FighterBounds {
  readonly centerX: number;
  readonly centerY: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly velocityY: number;
  readonly facing: 1 | -1;
}

/**
 * Tunable thresholds for the detector. All fields optional with
 * sensible defaults from {@link LEDGE_DETECTION_DEFAULTS}; per-stage or
 * per-character overrides are reserved for a balance pass.
 */
export interface LedgeDetectionTuning {
  /**
   * Maximum horizontal distance (px) between the fighter's leading edge
   * and the ledge corner for the grab to register. Smash convention is
   * "the corner has a small magnetic radius" so a fighter falling close
   * past the ledge still latches; here the radius defaults to half the
   * fighter's body width — i.e. as long as the fighter's silhouette
   * straddles the ledge corner the grab registers.
   *
   * Default: derived per-call from the fighter's `halfWidth` (passed in
   * via {@link FighterBounds}); set this field explicitly only to clamp
   * the magnetism for a custom stage with very narrow ledges.
   */
  readonly horizontalRadius?: number;
  /**
   * Maximum vertical distance (px) between the ledge corner and the
   * fighter's body centre below which the grab registers. The corner
   * must be inside the band `[centerY - vertRadiusUp, centerY +
   * vertRadiusDown]` — i.e. the fighter's body silhouette overlaps the
   * ledge horizontally.
   *
   * Default: half the fighter's body height (so the corner is in the
   * top half of the body) for the "up" radius and the same value for
   * the "down" radius.
   */
  readonly verticalRadiusUp?: number;
  readonly verticalRadiusDown?: number;
  /**
   * Minimum descending velocity (px/step) required for a ledge grab to
   * register. Default 0 — any non-negative `velocityY` (i.e. falling or
   * stationary) is enough. A positive value would force a fighter to be
   * actually moving downward to grab; the canonical Smash rule is the
   * looser version, so the default permits a fighter who's hit "apex"
   * of their jump to grab the ledge they're floating past.
   */
  readonly minDescendVelocity?: number;
  /**
   * If `true`, require the ledge to be on the fighter's facing side. A
   * fighter facing right can only grab a `'right'`-side ledge; a fighter
   * facing left can only grab a `'left'`-side ledge. This is the
   * canonical "ledge is in front of me" rule.
   *
   * Some recovery moves (Bear's tether) ignore facing — they latch on
   * any ledge the line touches regardless of which corner. The runtime
   * composes the facing-aware default detection with the tether's
   * facing-blind path; consumers of the bare detector can disable this
   * gate by passing `requireFacing: false`.
   *
   * Default: `true`.
   */
  readonly requireFacing?: boolean;
}

/**
 * Result of a successful ledge-grab classification. `null` when no
 * candidate matches.
 *
 *   • `candidate`: the matching ledge record (so callers can read its
 *     `platformId`, `side`, and corner coordinates without re-finding
 *     it).
 *   • `latchX` / `latchY`: the suggested position for the fighter's
 *     body centre once latched. The state machine uses this to snap
 *     the body to the ledge so a fighter hanging "off the lip" reads
 *     visually clean — no stuck-in-the-platform clipping.
 */
export interface LedgeGrabDetection {
  readonly candidate: LedgeCandidate;
  readonly latchX: number;
  readonly latchY: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Sensible defaults — tuned for the canonical 90×130 fighter body and a
 * 200-px-wide platform. The horizontal / vertical radii are derived
 * per-call from the fighter's body so the detector stays correct when
 * Bear (heavier, larger body) or Cat (lighter, smaller body) swap in.
 */
export const LEDGE_DETECTION_DEFAULTS: LedgeDetectionTuning = Object.freeze({
  // `horizontalRadius` / `verticalRadiusUp` / `verticalRadiusDown` are
  // intentionally omitted so the resolver derives them from the
  // fighter's body half-extents per call. Set them on a per-stage
  // override only when a custom stage's narrow ledge geometry needs
  // tighter clamps.
  minDescendVelocity: 0,
  // Smash grabs a ledge regardless of which way the fighter faces — you snap
  // onto the lip facing the stage. A recovering fighter is moving *inward*
  // (facing the stage), i.e. AWAY from the ledge's outer side, so a facing
  // gate would reject exactly the normal recovery case. Default off; left as
  // an opt-in for narrow custom-stage geometry that wants directional grabs.
  requireFacing: false,
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the horizontal magnetism radius for a fighter's bounds. If
 * the caller pinned an explicit radius via tuning, use that; otherwise
 * derive from the body half-width.
 */
function resolveHorizontalRadius(
  bounds: FighterBounds,
  tuning: LedgeDetectionTuning,
): number {
  if (
    typeof tuning.horizontalRadius === 'number' &&
    Number.isFinite(tuning.horizontalRadius) &&
    tuning.horizontalRadius >= 0
  ) {
    return tuning.horizontalRadius;
  }
  return bounds.halfWidth;
}

function resolveVerticalRadiusUp(
  bounds: FighterBounds,
  tuning: LedgeDetectionTuning,
): number {
  if (
    typeof tuning.verticalRadiusUp === 'number' &&
    Number.isFinite(tuning.verticalRadiusUp) &&
    tuning.verticalRadiusUp >= 0
  ) {
    return tuning.verticalRadiusUp;
  }
  return bounds.halfHeight;
}

function resolveVerticalRadiusDown(
  bounds: FighterBounds,
  tuning: LedgeDetectionTuning,
): number {
  if (
    typeof tuning.verticalRadiusDown === 'number' &&
    Number.isFinite(tuning.verticalRadiusDown) &&
    tuning.verticalRadiusDown >= 0
  ) {
    return tuning.verticalRadiusDown;
  }
  return bounds.halfHeight;
}

/**
 * True iff the fighter's velocity / facing satisfies the *non-geometric*
 * preconditions for an edge grab. A rising fighter fails this gate. The
 * facing check is opt-in (`requireFacing`, default off) — when enabled a
 * fighter whose facing rules out the candidate's side also fails.
 *
 * Pure — no side effects, no time / random reads.
 */
export function isEligibleForLedgeGrab(
  bounds: FighterBounds,
  candidate: LedgeCandidate,
  tuning: LedgeDetectionTuning = LEDGE_DETECTION_DEFAULTS,
): boolean {
  const minVy = tuning.minDescendVelocity ?? 0;
  if (bounds.velocityY < minVy) return false;
  const requireFacing = tuning.requireFacing ?? false;
  if (requireFacing) {
    if (candidate.side === 'right' && bounds.facing !== 1) return false;
    if (candidate.side === 'left' && bounds.facing !== -1) return false;
  }
  return true;
}

/**
 * Geometric overlap test: is the fighter's body bounding box close
 * enough to the ledge corner to grab? Pure — same `(bounds, candidate,
 * tuning)` always returns the same result.
 *
 * Composed with {@link isEligibleForLedgeGrab} by {@link detectLedgeGrab}
 * — callers that want only the geometric half (e.g. an AI predictor
 * asking "is there a ledge nearby regardless of velocity?") can call
 * this directly.
 */
export function isWithinLedgeRadius(
  bounds: FighterBounds,
  candidate: LedgeCandidate,
  tuning: LedgeDetectionTuning = LEDGE_DETECTION_DEFAULTS,
): boolean {
  const hRadius = resolveHorizontalRadius(bounds, tuning);
  const vRadiusUp = resolveVerticalRadiusUp(bounds, tuning);
  const vRadiusDown = resolveVerticalRadiusDown(bounds, tuning);
  const dx = Math.abs(bounds.centerX - candidate.x);
  if (dx > hRadius) return false;
  const dy = candidate.y - bounds.centerY; // positive = ledge below centre
  if (dy > vRadiusDown) return false;
  if (-dy > vRadiusUp) return false;
  return true;
}

/**
 * Resolve which ledge candidate (if any) the fighter is currently
 * grabbing. Returns the closest matching ledge — closest by horizontal
 * distance to the fighter's centre — so that a fighter overlapping two
 * candidate corners (e.g. a thin platform with grabbable corners on
 * both sides, or two platforms whose lips touch) latches onto the one
 * the player most clearly aimed at.
 *
 * Returns `null` if no candidate satisfies the eligibility +
 * geometric tests.
 *
 * Pure — same `(bounds, candidates, tuning)` always returns the same
 * detection.
 */
export function detectLedgeGrab(
  bounds: FighterBounds,
  candidates: ReadonlyArray<LedgeCandidate>,
  tuning: LedgeDetectionTuning = LEDGE_DETECTION_DEFAULTS,
): LedgeGrabDetection | null {
  let best: LedgeGrabDetection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isEligibleForLedgeGrab(bounds, candidate, tuning)) continue;
    if (!isWithinLedgeRadius(bounds, candidate, tuning)) continue;
    const dx = Math.abs(bounds.centerX - candidate.x);
    if (dx >= bestDistance) continue;
    bestDistance = dx;
    best = {
      candidate,
      latchX: candidate.x,
      latchY: candidate.y + bounds.halfHeight,
    };
  }
  return best;
}

/**
 * Build a pair of `LedgeCandidate` records (left + right corner) from a
 * platform rectangle. Most stage layouts express platforms as
 * `(centerX, centerY, width, height)` with the platform top at
 * `centerY - height/2`; this helper does the corner math so the
 * stage-loading path can iterate platforms once and emit the candidate
 * list directly.
 *
 * Pass-through (drop-through) platforms are NOT grabbable — the runtime
 * filters those out before calling this helper.
 */
export function ledgeCandidatesFromPlatform(
  platform: {
    readonly id: string;
    readonly centerX: number;
    readonly centerY: number;
    readonly width: number;
    readonly height: number;
  },
): readonly [LedgeCandidate, LedgeCandidate] {
  const top = platform.centerY - platform.height / 2;
  const leftX = platform.centerX - platform.width / 2;
  const rightX = platform.centerX + platform.width / 2;
  return [
    Object.freeze({ platformId: platform.id, side: 'left' as const, x: leftX, y: top }),
    Object.freeze({ platformId: platform.id, side: 'right' as const, x: rightX, y: top }),
  ];
}

/**
 * Compose two candidate records and check if they describe the same
 * ledge corner (used by the state machine to detect "we're still
 * hanging on the ledge we latched onto").
 */
export function ledgeCandidatesEqual(
  a: LedgeCandidate | null,
  b: LedgeCandidate | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.platformId === b.platformId && a.side === b.side;
}
