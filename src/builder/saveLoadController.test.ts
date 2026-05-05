import { describe, expect, it } from 'vitest';
import {
  SaveLoadController,
  describeLoadError,
  describeSaveError,
  validateNameDraft,
  type SaveLoadStorageDriver,
  type SaveLoadView,
} from './saveLoadController';
import { DEFAULT_GRID_SPEC } from './builderGrid';
import {
  buildCustomStageData,
  type CustomStageData,
  type CustomStageIndexEntry,
} from './customStageSerializer';
import type { PlacedPiece } from './dragDrop';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Phaser-free `PlacedPiece` factory for the controller tests. Uses the
 * default grid spec so the canvas-bounds re-validator inside the storage
 * layer accepts the saved blob without contortions.
 */
function makePiece(overrides: Partial<PlacedPiece> = {}): PlacedPiece {
  return {
    type: 'flat-platform',
    canvasX: 64,
    canvasY: 96,
    width: 64,
    height: 32,
    col: 2,
    row: 3,
    ...overrides,
  };
}

interface StubDriverState {
  slots: CustomStageIndexEntry[];
  // Stage payloads keyed by slot id so the load path can return them.
  payloads: Map<string, CustomStageData>;
  // Pre-programmed forced failures, popped per call.
  saveQueue: Array<
    | { kind: 'ok' }
    | { kind: 'err'; code: SaveError; error: string }
  >;
  loadQueue: Array<
    | { kind: 'real' }
    | { kind: 'err'; code: SaveError; error: string }
  >;
  deleteQueue: Array<
    | { kind: 'real' }
    | { kind: 'err'; code: SaveError; error: string }
  >;
}

type SaveError =
  | 'unavailable'
  | 'missing'
  | 'corrupted'
  | 'write-failed'
  | 'name-collision'
  | 'invalid-name'
  | 'slot-not-found';

function buildStubDriver(
  initial: ReadonlyArray<CustomStageIndexEntry> = [],
  payloadEntries: ReadonlyArray<readonly [string, CustomStageData]> = [],
): { driver: SaveLoadStorageDriver; state: StubDriverState } {
  const state: StubDriverState = {
    slots: initial.slice(),
    payloads: new Map(payloadEntries),
    saveQueue: [],
    loadQueue: [],
    deleteQueue: [],
  };
  const driver: SaveLoadStorageDriver = {
    list: () => state.slots,
    save: (name, gridSpec, pieces, overwrite) => {
      const queued = state.saveQueue.shift();
      if (queued && queued.kind === 'err') {
        return { ok: false, code: queued.code, error: queued.error };
      }
      const trimmed = name.trim();
      const id = idFromName(trimmed);
      const existing = state.slots.find((s) => s.id === id);
      if (existing && !overwrite) {
        return {
          ok: false,
          code: 'name-collision',
          error: `slot '${existing.name}' already exists`,
        };
      }
      state.payloads.set(id, buildCustomStageData(trimmed, gridSpec, pieces));
      if (existing) {
        // CustomStageIndexEntry is readonly — replace the entry in
        // place with a new immutable record so the new display name
        // takes effect.
        const idx = state.slots.findIndex((s) => s.id === id);
        if (idx >= 0) {
          state.slots[idx] = { id, name: trimmed };
        }
      } else {
        state.slots.unshift({ id, name: trimmed });
      }
      return { ok: true, value: { id, name: trimmed } };
    },
    load: (slotId) => {
      const queued = state.loadQueue.shift();
      if (queued && queued.kind === 'err') {
        return { ok: false, code: queued.code, error: queued.error };
      }
      const payload = state.payloads.get(slotId);
      if (!payload) {
        return {
          ok: false,
          code: 'slot-not-found',
          error: `no payload for ${slotId}`,
        };
      }
      return { ok: true, value: payload };
    },
    delete: (slotId) => {
      const queued = state.deleteQueue.shift();
      if (queued && queued.kind === 'err') {
        return { ok: false, code: queued.code, error: queued.error };
      }
      const idx = state.slots.findIndex((s) => s.id === slotId);
      if (idx < 0) {
        return {
          ok: false,
          code: 'slot-not-found',
          error: `no slot ${slotId}`,
        };
      }
      state.slots.splice(idx, 1);
      state.payloads.delete(slotId);
      return { ok: true, value: undefined };
    },
  };
  return { driver, state };
}

/** Mirror of {@link customStageSlotIdFromName} — kept inline so tests don't depend on the helper. */
function idFromName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length === 0) return 'stage';
  let id = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (id.length === 0) return 'stage';
  return id;
}

function buildController(opts: {
  pieces?: PlacedPiece[];
  driver?: SaveLoadStorageDriver;
  state?: StubDriverState;
  onLoad?: (data: CustomStageData) => { accepted: number; rejected: number };
}): {
  controller: SaveLoadController;
  driver: SaveLoadStorageDriver;
  state: StubDriverState;
} {
  const fallback = opts.driver ? null : buildStubDriver();
  const driver = opts.driver ?? fallback!.driver;
  const state = opts.state ?? fallback!.state;
  const piecesRef = { current: opts.pieces ?? [] };
  const controller = new SaveLoadController({
    registry: {
      getGridSpec: () => DEFAULT_GRID_SPEC,
      getPieces: () => piecesRef.current,
    },
    applyLoad:
      opts.onLoad ??
      (() => ({ accepted: 0, rejected: 0 })),
    driver,
  });
  return { controller, driver, state };
}

// ---------------------------------------------------------------------------
// validateNameDraft
// ---------------------------------------------------------------------------

describe('validateNameDraft — pure helper', () => {
  it('rejects empty / whitespace-only names', () => {
    expect(validateNameDraft('')?.code).toBe('name-empty');
    expect(validateNameDraft('   ')?.code).toBe('name-empty');
  });

  it('rejects names longer than the serializer cap', () => {
    expect(validateNameDraft('x'.repeat(65))?.code).toBe('name-too-long');
  });

  it('rejects control characters', () => {
    expect(validateNameDraft('lavatower')?.code).toBe('name-control-chars');
  });

  it('accepts a normal name', () => {
    expect(validateNameDraft('Lava Tower')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Toolbar gestures
// ---------------------------------------------------------------------------

describe('SaveLoadController — toolbar', () => {
  it('starts in the closed view with canSave/canLoad reflecting the stub state', () => {
    const { controller } = buildController({ pieces: [] });
    const view = controller.getView();
    if (view.kind !== 'closed') throw new Error('expected closed');
    expect(view.canSave).toBe(false);
    expect(view.canLoad).toBe(false);
  });

  it('canSave becomes true once the registry has a piece', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    const view = controller.getView();
    if (view.kind !== 'closed') throw new Error('expected closed');
    expect(view.canSave).toBe(true);
  });

  it('canLoad becomes true when the slot index has entries', () => {
    const { driver, state } = buildStubDriver([{ id: 'lava', name: 'Lava' }]);
    const { controller } = buildController({
      pieces: [],
      driver,
      state,
    });
    const view = controller.getView();
    if (view.kind !== 'closed') throw new Error('expected closed');
    expect(view.canLoad).toBe(true);
  });

  it('openSavePrompt with empty registry surfaces nothing-to-save error', () => {
    const { controller } = buildController({ pieces: [] });
    const view = controller.openSavePrompt();
    expect(view.kind).toBe('save-error');
    if (view.kind !== 'save-error') return;
    expect(view.failure.code).toBe('nothing-to-save');
  });

  it('openSavePrompt opens the prompt when at least one piece is placed', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    const view = controller.openSavePrompt();
    expect(view.kind).toBe('save-prompt');
  });

  it('openLoadList exposes the slot index snapshot', () => {
    const { driver, state } = buildStubDriver([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    const { controller } = buildController({ driver, state });
    const view = controller.openLoadList();
    if (view.kind !== 'load-list') throw new Error('expected load-list');
    expect(view.slots.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Save prompt — name draft + validation
// ---------------------------------------------------------------------------

describe('SaveLoadController — save prompt validation', () => {
  it('rejects empty draft on submit and stays in save-prompt with name-empty error', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    const view = controller.submitSavePrompt();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.error?.code).toBe('name-empty');
  });

  it('rejects too-long names', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.setNameDraft('x'.repeat(65));
    const view = controller.submitSavePrompt();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.error?.code).toBe('name-too-long');
  });

  it('rejects control characters', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.setNameDraft('badname');
    const view = controller.submitSavePrompt();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.error?.code).toBe('name-control-chars');
  });

  it('clears stale validation errors as the draft is edited', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.submitSavePrompt(); // produces name-empty
    const updated = controller.setNameDraft('Lava');
    if (updated.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(updated.error).toBeNull();
  });

  it('insertIntoNameDraft splices text at the cursor', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.insertIntoNameDraft('La');
    controller.insertIntoNameDraft('va');
    const view = controller.getView();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.nameDraft).toBe('Lava');
    expect(view.cursor).toBe(4);
  });

  it('backspaceNameDraft removes the character to the left', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.insertIntoNameDraft('Lavaa');
    controller.backspaceNameDraft();
    const view = controller.getView();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.nameDraft).toBe('Lava');
  });
});

// ---------------------------------------------------------------------------
// Save commit + storage error handling
// ---------------------------------------------------------------------------

describe('SaveLoadController — commit save', () => {
  it('commits a fresh save and transitions to save-success', () => {
    const { driver, state } = buildStubDriver();
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava Tower');
    const view = controller.submitSavePrompt();
    expect(view.kind).toBe('save-success');
    if (view.kind !== 'save-success') return;
    expect(view.name).toBe('Lava Tower');
    expect(view.overwritten).toBe(false);
    // Last result is recorded for the toolbar's "Last saved" line.
    expect(controller.getLastResult()).toEqual({
      kind: 'saved',
      slotId: idFromName('Lava Tower'),
      name: 'Lava Tower',
    });
    // Slot index reflects the new entry.
    expect(state.slots.map((s) => s.name)).toContain('Lava Tower');
  });

  it('detects a name collision and transitions to save-confirm-overwrite', () => {
    const id = idFromName('Lava Tower');
    const { driver, state } = buildStubDriver([{ id, name: 'Lava Tower' }]);
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava Tower');
    const view = controller.submitSavePrompt();
    expect(view.kind).toBe('save-confirm-overwrite');
    if (view.kind !== 'save-confirm-overwrite') return;
    expect(view.slotId).toBe(id);
    expect(view.existingName).toBe('Lava Tower');
  });

  it('save-prompt warns inline when a draft will overwrite an existing slot', () => {
    const id = idFromName('Lava');
    const { driver, state } = buildStubDriver([{ id, name: 'Lava' }]);
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    const view = controller.getView();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.overwritesExistingName).toBe('Lava');
  });

  it('confirmOverwrite re-runs the save with overwrite:true', () => {
    const id = idFromName('Lava');
    const { driver, state } = buildStubDriver([{ id, name: 'Lava' }]);
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    controller.submitSavePrompt(); // confirm-overwrite
    const view = controller.confirmOverwrite();
    expect(view.kind).toBe('save-success');
    if (view.kind !== 'save-success') return;
    expect(view.overwritten).toBe(true);
  });

  it('cancelOverwrite returns to the save-prompt with the typed name pre-populated', () => {
    const id = idFromName('Lava');
    const { driver, state } = buildStubDriver([{ id, name: 'Lava' }]);
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    controller.submitSavePrompt();
    const view = controller.cancelOverwrite();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.nameDraft).toBe('Lava');
  });

  it('storage write-failed surfaces as a save-error with the storage code preserved', () => {
    const { driver, state } = buildStubDriver();
    state.saveQueue.push({
      kind: 'err',
      code: 'write-failed',
      error: 'quota',
    });
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    const view = controller.submitSavePrompt();
    expect(view.kind).toBe('save-error');
    if (view.kind !== 'save-error') return;
    expect(view.failure.storageCode).toBe('write-failed');
    // Player-readable message references storage, not the raw error.
    expect(view.failure.message).toMatch(/storage/i);
  });

  it('storage unavailable error keeps the typed code on the failure', () => {
    const { driver, state } = buildStubDriver();
    state.saveQueue.push({
      kind: 'err',
      code: 'unavailable',
      error: 'no localStorage',
    });
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    const view = controller.submitSavePrompt();
    if (view.kind !== 'save-error') throw new Error('expected save-error');
    expect(view.failure.storageCode).toBe('unavailable');
  });

  it('dismissing a save-error returns to the save-prompt with the failed draft', () => {
    const { driver, state } = buildStubDriver();
    state.saveQueue.push({
      kind: 'err',
      code: 'write-failed',
      error: 'quota',
    });
    const { controller } = buildController({
      pieces: [makePiece()],
      driver,
      state,
    });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    controller.submitSavePrompt(); // produces save-error
    const view = controller.dismiss();
    if (view.kind !== 'save-prompt') throw new Error('expected save-prompt');
    expect(view.nameDraft).toBe('Lava');
  });

  it('cancel from any view returns to closed', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    const view = controller.cancel();
    expect(view.kind).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// Load flow
// ---------------------------------------------------------------------------

describe('SaveLoadController — load flow', () => {
  function buildLoadFixture() {
    const id = idFromName('Lava Tower');
    const data = buildCustomStageData('Lava Tower', DEFAULT_GRID_SPEC, [
      makePiece(),
    ]);
    const { driver, state } = buildStubDriver(
      [{ id, name: 'Lava Tower' }],
      [[id, data]],
    );
    return { driver, state, id, data };
  }

  it('lists slots in the load-list view', () => {
    const { driver, state } = buildLoadFixture();
    const { controller } = buildController({ driver, state });
    const view = controller.openLoadList();
    if (view.kind !== 'load-list') throw new Error('expected load-list');
    expect(view.slots).toHaveLength(1);
  });

  it('successful load applies the data + transitions to load-success', () => {
    const { driver, state, id } = buildLoadFixture();
    const reports: CustomStageData[] = [];
    const { controller } = buildController({
      driver,
      state,
      onLoad: (data) => {
        reports.push(data);
        return { accepted: 1, rejected: 0 };
      },
    });
    controller.openLoadList();
    const view = controller.pickLoadSlot(id);
    expect(view.kind).toBe('load-success');
    if (view.kind !== 'load-success') return;
    expect(view.accepted).toBe(1);
    expect(view.rejected).toBe(0);
    expect(reports).toHaveLength(1);
    // Toolbar last result is now a 'loaded' record.
    const last = controller.getLastResult();
    expect(last?.kind).toBe('loaded');
  });

  it('corrupted slot surfaces a load-error with the typed storage code', () => {
    const { driver, state, id } = buildLoadFixture();
    state.loadQueue.push({
      kind: 'err',
      code: 'corrupted',
      error: 'bad json',
    });
    const { controller } = buildController({ driver, state });
    controller.openLoadList();
    const view = controller.pickLoadSlot(id);
    if (view.kind !== 'load-error') throw new Error('expected load-error');
    expect(view.failure.code).toBe('corrupted');
    expect(view.failure.message).toMatch(/corrupted/i);
  });

  it('dismissing a load-error returns to the load-list', () => {
    const { driver, state, id } = buildLoadFixture();
    state.loadQueue.push({
      kind: 'err',
      code: 'corrupted',
      error: 'bad json',
    });
    const { controller } = buildController({ driver, state });
    controller.openLoadList();
    controller.pickLoadSlot(id);
    const view = controller.dismiss();
    expect(view.kind).toBe('load-list');
  });

  it('deleteLoadSlot removes the slot and re-renders the load-list', () => {
    const { driver, state, id } = buildLoadFixture();
    const { controller } = buildController({ driver, state });
    controller.openLoadList();
    const view = controller.deleteLoadSlot(id);
    if (view.kind !== 'load-list') throw new Error('expected load-list');
    expect(view.slots).toHaveLength(0);
    expect(state.slots).toHaveLength(0);
  });

  it('deleteLoadSlot from a load-error view succeeds and returns to load-list', () => {
    const { driver, state, id } = buildLoadFixture();
    state.loadQueue.push({
      kind: 'err',
      code: 'corrupted',
      error: 'bad json',
    });
    const { controller } = buildController({ driver, state });
    controller.openLoadList();
    controller.pickLoadSlot(id); // -> load-error
    const view = controller.deleteLoadSlot(id);
    expect(view.kind).toBe('load-list');
    expect(state.slots).toHaveLength(0);
  });

  it('picking with empty slot id surfaces inline slot-not-found error', () => {
    const { driver, state } = buildLoadFixture();
    const { controller } = buildController({ driver, state });
    controller.openLoadList();
    const view = controller.pickLoadSlot('');
    if (view.kind !== 'load-list') throw new Error('expected load-list');
    expect(view.error?.code).toBe('slot-not-found');
  });
});

// ---------------------------------------------------------------------------
// Listener notifications
// ---------------------------------------------------------------------------

describe('SaveLoadController — listener subscription', () => {
  it('notifies subscribers after every state transition', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    const log: SaveLoadView[] = [];
    controller.addListener((v) => log.push(v));
    controller.openSavePrompt();
    controller.setNameDraft('Lava');
    controller.submitSavePrompt();
    expect(log.map((v) => v.kind)).toEqual([
      'save-prompt',
      'save-prompt',
      'save-success',
    ]);
  });

  it('removeListener detaches a previously-registered listener', () => {
    const { controller } = buildController({ pieces: [makePiece()] });
    const log: SaveLoadView[] = [];
    const sub = (v: SaveLoadView): void => {
      log.push(v);
    };
    controller.addListener(sub);
    controller.removeListener(sub);
    controller.openSavePrompt();
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// describeSaveError / describeLoadError — UX message mapping
// ---------------------------------------------------------------------------

describe('describeSaveError / describeLoadError', () => {
  it('describeSaveError covers every typed code with a friendly message', () => {
    expect(describeSaveError('unavailable', 'fallback')).toMatch(/storage/i);
    expect(describeSaveError('invalid-name', 'fallback')).toMatch(/name/i);
    expect(describeSaveError('corrupted', 'fallback')).toMatch(/malformed/i);
    expect(describeSaveError('write-failed', 'fallback')).toMatch(/storage/i);
    expect(describeSaveError('name-collision', 'fallback')).toMatch(/exists/i);
  });

  it('describeLoadError mentions the slot id for slot-specific codes', () => {
    expect(describeLoadError('slot-not-found', 'lava')).toMatch(/'lava'/);
    expect(describeLoadError('corrupted', 'lava')).toMatch(/'lava'/);
    expect(describeLoadError('missing', 'lava')).toMatch(/'lava'/);
  });
});
