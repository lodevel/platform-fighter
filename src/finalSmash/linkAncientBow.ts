/** The Ancient Arrow, the article of Link's Final Smash (Ancient Bow and Arrow), in world px.
 *
 * SmashWiki "Ancient Bow and Arrow": Link "fires an Ancient Arrow straight ahead, hitting the first
 * person in his line of sight. A small explosion occurs as the opponent is hit, damaging anybody else
 * near the victim"; "If it strikes a wall or floor, it will also explode, but the explosion deals less
 * damage (35% → 20%)". No cinematic: the flying arrow is only the trigger, the explosion is the hit.
 *
 * Hit packets (damage, angle, BKB/KBG, radius, offset) are SmashWiki "Link (SSBU)/Final Smash" rows and
 * are read from `finalPacketBinding` (labels `ancient-flight`, `ancient-fighter`, `ancient-terrain`):
 * Flying 0% / 361 / 10 / 66, r 5, top z 4; Explosion (fighter) 35% / 60 / 102 / 46, r 25;
 * Explosion (wall) 20% / 50 / 122 / 35, r 25.
 *
 * SmashWiki gives no speed, range or lifetime. Those come from the native article
 * (sources/native/link_ancientbowarrow: Fly speed_x 60, dist_meter 60 × 10; Stick removes itself at
 * local frame 15, StickWall at 10). */
export const ANCIENT_ARROW_FLIGHT = Object.freeze({ speedNative: 60, rangeNative: 600,
  fighterBlastFrames: 14, terrainBlastFrames: 9 });

export type AncientArrowPhase = 'fly' | 'fighter-blast' | 'terrain-blast';
/** `x`/`y` is the arrow's model origin (the blast centre once it has struck). */
export interface AncientArrowState {
  readonly phase: AncientArrowPhase; readonly age: number;
  readonly x: number; readonly y: number; readonly facing: 1 | -1;
  /** World px flown so far. */
  readonly distance: number;
}
export interface AncientArrowContact { readonly kind: 'fighter' | 'terrain'; readonly fraction: number }

export function beginAncientArrow(origin: { x: number; y: number }, facing: 1 | -1): AncientArrowState {
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || (facing !== 1 && facing !== -1))
    throw new TypeError('Ancient Arrow requires a finite origin and a facing');
  return Object.freeze({ phase: 'fly', age: 0, x: origin.x, y: origin.y, facing, distance: 0 });
}

/** This step's travel of the arrow origin, or null once it has struck. */
export function ancientArrowSweep(state: AncientArrowState, pxPerNative: number):
  { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } } | null {
  if (state.phase !== 'fly') return null;
  return { from: { x: state.x, y: state.y }, to: { x: state.x + state.facing * ANCIENT_ARROW_FLIGHT.speedNative * pxPerNative, y: state.y } };
}

/** First of this step's contacts; a terrain contact wins a tie (it stops the arrow before the fighter). */
export function firstAncientArrowContact(contacts: readonly AncientArrowContact[]): AncientArrowContact | null {
  return [...contacts].sort((a, b) => a.fraction - b.fraction || (a.kind === b.kind ? 0 : a.kind === 'terrain' ? -1 : 1))[0] ?? null;
}

/** One fixed step. A contact turns the arrow into its explosion where it struck; with none it flies on
 * and leaves play once its travel exceeds the native range. Null once it has left play. */
export function stepAncientArrow(state: AncientArrowState, contact: AncientArrowContact | null, pxPerNative: number): AncientArrowState | null {
  const sweep = ancientArrowSweep(state, pxPerNative);
  if (sweep && contact) {
    const t = contact.fraction;
    return Object.freeze({ ...state, phase: contact.kind === 'fighter' ? 'fighter-blast' : 'terrain-blast', age: 0,
      x: sweep.from.x + (sweep.to.x - sweep.from.x) * t, y: sweep.from.y + (sweep.to.y - sweep.from.y) * t });
  }
  if (sweep) {
    const distance = state.distance + Math.abs(sweep.to.x - sweep.from.x);
    if (distance > ANCIENT_ARROW_FLIGHT.rangeNative * pxPerNative) return null;
    return Object.freeze({ ...state, age: state.age + 1, x: sweep.to.x, y: sweep.to.y, distance });
  }
  const age = state.age + 1;
  return age >= (state.phase === 'fighter-blast' ? ANCIENT_ARROW_FLIGHT.fighterBlastFrames : ANCIENT_ARROW_FLIGHT.terrainBlastFrames)
    ? null : Object.freeze({ ...state, age });
}

export function parseAncientArrowState(value: unknown): AncientArrowState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Ancient Arrow state must be an object');
  const row = value as Record<string, unknown>, keys = ['phase', 'age', 'x', 'y', 'facing', 'distance'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
    !['fly', 'fighter-blast', 'terrain-blast'].includes(row.phase as string) ||
    !Number.isSafeInteger(row.age) || (row.age as number) < 0 || (row.facing !== 1 && row.facing !== -1) ||
    ['x', 'y', 'distance'].some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key])) || (row.distance as number) < 0)
    throw new TypeError('Malformed Ancient Arrow checkpoint');
  return Object.freeze({ ...row }) as unknown as AncientArrowState;
}
