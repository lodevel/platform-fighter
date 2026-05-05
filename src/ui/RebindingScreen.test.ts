import { describe, it, expect, beforeEach } from 'vitest';
import { RebindingScreen } from './RebindingScreen';
import { InputBindingsStore } from '../input/InputBindingsStore';
import { LOGICAL_ACTIONS } from '../types/inputBindings';
import { KEY_CODE } from '../input/keyCodes';
import {
  DEFAULT_REBINDING_DEVICE_FOR_SLOT,
  REBINDING_DEVICE_OPTIONS,
  formatActionLabel,
  formatBinding,
  formatDeviceLabel,
  nextDeviceOption,
} from './rebindingScreenFormat';
import { CAPTURE_PROMPT_LABEL } from './bindingCapture';
import {
  CONFLICT_TINT,
  conflictTintHexString,
} from './bindingConflicts';

/**
 * AC 40101 Sub-AC 1 — `RebindingScreen` is Phaser-touching but its
 * structure (one panel per slot, one device chip per panel, one row per
 * logical action) is checked here against a hand-rolled scene shim so
 * the suite runs under plain Node + vitest.
 *
 * What this suite locks down:
 *
 *   1. The screen creates exactly four player panels (slots 1–4).
 *   2. Each panel carries a header text, a device-chip background +
 *      label, and one (action label + binding value) text pair per
 *      logical action.
 *   3. Each panel's initial device label is inferred from the store —
 *      a fresh store opens with slots 1/2 → keyboard halves, slots 3/4
 *      → gamepad slots.
 *   4. Each panel's action list reflects the store's bindings (Left,
 *      Right, …, Taunt) in the canonical action order, with the
 *      corresponding binding string on the right.
 *   5. The device chip is interactive — a `pointerdown` handler exists
 *      that cycles to the next option, and `setPanelDevice` jumps
 *      directly to a target option for tests / settings-load.
 *   6. `refreshBindings` repaints the action-list strings after a
 *      store mutation without disturbing the device chip selections.
 *   7. `destroy()` tears down every Phaser object exactly once and is
 *      idempotent.
 */

interface MockText {
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: string;
  origin: { x: number; y: number };
  scrollFactor: { x: number; y: number };
  depth: number;
  destroyed: boolean;
  interactive: boolean;
  setTextCalls: number;
  listeners: Map<string, Array<() => void>>;
  setText(value: string): MockText;
  setColor(value: string): MockText;
  setOrigin(x: number, y?: number): MockText;
  setScrollFactor(x: number, y?: number): MockText;
  setPosition(x: number, y: number): MockText;
  setDepth(depth: number): MockText;
  setInteractive(): MockText;
  on(event: string, fn: () => void): MockText;
  destroy(): void;
  __fire(event: string): void;
}

interface MockRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: number;
  fillAlpha: number;
  strokeWidth: number;
  strokeColor: number;
  origin: { x: number; y: number };
  scrollFactor: { x: number; y: number };
  depth: number;
  destroyed: boolean;
  setOrigin(x: number, y?: number): MockRect;
  setStrokeStyle(width: number, color: number, alpha?: number): MockRect;
  setScrollFactor(x: number, y?: number): MockRect;
  setPosition(x: number, y: number): MockRect;
  setDepth(depth: number): MockRect;
  destroy(): void;
}

interface MockScene {
  scale: { gameSize: { width: number; height: number } };
  add: {
    text: (x: number, y: number, content: string, style: any) => MockText;
    rectangle: (
      x: number,
      y: number,
      w: number,
      h: number,
      fill: number,
      alpha?: number,
    ) => MockRect;
  };
  texts: MockText[];
  rects: MockRect[];
}

function createMockScene(viewW = 1280, viewH = 720): MockScene {
  const texts: MockText[] = [];
  const rects: MockRect[] = [];
  const scene: MockScene = {
    scale: { gameSize: { width: viewW, height: viewH } },
    add: {
      text(x, y, content, style) {
        const t: MockText = {
          x,
          y,
          text: content,
          color: typeof style?.color === 'string' ? style.color : '#ffffff',
          fontSize: typeof style?.fontSize === 'string' ? style.fontSize : '',
          origin: { x: 0, y: 0 },
          scrollFactor: { x: 1, y: 1 },
          depth: 0,
          destroyed: false,
          interactive: false,
          setTextCalls: 0,
          listeners: new Map(),
          setText(value) {
            t.setTextCalls += 1;
            t.text = value;
            return t;
          },
          setColor(value) {
            t.color = value;
            return t;
          },
          setOrigin(ox, oy) {
            t.origin = { x: ox, y: oy ?? ox };
            return t;
          },
          setScrollFactor(sx, sy) {
            t.scrollFactor = { x: sx, y: sy ?? sx };
            return t;
          },
          setPosition(nx, ny) {
            t.x = nx;
            t.y = ny;
            return t;
          },
          setDepth(d) {
            t.depth = d;
            return t;
          },
          setInteractive() {
            t.interactive = true;
            return t;
          },
          on(event, fn) {
            const list = t.listeners.get(event) ?? [];
            list.push(fn);
            t.listeners.set(event, list);
            return t;
          },
          destroy() {
            t.destroyed = true;
          },
          __fire(event) {
            for (const fn of t.listeners.get(event) ?? []) fn();
          },
        };
        texts.push(t);
        return t;
      },
      rectangle(x, y, w, h, fill, alpha) {
        const r: MockRect = {
          x,
          y,
          width: w,
          height: h,
          fillColor: fill,
          fillAlpha: alpha ?? 1,
          strokeWidth: 0,
          strokeColor: 0,
          origin: { x: 0.5, y: 0.5 },
          scrollFactor: { x: 1, y: 1 },
          depth: 0,
          destroyed: false,
          setOrigin(ox, oy) {
            r.origin = { x: ox, y: oy ?? ox };
            return r;
          },
          setStrokeStyle(width, color) {
            r.strokeWidth = width;
            r.strokeColor = color;
            return r;
          },
          setScrollFactor(sx, sy) {
            r.scrollFactor = { x: sx, y: sy ?? sx };
            return r;
          },
          setPosition(nx, ny) {
            r.x = nx;
            r.y = ny;
            return r;
          },
          setDepth(d) {
            r.depth = d;
            return r;
          },
          destroy() {
            r.destroyed = true;
          },
        };
        rects.push(r);
        return r;
      },
    },
    texts,
    rects,
  };
  return scene;
}

// ---------------------------------------------------------------------------

describe('RebindingScreen — construction', () => {
  let scene: MockScene;
  let store: InputBindingsStore;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
  });

  it('renders four player panels', () => {
    const screen = new RebindingScreen(scene as any, store);
    expect(screen.panelCount()).toBe(4);
  });

  it('produces a panel snapshot for every slot 1–4', () => {
    const screen = new RebindingScreen(scene as any, store);
    const all = screen.getAllPanelSnapshots();
    expect(all.map((p) => p.slot)).toEqual([1, 2, 3, 4]);
  });

  it('initial device on each panel matches the slot policy default', () => {
    const screen = new RebindingScreen(scene as any, store);
    expect(screen.getPanelSnapshot(1).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[1],
    );
    expect(screen.getPanelSnapshot(2).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[2],
    );
    expect(screen.getPanelSnapshot(3).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[3],
    );
    expect(screen.getPanelSnapshot(4).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[4],
    );
  });

  it('initial device label uses the human-readable formatter', () => {
    const screen = new RebindingScreen(scene as any, store);
    expect(screen.getPanelSnapshot(1).deviceLabel).toBe(
      formatDeviceLabel(DEFAULT_REBINDING_DEVICE_FOR_SLOT[1]),
    );
  });

  it('every panel has one row per logical action in canonical order', () => {
    const screen = new RebindingScreen(scene as any, store);
    for (const slot of [1, 2, 3, 4] as const) {
      const snap = screen.getPanelSnapshot(slot);
      expect(snap.rows.length).toBe(LOGICAL_ACTIONS.length);
      snap.rows.forEach((row, i) => {
        expect(row.action).toBe(LOGICAL_ACTIONS[i]);
      });
    }
  });

  it('renders the 4 panel headers + screen heading on the canvas', () => {
    new RebindingScreen(scene as any, store);
    // Heading + subheading + (P1..P4 header per panel) at minimum.
    const headings = scene.texts.filter(
      (t) =>
        t.text === 'INPUT REBINDING' ||
        t.text === 'P1 PLAYER' ||
        t.text === 'P2 PLAYER' ||
        t.text === 'P3 PLAYER' ||
        t.text === 'P4 PLAYER',
    );
    expect(headings.length).toBe(5);
  });

  it('renders a device chip text per panel showing its label', () => {
    new RebindingScreen(scene as any, store);
    for (const opt of REBINDING_DEVICE_OPTIONS) {
      // All options' labels are valid candidates, but only the four
      // policy defaults should appear at construction time.
      void opt;
    }
    const expectedLabels = [1, 2, 3, 4].map((slot) =>
      formatDeviceLabel(DEFAULT_REBINDING_DEVICE_FOR_SLOT[slot as 1 | 2 | 3 | 4]),
    );
    for (const expected of expectedLabels) {
      expect(scene.texts.some((t) => t.text === expected)).toBe(true);
    }
  });

  it('renders a row for every logical action × every panel', () => {
    new RebindingScreen(scene as any, store);
    // Every action label should appear at least four times (once per
    // panel). There can be more text objects (header, device chip,
    // binding values) but exact count for action labels is 4 × N.
    for (const action of LOGICAL_ACTIONS) {
      const label = formatActionLabel(action);
      const occurrences = scene.texts.filter((t) => t.text === label);
      expect(occurrences.length).toBe(4);
    }
  });

  it('renders four background rectangles for the panels (one per slot)', () => {
    new RebindingScreen(scene as any, store);
    // Per panel: 1 background rect + 1 device-chip rect = 8 total.
    expect(scene.rects.length).toBeGreaterThanOrEqual(8);
  });

  it('panels are laid out left-to-right with non-overlapping x positions', () => {
    new RebindingScreen(scene as any, store);
    // The first rectangle for each panel is its background; collect
    // them in creation order.
    const backgrounds = scene.rects.slice(0, 4);
    // Descending? Should be ascending.
    for (let i = 1; i < backgrounds.length; i += 1) {
      expect(backgrounds[i]!.x).toBeGreaterThan(backgrounds[i - 1]!.x);
    }
  });

  it('every text and rect is locked to the viewport (scrollFactor 0)', () => {
    new RebindingScreen(scene as any, store);
    for (const t of scene.texts) {
      expect(t.scrollFactor).toEqual({ x: 0, y: 0 });
    }
    for (const r of scene.rects) {
      expect(r.scrollFactor).toEqual({ x: 0, y: 0 });
    }
  });
});

// ---------------------------------------------------------------------------

describe('RebindingScreen — device chip interactivity', () => {
  let scene: MockScene;
  let store: InputBindingsStore;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
  });

  it('marks the device-chip text as interactive', () => {
    new RebindingScreen(scene as any, store);
    // Any text whose content matches a device label should be marked
    // interactive (these are the chips).
    const chipLabels = REBINDING_DEVICE_OPTIONS.map(formatDeviceLabel);
    const chips = scene.texts.filter((t) => chipLabels.includes(t.text));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.interactive).toBe(true);
      expect(chip.listeners.has('pointerdown')).toBe(true);
    }
  });

  it('clicking a chip cycles to the next device option', () => {
    const screen = new RebindingScreen(scene as any, store);
    const initialDevice = screen.getPanelSnapshot(1).device;

    // Find the chip text for slot 1 (label === initial device label).
    const chip = scene.texts.find(
      (t) => t.text === formatDeviceLabel(initialDevice) && t.interactive,
    );
    expect(chip).toBeDefined();

    chip!.__fire('pointerdown');

    const expected = nextDeviceOption(initialDevice);
    expect(screen.getPanelSnapshot(1).device).toBe(expected);
    expect(chip!.text).toBe(formatDeviceLabel(expected));
  });

  it('chip cycle wraps round through every option after N clicks', () => {
    const screen = new RebindingScreen(scene as any, store);
    const slot = 1 as const;
    const start = screen.getPanelSnapshot(slot).device;
    const chip = scene.texts.find(
      (t) => t.text === formatDeviceLabel(start) && t.interactive,
    );
    for (let i = 0; i < REBINDING_DEVICE_OPTIONS.length; i += 1) {
      chip!.__fire('pointerdown');
    }
    expect(screen.getPanelSnapshot(slot).device).toBe(start);
  });

  it('setPanelDevice jumps directly to a target option', () => {
    const screen = new RebindingScreen(scene as any, store);
    screen.setPanelDevice(3, 'none');
    expect(screen.getPanelSnapshot(3).device).toBe('none');
    expect(screen.getPanelSnapshot(3).deviceLabel).toBe(formatDeviceLabel('none'));
  });

  it('setPanelDevice does not affect other panels', () => {
    const screen = new RebindingScreen(scene as any, store);
    screen.setPanelDevice(2, 'gamepad_1');
    expect(screen.getPanelSnapshot(1).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[1],
    );
    expect(screen.getPanelSnapshot(3).device).toBe(
      DEFAULT_REBINDING_DEVICE_FOR_SLOT[3],
    );
  });
});

// ---------------------------------------------------------------------------

describe('RebindingScreen — refreshBindings', () => {
  it('repaints binding-row text after the store mutates', () => {
    const scene = createMockScene();
    const store = new InputBindingsStore();
    const screen = new RebindingScreen(scene as any, store);

    const initialJump = screen.getPanelSnapshot(1).rows.find((r) => r.action === 'jump');
    expect(initialJump?.bindingLabel).toBe('W');

    // Clear the slot's jump binding and refresh.
    store.setAction(1, 'jump', []);
    screen.refreshBindings();

    const refreshedJump = screen.getPanelSnapshot(1).rows.find((r) => r.action === 'jump');
    expect(refreshedJump?.bindingLabel).toBe('—');

    // The Phaser text node for the slot-1 jump row should reflect the
    // new label. (Find any text matching '—' on the panel.)
    expect(scene.texts.some((t) => t.text === '—')).toBe(true);
  });

  it('does not change device-chip selections', () => {
    const scene = createMockScene();
    const store = new InputBindingsStore();
    const screen = new RebindingScreen(scene as any, store);
    const before = screen.getAllPanelSnapshots().map((s) => s.device);
    store.setAction(1, 'jump', []);
    screen.refreshBindings();
    const after = screen.getAllPanelSnapshots().map((s) => s.device);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe('RebindingScreen — destroy()', () => {
  it('destroys every text and rect exactly once', () => {
    const scene = createMockScene();
    const store = new InputBindingsStore();
    const screen = new RebindingScreen(scene as any, store);
    expect(scene.texts.every((t) => !t.destroyed)).toBe(true);
    expect(scene.rects.every((r) => !r.destroyed)).toBe(true);
    screen.destroy();
    expect(scene.texts.every((t) => t.destroyed)).toBe(true);
    expect(scene.rects.every((r) => r.destroyed)).toBe(true);
  });

  it('is idempotent', () => {
    const scene = createMockScene();
    const store = new InputBindingsStore();
    const screen = new RebindingScreen(scene as any, store);
    expect(() => {
      screen.destroy();
      screen.destroy();
    }).not.toThrow();
  });

  it('refreshBindings is a no-op after destroy()', () => {
    const scene = createMockScene();
    const store = new InputBindingsStore();
    const screen = new RebindingScreen(scene as any, store);
    screen.destroy();
    expect(() => screen.refreshBindings()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC 40102 Sub-AC 2 — interactive binding capture flow
// ---------------------------------------------------------------------------

/**
 * Helpers to find the binding-row text object for a given (slot, action)
 * pair using the layout invariants the screen guarantees: there are 4
 * panels, one row per logical action, and the binding texts are pushed
 * onto `scene.texts` in panel-then-row creation order.
 */
function findBindingText(
  scene: MockScene,
  slot: 1 | 2 | 3 | 4,
  action: (typeof LOGICAL_ACTIONS)[number],
): MockText | undefined {
  // The right-side binding text is the only interactive text whose
  // *current* label matches the formatted binding for that action OR
  // (after capture begins) the prompt label. We resolve via the
  // LOGICAL_ACTIONS row index instead — every slot's binding texts are
  // pushed in canonical order alongside their action labels.
  const actionRowIndex = LOGICAL_ACTIONS.indexOf(action);
  // Panel-creation-time order: for each panel we push:
  //  1 background rect, 1 device chip rect (rects)
  //  1 header text, 1 device text, then for each row (label, value) — texts,
  //  finally 1 reset-to-default button (texts) (AC 40103 Sub-AC 3).
  // Find them by scanning all interactive texts and grouping by panel.
  const interactiveTexts = scene.texts.filter((t) => t.interactive);
  // Per-slot count: 1 device chip + LOGICAL_ACTIONS.length binding rows
  //                + 1 reset-to-default button + 1 confirm button (AC 50101).
  const perSlot = 1 + LOGICAL_ACTIONS.length + 2;
  const slotIdx = slot - 1;
  // The first interactive text per slot is the device chip; the next N
  // are the binding rows in canonical action order; the last two are
  // the reset-to-default button and the confirm button (in that order).
  const start = slotIdx * perSlot;
  return interactiveTexts[start + 1 + actionRowIndex];
}

/**
 * Locate a panel's "Reset to Default" button in the mock scene's
 * interactive-text list. Sits one past the binding rows per the
 * panel-construction order (see {@link findBindingText}).
 */
function findResetButton(
  scene: MockScene,
  slot: 1 | 2 | 3 | 4,
): MockText | undefined {
  const interactiveTexts = scene.texts.filter((t) => t.interactive);
  const perSlot = 1 + LOGICAL_ACTIONS.length + 2;
  const slotIdx = slot - 1;
  const start = slotIdx * perSlot;
  // Layout: [chip, bindings × N, reset, confirm] → index N+1 within the block.
  return interactiveTexts[start + 1 + LOGICAL_ACTIONS.length];
}

/**
 * Locate a panel's "Confirm" button in the mock scene's interactive-
 * text list — AC 50101 Sub-AC 1. Sits one past the reset button per
 * the panel-construction order (see {@link findBindingText}).
 */
function findConfirmButton(
  scene: MockScene,
  slot: 1 | 2 | 3 | 4,
): MockText | undefined {
  const interactiveTexts = scene.texts.filter((t) => t.interactive);
  const perSlot = 1 + LOGICAL_ACTIONS.length + 2;
  const slotIdx = slot - 1;
  const start = slotIdx * perSlot;
  // Layout: [chip, bindings × N, reset, confirm] → index N+2 within the block.
  return interactiveTexts[start + 1 + LOGICAL_ACTIONS.length + 1];
}

describe('RebindingScreen — capture flow (AC 40102 Sub-AC 2)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('every binding-row text is interactive and has a pointerdown listener', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      for (const action of LOGICAL_ACTIONS) {
        const text = findBindingText(scene, slot, action);
        expect(text).toBeDefined();
        expect(text!.interactive).toBe(true);
        expect(text!.listeners.has('pointerdown')).toBe(true);
      }
    }
  });

  it('clicking a binding row begins a capture session', () => {
    expect(screen.getActiveCapture()).toBeNull();
    const text = findBindingText(scene, 1, 'jump');
    text!.__fire('pointerdown');
    const active = screen.getActiveCapture();
    expect(active).toEqual({ slot: 1, action: 'jump' });
  });

  it('clicking a binding row paints the prompt label into that cell', () => {
    const text = findBindingText(scene, 1, 'jump');
    expect(text!.text).toBe('W'); // default keyboard P1 jump label
    text!.__fire('pointerdown');
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);
  });

  it('beginCapture programmatically opens a capture without a click', () => {
    screen.beginCapture(2, 'attack');
    expect(screen.getActiveCapture()).toEqual({ slot: 2, action: 'attack' });
    const text = findBindingText(scene, 2, 'attack');
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);
  });

  it('clicking another row cancels the in-flight capture and switches focus', () => {
    screen.beginCapture(1, 'jump');
    const jumpText = findBindingText(scene, 1, 'jump');
    expect(jumpText!.text).toBe(CAPTURE_PROMPT_LABEL);

    // Click another row — previous label restores, new capture opens.
    const attackText = findBindingText(scene, 1, 'attack');
    attackText!.__fire('pointerdown');

    expect(jumpText!.text).toBe('W'); // restored
    expect(attackText!.text).toBe(CAPTURE_PROMPT_LABEL);
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'attack' });
  });

  it('cancelCapture restores the previous label and ends the session', () => {
    screen.beginCapture(1, 'jump');
    const text = findBindingText(scene, 1, 'jump');
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);

    const result = screen.cancelCapture();
    expect(result).toEqual({ accepted: false, reason: 'cancelled' });
    expect(text!.text).toBe('W'); // back to W
    expect(screen.getActiveCapture()).toBeNull();
  });

  it('cancelCapture is a no-op when no capture is active', () => {
    const result = screen.cancelCapture();
    expect(result).toEqual({ accepted: false, reason: 'no_active_capture' });
  });

  it('submitKeyboardCapture writes a KeyboardBinding to the store and ends capture', () => {
    screen.beginCapture(1, 'jump');
    const text = findBindingText(scene, 1, 'jump');
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);

    const result = screen.submitKeyboardCapture(KEY_CODE.SPACE);
    expect(result).toEqual({ accepted: true, slot: 1, action: 'jump' });

    // Store updated.
    const stored = store.getAction(1, 'jump');
    expect(stored.length).toBe(1);
    expect(stored[0]).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.SPACE });

    // Display updated to the new key label.
    expect(text!.text).toBe(formatBinding(stored[0]!));

    // Capture ended.
    expect(screen.getActiveCapture()).toBeNull();
  });

  it('submitKeyboardCapture with ESC cancels the capture without writing', () => {
    screen.beginCapture(1, 'jump');
    const before = store.getAction(1, 'jump');

    const result = screen.submitKeyboardCapture(27);
    expect(result).toEqual({ accepted: false, reason: 'cancelled' });

    // Store unchanged.
    expect(store.getAction(1, 'jump')).toEqual(before);
    expect(screen.getActiveCapture()).toBeNull();

    const text = findBindingText(scene, 1, 'jump');
    expect(text!.text).toBe('W'); // restored
  });

  it('submitKeyboardCapture rejects invalid keyCodes without crashing', () => {
    screen.beginCapture(1, 'jump');
    const result = screen.submitKeyboardCapture(0);
    expect(result).toEqual({ accepted: false, reason: 'invalid_input' });
    // Capture stays open so the player can press another key.
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });
  });

  it('submitKeyboardCapture is a no-op when no capture is active', () => {
    const result = screen.submitKeyboardCapture(KEY_CODE.SPACE);
    expect(result).toEqual({ accepted: false, reason: 'no_active_capture' });
    // Store untouched.
    expect(store.getAction(1, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.W,
    });
  });

  it('submitGamepadButtonCapture writes a button GamepadBinding pinned to the pad', () => {
    screen.beginCapture(3, 'attack');
    const result = screen.submitGamepadButtonCapture(0, 2);
    expect(result).toEqual({ accepted: true, slot: 3, action: 'attack' });

    const stored = store.getAction(3, 'attack');
    expect(stored.length).toBe(1);
    expect(stored[0]).toEqual({
      kind: 'gamepad',
      gamepadIndex: 0,
      source: { type: 'button', buttonIndex: 2 },
    });
  });

  it('submitGamepadButtonCapture cancels on the standard B / Circle button', () => {
    screen.beginCapture(3, 'attack');
    const before = store.getAction(3, 'attack');

    const result = screen.submitGamepadButtonCapture(0, 1);
    expect(result).toEqual({ accepted: false, reason: 'cancelled' });
    expect(store.getAction(3, 'attack')).toEqual(before);
    expect(screen.getActiveCapture()).toBeNull();
  });

  it('submitGamepadAxisCapture writes a half-axis binding with inferred direction', () => {
    screen.beginCapture(3, 'left');
    const result = screen.submitGamepadAxisCapture(0, 0, -0.95);
    expect(result.accepted).toBe(true);

    const stored = store.getAction(3, 'left');
    expect(stored.length).toBe(1);
    const b = stored[0]!;
    expect(b.kind).toBe('gamepad');
    if (b.kind === 'gamepad') {
      expect(b.gamepadIndex).toBe(0);
      expect(b.source.type).toBe('axis');
      if (b.source.type === 'axis') {
        expect(b.source.axisIndex).toBe(0);
        expect(b.source.direction).toBe(-1);
      }
    }
  });

  it('submitGamepadAxisCapture rejects an axis value of zero', () => {
    screen.beginCapture(3, 'left');
    const before = store.getAction(3, 'left');
    const result = screen.submitGamepadAxisCapture(0, 0, 0);
    expect(result).toEqual({ accepted: false, reason: 'invalid_input' });
    // Capture stays open; store untouched.
    expect(store.getAction(3, 'left')).toEqual(before);
    expect(screen.getActiveCapture()).toEqual({ slot: 3, action: 'left' });
  });

  it('refreshBindings does not overwrite the active-capture prompt cell', () => {
    screen.beginCapture(1, 'jump');
    const text = findBindingText(scene, 1, 'jump');
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);

    // External store mutation + refresh should leave the prompt alone.
    store.setAction(1, 'attack', []);
    screen.refreshBindings();

    // Jump cell still shows the prompt.
    expect(text!.text).toBe(CAPTURE_PROMPT_LABEL);
    // Attack cell repainted.
    const attackText = findBindingText(scene, 1, 'attack');
    expect(attackText!.text).toBe('—');
  });

  it('does not change other slots when one slot captures', () => {
    const p2Jump = findBindingText(scene, 2, 'jump');
    const beforeP2 = p2Jump!.text;

    screen.beginCapture(1, 'jump');
    screen.submitKeyboardCapture(KEY_CODE.SPACE);

    // P2 row should be untouched.
    expect(p2Jump!.text).toBe(beforeP2);
    expect(store.getAction(2, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.ARROW_UP,
    });
  });

  it('after destroy() capture submission becomes a no-op', () => {
    screen.beginCapture(1, 'jump');
    screen.destroy();
    expect(screen.getActiveCapture()).toBeNull();
    const result = screen.submitKeyboardCapture(KEY_CODE.SPACE);
    expect(result).toEqual({ accepted: false, reason: 'no_active_capture' });
  });
});

// ---------------------------------------------------------------------------
// AC 40103 Sub-AC 3 — conflict detection + visual warnings + resolution prompts
// ---------------------------------------------------------------------------

describe('RebindingScreen — conflict detection (AC 40103 Sub-AC 3)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('a freshly defaulted store reports zero conflicts', () => {
    const report = screen.getConflictReport();
    expect(report.conflicts).toEqual([]);
    expect(screen.getConflictBannerLines()).toEqual([]);
  });

  it('the banner text is empty initially (no conflicts)', () => {
    // The banner is the first text whose content is '' — find any
    // empty-text node added by the screen's banner constructor.
    const empty = scene.texts.filter((t) => t.text === '');
    expect(empty.length).toBeGreaterThan(0);
  });

  it('flags an intra-player conflict after binding two unrelated actions to the same key', () => {
    // Default P1 has shield=H, attack=F. Make shield=F → collision.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();

    const report = screen.getConflictReport();
    expect(report.conflicts.length).toBe(1);
    expect(report.conflicts[0]!.kind).toBe('intra_player');
    expect(report.hasConflict(1, 'attack')).toBe(true);
    expect(report.hasConflict(1, 'shield')).toBe(true);
  });

  it('flags an inter-player keyboard conflict between slots 1 and 2', () => {
    // Override P2's attack to W (P1's jump+up are on W) — cross-slot conflict.
    store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.W }]);
    screen.refreshBindings();

    const report = screen.getConflictReport();
    const interConflicts = report.conflicts.filter(
      (c) => c.kind === 'inter_player_keyboard',
    );
    expect(interConflicts.length).toBeGreaterThanOrEqual(1);
    const c = interConflicts[0]!;
    const slots = c.locations.map((l) => l.slot).sort();
    expect(slots).toContain(1);
    expect(slots).toContain(2);
  });

  it('does NOT flag the canonical up+jump default overlap as a conflict', () => {
    const report = screen.getConflictReport();
    expect(report.hasConflict(1, 'up')).toBe(false);
    expect(report.hasConflict(1, 'jump')).toBe(false);
    expect(report.hasConflict(2, 'up')).toBe(false);
    expect(report.hasConflict(2, 'jump')).toBe(false);
  });

  it('panel snapshot rows expose hasConflict + severity for conflicted rows', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();

    const snap = screen.getPanelSnapshot(1);
    const attackRow = snap.rows.find((r) => r.action === 'attack')!;
    const shieldRow = snap.rows.find((r) => r.action === 'shield')!;
    const jumpRow = snap.rows.find((r) => r.action === 'jump')!;

    expect(attackRow.hasConflict).toBe(true);
    expect(attackRow.severity).toBe('error');
    expect(shieldRow.hasConflict).toBe(true);
    expect(shieldRow.severity).toBe('error');
    // Unrelated rows stay clean.
    expect(jumpRow.hasConflict).toBe(false);
    expect(jumpRow.severity).toBeNull();
  });

  it('binding-row text is recoloured to the conflict tint when conflicted', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();

    const tintHex = conflictTintHexString('error');
    // Find the F-labelled rows on slot 1 and check their colour.
    const tintedTexts = scene.texts.filter(
      (t) => t.text === 'F' && t.color.toLowerCase() === tintHex.toLowerCase(),
    );
    expect(tintedTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('clean rows return to the default colour after a conflict resolves', () => {
    // Cause a conflict.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.getConflictReport().conflicts.length).toBeGreaterThan(0);

    // Resolve by reverting shield back to H.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.H }]);
    screen.refreshBindings();

    expect(screen.getConflictReport().conflicts).toEqual([]);

    // The slot-1 attack row should be back to the default colour.
    // Find the F text again — it should be the *attack* row only now,
    // and its color should be the default binding value colour
    // (not the conflict tint).
    const fTexts = scene.texts.filter((t) => t.text === 'F');
    expect(fTexts.length).toBeGreaterThan(0);
    const tintHex = conflictTintHexString('error');
    for (const t of fTexts) {
      expect(t.color.toLowerCase()).not.toBe(tintHex.toLowerCase());
    }
  });

  it('warning banner copy lists the conflict count and resolution prompts', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();

    const lines = screen.getConflictBannerLines();
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('1 binding conflict');
    expect(lines.slice(1).join('\n').toLowerCase()).toContain('unbind');
  });

  it('warning banner is wired into a Phaser text node on the canvas', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();

    // Find a text whose content matches the joined banner.
    const expectedJoined = screen.getConflictBannerLines().join('\n');
    const banner = scene.texts.find((t) => t.text === expectedJoined);
    expect(banner).toBeDefined();
  });

  it('committing a capture immediately re-evaluates conflicts (creates them)', () => {
    expect(screen.getConflictReport().conflicts).toEqual([]);
    screen.beginCapture(1, 'shield');
    // Capture F — collides with attack=F.
    const result = screen.submitKeyboardCapture(KEY_CODE.F);
    expect(result.accepted).toBe(true);
    const report = screen.getConflictReport();
    expect(report.conflicts.length).toBe(1);
    expect(report.hasConflict(1, 'attack')).toBe(true);
    expect(report.hasConflict(1, 'shield')).toBe(true);
  });

  it('committing a capture immediately re-evaluates conflicts (resolves them)', () => {
    // Pre-existing conflict.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.getConflictReport().conflicts.length).toBe(1);

    // Capture-rebind shield to a fresh key.
    screen.beginCapture(1, 'shield');
    screen.submitKeyboardCapture(KEY_CODE.SPACE);
    expect(screen.getConflictReport().conflicts).toEqual([]);
  });

  it('resolveConflict clears the FIRST involved binding location', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const c = screen.getConflictReport().conflicts[0]!;
    const firstLoc = c.locations[0]!;

    const ok = screen.resolveConflict(c);
    expect(ok).toBe(true);

    // The first location's binding list is now empty.
    expect(store.getAction(firstLoc.slot, firstLoc.action)).toEqual([]);
    // No conflicts remain.
    expect(screen.getConflictReport().conflicts).toEqual([]);
  });

  it('resolveConflictAtLocation targets the specified location index', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const c = screen.getConflictReport().conflicts[0]!;
    // Resolve location 1 (the second one) instead of location 0.
    const targetLoc = c.locations[1]!;

    const ok = screen.resolveConflictAtLocation(c, 1);
    expect(ok).toBe(true);
    expect(store.getAction(targetLoc.slot, targetLoc.action)).toEqual([]);
  });

  it('resolveConflict on a stale empty-list location returns false', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const c = screen.getConflictReport().conflicts[0]!;
    const firstLoc = c.locations[0]!;
    // Pre-empty the live list.
    store.setAction(firstLoc.slot, firstLoc.action, []);
    const ok = screen.resolveConflict(c);
    expect(ok).toBe(false);
  });

  it('CONFLICT_TINT exposes distinct colours for error and warning', () => {
    expect(CONFLICT_TINT.error).not.toBe(CONFLICT_TINT.warning);
    expect(conflictTintHexString('error')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('refreshBindings is a no-op after destroy() (no conflict throws)', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.destroy();
    expect(() => screen.refreshBindings()).not.toThrow();
    // Conflict report unchanged after destroy (last computed state).
    expect(() => screen.getConflictReport()).not.toThrow();
  });

  it('resolveConflict after destroy returns false', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const c = screen.getConflictReport().conflicts[0]!;
    screen.destroy();
    expect(screen.resolveConflict(c)).toBe(false);
  });

  it('cross-slot conflict tints both slot-1 and slot-2 binding rows', () => {
    // Make P2's left collide with P1's left=A.
    store.setAction(2, 'left', [{ kind: 'keyboard', keyCode: KEY_CODE.A }]);
    screen.refreshBindings();

    expect(screen.getConflictReport().hasConflict(1, 'left')).toBe(true);
    expect(screen.getConflictReport().hasConflict(2, 'left')).toBe(true);

    const tintHex = conflictTintHexString('error');
    const tinted = scene.texts.filter(
      (t) => t.text === 'A' && t.color.toLowerCase() === tintHex.toLowerCase(),
    );
    expect(tinted.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC 40103 Sub-AC 3 — save guard (intra-player conflicts block save)
// ---------------------------------------------------------------------------

describe('RebindingScreen — save guard (AC 40103 Sub-AC 3)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('canSave() is true on a freshly defaulted store', () => {
    expect(screen.canSave()).toBe(true);
    expect(screen.getSaveBlockReason()).toBeNull();
  });

  it('canSavePlayer() is true for every slot on a clean store', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      expect(screen.canSavePlayer(slot)).toBe(false === false); // i.e. true
      expect(screen.canSavePlayer(slot)).toBe(true);
    }
  });

  it('canSave() flips to false when an intra-player conflict appears', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.canSave()).toBe(false);
  });

  it('canSavePlayer() blocks only the slot that owns the conflict', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.canSavePlayer(1)).toBe(false);
    expect(screen.canSavePlayer(2)).toBe(true);
    expect(screen.canSavePlayer(3)).toBe(true);
    expect(screen.canSavePlayer(4)).toBe(true);
  });

  it('inter-player keyboard overlap does NOT block save (warning only)', () => {
    // Cross-slot only: P2's attack=W overlaps P1 jump+up=W. The
    // dispatcher can still surface both presses, so saving is allowed.
    store.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.W }]);
    screen.refreshBindings();
    const report = screen.getConflictReport();
    // Sanity check — there IS a conflict.
    expect(report.conflicts.length).toBeGreaterThan(0);
    // …but only inter-player kinds (which don't block).
    const intra = report.conflicts.filter((c) => c.kind === 'intra_player');
    expect(intra.length).toBe(0);
    expect(screen.canSave()).toBe(true);
    expect(screen.getSaveBlockReason()).toBeNull();
  });

  it('getSaveBlockReason names the affected slot(s)', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const reason = screen.getSaveBlockReason();
    expect(reason).not.toBeNull();
    expect(reason).toContain('P1');
    expect(reason!.toLowerCase()).toContain('save blocked');
    expect(reason!.toLowerCase()).toContain('reset to default');
  });

  it('getSaveBlockReason aggregates multiple slots', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    store.setAction(3, 'attack', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'button', buttonIndex: 0 }, // collides with jump=btn 0
      },
    ]);
    screen.refreshBindings();
    const reason = screen.getSaveBlockReason();
    expect(reason).toContain('P1');
    expect(reason).toContain('P3');
  });

  it('save banner footer surfaces the block reason while a conflict is active', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    const lines = screen.getConflictBannerLines();
    const last = lines[lines.length - 1]!;
    expect(last.toLowerCase()).toContain('save blocked');
  });

  it('canSave() recovers when the conflict is resolved', () => {
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.canSave()).toBe(false);

    // Resolve.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.H }]);
    screen.refreshBindings();
    expect(screen.canSave()).toBe(true);
  });

  it('committing a capture that introduces a conflict blocks save', () => {
    expect(screen.canSave()).toBe(true);
    screen.beginCapture(1, 'shield');
    screen.submitKeyboardCapture(KEY_CODE.F); // collides with attack=F
    expect(screen.canSave()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC 40103 Sub-AC 3 — per-player Reset to Default
// ---------------------------------------------------------------------------

describe('RebindingScreen — Reset to Default per panel (AC 40103 Sub-AC 3)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('renders one Reset to Default button per panel', () => {
    // Filter to interactive texts whose label is exactly the
    // reset-button copy (not the subheading help line).
    const resetButtons = scene.texts.filter(
      (t) => t.interactive && t.text.startsWith('↺'),
    );
    expect(resetButtons.length).toBe(4);
  });

  it('every reset button is interactive with a pointerdown listener', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const btn = findResetButton(scene, slot);
      expect(btn).toBeDefined();
      expect(btn!.interactive).toBe(true);
      expect(btn!.listeners.has('pointerdown')).toBe(true);
    }
  });

  it('resetPlayerBindings() restores the canonical default mapping for one slot', () => {
    // Customise slot 1 heavily.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(1, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.A }]);
    expect(store.getAction(1, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.SPACE,
    });

    const ok = screen.resetPlayerBindings(1);
    expect(ok).toBe(true);

    // Slot 1 is back to defaults (W for jump, F for attack).
    expect(store.getAction(1, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.W,
    });
    expect(store.getAction(1, 'attack')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.F,
    });
  });

  it('resetPlayerBindings() does not touch other slots', () => {
    // Customise slots 2 and 3.
    store.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    store.setAction(3, 'attack', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'button', buttonIndex: 7 },
      },
    ]);
    const beforeP2Jump = store.getAction(2, 'jump')[0];
    const beforeP3Attack = store.getAction(3, 'attack')[0];

    screen.resetPlayerBindings(1);

    expect(store.getAction(2, 'jump')[0]).toEqual(beforeP2Jump);
    expect(store.getAction(3, 'attack')[0]).toEqual(beforeP3Attack);
  });

  it('clicking the per-panel reset button restores defaults for that slot', () => {
    store.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    expect(store.getAction(2, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.SPACE,
    });

    const btn = findResetButton(scene, 2);
    btn!.__fire('pointerdown');

    // Slot 2 jumps back to ARROW_UP.
    expect(store.getAction(2, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.ARROW_UP,
    });
  });

  it('clicking a panel reset clears any intra-player conflict on that slot', () => {
    // Cause an intra-player conflict on slot 1.
    store.setAction(1, 'shield', [{ kind: 'keyboard', keyCode: KEY_CODE.F }]);
    screen.refreshBindings();
    expect(screen.getConflictReport().conflicts.length).toBeGreaterThan(0);
    expect(screen.canSave()).toBe(false);

    // Click slot 1's reset button.
    const btn = findResetButton(scene, 1);
    btn!.__fire('pointerdown');

    // Conflict gone, save unblocked.
    expect(screen.getConflictReport().conflicts).toEqual([]);
    expect(screen.canSave()).toBe(true);
  });

  it('clicking reset re-paints the binding-row labels from defaults', () => {
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    screen.refreshBindings();
    const jumpText = findBindingText(scene, 1, 'jump');
    expect(jumpText!.text).toBe('Space');

    findResetButton(scene, 1)!.__fire('pointerdown');

    expect(jumpText!.text).toBe('W'); // back to the default
  });

  it('reset cancels an in-flight capture on the same slot', () => {
    screen.beginCapture(1, 'jump');
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });

    findResetButton(scene, 1)!.__fire('pointerdown');

    // Capture session torn down by the reset.
    expect(screen.getActiveCapture()).toBeNull();
    // Slot 1 jump is back to default 'W'.
    expect(store.getAction(1, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.W,
    });
  });

  it('reset on a different slot leaves an in-flight capture intact', () => {
    screen.beginCapture(1, 'jump');
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });

    findResetButton(scene, 2)!.__fire('pointerdown');

    // Slot 1 capture session still active.
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });
  });

  it('resetPlayerBindings returns false after destroy', () => {
    screen.destroy();
    expect(screen.resetPlayerBindings(1)).toBe(false);
  });

  it('reset button is destroyed alongside the rest of the panel', () => {
    const btn = findResetButton(scene, 1)!;
    expect(btn.destroyed).toBe(false);
    screen.destroy();
    expect(btn.destroyed).toBe(true);
  });

  it('falls back to per-action setAction when the source has no reset() method', () => {
    // Build a minimal store mock that only implements get + setAction.
    const baseline = new InputBindingsStore();
    const customised = new InputBindingsStore();
    customised.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);

    let getCount = 0;
    const setActionCalls: Array<{
      slot: number;
      action: string;
      bindings: ReadonlyArray<unknown>;
    }> = [];
    const minimalSource = {
      get(slot: 1 | 2 | 3 | 4) {
        getCount += 1;
        return customised.get(slot);
      },
      setAction(slot: 1 | 2 | 3 | 4, action: any, bindings: ReadonlyArray<any>) {
        customised.setAction(slot, action, bindings);
        setActionCalls.push({ slot, action, bindings });
      },
      // intentionally NO reset method — tests the fallback path.
    };
    void getCount;
    void baseline;

    const fallbackScene = createMockScene();
    const fallbackScreen = new RebindingScreen(
      fallbackScene as any,
      minimalSource as any,
    );

    // Reset should still work — falls back to per-action writes.
    const ok = fallbackScreen.resetPlayerBindings(1);
    expect(ok).toBe(true);
    // Every logical action was set during the fallback reset.
    const slotsReset = new Set(
      setActionCalls.filter((c) => c.slot === 1).map((c) => c.action),
    );
    for (const a of LOGICAL_ACTIONS) {
      expect(slotsReset.has(a)).toBe(true);
    }
    // The slot is now back to defaults.
    expect(customised.getAction(1, 'jump')[0]).toEqual({
      kind: 'keyboard',
      keyCode: KEY_CODE.W,
    });

    fallbackScreen.destroy();
  });
});

// ---------------------------------------------------------------------------
// AC 50101 Sub-AC 1 — per-player Confirm button
// ---------------------------------------------------------------------------

describe('RebindingScreen — Confirm per panel (AC 50101 Sub-AC 1)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('renders one Confirm button per panel', () => {
    const confirmButtons = scene.texts.filter(
      (t) => t.interactive && t.text.startsWith('✓'),
    );
    expect(confirmButtons.length).toBe(4);
  });

  it('every confirm button is interactive with a pointerdown listener', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const btn = findConfirmButton(scene, slot);
      expect(btn).toBeDefined();
      expect(btn!.interactive).toBe(true);
      expect(btn!.listeners.has('pointerdown')).toBe(true);
    }
  });

  it('each confirm button shows the canonical "✓ Confirm" label', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const btn = findConfirmButton(scene, slot);
      expect(btn!.text).toBe('✓ Confirm');
    }
  });

  it('confirm and reset buttons live on the same footer row', () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const reset = findResetButton(scene, slot)!;
      const confirm = findConfirmButton(scene, slot)!;
      expect(reset.y).toBe(confirm.y);
      // Confirm sits to the LEFT of Reset in the footer.
      expect(confirm.x).toBeLessThan(reset.x);
    }
  });

  it('clicking confirm fans out to every onConfirm listener with the slot', () => {
    const seen: number[] = [];
    screen.onConfirm((slot) => seen.push(slot));
    findConfirmButton(scene, 2)!.__fire('pointerdown');
    expect(seen).toEqual([2]);
  });

  it('multiple onConfirm listeners all fire in registration order', () => {
    const order: string[] = [];
    screen.onConfirm((slot) => order.push(`A:${slot}`));
    screen.onConfirm((slot) => order.push(`B:${slot}`));
    findConfirmButton(scene, 1)!.__fire('pointerdown');
    expect(order).toEqual(['A:1', 'B:1']);
  });

  it('the unsubscribe handle returned by onConfirm removes the listener', () => {
    const seen: number[] = [];
    const off = screen.onConfirm((slot) => seen.push(slot));
    off();
    findConfirmButton(scene, 3)!.__fire('pointerdown');
    expect(seen).toEqual([]);
  });

  it('confirmPlayerBindings programmatically fires the listeners', () => {
    const seen: number[] = [];
    screen.onConfirm((slot) => seen.push(slot));
    const ok = screen.confirmPlayerBindings(4);
    expect(ok).toBe(true);
    expect(seen).toEqual([4]);
  });

  it('confirm cancels an in-flight capture on the same slot', () => {
    screen.beginCapture(1, 'jump');
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });
    findConfirmButton(scene, 1)!.__fire('pointerdown');
    expect(screen.getActiveCapture()).toBeNull();
  });

  it('confirm on a different slot leaves an in-flight capture intact', () => {
    screen.beginCapture(1, 'jump');
    findConfirmButton(scene, 2)!.__fire('pointerdown');
    expect(screen.getActiveCapture()).toEqual({ slot: 1, action: 'jump' });
  });

  it('confirmPlayerBindings returns false after destroy', () => {
    screen.destroy();
    expect(screen.confirmPlayerBindings(1)).toBe(false);
  });

  it('confirm button is destroyed alongside the rest of the panel', () => {
    const btn = findConfirmButton(scene, 1)!;
    expect(btn.destroyed).toBe(false);
    screen.destroy();
    expect(btn.destroyed).toBe(true);
  });

  it('confirm listeners are cleared on destroy so they do not leak', () => {
    const seen: number[] = [];
    screen.onConfirm((slot) => seen.push(slot));
    screen.destroy();
    // The listener list is cleared; re-using confirmPlayerBindings would
    // be a no-op anyway because destroyed === true, but assert the
    // listener simply does not fire post-destroy.
    expect(screen.confirmPlayerBindings(1)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('confirm button uses the dedicated confirm colour, not the reset colour', () => {
    const reset = findResetButton(scene, 1)!;
    const confirm = findConfirmButton(scene, 1)!;
    expect(confirm.color).not.toBe(reset.color);
  });
});

// ---------------------------------------------------------------------------
// AC 50104 Sub-AC 4 — onReset listener pattern (the persistence-side
// hook the scene uses to write the now-default profile to localStorage)
// ---------------------------------------------------------------------------

describe('RebindingScreen — onReset per panel (AC 50104 Sub-AC 4)', () => {
  let scene: MockScene;
  let store: InputBindingsStore;
  let screen: RebindingScreen;

  beforeEach(() => {
    scene = createMockScene();
    store = new InputBindingsStore();
    screen = new RebindingScreen(scene as any, store);
  });

  it('clicking reset fans out to every onReset listener with the slot', () => {
    const seen: number[] = [];
    screen.onReset((slot) => seen.push(slot));
    findResetButton(scene, 3)!.__fire('pointerdown');
    expect(seen).toEqual([3]);
  });

  it('multiple onReset listeners all fire in registration order', () => {
    const order: string[] = [];
    screen.onReset((slot) => order.push(`A:${slot}`));
    screen.onReset((slot) => order.push(`B:${slot}`));
    findResetButton(scene, 1)!.__fire('pointerdown');
    expect(order).toEqual(['A:1', 'B:1']);
  });

  it('the unsubscribe handle returned by onReset removes the listener', () => {
    const seen: number[] = [];
    const off = screen.onReset((slot) => seen.push(slot));
    off();
    findResetButton(scene, 2)!.__fire('pointerdown');
    expect(seen).toEqual([]);
  });

  it('resetPlayerBindings programmatically fires the listeners', () => {
    const seen: number[] = [];
    screen.onReset((slot) => seen.push(slot));
    const ok = screen.resetPlayerBindings(4);
    expect(ok).toBe(true);
    expect(seen).toEqual([4]);
  });

  it('the listener observes the post-reset store state — defaults', () => {
    // Customise slot 1 so we can see the rollback through the listener.
    store.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    let snapshotInListener: { jumpKey?: number } = {};
    screen.onReset((slot) => {
      const live = store.getAction(slot, 'jump');
      const first = live[0];
      if (first && first.kind === 'keyboard') {
        snapshotInListener = { jumpKey: first.keyCode };
      }
    });
    findResetButton(scene, 1)!.__fire('pointerdown');
    // Listener saw the canonical default (W), not the previous SPACE.
    expect(snapshotInListener.jumpKey).toBe(KEY_CODE.W);
  });

  it('reset listeners are cleared on destroy so they do not leak', () => {
    const seen: number[] = [];
    screen.onReset((slot) => seen.push(slot));
    screen.destroy();
    expect(screen.resetPlayerBindings(1)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('a listener that unsubscribes mid-fan-out does not skip its sibling', () => {
    const seen: string[] = [];
    let off2: (() => void) | null = null;
    screen.onReset((slot) => {
      seen.push(`A:${slot}`);
      off2?.();
    });
    off2 = screen.onReset((slot) => seen.push(`B:${slot}`));
    findResetButton(scene, 2)!.__fire('pointerdown');
    // Both listeners fire — the snapshot taken at fan-out start preserves B
    // even though A unsubscribes B during its own callback.
    expect(seen).toEqual(['A:2', 'B:2']);
  });
});

// ---------------------------------------------------------------------------
// AC 50104 Sub-AC 4 — confirm + reset round-trip with the persistence
// controller (verifies the scene-side wiring shape works end-to-end)
// ---------------------------------------------------------------------------

describe('RebindingScreen confirm/reset → persistence (AC 50104 Sub-AC 4)', () => {
  it('subscribing the persistence controller to onConfirm writes the slot to storage', async () => {
    const { BindingsPersistenceController } = await import(
      '../input/BindingsPersistenceController'
    );
    const { saveBindingsSnapshot, snapshotStorageKey, loadBindingsSnapshot } =
      await import('../input/BindingsStorage');
    void saveBindingsSnapshot;

    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };

    const scene = createMockScene();
    const store = new InputBindingsStore();
    const persistence = new BindingsPersistenceController({ store, storage });
    const screen = new RebindingScreen(scene as any, store);

    // Wire the same shape the scene uses.
    screen.onConfirm((slot) => {
      persistence.saveSlot(slot);
      persistence.saveAll();
    });

    // Customise slot 2 then click confirm.
    store.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    findConfirmButton(scene, 2)!.__fire('pointerdown');

    // Snapshot key written; round-trips back to the same custom binding.
    expect(data.has(snapshotStorageKey())).toBe(true);
    const loaded = loadBindingsSnapshot(storage as any);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const p2Jump = loaded.value[2].bindings.jump[0];
      expect(p2Jump).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.SPACE });
    }

    screen.destroy();
  });

  it('subscribing the persistence controller to onReset writes the now-default slot to storage', async () => {
    const { BindingsPersistenceController } = await import(
      '../input/BindingsPersistenceController'
    );
    const { saveBindingsSnapshot, loadBindingsSnapshot } = await import(
      '../input/BindingsStorage'
    );

    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };

    // Pre-seed storage with a customised P1 (jump = SPACE) so the
    // listener has something to overwrite.
    const seededStore = new InputBindingsStore();
    seededStore.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
    saveBindingsSnapshot(seededStore.snapshot(), storage as any);
    expect(
      (loadBindingsSnapshot(storage as any) as any).value[1].bindings.jump[0],
    ).toEqual({ kind: 'keyboard', keyCode: KEY_CODE.SPACE });

    const scene = createMockScene();
    const store = new InputBindingsStore();
    // Hydrate the live store from the seed so the screen renders the
    // pre-customised state.
    new BindingsPersistenceController({ store, storage }).hydrate();
    const persistence = new BindingsPersistenceController({ store, storage });
    const screen = new RebindingScreen(scene as any, store);
    screen.onReset((slot) => {
      persistence.saveSlot(slot);
      persistence.saveAll();
    });

    // Click reset on slot 1.
    findResetButton(scene, 1)!.__fire('pointerdown');

    // Snapshot now reflects the canonical default — refresh-survives.
    const after = loadBindingsSnapshot(storage as any);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value[1].bindings.jump[0]).toEqual({
        kind: 'keyboard',
        keyCode: KEY_CODE.W,
      });
    }

    screen.destroy();
  });

  it('reset restores the per-slot device defaults — slot 3 → gamepad 0', async () => {
    const { BindingsPersistenceController } = await import(
      '../input/BindingsPersistenceController'
    );
    const { loadBindingsSnapshot } = await import('../input/BindingsStorage');

    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
      removeItem: (k: string) => {
        data.delete(k);
      },
    };

    const scene = createMockScene();
    const store = new InputBindingsStore();
    // Override slot 3 with a keyboard binding (would not be its default
    // device — slot 3 defaults to gamepad 0).
    store.setAction(3, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    const persistence = new BindingsPersistenceController({ store, storage });
    const screen = new RebindingScreen(scene as any, store);
    screen.onReset((slot) => {
      persistence.saveSlot(slot);
      persistence.saveAll();
    });

    findResetButton(scene, 3)!.__fire('pointerdown');

    // Slot 3 jump is back to its default gamepad 0 button binding.
    const live = store.getAction(3, 'jump')[0];
    expect(live?.kind).toBe('gamepad');
    if (live && live.kind === 'gamepad') {
      expect(live.gamepadIndex).toBe(0);
    }
    // And the storage round-trips it.
    const loaded = loadBindingsSnapshot(storage as any);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const stored = loaded.value[3].bindings.jump[0];
      expect(stored?.kind).toBe('gamepad');
      if (stored && stored.kind === 'gamepad') {
        expect(stored.gamepadIndex).toBe(0);
      }
    }

    screen.destroy();
  });
});
