/**
 * Phaser-free helpers for the `StageSelectScene` — AC 20104 Sub-AC 4.
 *
 * Keeping the entry-list builder out of the scene file means the unit
 * suite can drive every branch of the "which stages does the menu
 * list?" logic under plain Node — Phaser pulls in `navigator` /
 * `document` at module-eval time and would otherwise force this
 * pure-data helper into a jsdom harness.
 *
 * The scene file (`StageSelectScene.ts`) re-exports these symbols so
 * call sites and tests can import either path interchangeably; the
 * scene still owns the cursor state, GameObjects cache, and key-event
 * wiring.
 *
 * Determinism note: every helper here is a pure function of its
 * inputs. No `Math.random()`, no wall-clock reads, no module-level
 * mutation. A replay that recorded "player picked stage X from the
 * stage select menu" can re-derive the same entries list byte-
 * identically given the same `customStageIndex`.
 */

import {
  CRUMBLING_STAGE,
  FLAT_STAGE,
  LAVA_STAGE,
  MOVING_PLATFORM_STAGE,
  WIND_STAGE,
} from '../stages';
import type { CustomStageIndexEntry } from '../builder';

/**
 * Built-in stage entry — a hard-coded record per canonical built-in
 * stage. The display name is decoupled from the registry id so the
 * menu can show "MOVING PLATFORM" rather than the raw id.
 */
export interface BuiltInStageEntry {
  readonly kind: 'built-in';
  readonly id: string;
  readonly displayName: string;
  readonly subtitle: string;
}

/**
 * Custom stage entry — surfaced when the player has saved at least
 * one stage through the M3 builder. The `slotId` is the storage-layer
 * id that round-trips through `loadCustomStage`; the `displayName`
 * comes from the player-typed save name.
 */
export interface CustomStageEntry {
  readonly kind: 'custom';
  readonly slotId: string;
  readonly displayName: string;
  readonly subtitle: string;
}

/** Discriminated union the menu cursor walks through. */
export type StageSelectEntry = BuiltInStageEntry | CustomStageEntry;

/**
 * Canonical built-in stage roster. Mirrors the `STAGES` registry
 * order from `stageDefinitions.ts` (flat → lava → wind → crumbling
 * → moving platform). Decoupled from the registry so the menu can
 * present a friendly label without forcing every stage definition
 * to declare its presentation name.
 */
export const BUILT_IN_STAGE_ENTRIES: ReadonlyArray<BuiltInStageEntry> =
  Object.freeze([
    Object.freeze({
      kind: 'built-in' as const,
      id: FLAT_STAGE.id,
      displayName: 'FLAT',
      subtitle: 'Battlefield-style. No hazards.',
    }),
    Object.freeze({
      kind: 'built-in' as const,
      id: LAVA_STAGE.id,
      displayName: 'LAVA',
      subtitle: 'Rising lava pools. Instant KO.',
    }),
    Object.freeze({
      kind: 'built-in' as const,
      id: WIND_STAGE.id,
      displayName: 'WIND',
      subtitle: 'Gust corridors push you off-stage.',
    }),
    Object.freeze({
      kind: 'built-in' as const,
      id: CRUMBLING_STAGE.id,
      displayName: 'CRUMBLING',
      subtitle: 'Floors fall after you step on them.',
    }),
    Object.freeze({
      kind: 'built-in' as const,
      id: MOVING_PLATFORM_STAGE.id,
      displayName: 'MOVING PLATFORM',
      subtitle: 'Ferries across a wide pit.',
    }),
  ]);

/**
 * Build the full ordered list of selectable stages — built-ins first,
 * saved custom stages in the order the storage layer returns them
 * (last-saved-first per `customStageStorage.listCustomStages`).
 */
export function buildStageSelectEntries(
  customStageIndex: ReadonlyArray<CustomStageIndexEntry>,
): ReadonlyArray<StageSelectEntry> {
  const out: StageSelectEntry[] = [];
  for (const entry of BUILT_IN_STAGE_ENTRIES) out.push(entry);
  for (const slot of customStageIndex) {
    out.push({
      kind: 'custom',
      slotId: slot.id,
      displayName: slot.name.toUpperCase(),
      subtitle: 'Custom stage from builder',
    });
  }
  return out;
}

/**
 * Wrap the cursor index `current + delta` against the entries list.
 * Returns the same value (no wrap) when the list is empty so the
 * caller can no-op cleanly. Pure helper exposed so tests can drive
 * the wraparound contract without instantiating the scene.
 */
export function cycleStageCursor(
  current: number,
  delta: number,
  entriesLength: number,
): number {
  if (entriesLength <= 0) return current;
  const step = Math.trunc(delta);
  const raw = current + step;
  // Modulo that handles negative deltas correctly across all positive
  // entriesLength values (JS `%` returns the sign of the dividend).
  return ((raw % entriesLength) + entriesLength) % entriesLength;
}
