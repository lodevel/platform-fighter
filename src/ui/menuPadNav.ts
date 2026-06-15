/**
 * menuPadNav — shared gamepad navigation poller for menu scenes.
 *
 * Every menu (main menu, mode select, stage select, results, …) wants
 * the same gamepad affordances the keyboard already has:
 *
 *   • d-pad / left stick — move the selection
 *   • A                  — confirm
 *   • B                  — back / cancel
 *   • START              — confirm (Smash-style "press start")
 *
 * Phaser's gamepad plugin is level-triggered (`pad.A` stays true while
 * held), so this class keeps a per-pad latch snapshot and derives
 * edge-triggered "pressed this frame" events, aggregated across every
 * connected pad. Menus call {@link poll} once per `update()` tick and
 * react to the returned booleans.
 *
 * Stick movement converts to discrete repeats with an initial delay so
 * holding a direction scrolls a list at a readable rate instead of
 * 60 steps per second.
 */
import Phaser from 'phaser';

export interface MenuPadEvents {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly confirm: boolean;
  readonly back: boolean;
}

const STICK_THRESHOLD = 0.5;
/** Frames before a held direction starts repeating. */
const REPEAT_DELAY_FRAMES = 18;
/** Frames between repeats while held. */
const REPEAT_INTERVAL_FRAMES = 7;
/** Standard-mapping START button index. */
const START_BUTTON_INDEX = 9;

interface PadLatch {
  a: boolean;
  b: boolean;
  start: boolean;
  up: number;
  down: number;
  left: number;
  right: number;
}

export class MenuPadNav {
  private readonly scene: Phaser.Scene;
  private readonly latches = new Map<number, PadLatch>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // A pad that connects MID-SCENE gets its latch pre-primed all-false
    // so its very first press counts as an edge. The current-state
    // priming in poll() only covers pads already present at the first
    // poll (a button held across a scene transition must not confirm
    // on the menu's first frame). DISCONNECTED drops the latch so the
    // map can't grow past the live pad set. No explicit detach needed:
    // both listeners hang off the SCENE's own GamepadPlugin, whose
    // shutdown removes all its listeners when the scene goes down.
    scene.input.gamepad?.on(
      Phaser.Input.Gamepad.Events.CONNECTED,
      this.onPadConnected,
      this,
    );
    scene.input.gamepad?.on(
      Phaser.Input.Gamepad.Events.DISCONNECTED,
      this.onPadDisconnected,
      this,
    );
  }

  private onPadConnected(pad: Phaser.Input.Gamepad.Gamepad): void {
    this.latches.set(pad.index, {
      a: false,
      b: false,
      start: false,
      up: 0,
      down: 0,
      left: 0,
      right: 0,
    });
  }

  private onPadDisconnected(pad: Phaser.Input.Gamepad.Gamepad): void {
    this.latches.delete(pad.index);
  }

  /** Edge-triggered menu events aggregated across all connected pads. */
  poll(): MenuPadEvents {
    const out = {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: false,
      back: false,
    };
    const pads = this.scene.input.gamepad?.gamepads ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      // First sighting of a pad: prime the latch from the CURRENT
      // button state without emitting events. A button still held
      // from the previous scene (e.g. attack mashed at match end)
      // must not fire a confirm on the menu's first frame. (Pads that
      // connect MID-SCENE skip this branch — the CONNECTED handler
      // pre-primed them all-false so their first press counts.)
      if (!this.latches.has(pad.index)) {
        this.latches.set(pad.index, {
          a: !!pad.A,
          b: !!pad.B,
          start: !!pad.buttons[START_BUTTON_INDEX]?.pressed,
          up: 0,
          down: 0,
          left: 0,
          right: 0,
        });
        continue;
      }
      const latch = this.latches.get(pad.index)!;

      const a = !!pad.A;
      const b = !!pad.B;
      const start = !!pad.buttons[START_BUTTON_INDEX]?.pressed;
      if (a && !latch.a) out.confirm = true;
      if (start && !latch.start) out.confirm = true;
      if (b && !latch.b) out.back = true;

      const axisX = pad.axes[0]?.getValue() ?? 0;
      const axisY = pad.axes[1]?.getValue() ?? 0;
      const dirActive = {
        up: pad.up || axisY < -STICK_THRESHOLD,
        down: pad.down || axisY > STICK_THRESHOLD,
        left: pad.left || axisX < -STICK_THRESHOLD,
        right: pad.right || axisX > STICK_THRESHOLD,
      };
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const held = dirActive[dir];
        const frames = held ? latch[dir] + 1 : 0;
        // Fire on the initial press, then repeat after the delay.
        if (
          frames === 1 ||
          (frames > REPEAT_DELAY_FRAMES &&
            (frames - REPEAT_DELAY_FRAMES) % REPEAT_INTERVAL_FRAMES === 0)
        ) {
          out[dir] = true;
        }
        latch[dir] = frames;
      }

      latch.a = a;
      latch.b = b;
      latch.start = start;
      this.latches.set(pad.index, latch);
    }
    return out;
  }

  reset(): void {
    this.latches.clear();
  }
}
