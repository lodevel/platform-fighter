/**
 * Character package format `character-package/1`: how one character is displayed.
 *
 * Display only. Hitboxes, hurtboxes, damage, physics and a fighter's special
 * clocks belong to the game, which turns them into a plain request (action and
 * tick, facing). This module imports nothing outside `character/package/`.
 *
 * Conventions: lengths in design pixels, +X right, +Y down, every pose authored
 * facing right (the display mirrors X for left), time in ticks at 60 Hz counted
 * from 0 at the start of the action.
 */

export const PACKAGE_SCHEMA = 'character-package/1';

export type PageId = string;
export type DrawingId = string;
export type ActionId = string;

export interface CharacterPackage {
  readonly schema: typeof PACKAGE_SCHEMA;
  readonly id: string;
  /** Content hash of the canonical package, set by the serializer. */
  readonly revision: string;
  readonly pages: Readonly<Record<PageId, Page>>;
  readonly drawings: Readonly<Record<DrawingId, Drawing>>;
  readonly actions: Readonly<Record<ActionId, Action>>;
  /** Alternate colourings of the same drawings. Absent: the character is shown only as drawn. */
  readonly costumes?: Costumes;
  /**
   * Colours of `indexed` pages as `#rrggbbaa` (straight alpha), at most 256. Entry 0 is
   * transparent. Costumes recolour these entries rather than the pixels.
   */
  readonly palette?: readonly string[];
  readonly provenance: Provenance;
  /** Data only one host understands, keyed by a versioned host name. Never read by the core. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** An image file holding drawings, relative to the package directory. */
export interface Page {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  /**
   * `indexed`: a greyscale PNG whose value is the pixel's entry in the package palette
   * (one byte per pixel on the GPU). Absent: an RGBA PNG.
   */
  readonly format?: 'indexed';
}

/** One stored drawing: a rectangle of a page, placed by its root anchor. */
export interface Drawing {
  readonly page: PageId;
  /** [x, y, width, height] in page pixels. */
  readonly rect: readonly [number, number, number, number];
  /** Where the character's root sits, in page pixels from the rectangle's top-left corner. */
  readonly anchor: readonly [number, number];
  /** Design pixels per page pixel. */
  readonly scale: number;
}

/**
 * Actions named `effect.<name>` are effects (Final Smash bursts, articles such as arrows): the game
 * places the root at the effect's own origin and picks the tick (the effect's age, or a drawing step
 * such as a spin), so their `bodyCentreFromRootY` is 0. Tools keep their drawings as drawn: they are
 * neither held longer nor shrunk.
 */
export const EFFECT_ACTION_PREFIX = 'effect.';
export const isEffectAction = (action: ActionId): boolean => action.startsWith(EFFECT_ACTION_PREFIX);

/**
 * What one action shows over time. `bodyCentreFromRootY` places the drawing
 * relative to the game's body centre: root = bodyCentre - (0, bodyCentreFromRootY).
 */
export interface Action {
  readonly bodyCentreFromRootY: number;
  readonly drawings: Schedule<DrawingWindow>;
  /** Named attachment points, such as the hand that holds an item. */
  readonly sockets?: Readonly<Record<string, SocketTrack>>;
  /** The original move this action follows (the 20/20 reference), when known. */
  readonly source?: { readonly game: string; readonly move: string };
}

/**
 * Contiguous windows [start, end) from tick 0. After the last window the schedule
 * either repeats (`loop`, period = last end), keeps the last window (`hold`), or
 * shows nothing (`stop`).
 */
export interface Schedule<W extends Window> {
  readonly after: 'loop' | 'hold' | 'stop';
  readonly windows: readonly W[];
}

export interface Window {
  readonly start: number;
  readonly end: number;
}

export interface DrawingWindow extends Window {
  readonly drawing: DrawingId;
  /** Frame of the source move this drawing depicts, for review and reference alignment. */
  readonly sample?: number;
}

export interface SocketTrack {
  /** `body-centre` or `root` origin, facing right. */
  readonly space: 'body-centre' | 'root';
  readonly schedule: Schedule<SocketWindow>;
}

export interface SocketWindow extends Window {
  readonly x: number;
  readonly y: number;
  /** Direction of the held item in degrees clockwise from up (0 = up, 90 = forward), facing right. */
  readonly angle?: number;
  /** In-plane share of the item's length, 0..1, for items turned toward or away from the viewer. */
  readonly length?: number;
}

/** Most colour regions a costume may move (the recolour shader's fixed size). */
export const MAX_COLOR_REGIONS = 4;

/**
 * Costumes recolour the drawings at display time. Costume 0 is the art as drawn;
 * costume N moves every region by its slot's colour in N relative to costume 0,
 * keeping the art's light and shadow.
 */
export interface Costumes {
  /** Where each slot's colour lives in the art; several regions may share a slot. */
  readonly regions: readonly ColorRegion[];
  readonly list: readonly Costume[];
}

export interface ColorRegion {
  readonly slot: string;
  /** `#rrggbb` as drawn. */
  readonly color: string;
  /** Furthest a pixel may stray from `color` in hue (share of the wheel), saturation and value and still belong to the region. */
  readonly tolerance: readonly [number, number, number];
}

export interface Costume {
  readonly name: string;
  /** `#rrggbb` per slot named by the regions. */
  readonly slots: Readonly<Record<string, string>>;
}

export interface Provenance {
  readonly importer?: { readonly name: string; readonly version: string };
  /** Source files and their SHA-256, keyed by path. */
  readonly sources: Readonly<Record<string, string>>;
}
