/**
 * Binding-conflict detection (canonical M5 vocabulary) — AC 50004 Sub-AC 4.
 *
 * Purpose
 * -------
 *
 * AC 50004 Sub-AC 4 calls for "conflict detection logic that checks for
 * duplicate bindings within a single player's action set and surfaces a
 * warning/rejection in the UI". This module is the *canonical-
 * vocabulary* detector that pairs with {@link InputBindingProfileManager}
 * — it speaks the {@link BindingAction} / {@link PlayerProfile} /
 * {@link InputBinding} types from `src/types/bindings.ts`.
 *
 * The legacy {@link import('../ui/bindingConflicts').detectAllConflicts}
 * detector in `src/ui/bindingConflicts.ts` remains the source of truth
 * for the rebinding screen's per-action-row tinting + warning banner —
 * that surface is built on the older `inputBindings.ts` vocabulary
 * (`LogicalAction`) and is intentionally untouched here. Two parallel
 * detectors is *not* duplication: one operates on the legacy schema the
 * RebindingScreen owns; this one operates on the canonical schema the
 * profile manager / persistence loader / replay payload all share. Any
 * caller using the new vocabulary uses this module, not the UI one.
 *
 * Why a separate pure module instead of a method on the manager
 * -------------------------------------------------------------
 *
 *   • Test ergonomics — every detection rule is a pure function on a
 *     plain {@link PlayerProfile}. The vitest suite drives the whole
 *     surface under plain Node, no Phaser, no DOM, no manager
 *     instantiation.
 *   • Re-use — the lobby's "ready check", the persistence loader's
 *     "blob looks corrupt" path, and the rebinding capture flow's
 *     "would this commit produce a conflict?" path all want the same
 *     detection rules without coupling to a manager instance.
 *   • Determinism — same profile snapshot ⇒ byte-identical
 *     {@link IntraPlayerConflictReport}. Conflict order is a stable
 *     sort over `(identity, first-action)` so two consecutive
 *     re-renders of the same state are pixel-identical, and snapshot
 *     tests compare cleanly across runs.
 *
 * What constitutes an intra-player duplicate
 * ------------------------------------------
 *
 * Two or more *distinct* {@link BindingAction}s on a single
 * {@link PlayerProfile} bind the same physical input (same
 * {@link bindingIdentity}). Examples:
 *
 *   • `attack` and `shield` both on the F key → conflict.
 *   • `attack` bound twice to F (i.e. duplicate entries inside the
 *     `attack` binding list) → NOT a conflict; the dispatcher OR-s
 *     same-action bindings, so a duplicate in one slot is harmless.
 *   • `moveUp` and `jump` both on W → exempt by
 *     {@link ALLOWED_OVERLAP_PAIRS} (the canonical "tap up to jump"
 *     platform-fighter binding the default keyboard preset ships with).
 *
 * Allowed overlaps
 * ----------------
 *
 * The default keyboard presets bind `moveUp` and `jump` to the same key
 * (W on P1, Up Arrow on P2). That is not a bug — it is the canonical
 * "tap up to jump" platform-fighter ergonomic. {@link ALLOWED_OVERLAP_PAIRS}
 * encodes the small set of action pairs that may share a binding without
 * flagging. The exemption is *exact-pair* — a binding shared by
 * `moveUp` + `jump` + `attack` is still flagged because `attack` is not
 * in the allowed pair.
 *
 * Severity levels
 * ---------------
 *
 *   • `'error'` — the binding is unrecoverable as-is: the dispatcher
 *     will fire both actions on every press, leaving the player
 *     unable to use either independently. Applies to every intra-
 *     player duplicate that is NOT in {@link ALLOWED_OVERLAP_PAIRS}.
 *   • `'warning'` — reserved for future "soft" conflicts (e.g. binding
 *     to a key that overlaps a browser shortcut). Today the module
 *     emits no `'warning'` severities; the field is part of the
 *     public type so callers don't have to pattern-match a union later.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The conflict
 * locations are typed against {@link PlayerBindingIndex} and
 * {@link BindingAction} so a mistyped slot or action surfaces at compile
 * time, not runtime.
 *
 * Determinism
 * -----------
 *
 *   • Pure function — no `Math.random()`, no wall-clock reads, no
 *     Phaser, no DOM access.
 *   • Identity strings are deterministic (see {@link bindingIdentity}).
 *   • Returned reports are deeply frozen so a downstream consumer cannot
 *     mutate the cached detector output by writing into a returned array.
 *   • Same input ⇒ identical output across processes — suitable for
 *     replay-payload validation and lobby ready-check parity tests.
 */

import type {
  BindingAction,
  GamepadBindingSource,
  InputBinding,
  PlayerBinding,
  PlayerBindingIndex,
  PlayerProfile,
} from '../types/bindings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One binding location on a player slot. Returned per binding entry that
 * participates in a conflict so the UI can find and recolour the exact
 * row the duplicate lives in (or the persistence loader can pinpoint the
 * blob entry to surface in an error toast).
 */
export interface IntraPlayerBindingLocation {
  readonly slot: PlayerBindingIndex;
  readonly action: BindingAction;
  /** Index into the per-action `ReadonlyArray<InputBinding>` list. */
  readonly bindingIndex: number;
}

/**
 * Severity tier — UI consumers use this to pick the row tint. Today
 * every emitted conflict is `'error'`; the union is kept open for future
 * `'warning'` conflicts that don't strictly break the dispatcher (e.g. a
 * binding that overlaps a browser shortcut).
 */
export type IntraPlayerConflictSeverity = 'error' | 'warning';

/**
 * One detected intra-player duplicate-binding cluster. `locations`
 * always contains ≥2 entries — a conflict is meaningless with a single
 * location. The `bindingIdentity` string is stable across runs and
 * useful for debugging / logging; UI consumers should display the
 * binding via their own format helpers.
 */
export interface IntraPlayerBindingConflict {
  /**
   * Slot the conflict belongs to — every entry in {@link locations}
   * shares this slot value (intra-player by definition).
   */
  readonly slot: PlayerBindingIndex;
  readonly severity: IntraPlayerConflictSeverity;
  /**
   * Stable identity string for the shared binding — same for every
   * location in {@link locations}. The exact format is an
   * implementation detail (`kb:87`, `gp:0:btn:0`, …) but two equal
   * identities always describe the same physical input.
   */
  readonly identity: string;
  /** ≥2 distinct-action locations that share this physical input. */
  readonly locations: ReadonlyArray<IntraPlayerBindingLocation>;
  /**
   * Distinct {@link BindingAction}s involved in this conflict. Sorted
   * by the canonical {@link BindingAction} ordering so the UI's
   * resolution prompt reads the same way every refresh.
   */
  readonly actions: ReadonlyArray<BindingAction>;
}

/**
 * Result of scanning one or more {@link PlayerProfile}s for duplicates
 * within each player's own action set.
 *
 * Carries the raw conflict list plus index-friendly query helpers so the
 * UI can ask "is row X conflicted?" without re-scanning the list every
 * render frame. Every accessor returns a frozen reference; callers
 * cannot mutate the report.
 */
export interface IntraPlayerConflictReport {
  /**
   * All detected conflicts, sorted deterministically by
   * `(slot, identity, first-action)`. Empty array when no conflicts
   * exist.
   */
  readonly conflicts: ReadonlyArray<IntraPlayerBindingConflict>;
  /** True iff any conflict was detected. Convenience for the UI's "should I show the warning banner?" check. */
  readonly hasConflicts: boolean;
  /** True iff `(slot, action)` participates in any conflict. */
  hasConflictAt(slot: PlayerBindingIndex, action: BindingAction): boolean;
  /** All conflicts that involve `(slot, action)`. May be empty. */
  conflictsAt(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): ReadonlyArray<IntraPlayerBindingConflict>;
  /** All conflicts that involve `slot`. May be empty. */
  conflictsForSlot(slot: PlayerBindingIndex): ReadonlyArray<IntraPlayerBindingConflict>;
  /** Highest severity present at `(slot, action)`, or `null` if clean. */
  severityAt(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): IntraPlayerConflictSeverity | null;
}

// ---------------------------------------------------------------------------
// Allowed overlaps
// ---------------------------------------------------------------------------

/**
 * Pairs of {@link BindingAction}s that are allowed to share an
 * intra-player binding without being flagged.
 *
 * Today only `moveUp`/`jump` qualifies — the canonical "tap up to jump"
 * platform-fighter binding shipped by the default keyboard presets. Any
 * other shared binding is a conflict. Adding a new pair is a one-line
 * change here and immediately propagates through every detector + UI
 * consumer.
 *
 * Note the *pair* semantics: a binding shared by EXACTLY the two listed
 * actions (and no third action) is allowed. A binding shared by
 * `moveUp` + `jump` + `attack` is still flagged because `attack` is not
 * in the allowed pair.
 */
export const ALLOWED_OVERLAP_PAIRS: ReadonlyArray<
  readonly [BindingAction, BindingAction]
> = Object.freeze([Object.freeze(['moveUp', 'jump'] as const)]);

/**
 * True iff the supplied set of actions exactly equals one of the
 * {@link ALLOWED_OVERLAP_PAIRS}. The detection logic uses this to skip
 * the canonical `moveUp`+`jump` overlap without polluting every conflict
 * with an "is this the up-jump pair?" branch.
 *
 * Pure function — used by the detector and exposed for tests / future
 * UI variants that need the same exemption check (e.g. a "show me the
 * exempt overlaps too" diagnostic mode).
 */
export function isAllowedOverlap(actions: ReadonlySet<BindingAction>): boolean {
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
 *   • `gp:<padIndex>:axis:<i>:<+1|-1>` — gamepad half-axis. The
 *     threshold is intentionally NOT part of the identity: two bindings
 *     on the same half-axis with different sensitivities still fight
 *     for the same physical signal at runtime, so they conflict.
 *   • Gamepad bindings with `gamepadIndex === null` use `any` as the
 *     pad segment so they collide with bindings on every pad — that is
 *     the correct behaviour: a "menu confirm on any pad" binding
 *     genuinely overlaps every per-pad binding to the same source.
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
// Detection — single profile
// ---------------------------------------------------------------------------

/**
 * Per-identity bucket used during scanning. Tracks every action that
 * binds the same physical input on a single slot, and the index inside
 * each action's binding list so the renderer can target the exact entry.
 */
interface IntraBucket {
  readonly identity: string;
  /** Map of action → list of binding indices on that action. */
  readonly perAction: Map<BindingAction, number[]>;
}

/**
 * Detect every intra-player duplicate-binding cluster on a single
 * {@link PlayerProfile}.
 *
 * Rules:
 *
 *   • A "duplicate" is two or more distinct {@link BindingAction}s on
 *     the slot whose binding lists contain a binding with the same
 *     {@link bindingIdentity}. Multiple bindings on the *same* action
 *     that happen to be the same physical input do NOT conflict (the
 *     dispatcher OR-s same-action bindings).
 *   • If the duplicate's action set is in {@link ALLOWED_OVERLAP_PAIRS},
 *     it is silently skipped — the canonical `moveUp`+`jump` overlap is
 *     expected by default.
 *
 * The returned list is frozen and sorted by `(identity, first-action)`
 * for deterministic UI rendering.
 *
 * Accepts both {@link PlayerProfile} (the persistence shape) and
 * {@link PlayerBinding} (the runtime shape) — only the
 * `bindings: ActionMap` field is read. Tolerating both shapes lets the
 * detector be called from the persistence loader, the runtime
 * dispatcher, and the rebinding UI without forcing every caller to
 * lift / lower the profile envelope.
 */
export function detectIntraPlayerConflicts(
  profile: PlayerProfile | PlayerBinding,
): ReadonlyArray<IntraPlayerBindingConflict> {
  const slot = profile.playerIndex;
  const buckets = new Map<string, IntraBucket>();
  const actions = Object.keys(profile.bindings) as BindingAction[];
  for (const action of actions) {
    const list = profile.bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i]!;
      const id = bindingIdentity(binding);
      let bucket = buckets.get(id);
      if (bucket === undefined) {
        bucket = { identity: id, perAction: new Map() };
        buckets.set(id, bucket);
      }
      const indices = bucket.perAction.get(action) ?? [];
      indices.push(i);
      bucket.perAction.set(action, indices);
    }
  }

  const conflicts: IntraPlayerBindingConflict[] = [];
  for (const bucket of buckets.values()) {
    // Drop single-action buckets — they cannot conflict (the dispatcher
    // OR-s same-action bindings together).
    if (bucket.perAction.size < 2) continue;

    const actionSet = new Set<BindingAction>(bucket.perAction.keys());
    if (isAllowedOverlap(actionSet)) continue;

    const locations: IntraPlayerBindingLocation[] = [];
    for (const [action, indices] of bucket.perAction) {
      for (const idx of indices) {
        locations.push({ slot, action, bindingIndex: idx });
      }
    }
    locations.sort(compareLocations);

    const sortedActions = [...actionSet].sort(compareActions);

    conflicts.push(
      Object.freeze({
        slot,
        severity: 'error' as const,
        identity: bucket.identity,
        locations: Object.freeze(locations),
        actions: Object.freeze(sortedActions),
      }),
    );
  }

  conflicts.sort(compareConflicts);
  return Object.freeze(conflicts);
}

// ---------------------------------------------------------------------------
// Detection — across multiple profiles (per-player only — Sub-AC 4 scope)
// ---------------------------------------------------------------------------

/**
 * Detect intra-player duplicate-binding clusters across a snapshot of
 * profiles, returning a {@link IntraPlayerConflictReport} that bundles
 * every per-slot result with O(1) lookup helpers for the UI's per-row
 * tinting path.
 *
 * Sub-AC 4 of AC 50004 calls explicitly for "duplicate bindings within
 * a single player's action set". *Inter-player* keyboard overlap (slots
 * 1+2 sharing a key) is intentionally OUT OF SCOPE for this detector —
 * that case is owned by the legacy `bindingConflicts.ts` detector in
 * `src/ui/`, and a future "canonical inter-player detector" sub-AC can
 * extend this module without retrofitting the existing surface.
 *
 * The report is fully frozen — callers cannot mutate the conflict list
 * or the per-slot index. To re-detect after a profile mutation, call
 * this function again with the new snapshot; it is cheap (linear in
 * the number of binding entries across all slots) and produces a fresh
 * report.
 *
 * Accepts both {@link PlayerProfile} and {@link PlayerBinding} for
 * each slot value (only the `bindings` field is read), so callers
 * holding the runtime-shape map don't have to lift to profiles first.
 */
export function detectAllIntraPlayerConflicts(
  snapshot: Readonly<Record<PlayerBindingIndex, PlayerProfile | PlayerBinding>>,
): IntraPlayerConflictReport {
  const all: IntraPlayerBindingConflict[] = [];
  const slots: ReadonlyArray<PlayerBindingIndex> = [1, 2, 3, 4];
  for (const slot of slots) {
    const profile = snapshot[slot];
    /* istanbul ignore next — caller should always supply all four slots. */
    if (profile === undefined) continue;
    for (const c of detectIntraPlayerConflicts(profile)) all.push(c);
  }
  all.sort(compareConflicts);
  return buildReport(all);
}

/**
 * Per-action conflict-check — would replacing the current binding list
 * for `(slot, action)` with `proposedBindings` produce an intra-player
 * conflict on the slot?
 *
 * Used by the rebinding capture flow to surface a *pre-commit* warning
 * ("the F key is already bound to Shield on P1 — confirm or cancel?")
 * without forcing the player to discover the conflict only after the
 * write has already mutated the live store. The helper does not mutate
 * the supplied profile; callers that want to commit the binding pass
 * the new list through {@link InputBindingProfileManager.setActionBindings}
 * (or its `Checked` variant) themselves.
 *
 * Returns the conflicts that would exist *after* the proposed write —
 * an empty array when the write is safe.
 */
export function detectIntraPlayerConflictsForProposal(
  profile: PlayerProfile | PlayerBinding,
  action: BindingAction,
  proposedBindings: ReadonlyArray<InputBinding>,
): ReadonlyArray<IntraPlayerBindingConflict> {
  const slot = profile.playerIndex;
  // Rebuild the proposed binding map without mutating the input.
  const merged: Record<BindingAction, ReadonlyArray<InputBinding>> = {
    ...profile.bindings,
    [action]: Object.freeze(Array.from(proposedBindings)),
  } as Record<BindingAction, ReadonlyArray<InputBinding>>;
  // Fresh frozen profile-like value — the detector only reads
  // `playerIndex` + `bindings`.
  const proposed = {
    playerIndex: slot,
    bindings: merged,
  } as PlayerBinding;
  return detectIntraPlayerConflicts(proposed);
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(
  all: IntraPlayerBindingConflict[],
): IntraPlayerConflictReport {
  // Build (slot, action) → conflicts and slot → conflicts indexes.
  const indexByRow = new Map<string, IntraPlayerBindingConflict[]>();
  const indexBySlot = new Map<PlayerBindingIndex, IntraPlayerBindingConflict[]>();
  for (const conflict of all) {
    const slotArr = indexBySlot.get(conflict.slot) ?? [];
    slotArr.push(conflict);
    indexBySlot.set(conflict.slot, slotArr);

    for (const loc of conflict.locations) {
      const key = `${loc.slot}|${loc.action}`;
      const arr = indexByRow.get(key) ?? [];
      arr.push(conflict);
      indexByRow.set(key, arr);
    }
  }

  const frozenAll = Object.freeze(all.slice());
  const report: IntraPlayerConflictReport = Object.freeze({
    conflicts: frozenAll,
    hasConflicts: frozenAll.length > 0,
    hasConflictAt(slot: PlayerBindingIndex, action: BindingAction): boolean {
      return indexByRow.has(`${slot}|${action}`);
    },
    conflictsAt(
      slot: PlayerBindingIndex,
      action: BindingAction,
    ): ReadonlyArray<IntraPlayerBindingConflict> {
      const arr = indexByRow.get(`${slot}|${action}`);
      return arr === undefined
        ? Object.freeze([])
        : Object.freeze(arr.slice());
    },
    conflictsForSlot(
      slot: PlayerBindingIndex,
    ): ReadonlyArray<IntraPlayerBindingConflict> {
      const arr = indexBySlot.get(slot);
      return arr === undefined
        ? Object.freeze([])
        : Object.freeze(arr.slice());
    },
    severityAt(
      slot: PlayerBindingIndex,
      action: BindingAction,
    ): IntraPlayerConflictSeverity | null {
      const arr = indexByRow.get(`${slot}|${action}`);
      if (arr === undefined || arr.length === 0) return null;
      // 'error' beats 'warning' if both ever appear at the same row.
      return arr.some((c) => c.severity === 'error') ? 'error' : 'warning';
    },
  });
  return report;
}

// ---------------------------------------------------------------------------
// UI surface — warning text formatter
// ---------------------------------------------------------------------------

/**
 * Compose the screen-wide warning lines for an
 * {@link IntraPlayerConflictReport} — Sub-AC 4 "surfaces a warning ...
 * in the UI" deliverable.
 *
 *   • Empty report → empty array. UI consumers use that to hide the
 *     warning banner without needing a separate "show banner" flag.
 *   • Non-empty → a one-line headline with the count, plus optional
 *     detail lines (one per conflict, capped by `maxDetailLines`).
 *
 * The strings are device-agnostic (they reference action names like
 * "Attack" and the binding identity, not key glyphs) so the same lines
 * are usable in keyboard *and* gamepad rebinding panels. Callers that
 * want pretty key glyphs (e.g. "F" instead of `kb:70`) should map the
 * conflict's `identity` through their own format helper before display
 * — see the legacy `formatBinding` helper in `src/ui/rebindingScreenFormat.ts`
 * for an example.
 */
export function formatIntraPlayerWarningLines(
  report: IntraPlayerConflictReport,
  maxDetailLines: number = 3,
): ReadonlyArray<string> {
  const conflicts = report.conflicts;
  if (conflicts.length === 0) return Object.freeze([]);
  const lines: string[] = [];
  lines.push(
    conflicts.length === 1
      ? '⚠ 1 binding conflict — same input bound to multiple actions'
      : `⚠ ${conflicts.length} binding conflicts — same input bound to multiple actions`,
  );
  const detailCount = Math.min(conflicts.length, Math.max(0, maxDetailLines));
  for (let i = 0; i < detailCount; i += 1) {
    lines.push(formatIntraPlayerConflictPrompt(conflicts[i]!));
  }
  if (conflicts.length > detailCount) {
    const more = conflicts.length - detailCount;
    lines.push(`  …and ${more} more`);
  }
  return Object.freeze(lines);
}

/**
 * Per-conflict resolution prompt — the line a UI surface would render
 * underneath the warning banner. Names every action involved and tells
 * the player how to resolve the conflict.
 *
 * Format example:
 *   "  • P1 'kb:70' is shared by Attack & Shield — unbind one or pick a new input"
 */
export function formatIntraPlayerConflictPrompt(
  conflict: IntraPlayerBindingConflict,
): string {
  const actionList = conflict.actions
    .map((a) => formatActionLabelLocal(a))
    .join(' & ');
  return `  • P${conflict.slot} '${conflict.identity}' is shared by ${actionList} — unbind one or pick a new input`;
}

// ---------------------------------------------------------------------------
// UI surface — rejection result
// ---------------------------------------------------------------------------

/**
 * Discriminated result the rebinding UI / capture flow can use as a
 * rejection signal. `accepted: true` means the proposed bindings are
 * conflict-free (or carry only allowed-overlap pairs); `accepted: false`
 * carries the conflicts that blocked the write so the UI can surface
 * them in a toast / banner.
 */
export type IntraPlayerConflictCheckResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: 'intra_player_conflict';
      readonly conflicts: ReadonlyArray<IntraPlayerBindingConflict>;
      /** Pre-formatted warning lines suitable for direct UI display. */
      readonly warningLines: ReadonlyArray<string>;
    };

/**
 * Wrap {@link detectIntraPlayerConflictsForProposal} in a discriminated
 * result so the UI's "should I commit this binding?" path branches on a
 * single object instead of probing the conflicts array length itself.
 *
 * This is the canonical rejection helper for AC 50004 Sub-AC 4 — the
 * rebinding capture flow consults it before writing a captured binding
 * to the profile manager and surfaces the warning lines in a confirm-
 * cancel dialog when `accepted: false`.
 */
export function checkProposedBindingForConflicts(
  profile: PlayerProfile | PlayerBinding,
  action: BindingAction,
  proposedBindings: ReadonlyArray<InputBinding>,
): IntraPlayerConflictCheckResult {
  const conflicts = detectIntraPlayerConflictsForProposal(
    profile,
    action,
    proposedBindings,
  );
  if (conflicts.length === 0) {
    return Object.freeze({ accepted: true });
  }
  // Build a single-slot report so the formatter shape matches.
  const report = buildReport([...conflicts]);
  return Object.freeze({
    accepted: false,
    reason: 'intra_player_conflict',
    conflicts: report.conflicts,
    warningLines: formatIntraPlayerWarningLines(report),
  });
}

// ---------------------------------------------------------------------------
// Sorting helpers — deterministic conflict order
// ---------------------------------------------------------------------------

const ACTION_RANK: Readonly<Record<BindingAction, number>> = Object.freeze({
  moveLeft: 0,
  moveRight: 1,
  moveUp: 2,
  moveDown: 3,
  jump: 4,
  attack: 5,
  special: 6,
  shield: 7,
  grab: 8,
  dodge: 9,
});

function compareActions(a: BindingAction, b: BindingAction): number {
  return ACTION_RANK[a] - ACTION_RANK[b];
}

function compareConflicts(
  a: IntraPlayerBindingConflict,
  b: IntraPlayerBindingConflict,
): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  if (a.identity < b.identity) return -1;
  if (a.identity > b.identity) return 1;
  // Tie-break by first-action ranking.
  const aFirst = a.actions[0];
  const bFirst = b.actions[0];
  if (aFirst === undefined && bFirst === undefined) return 0;
  if (aFirst === undefined) return -1;
  if (bFirst === undefined) return 1;
  return compareActions(aFirst, bFirst);
}

function compareLocations(
  a: IntraPlayerBindingLocation,
  b: IntraPlayerBindingLocation,
): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  const ar = compareActions(a.action, b.action);
  if (ar !== 0) return ar;
  return a.bindingIndex - b.bindingIndex;
}

// ---------------------------------------------------------------------------
// Action label formatter (UI-friendly)
// ---------------------------------------------------------------------------

/**
 * Local helper: translate a {@link BindingAction} identifier to the
 * Title-Case label the UI surfaces in warning text. Local copy (rather
 * than importing from `src/ui/rebindingScreenFormat.ts`) so this module
 * carries zero `src/ui` dependencies — UI-layer code can change the
 * formatter freely without forcing this module to recompile.
 *
 * Mapping:
 *
 *   moveLeft  → "Move Left"
 *   moveRight → "Move Right"
 *   moveUp    → "Move Up"
 *   moveDown  → "Move Down"
 *   jump      → "Jump"
 *   attack    → "Attack"
 *   special   → "Special"
 *   shield    → "Shield"
 *   grab      → "Grab"
 *   dodge     → "Dodge"
 */
function formatActionLabelLocal(action: BindingAction): string {
  switch (action) {
    case 'moveLeft':
      return 'Move Left';
    case 'moveRight':
      return 'Move Right';
    case 'moveUp':
      return 'Move Up';
    case 'moveDown':
      return 'Move Down';
    case 'jump':
      return 'Jump';
    case 'attack':
      return 'Attack';
    case 'special':
      return 'Special';
    case 'shield':
      return 'Shield';
    case 'grab':
      return 'Grab';
    case 'dodge':
      return 'Dodge';
  }
}

/**
 * Tint colour (hex int) for a conflict severity. The renderer uses this
 * to recolour conflicted binding-row text. Aligned with the existing
 * `CONFLICT_TINT` palette in `src/ui/bindingConflicts.ts` so the two
 * detectors produce the same on-screen colour for the same severity.
 */
export const INTRA_PLAYER_CONFLICT_TINT: Readonly<
  Record<IntraPlayerConflictSeverity, number>
> = Object.freeze({
  error: 0xff5b5b,
  warning: 0xffd166,
});

/**
 * Hex-string tint colour suitable for Phaser's `text.setColor(...)`.
 * Convenience wrapper over {@link INTRA_PLAYER_CONFLICT_TINT}.
 */
export function intraPlayerConflictTintHex(
  severity: IntraPlayerConflictSeverity,
): string {
  const v = INTRA_PLAYER_CONFLICT_TINT[severity];
  return `#${v.toString(16).padStart(6, '0')}`;
}
