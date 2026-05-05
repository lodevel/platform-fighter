/**
 * Phaser-free edit-state model for the M7.5 character editor.
 *
 * Mirrors the structure of `src/builder/stageDataModel.ts` so the
 * future Phaser scene + drag/drop UI can plug into a battle-tested
 * data layer without re-deriving editing semantics. Three concerns
 * live here:
 *
 *   1. **Working spec** — the {@link CharacterDataSpec} the user is
 *      currently editing. Operations like `setMovementField` mutate
 *      this and emit a change event the renderer can subscribe to.
 *
 *   2. **Dirty tracking** — `isDirty()` reports whether the working
 *      spec has unsaved changes since the last `markClean()` /
 *      `loadSpec()`. The scene reads this to grey out the "save"
 *      button and warn-on-close.
 *
 *   3. **Undo / redo** — every mutation pushes onto a bounded
 *      history stack. The scene's `[Z] / [Y]` keyboard hotkeys (or
 *      back/forward buttons) call `undo()` / `redo()`.
 *
 * Phaser-free, no `Math.random`, no wall-clock — every mutation is
 * pure projection over the prior state plus the operation. Tests
 * exhaustively cover the rules; the Phaser scene wires in.
 */

import type { CharacterDataSpec } from '../characters/characterSerializer';

/** Maximum history depth so memory stays bounded. */
export const EDIT_HISTORY_MAX_DEPTH = 64;

/** Subscriber fired on every mutation that changes the working spec. */
export type CharacterEditChangeListener = (
  next: CharacterDataSpec,
  prev: CharacterDataSpec | null,
) => void;

/**
 * Minimal field-level mutation log entry. Captures the snapshot
 * BEFORE the mutation so undo restores by replacement (not by
 * reverse-applying the op). Cheap given the small spec size.
 */
interface EditHistoryEntry {
  readonly previous: CharacterDataSpec;
}

/**
 * Phaser-free edit-state container. Construct with an initial spec
 * (typically loaded from the storage layer or hand-crafted in
 * tests), then drive via the mutation methods.
 */
export class CharacterEditState {
  private current: CharacterDataSpec;
  private clean: CharacterDataSpec;
  private undoStack: EditHistoryEntry[] = [];
  private redoStack: EditHistoryEntry[] = [];
  private listeners: CharacterEditChangeListener[] = [];

  constructor(initial: CharacterDataSpec) {
    this.current = initial;
    this.clean = initial;
  }

  /** Read the working spec. Returns the same frozen reference until a mutation fires. */
  getSpec(): CharacterDataSpec {
    return this.current;
  }

  /** True iff the working spec differs from the last clean checkpoint. */
  isDirty(): boolean {
    return this.current !== this.clean;
  }

  /** Force the working spec back to the clean checkpoint. Clears undo / redo. */
  reset(): void {
    if (this.current === this.clean) return;
    const prev = this.current;
    this.current = this.clean;
    this.undoStack = [];
    this.redoStack = [];
    this.emit(this.current, prev);
  }

  /** Replace the working spec wholesale and reset the dirty + history state. */
  loadSpec(spec: CharacterDataSpec): void {
    const prev = this.current;
    this.current = spec;
    this.clean = spec;
    this.undoStack = [];
    this.redoStack = [];
    this.emit(this.current, prev);
  }

  /** Mark the current working spec as the new clean checkpoint (after a save). */
  markClean(): void {
    this.clean = this.current;
  }

  // -------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------

  /**
   * Update one field of the movement profile. The new value replaces
   * the old; an unchanged value is a no-op (no history entry).
   */
  setMovementField<K extends keyof CharacterDataSpec['movement']>(
    field: K,
    value: CharacterDataSpec['movement'][K],
  ): void {
    if (this.current.movement[field] === value) return;
    this.applyMutation((s) => ({
      ...s,
      movement: { ...s.movement, [field]: value },
    }));
  }

  /** Update one field of the body geometry (width, height, chamfer). */
  setBodyField<K extends keyof CharacterDataSpec['body']>(
    field: K,
    value: CharacterDataSpec['body'][K],
  ): void {
    if (this.current.body[field] === value) return;
    this.applyMutation((s) => ({
      ...s,
      body: { ...s.body, [field]: value },
    }));
  }

  /** Update the displayName. */
  setDisplayName(value: string): void {
    if (this.current.displayName === value) return;
    this.applyMutation((s) => ({ ...s, displayName: value }));
  }

  /** Update the role label. */
  setRole(value: string): void {
    if (this.current.role === value) return;
    this.applyMutation((s) => ({ ...s, role: value }));
  }

  // -------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Pop the most recent mutation off the undo stack. The current
   * spec moves to the redo stack so a subsequent `redo()` re-applies
   * it. No-op if `canUndo()` is false.
   */
  undo(): void {
    const entry = this.undoStack.pop();
    if (entry === undefined) return;
    this.redoStack.push({ previous: this.current });
    const prev = this.current;
    this.current = entry.previous;
    this.emit(this.current, prev);
  }

  /** Re-apply the most recently undone mutation. No-op if `canRedo()` is false. */
  redo(): void {
    const entry = this.redoStack.pop();
    if (entry === undefined) return;
    this.undoStack.push({ previous: this.current });
    if (this.undoStack.length > EDIT_HISTORY_MAX_DEPTH) {
      this.undoStack.shift();
    }
    const prev = this.current;
    this.current = entry.previous;
    this.emit(this.current, prev);
  }

  // -------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------

  onChange(listener: CharacterEditChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  private applyMutation(
    transform: (prev: CharacterDataSpec) => CharacterDataSpec,
  ): void {
    const prev = this.current;
    this.undoStack.push({ previous: prev });
    if (this.undoStack.length > EDIT_HISTORY_MAX_DEPTH) {
      this.undoStack.shift();
    }
    // Any new mutation invalidates the redo stack — same convention
    // as every other editor in existence.
    this.redoStack = [];
    this.current = Object.freeze(transform(prev));
    this.emit(this.current, prev);
  }

  private emit(next: CharacterDataSpec, prev: CharacterDataSpec | null): void {
    for (const l of this.listeners) {
      try {
        l(next, prev);
      } catch {
        /* don't let a misbehaving listener crash the editor */
      }
    }
  }
}
