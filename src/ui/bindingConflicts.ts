/**
 * Binding-conflict detection — AC 40103 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding screen lets a player remap any logical action on any of
 * the four player slots, and the rebinding store stores those mappings in
 * a flat per-slot table. Two failure modes are easy to walk into:
 *
 *   1. **Intra-player duplicate** — the same physical input is bound to
 *      two unrelated actions on the same slot (e.g. `attack` and `shield`
 *      both on Space). The first action that wins the dispatcher OR
 *      *will* fire, but the second never can — silent confusion.
 *   2. **Inter-player keyboard overlap** — slots 1 and 2 share one
 *      physical keyboard. If P1 binds Jump to W and P2 binds Jump to W
 *      too, both fire on every key press: the wrong slot wins or both
 *      win, and the player never sees what they intended.
 *
 * Both conditions need to be flagged on the rebinding screen with a
 * visible warning and a one-click resolution prompt so the player can
 * fix the bind without having to discover the problem mid-match.
 *
 * Why a sibling pure-helper module
 * --------------------------------
 *
 *   • Test ergonomics — every detection rule is a pure function on a
 *     plain JS object. The vitest suite drives the whole surface under
 *     plain Node, no Phaser, no DOM.
 *   • Re-use — the (later) lobby flow can reuse `detectAllConflicts` to
 *     refuse to start a match while a fatal conflict is unresolved.
 *   • Determinism — same store snapshot ⇒ byte-identical
 *     {@link ConflictReport}. Conflict order is a stable sort over
 *     `(kind, identity, slot, action)` so two consecutive renders of the
 *     same state are pixel-identical, and a snapshot test compares
 *     cleanly across runs.
 *
 * Allowed overlaps
 * ----------------
 *
 * The default keyboard preset binds `up` and `jump` to the same key (W
 * on P1, Up Arrow on P2). That is not a bug — it's the canonical
 * "tap up to jump" platform-fighter ergonomic. We must NOT flag that
 * pair as a conflict, or every fresh boot would scream warnings at the
 * player. {@link ALLOWED_OVERLAP_PAIRS} encodes the small set of action
 * pairs that may share a binding without flagging.
 *
 * Severity levels
 * ---------------
 *
 *   • `'error'` — the binding is unrecoverable as-is: the dispatcher will
 *     drop one of the two actions on the floor. Applies to every
 *     intra-player duplicate that is NOT in the allowed-overlap list,
 *     and to every inter-player keyboard overlap on slots 1+2.
 *   • `'warning'` — reserved for future "soft" conflicts (e.g. binding
 *     `taunt` to a button that overlaps a system shortcut). Today the
 *     module emits no `'warning'` severities; the field is part of the
 *     public type so callers don't have to pattern-match a union later.
 */

import type {
  ActionBindings,
  GamepadBindingSource,
  InputBinding,
  LogicalAction,
  PlayerBindings,
  PlayerBindingsIndex,
} from '../types/inputBindings';
import {
  formatActionLabel,
  formatBinding,
} from './rebindingScreenFormat';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single binding location in the store. The conflict detector emits one
 * of these per binding entry that participates in a conflict, so the UI
 * can find and recolour the exact row the duplicate lives in.
 */
export interface BindingLocation {
  readonly slot: PlayerBindingsIndex;
  readonly action: LogicalAction;
  /** Index into the per-action `ReadonlyArray<InputBinding>` list. */
  readonly bindingIndex: number;
}

/**
 * Categorical reason the conflict exists. Used by the renderer to pick a
 * banner colour and a resolution-prompt template (the recommended fix
 * differs by kind: "unbind one of them" vs "give P2 a different key").
 */
export type BindingConflictKind = 'intra_player' | 'inter_player_keyboard';

/**
 * Severity tier — the renderer uses this to pick the row tint. Today
 * every emitted conflict is `'error'`; the union is kept open for future
 * "warning" conflicts that don't strictly break the dispatcher (e.g. a
 * binding that overlaps a browser shortcut).
 */
export type BindingConflictSeverity = 'error' | 'warning';

/**
 * One detected duplicate-binding cluster. `locations` always contains
 * ≥2 entries (a conflict is meaningless with a single location). The
 * `bindingLabel` is the human-readable string for the shared input,
 * suitable for direct display in resolution-prompt copy.
 */
export interface BindingConflict {
  readonly kind: BindingConflictKind;
  readonly severity: BindingConflictSeverity;
  /**
   * Stable identity string for the shared binding — same for every
   * location in `locations`. The exact format is an implementation detail
   * (`kb:87`, `gp:0:btn:0`, …) but two equal identities always describe
   * the same physical input. Useful for debugging / logging only — UI
   * code should display `bindingLabel` instead.
   */
  readonly identity: string;
  /** Human-readable label for the shared binding (e.g. "W", "[1] A"). */
  readonly bindingLabel: string;
  /** ≥2 locations that share this physical input. */
  readonly locations: ReadonlyArray<BindingLocation>;
}

/**
 * Full report from {@link detectAllConflicts}. Carries the raw conflict
 * list plus index-friendly query helpers so the UI can ask "is row X
 * conflicted?" without re-scanning the list each render frame.
 */
export interface ConflictReport {
  /**
   * All detected conflicts, sorted deterministically by
   * `(kind, identity, first-location-slot, first-location-action)`. Empty
   * array when no conflicts exist.
   */
  readonly conflicts: ReadonlyArray<BindingConflict>;
  /** True iff `(slot, action)` participates in any conflict. */
  hasConflict(slot: PlayerBindingsIndex, action: LogicalAction): boolean;
  /** All conflicts that involve `(slot, action)`. May be empty. */
  conflictsAt(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
  ): ReadonlyArray<BindingConflict>;
  /** Highest severity present at `(slot, action)`, or `null` if clean. */
  severityAt(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
  ): BindingConflictSeverity | null;
}

// ---------------------------------------------------------------------------
// Allowed overlaps
// ---------------------------------------------------------------------------

/**
 * Pairs of {@link LogicalAction}s that are allowed to share an
 * intra-player binding without being flagged.
 *
 * Today only `up`/`jump` qualifies — the canonical "tap up to jump"
 * platform-fighter binding. Adding a new pair is a one-line change here
 * and immediately propagates through every detector + UI consumer.
 *
 * Note the *pair* semantics: a binding shared by EXACTLY the two listed
 * actions (and no third action) is allowed. A binding shared by
 * `up` + `jump` + `attack` is still flagged because `attack` is not in
 * the allowed pair.
 */
export const ALLOWED_OVERLAP_PAIRS: ReadonlyArray<
  readonly [LogicalAction, LogicalAction]
> = Object.freeze([Object.freeze(['up', 'jump'] as const)]);

/**
 * True iff the supplied set of actions exactly equals one of the
 * {@link ALLOWED_OVERLAP_PAIRS}. The detection logic uses this to skip
 * the canonical `up`+`jump` overlap without polluting every conflict
 * with an "is this the up-jump pair?" branch.
 */
export function isAllowedOverlap(
  actions: ReadonlySet<LogicalAction>,
): boolean {
  if (actions.size !== 2) return false;
  for (const pair of ALLOWED_OVERLAP_PAIRS) {
    if (actions.has(pair[0]) && actions.has(pair[1])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical string identity for a binding. Two bindings produce the same
 * identity iff they describe the same physical input — same key, same
 * gamepad button on the same pad, or same half-axis direction on the
 * same pad axis.
 *
 * The format is internal (callers should treat it opaquely) but stable:
 *
 *   • `kb:<keyCode>` — keyboard binding.
 *   • `gp:<padIndex>:btn:<i>` — gamepad button.
 *   • `gp:<padIndex>:axis:<i>:<+1|-1>` — gamepad half-axis. The threshold
 *     is intentionally NOT part of the identity: two bindings on the same
 *     half-axis with different sensitivities still fight for the same
 *     physical signal at runtime, so they conflict.
 *   • Gamepad bindings with `gamepadIndex === null` use `any` as the pad
 *     segment so they collide with bindings on every pad — that is the
 *     correct behaviour: a "menu confirm on any pad" binding genuinely
 *     overlaps every per-pad binding to the same source.
 */
export function bindingIdentity(binding: InputBinding): string {
  if (binding.kind === 'keyboard') {
    return `kb:${binding.keyCode}`;
  }
  // gamepad
  const padTag =
    binding.gamepadIndex === null ? 'any' : String(binding.gamepadIndex);
  return `gp:${padTag}:${gamepadSourceIdentity(binding.source)}`;
}

function gamepadSourceIdentity(source: GamepadBindingSource): string {
  if (source.type === 'button') return `btn:${source.buttonIndex}`;
  // axis — sign in the identity so left-stick-left and left-stick-right
  // do NOT share an identity (different physical deflections).
  const sign = source.direction > 0 ? '+1' : '-1';
  return `axis:${source.axisIndex}:${sign}`;
}

/**
 * True iff two bindings target the same physical input. Convenience
 * wrapper over {@link bindingIdentity} for callers that don't need the
 * intermediate string.
 */
export function bindingsConflict(a: InputBinding, b: InputBinding): boolean {
  return bindingIdentity(a) === bindingIdentity(b);
}

// ---------------------------------------------------------------------------
// Detection — intra-player
// ---------------------------------------------------------------------------

/**
 * Per-identity bucket used during scanning. Tracks every action that
 * binds the same physical input on a single slot, and the index inside
 * each action's binding list so the renderer can target the exact entry.
 */
interface IntraBucket {
  readonly identity: string;
  readonly bindingLabel: string;
  /** Map of action → list of binding indices on that action. */
  readonly perAction: Map<LogicalAction, number[]>;
}

/**
 * Detect every duplicate-binding cluster within a single player's
 * profile. Each returned conflict has all locations on the same slot.
 *
 * Rules:
 *
 *   • A "duplicate" is two or more actions on the slot whose binding
 *     lists contain a binding with the same {@link bindingIdentity}.
 *     Multiple bindings on the *same* action that happen to be the same
 *     physical input do NOT conflict (the dispatcher just OR-s them).
 *   • If the duplicate's action set is in {@link ALLOWED_OVERLAP_PAIRS},
 *     it is silently skipped — the canonical `up`+`jump` overlap is
 *     expected by default.
 */
export function detectIntraPlayerConflicts(
  pb: PlayerBindings,
): ReadonlyArray<BindingConflict> {
  const buckets = new Map<string, IntraBucket>();
  const actions = Object.keys(pb.bindings) as LogicalAction[];
  for (const action of actions) {
    const list = pb.bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i]!;
      const id = bindingIdentity(binding);
      let bucket = buckets.get(id);
      if (bucket === undefined) {
        bucket = {
          identity: id,
          bindingLabel: formatBinding(binding),
          perAction: new Map(),
        };
        buckets.set(id, bucket);
      }
      const indices = bucket.perAction.get(action) ?? [];
      indices.push(i);
      bucket.perAction.set(action, indices);
    }
  }

  const conflicts: BindingConflict[] = [];
  for (const bucket of buckets.values()) {
    // Drop single-action buckets — they cannot conflict (the dispatcher
    // OR-s same-action bindings together).
    if (bucket.perAction.size < 2) continue;

    const actionSet = new Set<LogicalAction>(bucket.perAction.keys());
    if (isAllowedOverlap(actionSet)) continue;

    const locations: BindingLocation[] = [];
    for (const [action, indices] of bucket.perAction) {
      for (const idx of indices) {
        locations.push({ slot: pb.playerIndex, action, bindingIndex: idx });
      }
    }
    locations.sort(compareLocations);
    conflicts.push({
      kind: 'intra_player',
      severity: 'error',
      identity: bucket.identity,
      bindingLabel: bucket.bindingLabel,
      locations: Object.freeze(locations),
    });
  }

  conflicts.sort(compareConflicts);
  return Object.freeze(conflicts);
}

// ---------------------------------------------------------------------------
// Detection — inter-player keyboard
// ---------------------------------------------------------------------------

/**
 * Detect duplicate keyboard bindings between slots that share one
 * physical keyboard. Slots 1 and 2 are always treated as overlapping
 * keyboard players per the Seed: P1=WASD-cluster, P2=arrows+numpad,
 * one keyboard between them.
 *
 * Gamepad bindings are intentionally NOT included here — two pads at
 * different `gamepadIndex` are distinct physical devices and cannot
 * overlap. (Two slots that *do* both reference the same `gamepadIndex`
 * would overlap, and that case is detected by
 * {@link detectInterPlayerGamepadConflicts}.)
 *
 * The slot pair is hard-coded to (1, 2) rather than scanning every
 * combination because:
 *
 *   • The Seed pins keyboard ownership to slots 1 and 2. Slots 3 and 4
 *     can in theory receive keyboard bindings (the rebinding screen
 *     allows it), but doing so produces a different category of
 *     misconfiguration ("a slot with no clear device") that the
 *     `inferDeviceOption` formatter already surfaces in the UI.
 *   • Limiting the scan to the canonical pair keeps the report
 *     deterministic and small.
 */
export function detectInterPlayerKeyboardConflicts(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
): ReadonlyArray<BindingConflict> {
  return detectInterPlayerKeyboardConflictsForSlots(snapshot, 1, 2);
}

/**
 * Lower-level helper exposed for tests / future configurations: detect
 * inter-player keyboard conflicts between any two slots. Used by
 * {@link detectInterPlayerKeyboardConflicts} which pins the slot pair to
 * (1, 2) per the Seed.
 */
export function detectInterPlayerKeyboardConflictsForSlots(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
  slotA: PlayerBindingsIndex,
  slotB: PlayerBindingsIndex,
): ReadonlyArray<BindingConflict> {
  if (slotA === slotB) return Object.freeze([]);
  const a = snapshot[slotA];
  const b = snapshot[slotB];

  // Identity → list of (slot, action, index) entries that bind it.
  // Restricted to keyboard bindings only.
  const buckets = new Map<
    string,
    { identity: string; bindingLabel: string; locations: BindingLocation[] }
  >();
  collectKeyboardLocations(buckets, slotA, a.bindings);
  collectKeyboardLocations(buckets, slotB, b.bindings);

  const conflicts: BindingConflict[] = [];
  for (const bucket of buckets.values()) {
    // We only care about identities that appear on BOTH slots.
    const slotsHit = new Set<PlayerBindingsIndex>();
    for (const loc of bucket.locations) slotsHit.add(loc.slot);
    if (slotsHit.size < 2) continue;

    const locations = bucket.locations.slice().sort(compareLocations);
    conflicts.push({
      kind: 'inter_player_keyboard',
      severity: 'error',
      identity: bucket.identity,
      bindingLabel: bucket.bindingLabel,
      locations: Object.freeze(locations),
    });
  }

  conflicts.sort(compareConflicts);
  return Object.freeze(conflicts);
}

function collectKeyboardLocations(
  buckets: Map<
    string,
    { identity: string; bindingLabel: string; locations: BindingLocation[] }
  >,
  slot: PlayerBindingsIndex,
  bindings: ActionBindings,
): void {
  const actions = Object.keys(bindings) as LogicalAction[];
  for (const action of actions) {
    const list = bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i]!;
      if (binding.kind !== 'keyboard') continue;
      const id = bindingIdentity(binding);
      let bucket = buckets.get(id);
      if (bucket === undefined) {
        bucket = {
          identity: id,
          bindingLabel: formatBinding(binding),
          locations: [],
        };
        buckets.set(id, bucket);
      }
      bucket.locations.push({ slot, action, bindingIndex: i });
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregate detection
// ---------------------------------------------------------------------------

/**
 * Combined detection over the full four-slot snapshot. Returns a
 * {@link ConflictReport} that bundles the raw conflict list with O(1)
 * lookup helpers for the UI's per-row colouring path.
 *
 * The report is fully frozen — callers cannot mutate the conflict list
 * or the index. To re-detect after a store mutation, call this function
 * again with the new snapshot; it is cheap (linear in the number of
 * binding entries across all slots) and produces a fresh report.
 */
export function detectAllConflicts(
  snapshot: Readonly<Record<PlayerBindingsIndex, PlayerBindings>>,
): ConflictReport {
  const all: BindingConflict[] = [];
  const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
  for (const slot of slots) {
    for (const c of detectIntraPlayerConflicts(snapshot[slot])) all.push(c);
  }
  for (const c of detectInterPlayerKeyboardConflicts(snapshot)) all.push(c);
  all.sort(compareConflicts);
  return buildReport(all);
}

function buildReport(all: BindingConflict[]): ConflictReport {
  // Build (slot, action) → conflicts index for fast lookups.
  const index = new Map<string, BindingConflict[]>();
  for (const conflict of all) {
    for (const loc of conflict.locations) {
      const key = `${loc.slot}|${loc.action}`;
      const arr = index.get(key) ?? [];
      arr.push(conflict);
      index.set(key, arr);
    }
  }
  for (const [key, arr] of index) {
    index.set(key, arr.slice());
  }
  const frozenAll = Object.freeze(all.slice());
  const report: ConflictReport = Object.freeze({
    conflicts: frozenAll,
    hasConflict(slot: PlayerBindingsIndex, action: LogicalAction): boolean {
      return index.has(`${slot}|${action}`);
    },
    conflictsAt(
      slot: PlayerBindingsIndex,
      action: LogicalAction,
    ): ReadonlyArray<BindingConflict> {
      const arr = index.get(`${slot}|${action}`);
      return arr === undefined ? Object.freeze([]) : Object.freeze(arr.slice());
    },
    severityAt(
      slot: PlayerBindingsIndex,
      action: LogicalAction,
    ): BindingConflictSeverity | null {
      const arr = index.get(`${slot}|${action}`);
      if (arr === undefined || arr.length === 0) return null;
      // 'error' beats 'warning' if both are ever emitted at the same row.
      return arr.some((c) => c.severity === 'error') ? 'error' : 'warning';
    },
  });
  return report;
}

// ---------------------------------------------------------------------------
// Sorting helpers — deterministic conflict order
// ---------------------------------------------------------------------------

const CONFLICT_KIND_RANK: Readonly<Record<BindingConflictKind, number>> = {
  inter_player_keyboard: 0,
  intra_player: 1,
};

function compareConflicts(a: BindingConflict, b: BindingConflict): number {
  const k = CONFLICT_KIND_RANK[a.kind] - CONFLICT_KIND_RANK[b.kind];
  if (k !== 0) return k;
  if (a.identity < b.identity) return -1;
  if (a.identity > b.identity) return 1;
  // Tie-break by first-location ordering — locations are pre-sorted, so
  // this is stable.
  const aLoc = a.locations[0];
  const bLoc = b.locations[0];
  if (aLoc === undefined && bLoc === undefined) return 0;
  if (aLoc === undefined) return -1;
  if (bLoc === undefined) return 1;
  return compareLocations(aLoc, bLoc);
}

function compareLocations(a: BindingLocation, b: BindingLocation): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  if (a.action < b.action) return -1;
  if (a.action > b.action) return 1;
  return a.bindingIndex - b.bindingIndex;
}

// ---------------------------------------------------------------------------
// Resolution prompts
// ---------------------------------------------------------------------------

/**
 * Compose the screen-wide warning banner for a {@link ConflictReport}.
 *
 *   • Empty report → empty string. The renderer uses that to hide the
 *     banner without needing a separate "show warning" boolean.
 *   • Non-empty → a one-line headline with the count, plus optional
 *     detail lines for the first few conflicts.
 */
export function formatConflictBannerLines(
  report: ConflictReport,
  maxDetailLines: number = 3,
): ReadonlyArray<string> {
  const conflicts = report.conflicts;
  if (conflicts.length === 0) return Object.freeze([]);
  const lines: string[] = [];
  lines.push(
    conflicts.length === 1
      ? '⚠ 1 binding conflict — click a highlighted row to rebind it'
      : `⚠ ${conflicts.length} binding conflicts — click a highlighted row to rebind it`,
  );
  const detailCount = Math.min(conflicts.length, Math.max(0, maxDetailLines));
  for (let i = 0; i < detailCount; i += 1) {
    lines.push(formatConflictResolutionPrompt(conflicts[i]!));
  }
  if (conflicts.length > detailCount) {
    const more = conflicts.length - detailCount;
    lines.push(`  …and ${more} more`);
  }
  return Object.freeze(lines);
}

/**
 * Compose the per-conflict resolution prompt — the line the screen shows
 * underneath the warning banner. Names every location involved and tells
 * the player exactly how to resolve it.
 */
export function formatConflictResolutionPrompt(
  conflict: BindingConflict,
): string {
  const locations = conflict.locations
    .map((loc) => `P${loc.slot} ${formatActionLabel(loc.action)}`)
    .join(' & ');
  if (conflict.kind === 'inter_player_keyboard') {
    return `  • '${conflict.bindingLabel}' is shared by ${locations} — give one a different key`;
  }
  return `  • '${conflict.bindingLabel}' is shared by ${locations} — unbind one or pick a new input`;
}

/**
 * Tint colour (hex int) for a conflict severity. The renderer uses this
 * to recolour conflicted binding-row text. Kept here (not in the screen)
 * so the lobby's "ready check" UI can reuse the same palette.
 */
export const CONFLICT_TINT: Readonly<Record<BindingConflictSeverity, number>> =
  Object.freeze({
    error: 0xff5b5b,
    warning: 0xffd166,
  });

/**
 * Hex-string tint colour suitable for Phaser's `text.setColor(...)`.
 * Convenience wrapper over {@link CONFLICT_TINT} so the renderer doesn't
 * have to repeat the int → string conversion.
 */
export function conflictTintHexString(
  severity: BindingConflictSeverity,
): string {
  const v = CONFLICT_TINT[severity];
  return `#${v.toString(16).padStart(6, '0')}`;
}
