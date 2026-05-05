import Phaser from 'phaser';
import type { StageLayout } from '../types';
import { STAGE_DESIGN_WIDTH, STAGE_DESIGN_HEIGHT } from './stageDefinitions';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { getPlatformBehavior } from './platformBehavior';
import {
  bindPlatformRectangle,
  type PlatformVisualBinder,
} from './PlatformVisualBinder';
import {
  computePlatformVisualState,
  type PlatformVisualInput,
} from './platformVisualState';

/**
 * Renders a `StageLayout` into a Phaser scene.
 *
 * Responsibilities (Sub-AC 2.1 + 2.2 — collision boundaries):
 *   1. Create a Matter.js static body for every platform so characters
 *      can stand / collide on it. `passThrough` platforms are tagged
 *      with a Matter `label` *and* a distinct collision category so the
 *      character controller can implement drop-through semantics by
 *      flipping its mask, without re-reading the layout.
 *   2. Apply a shared collision-filter table from
 *      `engine/collisionCategories` so every body in the world filters
 *      against the same scheme — characters, hitboxes, projectiles,
 *      hazards, and blast-zone sensors all line up.
 *   3. Build four blast-zone sensor walls (top / bottom / left / right)
 *      anchored to the layout's `blastZone` rectangle. These are
 *      `isStatic + isSensor` bodies that *don't* push characters back
 *      but *do* fire `collisionStart` events so the KO handler (later
 *      AC) can score a stock loss the instant a body crosses the line.
 *      Together with the platform bodies, this is what "Matter.js
 *      collision boundaries and static bodies for stage geometry"
 *      means in practice.
 *   4. Draw a flat-colour rectangle for every platform so the geometry
 *      is visible even before art assets land. Solid ground gets a
 *      thicker stroke; pass-through platforms get a thinner, brighter
 *      stroke to read as "thin" in the silhouette.
 *   5. Optionally outline the blast zone — useful while iterating on
 *      stage layouts and during the M4 replay debug overlay.
 *
 * Scaling: stages are authored at the design resolution (1920×1080).
 * If the active scene's `scale.gameSize` differs (responsive
 * fullscreen), every coordinate and dimension is scaled uniformly so
 * the same `StageLayout` data renders correctly on any viewport.
 *
 * The renderer keeps references to all created bodies + visuals on
 * the returned `RenderedStage` handle so they can be torn down on
 * scene shutdown without leaking Matter bodies into the next match.
 */
/**
 * Per-platform runtime-state lookup (Sub-AC 4 of AC 90304).
 *
 * The owning scene supplies one of these to
 * {@link RenderedStage.updateVisuals} so the stage renderer can drive
 * the visual binder without knowing anything about hazard entities
 * directly. The lookup is keyed by *layout index* (the position of the
 * platform in `layout.platforms`) so callers can assemble the
 * input record from whatever side-table they keep their hazard
 * entities in (a `Map<index, CrumblingPlatform>`, etc).
 *
 * Returning `null` / omitting an index means "no runtime entity is
 * attached to this platform" — the visual binder will resolve the
 * platform's static base behavior (solid / pass-through / moving) with
 * no overlay, exactly matching the M1/M2 default visuals.
 */
export type PlatformVisualInputProvider = (
  platformIndex: number,
) => PlatformVisualInput | null | undefined;

export interface RenderedStage {
  readonly layout: StageLayout;
  /** Matter bodies, one per platform, in layout order. */
  readonly platformBodies: ReadonlyArray<MatterJS.BodyType>;
  /** Visual rectangles aligned 1:1 with `platformBodies`. */
  readonly platformVisuals: ReadonlyArray<Phaser.GameObjects.Rectangle>;
  /**
   * Per-platform visual binders aligned 1:1 with `platformVisuals`
   * (Sub-AC 4 of AC 90304). The owning scene calls
   * {@link RenderedStage.updateVisuals} once per fixed step (or once
   * per render frame) to push current visual state from the runtime
   * entity layer into the bound Phaser rectangles. Direct access is
   * also exposed so scenes that need to apply a single ad-hoc state
   * (e.g. the M3 stage builder hover preview) can do so without
   * touching the rest of the binder roster.
   */
  readonly platformBinders: ReadonlyArray<PlatformVisualBinder>;
  /**
   * Blast-zone sensor walls — `[top, bottom, left, right]`.
   * `isSensor` so they don't physically block; collision events still
   * fire so the KO handler can detect a body crossing the boundary.
   */
  readonly blastZoneBodies: ReadonlyArray<MatterJS.BodyType>;
  /** Optional debug graphics for the blast zone outline (only when requested). */
  readonly blastZoneDebug?: Phaser.GameObjects.Graphics;
  /**
   * Optional per-edge debug rectangles (top/bottom/left/right), drawn
   * when `drawBlastZone` is enabled so each of the four blast-zone
   * boundary rectangles is visually identifiable. Empty when blast-zone
   * debug rendering is off.
   */
  readonly blastZoneEdgeVisuals: ReadonlyArray<Phaser.GameObjects.Rectangle>;
  /** Uniform scale factor applied (active width / design width). */
  readonly scale: number;
  /**
   * Push current visual state into every platform's binder.
   * Sub-AC 4 of AC 90304. The provider returns the per-platform
   * runtime-state input (crumble / periodic / moving motion +
   * dropping / isSolid flags) for a given layout index, or `null` if
   * no runtime entity is attached.
   *
   * The provider is called once per platform per frame; the returned
   * input is fed through {@link computePlatformVisualState} and
   * applied via the corresponding {@link PlatformVisualBinder}. The
   * `frame` argument is forwarded to the visual state computation so
   * the wobble jitter and moving-platform motion stay deterministic
   * across replays.
   */
  updateVisuals(frame: number, provider?: PlatformVisualInputProvider): void;
  /** Tear down all created bodies + visuals. Idempotent. */
  destroy(): void;
}

export interface StageRenderOptions {
  /** Draw a thin outline of the blast zone for debugging. Default: false. */
  readonly drawBlastZone?: boolean;
  /**
   * Skip creating the blast-zone sensor walls. Default: false.
   * Useful for the stage-builder preview where you want geometry
   * without active KO triggers.
   */
  readonly skipBlastZoneBodies?: boolean;
  /** Override the colour of solid (ground) platforms. */
  readonly groundColor?: number;
  /** Override the colour of pass-through (floating) platforms. */
  readonly floatColor?: number;
  /** Override the stroke colour. */
  readonly strokeColor?: number;
}

const DEFAULT_GROUND_COLOR = 0x2a2a3c;
const DEFAULT_FLOAT_COLOR = 0x3a3a52;
const DEFAULT_STROKE_COLOR = 0x6cf0c2;

/**
 * Per-edge debug colours for the blast-zone boundary rectangles.
 *
 * Each of the four blast-zone edges is drawn as its own thin rectangle
 * so a glance at the screen tells the dev which boundary a body is
 * about to cross. The colours are deliberately distinct (warm
 * red/orange for ceiling/pit, cool lime/cyan for the sides) so they
 * read at a distance — handy when iterating on stage layouts or
 * debugging a KO that fires on the "wrong" edge.
 *
 * Exported so unit tests can lock the mapping down without inlining
 * magic numbers.
 */
export const BLAST_ZONE_DEBUG_COLORS = {
  /** Top KO ceiling — warm red. */
  top: 0xff5577,
  /** Bottom pit — burnt orange. */
  bottom: 0xff9944,
  /** Left side — lime green. */
  left: 0x66ee88,
  /** Right side — sky cyan. */
  right: 0x66cdee,
} as const;

/**
 * How thick (in *viewport* pixels) to draw each blast-zone boundary
 * rectangle. Chosen so the bands read at a glance even on a scaled-down
 * 1280×720 laptop window without obscuring nearby gameplay.
 */
const BLAST_ZONE_EDGE_BAND_PX = 6;

/** Matter `label` strings — used by the character controller for collision rules. */
export const PLATFORM_LABELS = {
  solid: 'platform.solid',
  passThrough: 'platform.passThrough',
} as const;

/**
 * Matter `label` strings for the four blast-zone sensor walls. The
 * collision handler uses these labels to know *which* edge a body
 * crossed (top KO vs side KO vs bottom pit) so the KO animation /
 * camera shake can match the direction.
 */
export const BLAST_ZONE_LABELS = {
  top: 'blastZone.top',
  bottom: 'blastZone.bottom',
  left: 'blastZone.left',
  right: 'blastZone.right',
} as const;

/**
 * How thick to make the blast-zone sensor walls (in design-space
 * pixels). Anything substantially larger than the fastest tunnelling
 * body works — characters max out around ~30 px/frame at top knockback
 * speed, so 200 px gives a comfortable safety margin against
 * tunnelling between physics steps.
 */
const BLAST_ZONE_WALL_THICKNESS = 200;

/**
 * Build all Matter bodies + visuals for a stage. Returns a
 * `RenderedStage` handle the caller can `destroy()` on shutdown.
 */
export function renderStage(
  scene: Phaser.Scene,
  layout: StageLayout,
  options: StageRenderOptions = {},
): RenderedStage {
  const { width: viewW, height: viewH } = scene.scale.gameSize;

  // Uniform scale so authored 1920×1080 coordinates fit the live
  // viewport even on smaller laptop screens. We pick the smaller of
  // the two ratios so the stage never overflows the viewport.
  const scale = Math.min(viewW / STAGE_DESIGN_WIDTH, viewH / STAGE_DESIGN_HEIGHT);

  // Centre the design viewport inside the live viewport so a 16:9
  // design fits cleanly in any 16:9-or-wider window.
  const offsetX = (viewW - STAGE_DESIGN_WIDTH * scale) / 2;
  const offsetY = (viewH - STAGE_DESIGN_HEIGHT * scale) / 2;

  const groundColor = options.groundColor ?? DEFAULT_GROUND_COLOR;
  const floatColor = options.floatColor ?? DEFAULT_FLOAT_COLOR;
  const strokeColor = options.strokeColor ?? DEFAULT_STROKE_COLOR;

  const platformBodies: MatterJS.BodyType[] = [];
  const platformVisuals: Phaser.GameObjects.Rectangle[] = [];
  /**
   * Visual binders parallel `platformVisuals`. Built lazily once the
   * Phaser rectangles are constructed so each binder captures the
   * rectangle's authored base position / size — i.e. the geometry
   * before any per-frame wobble/drop/scale offset is applied. See
   * {@link bindPlatformRectangle}.
   */
  const platformBinders: PlatformVisualBinder[] = [];

  for (const p of layout.platforms) {
    const w = p.width * scale;
    const h = p.height * scale;
    const cx = offsetX + p.x * scale;
    const cy = offsetY + p.y * scale;

    // ---- Matter body --------------------------------------------------
    // Solid platforms get the SOLID category and the SOLID mask
    // (collide with characters/projectiles/items). Pass-through
    // platforms get the PASS_THROUGH category and a character-only
    // mask, so projectiles fly past them and the character controller
    // can flip the mask off momentarily for "drop-through".
    const isPass = p.passThrough;
    const category = isPass
      ? COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH
      : COLLISION_CATEGORIES.PLATFORM_SOLID;
    const mask = isPass
      ? COLLISION_MASKS.PLATFORM_PASS_THROUGH
      : COLLISION_MASKS.PLATFORM_SOLID;

    const body = scene.matter.add.rectangle(cx, cy, w, h, {
      isStatic: true,
      label: isPass ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
      friction: 0.6,
      collisionFilter: {
        category,
        mask,
        // group: 0 — we don't use Matter's group override mechanism;
        // category/mask filtering is sufficient for this game.
        group: 0,
      },
      // Storing `passThrough` on `body.plugin` keeps the flag
      // discoverable inside collision callbacks without a reverse
      // lookup into the layout.
      plugin: { passThrough: isPass },
    });
    platformBodies.push(body);

    // ---- Visual rectangle --------------------------------------------
    // procedural fallback — platforms render as flat-colour
    // `Phaser.GameObjects.Rectangle` primitives because no per-platform
    // tile-art sprite atlas is wired through the StageLayout schema yet.
    // The M1 Kenney tilemap is loaded but only used by the background;
    // platform geometry stays procedural until a future AC plumbs
    // tile-spec data through `StageLayout.platforms` so the renderer can
    // pick a sprite frame per platform face.
    const fill = isPass ? floatColor : groundColor;
    const rect = scene.add
      .rectangle(cx, cy, w, h, fill)
      .setStrokeStyle(isPass ? 2 : 3, strokeColor);
    platformVisuals.push(rect);

    // ---- Visual binder (Sub-AC 4 of AC 90304) ---------------------------
    // The binder captures the rectangle's *authored* base position /
    // size at construction. Subsequent `updateVisuals(frame, provider)`
    // calls layer the platform's runtime visual state (wobble / drop
    // offset / tint / scale / outline) on top of that baseline so the
    // flat-colour static rectangle from M1 morphs into the appropriate
    // hazard / drop-through / motion visual at runtime.
    platformBinders.push(bindPlatformRectangle(rect));
  }

  // ---- Blast-zone sensor walls (Sub-AC 2.2) ----------------------------
  // Four `isStatic + isSensor` rectangles, one per edge of the blast
  // zone. They don't push characters back — they only fire collision
  // events. The KO handler (lands in a later AC) listens for
  // `collisionStart` between a CHARACTER body and any body whose label
  // starts with `blastZone.` to detect a stock loss.
  const blastZoneBodies: MatterJS.BodyType[] = [];
  if (!options.skipBlastZoneBodies) {
    const z = layout.blastZone;
    const t = BLAST_ZONE_WALL_THICKNESS;
    // Compose four walls *outside* the blast-zone rectangle so the
    // *inner edge* of each wall sits exactly on the blast-zone line.
    // Each entry: [label, designCenterX, designCenterY, designW, designH].
    const wallSpecs: Array<
      [string, number, number, number, number]
    > = [
      // Top wall — centred above the blast zone
      [
        BLAST_ZONE_LABELS.top,
        (z.left + z.right) / 2,
        z.top - t / 2,
        z.right - z.left + t * 2, // overhang on both sides so corners are sealed
        t,
      ],
      // Bottom wall — centred below the blast zone
      [
        BLAST_ZONE_LABELS.bottom,
        (z.left + z.right) / 2,
        z.bottom + t / 2,
        z.right - z.left + t * 2,
        t,
      ],
      // Left wall — centred to the left of the blast zone
      [
        BLAST_ZONE_LABELS.left,
        z.left - t / 2,
        (z.top + z.bottom) / 2,
        t,
        z.bottom - z.top,
      ],
      // Right wall — centred to the right of the blast zone
      [
        BLAST_ZONE_LABELS.right,
        z.right + t / 2,
        (z.top + z.bottom) / 2,
        t,
        z.bottom - z.top,
      ],
    ];

    for (const [label, dcx, dcy, dw, dh] of wallSpecs) {
      const cx = offsetX + dcx * scale;
      const cy = offsetY + dcy * scale;
      const w = dw * scale;
      const h = dh * scale;

      const body = scene.matter.add.rectangle(cx, cy, w, h, {
        isStatic: true,
        isSensor: true, // KO trigger only — no physical push-back.
        label,
        collisionFilter: {
          category: COLLISION_CATEGORIES.BLAST_ZONE,
          mask: COLLISION_MASKS.BLAST_ZONE,
          group: 0,
        },
        plugin: { blastZoneEdge: label },
      });
      blastZoneBodies.push(body);
    }
  }

  // ---- Optional blast-zone debug visualization (Sub-AC 1) --------------
  // The blast zone is authored as four boundary lines (top/bottom/left/
  // right) on the `StageLayout.blastZone` rectangle. The debug overlay
  // renders each of those four boundaries as its own colour-coded
  // rectangle band so devs can immediately read which edge a fighter
  // is about to cross — useful while iterating on hazard stages and
  // when reproducing replay desyncs around KO frames.
  //
  // We also keep the dim full-rectangle outline so the four edges read
  // as belonging to the same blast zone at a glance.
  let blastZoneDebug: Phaser.GameObjects.Graphics | undefined;
  const blastZoneEdgeVisuals: Phaser.GameObjects.Rectangle[] = [];
  if (options.drawBlastZone) {
    const z = layout.blastZone;
    const x = offsetX + z.left * scale;
    const y = offsetY + z.top * scale;
    const w = (z.right - z.left) * scale;
    const h = (z.bottom - z.top) * scale;

    // Faded full-rectangle outline — keeps the four boundaries visually
    // grouped as a single blast zone even when drawn in distinct
    // per-edge colours.
    // procedural fallback — blast-zone debug overlay drawn from a
    // `Phaser.GameObjects.Graphics` primitive plus per-edge `Rectangle`s.
    // Pure debug chrome (only visible when `drawBlastZone` is set);
    // intentionally procedural — no replacement texture is planned.
    blastZoneDebug = scene.add.graphics();
    blastZoneDebug.lineStyle(2, 0xff5577, 0.4);
    blastZoneDebug.strokeRect(x, y, w, h);

    // Per-edge bands (top / bottom / left / right). Each band is a
    // thin rectangle pinned to one edge of the blast zone, drawn in a
    // distinct colour. Storing them on the returned `RenderedStage`
    // means the tear-down path nukes them along with everything else.
    const band = BLAST_ZONE_EDGE_BAND_PX;
    // Centre coords for each edge band so they hug the blast-zone line.
    const cxMid = x + w / 2;
    const cyMid = y + h / 2;
    type EdgeSpec = {
      readonly cx: number;
      readonly cy: number;
      readonly w: number;
      readonly h: number;
      readonly color: number;
    };
    const edgeSpecs: ReadonlyArray<EdgeSpec> = [
      // Top edge: full-width thin band along the ceiling KO line.
      { cx: cxMid, cy: y, w: w, h: band, color: BLAST_ZONE_DEBUG_COLORS.top },
      // Bottom edge: full-width thin band along the pit KO line.
      {
        cx: cxMid,
        cy: y + h,
        w: w,
        h: band,
        color: BLAST_ZONE_DEBUG_COLORS.bottom,
      },
      // Left edge: full-height thin band along the left side.
      {
        cx: x,
        cy: cyMid,
        w: band,
        h: h,
        color: BLAST_ZONE_DEBUG_COLORS.left,
      },
      // Right edge: full-height thin band along the right side.
      {
        cx: x + w,
        cy: cyMid,
        w: band,
        h: h,
        color: BLAST_ZONE_DEBUG_COLORS.right,
      },
    ];
    for (const spec of edgeSpecs) {
      const rect = scene.add
        .rectangle(spec.cx, spec.cy, spec.w, spec.h, spec.color, 0.55)
        .setStrokeStyle(1, spec.color);
      blastZoneEdgeVisuals.push(rect);
    }
  }

  let destroyed = false;

  /**
   * Push current visual state into every platform's binder
   * (Sub-AC 4 of AC 90304). Iterates the layout in order; for each
   * platform, asks the provider for its runtime input record; falls
   * back to a behavior-only default when none is supplied (so plain
   * solid / pass-through / moving platforms still get the correct
   * static tint without a runtime entity attached).
   *
   * The default-input fallback is what makes this method safe to call
   * unconditionally each frame even on stages that don't have any
   * crumble / periodic / moving entities — the renderer just re-asserts
   * the static base-behavior visuals, which is a no-op when nothing
   * has changed.
   */
  const updateVisuals = (
    frame: number,
    provider?: PlatformVisualInputProvider,
  ): void => {
    if (destroyed) return;
    for (let i = 0; i < layout.platforms.length; i += 1) {
      const platform = layout.platforms[i]!;
      const binder = platformBinders[i];
      if (!binder) continue;
      const supplied = provider ? provider(i) : null;
      // Fallback when the provider returns nothing: resolve the
      // canonical behavior from the platform record so a layout with
      // `behavior: 'moving'` still shows the purple kinematic tint
      // even when no entity is attached.
      const fallbackInput: PlatformVisualInput = {
        behavior: getPlatformBehavior(platform),
        motion: platform.motion,
        frame,
      };
      // The provider may omit `frame`; supply it from the call so the
      // wobble jitter / moving-platform motion stays deterministic
      // across runs.
      const merged: PlatformVisualInput = supplied
        ? { ...supplied, frame: supplied.frame ?? frame }
        : fallbackInput;
      const state = computePlatformVisualState(merged);
      binder.apply(state);
    }
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    for (const body of platformBodies) {
      scene.matter?.world?.remove(body);
    }
    for (const body of blastZoneBodies) {
      scene.matter?.world?.remove(body);
    }
    for (const v of platformVisuals) {
      v.destroy();
    }
    for (const v of blastZoneEdgeVisuals) {
      v.destroy();
    }
    blastZoneDebug?.destroy();
  };

  return {
    layout,
    platformBodies,
    platformVisuals,
    platformBinders,
    blastZoneBodies,
    blastZoneDebug,
    blastZoneEdgeVisuals,
    scale,
    updateVisuals,
    destroy,
  };
}
