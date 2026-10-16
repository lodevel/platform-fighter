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

import type {AttackMove,AttackCollisionHit} from '../characters/attacks';
import type {
  CharacterDataSpec,
  CharacterMovesSpec,
} from '../characters/characterSerializer';

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

  /** Update an existing movement numeric leaf, including nested launch profiles. */
  setMovementNumericField(path: ReadonlyArray<string>, value: number): void {
    if (path.length === 0) throw new Error('Movement field path cannot be empty');
    const currentValue = readPath(this.current.movement, path);
    if (typeof currentValue !== 'number') {
      throw new Error(`Movement field '${path.join('.')}' is not numeric`);
    }
    if (currentValue === value) return;
    this.applyMutation(spec => ({
      ...spec,
      movement: replacePath(spec.movement, path, value) as CharacterDataSpec['movement'],
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

  /** Rename the selected dispatch slot and exact incoming chain references.
   * Source pose/clip identity stays untouched, including nested variants. */
  renameMove(moveKey:keyof CharacterMovesSpec,id:string):void {
    const move=this.current.moves?.[moveKey];
    if(!move||!('id' in move)||!('type' in move))throw new Error('Select an attack move to rename');
    const next=id.trim();if(!next||next.length>120||! /^[a-zA-Z0-9_.:-]+$/.test(next))throw new Error('Use a nonempty move ID with letters, digits, dots, dashes or underscores');
    if(next===move.id)return;
    if(Object.values(this.current.moves??{}).some(value=>value&&'id' in value&&value.id===next))throw new Error('That move ID is already used');
    const previous=move.id;
    const references=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.map(references);
      if(!value||typeof value!=='object')return value;
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='nextId'&&item===previous?next:references(item)]));
    };
    this.applyMutation(spec=>({ ...spec,moves:Object.freeze(Object.fromEntries(Object.entries(spec.moves??{}).map(([key,value])=>{
      const updated=references(value) as Record<string,unknown>;
      return [key,key===moveKey?{...updated,id:next}:updated];
    }))) as CharacterMovesSpec }));
  }

  /** An explicit global shape selection supersedes prior per-window shapes.
   * Empty means collisionHits:[]; it never means inherited source geometry. */
  setMoveContactGeometry(moveKey:keyof CharacterMovesSpec,selection:
    {kind:'capsule';hits:readonly AttackCollisionHit[];windowHits?:readonly (readonly AttackCollisionHit[])[]}|{kind:'rectangle';rectangle:AttackMove['hitbox']}|{kind:'empty'}|
    {kind:'loaded';move:AttackMove}):void {
    const current=this.current.moves?.[moveKey];
    if(!current||!('type' in current)||!('hitbox' in current))throw new Error('Select an attack move to change contact geometry');
    const move={...current} as AttackMove;
    const clearWindow=(window:NonNullable<AttackMove['hitWindows']>[number])=>{
      const {collisionHits:_hits,hitbox:_box,...rest}=window;return rest;
    };
    const {collisionHits:_global,...withoutGlobal}=move;
    let next:AttackMove={...withoutGlobal,...(move.hitWindows?{hitWindows:move.hitWindows.map(clearWindow)}:{})};
    if(selection.kind==='loaded'){
      const base=selection.move;
      next={...next,hitbox:structuredClone(base.hitbox),
        ...(base.collisionHits===undefined?{}:{collisionHits:structuredClone(base.collisionHits)}),
        ...(next.hitWindows?{hitWindows:next.hitWindows.map((window,i)=>({...window,
          ...(base.hitWindows?.[i]?.collisionHits===undefined?{}:{collisionHits:structuredClone(base.hitWindows[i]!.collisionHits)}),
          ...(base.hitWindows?.[i]?.hitbox===undefined?{}:{hitbox:structuredClone(base.hitWindows[i]!.hitbox)})}))}:{})};
    }else if(selection.kind==='capsule'){
      if(!selection.hits.length)throw new Error('A capsule selection needs an actual contact template');
      if(selection.windowHits){
        if(!next.hitWindows||selection.windowHits.length!==next.hitWindows.length||selection.windowHits.some(hits=>!hits.length))
          throw new Error('Capsule phases must match every actual move window');
        next={...next,hitWindows:next.hitWindows.map((window,i)=>({...window,collisionHits:structuredClone(selection.windowHits![i]!)}))};
      }else next={...next,collisionHits:structuredClone(selection.hits)};
    }else if(selection.kind==='rectangle'){
      const r=selection.rectangle;
      if(![r.offsetX,r.offsetY,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)throw new Error('Rectangle must have finite positive dimensions');
      next={...next,hitbox:{...r},...(next.hitWindows?{hitWindows:next.hitWindows.map(window=>({...window,hitbox:{...r}}))}:{})};
    }else next={...next,collisionHits:[]};
    this.applyMutation(spec=>({...spec,moves:Object.freeze({...spec.moves,[moveKey]:next}) as CharacterMovesSpec}));
  }

  /** Update one numeric leaf on an authored move while preserving sibling data. */
  setMoveNumericField(
    moveKey: keyof CharacterMovesSpec,
    path: ReadonlyArray<string>,
    value: number,
  ): void {
    const move = this.current.moves?.[moveKey];
    if (!move) throw new Error(`Move '${String(moveKey)}' is not authored`);
    if (path.length === 0) throw new Error('Move field path cannot be empty');

    const currentValue = readPath(move, path);
    if (typeof currentValue !== 'number') {
      throw new Error(`Move field '${path.join('.')}' is not numeric`);
    }
    if (currentValue === value) return;

    this.applyMutation((spec) => ({
      ...spec,
      moves: Object.freeze({
        ...spec.moves,
        [moveKey]: replacePath(move, path, value),
      }) as CharacterMovesSpec,
    }));
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

function readPath(root: unknown, path: ReadonlyArray<string>): unknown {
  let cursor = root;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function replacePath(
  root: unknown,
  path: ReadonlyArray<string>,
  value: number,
): unknown {
  const [segment, ...rest] = path;
  if (segment === undefined) return value;
  if (Array.isArray(root)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= root.length) {
      throw new Error(`Invalid array index '${segment}'`);
    }
    const clone = [...root];
    clone[index] = replacePath(clone[index], rest, value);
    return Object.freeze(clone);
  }
  if (root === null || typeof root !== 'object') {
    throw new Error(`Cannot update '${path.join('.')}'`);
  }
  const record = root as Record<string, unknown>;
  if (!(segment in record)) throw new Error(`Unknown move field '${segment}'`);
  return Object.freeze({
    ...record,
    [segment]: replacePath(record[segment], rest, value),
  });
}
