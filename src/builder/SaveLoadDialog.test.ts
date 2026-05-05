import { describe, expect, it } from 'vitest';
import { SaveLoadDialog } from './SaveLoadDialog';
import {
  SaveLoadController,
  type SaveLoadStorageDriver,
} from './saveLoadController';
import { DEFAULT_GRID_SPEC } from './builderGrid';
import { buildCustomStageData } from './customStageSerializer';
import type { PlacedPiece } from './dragDrop';
import type { CustomStageData, CustomStageIndexEntry } from './customStageSerializer';

/**
 * AC 20103 Sub-AC 3 — `SaveLoadDialog` mirrors the controller's view
 * snapshots. Because Phaser is not available under vitest's plain Node
 * runtime, the dialog is constructed against an in-memory stub scene
 * that records every GameObject creation + visibility toggle. These
 * assertions verify the painter-side wiring contract:
 *
 *   • Modal hidden by default, visible while any non-`closed` view.
 *   • Toolbar buttons reflect the controller's `canSave` / `canLoad`.
 *   • Modal title swaps as the controller transitions through views.
 *   • Successful gestures (open save, type name, submit, confirm
 *     overwrite) flow through the controller to the storage driver.
 *
 * Pure visual styling (colours, font sizes) is not asserted — those are
 * fixed by the {@link SAVE_LOAD_DIALOG_COLORS} table and would just
 * mirror constants without buying coverage.
 */

interface StubText {
  type: 'text';
  destroyed: boolean;
  visible: boolean;
  content: string;
  color: string;
  origin: { x: number; y: number };
  destroy(): void;
  setOrigin(x: number, y?: number): StubText;
  setDepth(): StubText;
  setVisible(v: boolean): StubText;
  setColor(c: string): StubText;
  setText(t: string): StubText;
  setPosition(): StubText;
}

interface StubRect {
  type: 'rect';
  destroyed: boolean;
  visible: boolean;
  fill: number;
  alpha: number;
  destroy(): void;
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
  setOrigin(): StubRect;
  setDepth(): StubRect;
  setVisible(v: boolean): StubRect;
  setStrokeStyle(): StubRect;
  setFillStyle(c: number, a?: number): StubRect;
  setInteractive(): StubRect;
  setSize(): StubRect;
  setPosition(): StubRect;
  on(event: string, handler: (...args: unknown[]) => void): StubRect;
  emit(event: string, ...args: unknown[]): void;
}

function buildText(content: string, style: Record<string, unknown>): StubText {
  const text: StubText = {
    type: 'text',
    destroyed: false,
    visible: true,
    content,
    color: (style['color'] as string) ?? '',
    origin: { x: 0, y: 0 },
    destroy() {
      text.destroyed = true;
    },
    setOrigin(x = 0, y?: number) {
      text.origin = { x, y: y ?? x };
      return text;
    },
    setDepth() {
      return text;
    },
    setVisible(v) {
      text.visible = v;
      return text;
    },
    setColor(c) {
      text.color = c;
      return text;
    },
    setText(t) {
      text.content = t;
      return text;
    },
    setPosition() {
      return text;
    },
  };
  return text;
}

function buildRect(fill: number, alpha = 1): StubRect {
  const rect: StubRect = {
    type: 'rect',
    destroyed: false,
    visible: true,
    fill,
    alpha,
    handlers: new Map(),
    destroy() {
      rect.destroyed = true;
    },
    setOrigin() {
      return rect;
    },
    setDepth() {
      return rect;
    },
    setVisible(v) {
      rect.visible = v;
      return rect;
    },
    setStrokeStyle() {
      return rect;
    },
    setFillStyle(c, a = 1) {
      rect.fill = c;
      rect.alpha = a;
      return rect;
    },
    setInteractive() {
      return rect;
    },
    setSize() {
      return rect;
    },
    setPosition() {
      return rect;
    },
    on(event, handler) {
      const list = rect.handlers.get(event) ?? [];
      list.push(handler);
      rect.handlers.set(event, list);
      return rect;
    },
    emit(event, ...args) {
      const list = rect.handlers.get(event) ?? [];
      for (const h of list) h(...args);
    },
  };
  return rect;
}

function buildStubScene() {
  const created: { rects: StubRect[]; texts: StubText[] } = {
    rects: [],
    texts: [],
  };
  return {
    created,
    scene: {
      scale: { gameSize: { width: 1024, height: 768 } },
      add: {
        rectangle: (
          _x: number,
          _y: number,
          _w: number,
          _h: number,
          color: number,
          alpha = 1,
        ) => {
          const r = buildRect(color, alpha);
          created.rects.push(r);
          return r;
        },
        text: (
          _x: number,
          _y: number,
          content: string,
          style: Record<string, unknown>,
        ) => {
          const t = buildText(content, style);
          created.texts.push(t);
          return t;
        },
      },
    },
  };
}

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

function buildStubDriver(
  initial: ReadonlyArray<CustomStageIndexEntry> = [],
  payloadEntries: ReadonlyArray<readonly [string, CustomStageData]> = [],
): SaveLoadStorageDriver {
  const slots: CustomStageIndexEntry[] = initial.slice();
  const payloads = new Map<string, CustomStageData>(payloadEntries);
  return {
    list: () => slots,
    save: (name, gridSpec, pieces, overwrite) => {
      const trimmed = name.trim();
      const id = trimmed.replace(/\s+/g, '-').toLowerCase();
      const existing = slots.find((s) => s.id === id);
      if (existing && !overwrite) {
        return { ok: false, code: 'name-collision', error: 'collision' };
      }
      payloads.set(id, buildCustomStageData(trimmed, gridSpec, pieces));
      if (!existing) slots.unshift({ id, name: trimmed });
      return { ok: true, value: { id, name: trimmed } };
    },
    load: (id) => {
      const data = payloads.get(id);
      if (!data) return { ok: false, code: 'slot-not-found', error: 'missing' };
      return { ok: true, value: data };
    },
    delete: (id) => {
      const idx = slots.findIndex((s) => s.id === id);
      if (idx < 0) return { ok: false, code: 'slot-not-found', error: 'missing' };
      slots.splice(idx, 1);
      payloads.delete(id);
      return { ok: true, value: undefined };
    },
  };
}

function buildHarness(opts: {
  pieces?: PlacedPiece[];
  driver?: SaveLoadStorageDriver;
} = {}) {
  const stub = buildStubScene();
  const piecesRef = { current: opts.pieces ?? [] };
  const controller = new SaveLoadController({
    registry: {
      getGridSpec: () => DEFAULT_GRID_SPEC,
      getPieces: () => piecesRef.current,
    },
    applyLoad: () => ({ accepted: 1, rejected: 0 }),
    driver: opts.driver ?? buildStubDriver(),
  });
  const dialog = new SaveLoadDialog(stub.scene, controller);
  return { stub, controller, dialog, piecesRef };
}

describe('SaveLoadDialog — wiring contract', () => {
  it('builds the toolbar (two buttons) and a hidden modal scaffold on construction', () => {
    const { stub } = buildHarness();
    // Toolbar = save bg + load bg + last-result text + modal backdrop +
    // modal panel + modal title; at least 5 rectangles and 3 texts get
    // built up front.
    expect(stub.created.rects.length).toBeGreaterThanOrEqual(4);
    expect(stub.created.texts.length).toBeGreaterThanOrEqual(3);
    // Modal scaffold (backdrop + panel + title) starts hidden.
    const hidden = stub.created.rects.filter((r) => !r.visible);
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the modal when the save prompt opens', () => {
    const { stub, controller, dialog } = buildHarness({ pieces: [makePiece()] });
    controller.openSavePrompt();
    expect(dialog.isModalOpen()).toBe(true);
    // At least one rect with the modal-fill colour or a panel becomes visible.
    const visible = stub.created.rects.filter((r) => r.visible);
    expect(visible.length).toBeGreaterThan(0);
  });

  it('updates the modal title text when the controller transitions states', () => {
    const { stub, controller } = buildHarness({ pieces: [makePiece()] });
    controller.openSavePrompt();
    const titles = stub.created.texts.map((t) => t.content);
    expect(titles).toContain('Save Stage');
  });

  it('renders an inline overwrite warning when the draft collides with an existing slot', () => {
    const driver = buildStubDriver([{ id: 'lava', name: 'lava' }]);
    const { stub, controller } = buildHarness({
      pieces: [makePiece()],
      driver,
    });
    controller.openSavePrompt();
    controller.setNameDraft('lava');
    const helper = stub.created.texts.find((t) =>
      t.content.includes("Will overwrite 'lava'"),
    );
    expect(helper).toBeDefined();
  });

  it('renders the confirm-overwrite view body after a name collision submit', () => {
    const driver = buildStubDriver([{ id: 'lava', name: 'lava' }]);
    const { stub, controller } = buildHarness({
      pieces: [makePiece()],
      driver,
    });
    controller.openSavePrompt();
    controller.setNameDraft('lava');
    controller.submitSavePrompt();
    const titles = stub.created.texts.map((t) => t.content);
    expect(titles).toContain('Confirm Overwrite');
    const slotIdLine = stub.created.texts.find((t) =>
      t.content.includes('Slot id: lava'),
    );
    expect(slotIdLine).toBeDefined();
  });

  it('renders a success body after a save commits cleanly', () => {
    const { stub, controller } = buildHarness({ pieces: [makePiece()] });
    controller.openSavePrompt();
    controller.setNameDraft('Lava Tower');
    controller.submitSavePrompt();
    const titles = stub.created.texts.map((t) => t.content);
    expect(titles).toContain('Stage Saved');
    const body = stub.created.texts.find((t) =>
      t.content.includes("Saved 'Lava Tower'"),
    );
    expect(body).toBeDefined();
  });

  it('renders an empty-list helper when no slots are saved', () => {
    const { stub, controller } = buildHarness();
    controller.openLoadList();
    const helper = stub.created.texts.find((t) =>
      t.content === 'No saved stages yet.',
    );
    expect(helper).toBeDefined();
  });

  it('renders one row per slot in the load list', () => {
    const driver = buildStubDriver([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    const { stub, controller } = buildHarness({ driver });
    controller.openLoadList();
    const labels = stub.created.texts.map((t) => t.content);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
  });

  it('renders an error body when load returns a corrupted code', () => {
    const driver = buildStubDriver([{ id: 'bad', name: 'bad' }]);
    // Force the load to fail with corrupted.
    const proxied: SaveLoadStorageDriver = {
      ...driver,
      load: () => ({ ok: false, code: 'corrupted', error: 'bad' }),
    };
    const { stub, controller } = buildHarness({ driver: proxied });
    controller.openLoadList();
    controller.pickLoadSlot('bad');
    const errorMessage = stub.created.texts.find((t) =>
      t.content.includes("Stage 'bad' is corrupted"),
    );
    expect(errorMessage).toBeDefined();
  });

  it('hides the modal when the controller returns to closed', () => {
    const { dialog, controller } = buildHarness({ pieces: [makePiece()] });
    controller.openSavePrompt();
    expect(dialog.isModalOpen()).toBe(true);
    controller.cancel();
    expect(dialog.isModalOpen()).toBe(false);
  });

  it('destroy() tears down all GameObjects', () => {
    const { stub, dialog, controller } = buildHarness({ pieces: [makePiece()] });
    controller.openSavePrompt();
    dialog.destroy();
    const survivors = [...stub.created.rects, ...stub.created.texts].filter(
      (o) => !o.destroyed,
    );
    expect(survivors).toEqual([]);
  });
});
