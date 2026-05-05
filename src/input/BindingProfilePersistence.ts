/**
 * Versioned binding profile persistence schema — AC 40101 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The M5 input-rebinding milestone persists per-player control layouts
 * to the browser's `localStorage` so a player's customised bindings
 * survive across sessions. AC 40101 Sub-AC 1 calls for a *dedicated*
 * persistence schema module — types-and-constants only, no IO — that
 * the rest of the persistence stack (the IO layer in
 * `BindingsStorage.ts`, the rebinding UI's "Apply" button, the boot
 * path's hydrate step) consumes as the single source of truth for:
 *
 *   1. The current `SCHEMA_VERSION` constant.
 *   2. TypeScript types / interfaces describing the *4-player* profile
 *      payload (the envelope that wraps all four slots in one object,
 *      not a single-slot snippet).
 *   3. The `localStorage` *key* constant the IO layer reads / writes
 *      under.
 *
 * Splitting the schema out from the IO module keeps two concerns clean:
 *
 *   • This file is pure data and frozen constants — it can be imported
 *     by tests, by the rebinding UI's pure formatters, by replay code
 *     embedding a snapshot, all without dragging the `localStorage`
 *     resolution boilerplate along. No closures, no DOM, no Phaser.
 *   • The IO module (`BindingsStorage.ts`) imports from here, so a
 *     change to the on-disk shape lives in exactly one place — the
 *     IO layer's tests pin the round-trip, but the *vocabulary* is
 *     pinned here.
 *
 * Relationship to neighbouring modules
 * -----------------------------------
 *
 *   • {@link PlayerProfile} (declared in `src/types/bindings.ts`) is
 *     the *single-slot* envelope shape (one slot's `schemaVersion +
 *     deviceType + playerIndex + bindings`). This file's
 *     {@link BindingProfilesPayload} is the *four-slot* envelope that
 *     wraps a `Record<PlayerBindingIndex, PlayerProfile>` plus the
 *     payload-level schema version stamp.
 *   • {@link BINDINGS_SCHEMA_VERSION} (`src/types/bindings.ts`) is the
 *     canonical schema version for the binding *data model*. This
 *     file's {@link SCHEMA_VERSION} is pinned to the same literal so
 *     the two stay in lockstep — bumping one without the other is a
 *     compile error.
 *   • {@link STORAGE_APP_NAMESPACE} / {@link STORAGE_BINDINGS_DOMAIN}
 *     (`src/input/BindingsStorage.ts`) own the namespacing policy this
 *     file's {@link BINDING_PROFILES_STORAGE_KEY} composes — see the
 *     comment on that constant for the full rationale.
 *
 * Determinism + strict-TypeScript notes
 * -------------------------------------
 *
 *   • All exports are `as const` literals or frozen records. No
 *     `Math.random()`, no `Date.now()`, no closures. Two identical
 *     payloads produce byte-identical JSON because the field order on
 *     {@link BindingProfilesPayload} matches the canonical key order
 *     enforced by the serializer.
 *   • Strict-mode + `noUncheckedIndexedAccess`-friendly: the
 *     `profiles` field is typed as `Record<PlayerBindingIndex,
 *     PlayerProfile>` (not `Partial<…>`), so callers don't have to
 *     defensive-check undefined for known slots. Validators in the IO
 *     layer enforce the runtime invariant when loading a blob authored
 *     by an earlier or future build.
 */

import {
  BINDINGS_SCHEMA_VERSION,
  type BindingsSchemaVersion,
  type PlayerBindingIndex,
  type PlayerProfile,
} from '../types/bindings';

// ---------------------------------------------------------------------------
// 1) Schema version
// ---------------------------------------------------------------------------

/**
 * Current persistence schema version for the 4-player binding profile
 * payload.
 *
 * Pinned to the same literal as the data-model
 * {@link BINDINGS_SCHEMA_VERSION} so a single bump in either constant
 * surfaces as a TypeScript error here (the literal types must agree).
 * The IO layer keys its migration registry off this value; the
 * rebinding UI's "Reset / Import / Export" dialogs render it back to
 * the player as part of the diagnostic footer when a load fails.
 *
 * Versioning policy (mirrors the policy on
 * {@link BINDINGS_SCHEMA_VERSION}):
 *
 *   • Patch additions that older loaders can ignore (e.g. a new
 *     optional metadata field on the envelope) keep this constant
 *     pinned.
 *   • Additions to {@link PlayerProfile} (a new device kind, a new
 *     required field) bump the constant, because an older loader's
 *     validator would reject the new shape.
 *   • Removing or renaming a `BindingAction` bumps the constant and
 *     requires a migration entry — replays from before the rename are
 *     otherwise unrecoverable.
 *
 * Pinned via `as const` so the compile-time literal type
 * {@link SchemaVersion} narrows on every consumer. Numeric (not
 * string) so the migration registry can do `payload.schemaVersion <
 * CURRENT` style comparisons without parsing.
 */
export const SCHEMA_VERSION: BindingsSchemaVersion = BINDINGS_SCHEMA_VERSION;

/**
 * Type alias for the {@link SCHEMA_VERSION} literal. Re-exported under
 * a local name so consumers of *this* module don't have to reach into
 * `src/types/bindings.ts` for the type — the persistence layer is the
 * one that cares about it.
 */
export type SchemaVersion = BindingsSchemaVersion;

// ---------------------------------------------------------------------------
// 2) 4-player profile payload — TypeScript types / interfaces
// ---------------------------------------------------------------------------

/**
 * Tagged discriminator for the on-disk payload. A future persistence
 * version may add additional payload kinds (e.g. `'singleProfile'` for
 * a one-slot export the rebinding UI's "Export" button writes); the
 * IO layer uses this tag to refuse a single-slot blob accidentally
 * written under the four-slot key.
 *
 * Pinned to a string literal (not a numeric enum) so the on-disk JSON
 * is human-readable in DevTools and stable across milestones.
 */
export const BINDING_PROFILES_PAYLOAD_KIND = 'bindingProfiles' as const;

/** Type of {@link BINDING_PROFILES_PAYLOAD_KIND}. */
export type BindingProfilesPayloadKind = typeof BINDING_PROFILES_PAYLOAD_KIND;

/**
 * Map of slot index → {@link PlayerProfile}. All four slots are
 * statically guaranteed present at the type level so the rebinding
 * UI / replay loader can write `payload.profiles[3]` without an
 * `undefined`-narrowing branch.
 *
 * Slot indices are numeric (`PlayerBindingIndex = 1 | 2 | 3 | 4`); on
 * disk they round-trip as the strings `"1"` … `"4"` because that is
 * how `JSON.stringify` writes numeric record keys. The IO layer's
 * deserializer coerces them back.
 */
export type FourPlayerProfileMap = Readonly<Record<PlayerBindingIndex, PlayerProfile>>;

/**
 * The 4-player profile payload — the on-disk envelope that wraps all
 * four player slots together with a payload-level schema-version
 * stamp.
 *
 * Field order is the canonical wire-format order
 * (`schemaVersion → kind → profiles`); two equivalent payloads
 * therefore produce byte-identical JSON via the IO layer's
 * canonicalising serializer.
 *
 * Distinct from a single {@link PlayerProfile} (per-slot) and from
 * the legacy `SerializedBindingsSnapshot` (which keys by stringified
 * slot index over the older `PlayerBindings` shape). This payload is
 * the canonical four-slot envelope going forward; future code paths
 * (the boot hydrate step, the rebinding UI's "Save All", the replay
 * embed) all settle on this shape.
 *
 * All members are primitive or `readonly` containers of primitives so
 * the payload is structurally cloneable, JSON-stringifiable without
 * loss, and safe to embed inside a replay frame. No class instances,
 * no closures, no wall-clock-derived ids.
 */
export interface BindingProfilesPayload {
  /**
   * Schema version this payload was authored against. The IO layer
   * uses this to gate validation and to look up the migration step
   * that lifts an older payload to today's shape.
   */
  readonly schemaVersion: SchemaVersion;

  /**
   * Tagged discriminator — always {@link BINDING_PROFILES_PAYLOAD_KIND}
   * for this envelope. Lets the IO layer reject a blob of the wrong
   * shape with a precise error before any of it leaks into the runtime
   * store.
   */
  readonly kind: BindingProfilesPayloadKind;

  /**
   * The four-slot profile table. Each slot's {@link PlayerProfile}
   * carries its own per-slot `schemaVersion` (mirrored from this
   * envelope's at save time) so a future "extract one slot" flow can
   * peel off a single profile without re-stamping it.
   */
  readonly profiles: FourPlayerProfileMap;
}

// ---------------------------------------------------------------------------
// 3) localStorage key constant
// ---------------------------------------------------------------------------

/**
 * Top-level vendor / app namespace. Every key this codebase writes
 * starts with this prefix so a "Clear save data" sweep can match
 * everything under it without touching unrelated origin state.
 *
 * Mirrors the value declared on `BindingsStorage.ts` so the two
 * modules cannot drift. We do not import that constant directly: this
 * schema module is intentionally dependency-light and must be safe to
 * import from places that have no business pulling the IO layer in
 * (pure formatters, replay payloads, type-only contexts). The
 * one-line literal is pinned in two places, and a smoke test on the
 * IO layer asserts they agree.
 */
const APP_NAMESPACE = 'platformfighter';

/**
 * Per-domain namespace under {@link APP_NAMESPACE}. Bindings are one
 * of several domains the M5 + later milestones will persist (custom
 * stages, audio mixer levels, replay shortlist); each gets its own
 * sub-namespace so the same key segment can have different meanings
 * in different domains.
 */
const BINDINGS_DOMAIN = 'bindings';

/**
 * Storage-key version segment. Bumped in lockstep with
 * {@link SCHEMA_VERSION} so a breaking change to the payload content
 * lands on a new key — the old data becomes inert (still parsable in
 * DevTools, still sweepable by "Clear save data") but is never
 * returned by the IO layer's `loadProfilesPayload`.
 *
 * Encoded as `vN` rather than the bare number so a flat key listing
 * (`localStorage.key(i)` enumeration in DevTools) sorts version
 * boundaries cleanly between domains.
 */
const VERSION_SEGMENT = `v${SCHEMA_VERSION}` as const;

/** Key segment identifying the four-slot profile-payload blob. */
const PROFILES_KEY_SEGMENT = 'profiles';

/**
 * Key separator. `.` (dot) is conventional for hierarchical keys in
 * `localStorage` and avoids any clash with the `:` character that
 * some legacy libraries reserve for special meaning. The serializer's
 * JSON output never contains the separator at the top level of a key,
 * so there is no ambiguity when parsing or filtering.
 */
const KEY_SEPARATOR = '.';

/**
 * Full localStorage key for the 4-player profile payload.
 *
 *     platformfighter.bindings.v1.profiles
 *
 * Pinned as a `const` string (not a getter) so a static analyser can
 * inline it into "Clear save data" sweeps and DevTools-side scripts
 * the QA harness uses to inspect storage. The trailing `profiles`
 * segment names the *payload kind* this key holds, so a future
 * single-slot or per-device variant can land on a sibling key without
 * disturbing existing saves.
 *
 * The schema version travels in the *key path* (the `v1` segment) in
 * addition to the payload's `schemaVersion` field; this is belt +
 * braces:
 *
 *   • The key version protects against the case where a later schema
 *     ships and an older build is opened against the same origin —
 *     the older build looks up its `v1` key and finds nothing, falls
 *     back to defaults, and never sees the newer payload at all.
 *   • The payload version protects against the case where a hand-
 *     edited or migration-failed blob lands at the right key but with
 *     the wrong inner shape — the IO layer's strict validator catches
 *     it.
 */
export const BINDING_PROFILES_STORAGE_KEY: string = [
  APP_NAMESPACE,
  BINDINGS_DOMAIN,
  VERSION_SEGMENT,
  PROFILES_KEY_SEGMENT,
].join(KEY_SEPARATOR);
