/**
 * Menu input: DOM keyboard and the Gamepad API turned into per-device menu
 * actions. Directions repeat while held. Pointer input stays with the DOM
 * (screens use ordinary click handlers).
 *
 * Keyboard (one device): arrows or WASD move, Space confirms, Enter starts,
 * Esc / Backspace go back, C = x (add CPU), V = y, digits 1–4 pick a card.
 * Gamepad (standard mapping): d-pad or left stick move, A confirm, B back,
 * X = x, Y = y, Start = start.
 */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start' | 'x' | 'y'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4';
export type DeviceId = 'keyboard' | `pad${number}`;
export interface SelectionOwner {
  readonly device: DeviceId;
  readonly slot: 1 | 2 | 3 | 4;
  readonly padId?: string;
}
export interface MenuEvent {
  readonly device: DeviceId;
  readonly action: MenuAction;
  /** Free-cursor screens consume stick motion themselves; other menus snap. */
  readonly source?: 'keyboard' | 'button' | 'stick';
}
export type MenuListener = (event: MenuEvent) => void;

const KEYS: Readonly<Record<string, MenuAction>> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'confirm', Enter: 'start', NumpadEnter: 'start', Escape: 'back', Backspace: 'back', KeyC: 'x', KeyV: 'y',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4',
};
const PAD_BUTTONS: ReadonlyArray<[number, MenuAction]> = [
  [0, 'confirm'], [1, 'back'], [2, 'x'], [3, 'y'], [9, 'start'], [12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'],
];
const DIRECTIONS = new Set<MenuAction>(['up', 'down', 'left', 'right']);
const REPEAT_DELAY_MS = 320, REPEAT_EVERY_MS = 95, STICK_THRESHOLD = 0.55;

export class MenuInput {
  private readonly listeners = new Set<MenuListener>();
  private readonly held = new Map<string, number>();
  private readonly nextRepeat = new Map<string, number>();
  /**
   * Set while something else reads raw input (a text field, the controls
   * editor): no menu actions are emitted from keys or pads.
   */
  suspended = false;

  constructor() {
    addEventListener('keydown', (e) => {
      const action = KEYS[e.code];
      if (!action || this.suspended) return;
      e.preventDefault();
      // Keyboard auto-repeat stands in for the hold repeat on directions.
      if (e.repeat && !DIRECTIONS.has(action)) return;
      this.emit({ device: 'keyboard', action, source: 'keyboard' });
    });
  }

  on(listener: MenuListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connected pads, by Gamepad API index. */
  pads(): Gamepad[] {
    return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => Boolean(p?.connected));
  }

  /** Left-stick vector of a pad, dead-zoned, for free cursor movement. */
  stick(device: DeviceId): { x: number; y: number } {
    const pad = this.pads().find((p) => `pad${p.index}` === device);
    const dz = (v: number | undefined) => (v !== undefined && Math.abs(v) > 0.18 ? v : 0);
    return { x: dz(pad?.axes[0]), y: dz(pad?.axes[1]) };
  }

  /** Poll pads; call once per animation frame. */
  poll(now: number): void {
    // Held state keeps updating while suspended, so a press made then never fires on resume.
    const pads = this.pads();
    const connected = new Set(pads.map(pad => `pad${pad.index}`));
    for (const key of this.held.keys()) {
      if (!connected.has(key.split(':')[0]!)) { this.held.delete(key); this.nextRepeat.delete(key); }
    }
    for (const pad of pads) {
      const device = `pad${pad.index}` as DeviceId;
      const down = new Map<MenuAction, 'button' | 'stick'>();
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -STICK_THRESHOLD) down.set('left', 'stick');
      if (ax > STICK_THRESHOLD) down.set('right', 'stick');
      if (ay < -STICK_THRESHOLD) down.set('up', 'stick');
      if (ay > STICK_THRESHOLD) down.set('down', 'stick');
      for (const [button, action] of PAD_BUTTONS) if (pad.buttons[button]?.pressed) down.set(action, 'button');
      for (const action of ['confirm', 'back', 'start', 'x', 'y', 'up', 'down', 'left', 'right'] as const) {
        const key = `${device}:${action}`;
        if (!down.has(action)) { this.held.delete(key); this.nextRepeat.delete(key); continue; }
        if (!this.held.has(key)) {
          this.held.set(key, now);
          this.nextRepeat.set(key, now + REPEAT_DELAY_MS);
          if (!this.suspended) this.emit({ device, action, source: down.get(action) });
        } else if (DIRECTIONS.has(action) && now >= this.nextRepeat.get(key)!) {
          this.nextRepeat.set(key, now + REPEAT_EVERY_MS);
          if (!this.suspended) this.emit({ device, action, source: down.get(action) });
        }
      }
    }
  }

  private emit(event: MenuEvent): void {
    this.listeners.forEach((l) => l(event));
  }
}
