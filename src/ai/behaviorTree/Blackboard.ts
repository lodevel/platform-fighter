/**
 * Blackboard — typed key/value scratchpad shared between behavior tree nodes.
 *
 * A behavior tree decomposes a bot's "brain" into many small, single-purpose
 * nodes (move toward target, jump if grounded, fire smash on read, …). Those
 * nodes frequently need to coordinate without coupling directly to each
 * other — e.g. a perception leaf computes "currentTarget" once per tick, a
 * locomotion leaf consumes it, and a guard decorator gates the whole branch
 * on its presence. The classic AI design pattern for that coordination is a
 * Blackboard: a small typed dictionary attached to the controller that nodes
 * read from and write to during a tick.
 *
 * Design goals
 *
 *   1. Strongly typed — consumers may declare a `TSchema` interface that
 *      maps each key to its value type. `get`, `set`, `has`, and `delete`
 *      are then keyed against that schema, so a typo or a wrong-typed write
 *      is a compile error rather than a runtime surprise.
 *
 *   2. Schema-optional — when a controller doesn't yet have a stable schema
 *      (e.g. during prototyping or in tree-walking utilities), the default
 *      `Record<string, unknown>` schema permits arbitrary string keys with
 *      `unknown` values. Callers that need narrower types can cast at the
 *      call site or migrate to a real schema later without rewriting the
 *      Blackboard implementation.
 *
 *   3. Determinism — the underlying store is a `Map`, which preserves
 *      insertion order across reads. No `Math.random()`, no wall-clock
 *      reads. Behavior tree replays therefore see the same iteration order
 *      as the original simulation, which keeps drift-resync alignment
 *      cheap to verify.
 *
 *   4. Snapshot-friendly — the hybrid replay system records full state
 *      every 300 frames. `clear()` plus a fresh seeding pass (or
 *      `entries()` for inspection) is enough to rebuild a Blackboard from
 *      a snapshot without exposing the internal map.
 *
 *   5. Scoped keys — subtrees frequently need a private namespace so a
 *      perception module's `target` write does not clobber a combat
 *      module's `target` write. `scope('perception')` returns an
 *      `IBlackboard` view that transparently rewrites every key as
 *      `perception:<key>` while sharing the same underlying store as
 *      its parent — sibling scopes stay isolated, but the runner's
 *      single-store determinism and snapshot invariants are preserved.
 *      Scopes nest (`outer.scope('inner')` addresses `outer:inner:<key>`)
 *      and a scope-local `clear()` only removes that scope's entries.
 *
 * The Blackboard is intentionally tiny. It is *not* a generic event bus or
 * pub/sub system — nodes coordinate by writing/reading values at known
 * keys, and the tree's structure (Sequence / Selector / Parallel) governs
 * the order in which those writes happen.
 */

/**
 * Default schema for callers that don't (yet) have a typed shape. Keys are
 * arbitrary strings; values are `unknown` so consumers must narrow at the
 * call site. Prefer declaring a real `TSchema` interface as the controller
 * stabilises — typos and wrong-typed writes become compile errors.
 */
export type BlackboardSchema = Record<string, unknown>;

/**
 * Separator inserted between a scope prefix and a key when projecting a
 * scoped view onto the underlying store. Chosen as `:` because it is
 * conventional for namespaces (`perception:target`, `combat:lastHit`),
 * survives JSON serialisation cleanly (no escaping needed), and is rare
 * in identifier-style keys, which keeps the chance of accidental
 * collision with a non-scoped key vanishingly small.
 *
 * Exported so tests, snapshot tooling, and downstream integrations can
 * reason about the on-store key shape without re-deriving the convention.
 */
export const BLACKBOARD_SCOPE_SEPARATOR = ':';

/**
 * Public contract for a Blackboard. Exposed as an interface so nodes can
 * accept a minimal capability surface (e.g. `IBlackboard<MySchema>`)
 * without depending on the concrete `Blackboard` class — useful for tests
 * that supply a stub or a recording proxy.
 *
 * @typeParam TSchema A record type mapping each known key to its value type.
 *                    Defaults to {@link BlackboardSchema} for ad-hoc usage.
 */
export interface IBlackboard<TSchema extends object = BlackboardSchema> {
  /**
   * Read the value stored at `key`, or `undefined` if no entry exists.
   *
   * Returns `TSchema[K] | undefined` rather than `TSchema[K]` because the
   * key may be unset; consumers that require presence should pair `get`
   * with `has` (or use the structured pattern documented on `requireGet`).
   */
  get<K extends keyof TSchema & string>(key: K): TSchema[K] | undefined;

  /**
   * Store `value` at `key`, replacing any existing entry. Setting a value
   * of `undefined` (when the schema permits it) follows `Map` semantics —
   * the key will be present with an `undefined` value, not removed. Use
   * {@link delete} to fully remove an entry.
   */
  set<K extends keyof TSchema & string>(key: K, value: TSchema[K]): void;

  /**
   * True iff an entry exists at `key`. Distinguishes "set to undefined"
   * from "never set" — `has` is true in the former, false in the latter.
   */
  has<K extends keyof TSchema & string>(key: K): boolean;

  /**
   * Remove the entry at `key`. Returns `true` when an entry was present
   * (i.e. the call had an effect), `false` otherwise. Mirrors `Map.delete`.
   */
  delete<K extends keyof TSchema & string>(key: K): boolean;

  /**
   * Remove every entry visible through this view. On the root Blackboard
   * this empties the entire store; on a scoped view it removes only the
   * entries that belong to that scope (sibling and parent scopes survive).
   */
  clear(): void;

  /** Number of entries visible through this view. */
  readonly size: number;

  /**
   * Project a scoped sub-view onto this Blackboard. The returned view
   * shares the same underlying store as its parent, but every key the
   * caller supplies is transparently rewritten to
   * `${prefix}${SEPARATOR}${key}` before hitting the store. That gives
   * subtrees a private namespace — a perception subtree may write
   * `target` and a separate combat subtree may write `target` without
   * either overwriting the other, because their writes land at
   * `perception:target` and `combat:target` respectively.
   *
   * Scopes nest naturally: calling `scope('inner')` on a `scope('outer')`
   * view produces a view whose effective prefix is `outer:inner`, so
   * deep subtrees can carve their own sub-namespaces without losing the
   * parent's isolation.
   *
   * The optional `TSubSchema` type parameter lets the caller swap in a
   * narrower schema for the sub-view — common when a scope corresponds
   * to a self-contained subsystem with its own well-known keys.
   *
   * @param prefix Non-empty namespace label. Must not contain the scope
   *               separator (`:` by default) — splitting and re-joining
   *               keys relies on the separator being unambiguous.
   */
  scope<TSubSchema extends object = BlackboardSchema>(
    prefix: string,
  ): IBlackboard<TSubSchema>;
}

/**
 * In-memory typed key/value store used by the AI controller's behavior
 * tree. See the module docstring for the design rationale.
 *
 * @typeParam TSchema Optional record type describing the keys and value
 *                    types this Blackboard accepts. Defaults to a loose
 *                    `Record<string, unknown>` so prototype trees can use
 *                    the Blackboard without declaring a schema up front.
 *
 * @example Declaring a typed schema
 * ```ts
 * interface BotState {
 *   currentTargetId: number;
 *   isGrounded: boolean;
 *   lastHitFrame: number | undefined;
 * }
 *
 * const bb = new Blackboard<BotState>();
 * bb.set('currentTargetId', 2);          // OK
 * bb.set('isGrounded', true);            // OK
 * bb.set('isGrounded', 'yes');           // compile error
 * bb.set('unknownKey', 1);               // compile error
 * const id = bb.get('currentTargetId');  // typed as number | undefined
 * ```
 */
export class Blackboard<TSchema extends object = BlackboardSchema>
  implements IBlackboard<TSchema>
{
  /**
   * Backing store. `Map` is preferred over a plain object because:
   *   - It preserves insertion order across iteration, which keeps replay
   *     state-snapshots deterministic when serialised via `entries()`.
   *   - It distinguishes "set to undefined" from "absent" via `has`.
   *   - It cannot be shadowed by `Object.prototype` keys (`toString`, …).
   *
   * Stored as `unknown` because TypeScript's `Map<K, V>` cannot express
   * "the value at key K has type TSchema[K]"; the class methods bridge
   * that gap with narrowing casts at the boundary.
   */
  private readonly store: Map<string, unknown> = new Map<string, unknown>();

  /**
   * @param initial Optional seed entries. Useful for restoring a snapshot
   *                during replay scrub or for unit tests that want a
   *                pre-populated Blackboard. Entries with an explicit
   *                `undefined` value are stored as such (mirroring `set`),
   *                so callers that wish to omit a key should leave it off
   *                the partial entirely.
   */
  constructor(initial?: Partial<TSchema>) {
    if (initial !== undefined) {
      // `Object.entries` returns own enumerable string-keyed entries in
      // insertion order, which matches our determinism contract.
      for (const [key, value] of Object.entries(initial)) {
        this.store.set(key, value);
      }
    }
  }

  /** @inheritdoc */
  get<K extends keyof TSchema & string>(key: K): TSchema[K] | undefined {
    // The cast is the canonical "trust the schema" boundary: the public
    // API only allows writes through `set`, which is itself constrained
    // to `TSchema[K]`, so the value at `key` is necessarily compatible.
    return this.store.get(key) as TSchema[K] | undefined;
  }

  /** @inheritdoc */
  set<K extends keyof TSchema & string>(key: K, value: TSchema[K]): void {
    this.store.set(key, value);
  }

  /** @inheritdoc */
  has<K extends keyof TSchema & string>(key: K): boolean {
    return this.store.has(key);
  }

  /** @inheritdoc */
  delete<K extends keyof TSchema & string>(key: K): boolean {
    return this.store.delete(key);
  }

  /** @inheritdoc */
  clear(): void {
    this.store.clear();
  }

  /** @inheritdoc */
  get size(): number {
    return this.store.size;
  }

  /**
   * Read the value at `key` and throw if the entry is absent. Useful for
   * leaves that have a hard precondition ("perception must have written
   * `currentTarget` earlier this tick") and would otherwise have to
   * scatter `if (value === undefined) throw …` across many call sites.
   *
   * Throws `Error` with a descriptive message that includes `key` so
   * misconfigured trees fail loudly during development rather than
   * silently propagating `undefined`.
   */
  requireGet<K extends keyof TSchema & string>(key: K): TSchema[K] {
    if (!this.store.has(key)) {
      throw new Error(`Blackboard: required key "${key}" is not set`);
    }
    return this.store.get(key) as TSchema[K];
  }

  /**
   * Iterate over `[key, value]` pairs in insertion order. Exposed so
   * snapshot serialisation (replay system) and debug tooling can observe
   * the full Blackboard state without breaking encapsulation of the
   * underlying map.
   *
   * Note: the iterator yields the live store, not a defensive copy —
   * mutating the Blackboard during iteration follows `Map` semantics
   * (the iterator reflects the changes). Callers that need a stable
   * snapshot should `Array.from(bb.entries())` first.
   */
  entries(): IterableIterator<[string, unknown]> {
    return this.store.entries();
  }

  /**
   * Iterate over the set of keys currently stored, in insertion order.
   * Returned as `string` (rather than `keyof TSchema`) because the
   * Blackboard is permissive at runtime — even with a typed schema, a
   * cast-laden caller could write keys that aren't in the schema.
   */
  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  /**
   * @inheritdoc
   *
   * The root Blackboard creates fresh `ScopedBlackboard` views directly
   * over its underlying `Map`. Multiple calls with the same `prefix`
   * yield independent view objects, but they all read and write the
   * same physical store — sequential or concurrent ticks therefore see
   * each other's writes through any view sharing the prefix.
   */
  scope<TSubSchema extends object = BlackboardSchema>(
    prefix: string,
  ): IBlackboard<TSubSchema> {
    assertScopePrefix(prefix);
    return new ScopedBlackboard<TSubSchema>(this.store, prefix);
  }
}

/**
 * Validate a scope prefix at the call site and throw with a descriptive
 * message when it would produce an ambiguous on-store key shape. The
 * scope contract requires:
 *
 *   - non-empty (an empty prefix would alias the unscoped namespace and
 *     defeat the whole point of scoping);
 *   - separator-free (the separator is the only delimiter the scoped
 *     view uses to distinguish prefix from key — embedding one inside
 *     the prefix itself would make split/rejoin ambiguous).
 *
 * Centralising the check keeps both the root and nested scope paths
 * consistent and makes the failure mode loud and early.
 */
function assertScopePrefix(prefix: string): void {
  if (prefix.length === 0) {
    throw new Error('Blackboard.scope: prefix must be a non-empty string');
  }
  if (prefix.includes(BLACKBOARD_SCOPE_SEPARATOR)) {
    throw new Error(
      `Blackboard.scope: prefix must not contain the scope separator ` +
        `("${BLACKBOARD_SCOPE_SEPARATOR}"); got ${JSON.stringify(prefix)}`,
    );
  }
}

/**
 * Scoped projection over a Blackboard's underlying store. Every read,
 * write, presence check, and deletion is rewritten to address
 * `${this.prefix}${SEPARATOR}${key}` rather than `${key}`, giving the
 * caller a private namespace that cannot collide with sibling scopes
 * or with unscoped writes on the parent Blackboard.
 *
 * The view holds a *reference* to the parent's `Map`, not a copy:
 *
 *   - Determinism is preserved — scoped writes still land in the same
 *     insertion-ordered map that drives replay snapshot serialisation.
 *   - Lifecycle is preserved — when the runner clears or re-seeds the
 *     root Blackboard on `reset()`, every scoped view sees the change
 *     immediately without needing a re-bind.
 *   - Cost is constant — no per-key indirection beyond a string concat.
 *
 * `clear()` and `size` are scope-aware on this class: they only touch
 * entries whose stored key starts with `${this.prefix}${SEPARATOR}`,
 * leaving sibling scopes and the unscoped portion of the store
 * untouched. This is the property that lets a subtree call
 * `bb.clear()` between ticks without nuking unrelated state.
 *
 * Not exported from the module barrel — callers obtain a scope by
 * calling `someBlackboard.scope('prefix')` rather than instantiating
 * this class directly. That keeps the construction-time invariants
 * (validated prefix, store shared with the parent) impossible to
 * violate from outside the module.
 *
 * @typeParam TSchema Optional schema for the scoped namespace. Independent
 *                    of the parent Blackboard's schema — a perception
 *                    scope and a combat scope each declare their own.
 */
class ScopedBlackboard<TSchema extends object = BlackboardSchema>
  implements IBlackboard<TSchema>
{
  /** Concatenated `${prefix}${SEPARATOR}` — pre-computed once because we
   *  use it on every read, write, presence check, deletion, and clear.
   *  Keeping it in a field rather than re-building per call keeps hot
   *  AI ticks free of repeated string allocations. */
  private readonly fullPrefix: string;

  /**
   * @param store Reference to the parent Blackboard's `Map`. Stored as
   *              the loose `Map<string, unknown>` shape because the
   *              parent's schema is irrelevant at the view layer — only
   *              this scope's `TSchema` constrains the public surface.
   * @param prefix Caller-validated prefix. The constructor does not
   *               re-validate; `Blackboard.scope` and
   *               `ScopedBlackboard.scope` are the only call sites and
   *               both run `assertScopePrefix` first.
   */
  constructor(
    private readonly store: Map<string, unknown>,
    private readonly prefix: string,
  ) {
    this.fullPrefix = `${prefix}${BLACKBOARD_SCOPE_SEPARATOR}`;
  }

  /** Translate a caller-facing key into its on-store representation. */
  private scoped(key: string): string {
    return `${this.fullPrefix}${key}`;
  }

  /** @inheritdoc */
  get<K extends keyof TSchema & string>(key: K): TSchema[K] | undefined {
    return this.store.get(this.scoped(key)) as TSchema[K] | undefined;
  }

  /** @inheritdoc */
  set<K extends keyof TSchema & string>(key: K, value: TSchema[K]): void {
    this.store.set(this.scoped(key), value);
  }

  /** @inheritdoc */
  has<K extends keyof TSchema & string>(key: K): boolean {
    return this.store.has(this.scoped(key));
  }

  /** @inheritdoc */
  delete<K extends keyof TSchema & string>(key: K): boolean {
    return this.store.delete(this.scoped(key));
  }

  /**
   * @inheritdoc
   *
   * Removes every entry whose stored key begins with this view's
   * `${prefix}${SEPARATOR}`. Sibling scopes (different prefix) and the
   * unscoped portion of the store are untouched.
   *
   * We snapshot the matching keys via `Array.from` before deleting
   * because `Map` does not formally guarantee deletion-during-iteration
   * is safe across every engine version. The snapshot also makes the
   * deletion bounded by the count of matching keys at call time, even
   * if other code re-populates the scope concurrently — important if a
   * future replay scrub races scope clearing with re-seeding.
   */
  clear(): void {
    const matching: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(this.fullPrefix)) {
        matching.push(key);
      }
    }
    for (const key of matching) {
      this.store.delete(key);
    }
  }

  /**
   * @inheritdoc
   *
   * Counts only entries that belong to this scope. Linear in the size
   * of the underlying store, which is acceptable for AI controller
   * usage (Blackboards typically hold tens of entries) — if a future
   * profile shows this becoming a hotspot, we can cache the count and
   * invalidate on set/delete/clear.
   */
  get size(): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(this.fullPrefix)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * @inheritdoc
   *
   * Nested scopes compose by string concatenation: `outer.scope('inner')`
   * produces a view whose effective prefix is `outer:inner`, addressing
   * stored keys of the form `outer:inner:<key>`. The inner view shares
   * the same underlying store as the outermost root, so writes remain
   * visible through every parent view that includes the relevant
   * prefix.
   */
  scope<TSubSchema extends object = BlackboardSchema>(
    prefix: string,
  ): IBlackboard<TSubSchema> {
    assertScopePrefix(prefix);
    // Compose prefixes via the separator. We pass the composed prefix
    // straight into a fresh ScopedBlackboard rather than wrapping
    // `this` because direct delegation keeps the per-op cost flat
    // (one string concat) regardless of nesting depth.
    return new ScopedBlackboard<TSubSchema>(
      this.store,
      `${this.prefix}${BLACKBOARD_SCOPE_SEPARATOR}${prefix}`,
    );
  }
}
