import type { InputBinding, LogicalAction } from '../types/inputBindings';
import { buildGamepadAxisCaptureBinding, buildGamepadButtonCaptureBinding,
  buildKeyboardCaptureBinding } from '../ui/bindingCapture';
import { formatActionLabel } from '../ui/rebindingScreenFormat';
import { PlayerControlsSession } from './PlayerControlsSession';
import { PLAYER_CONTROLS_ROWS } from './playerControlsRows';

export interface ControlsPadSnapshot {
  readonly index: number;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>;
  readonly axes: ReadonlyArray<number>;
}

export function controlsPadIsNeutral(pad: ControlsPadSnapshot): boolean {
  return !pad.buttons.some(button => button.pressed)
    && !pad.axes.some(value => Math.abs(value) > 0.5);
}

/** One editor consumes only its owner's input, including the release after capture. */
export class PlayerControlsInput {
  focusedRow = 0;
  capture: LogicalAction | null = null;
  feedback = '';
  connected = true;
  closed: 'saved' | 'cancelled' | null = null;
  private waitingForNeutral = true;
  private previousButtons = new Set<number>();
  private direction = 0;
  private nextRepeat = 0;

  constructor(readonly session: PlayerControlsSession,
    private readonly sharedProfileIds: () => ReadonlyArray<string>,
    private readonly validateDraft: () => string | undefined = () => undefined) {}

  activate(row = this.focusedRow): void {
    if (this.closed || this.capture !== null) return;
    const target = PLAYER_CONTROLS_ROWS[row];
    if (!target) return;
    this.focusedRow = row;
    this.feedback = '';
    switch (target.kind) {
      case 'profile': this.session.cycleProfile(1); break;
      case 'binding':
        this.capture = target.action;
        this.waitingForNeutral = true;
        break;
      case 'reset': this.session.reset(); this.feedback = 'Defaults restored in this draft.'; break;
      case 'copy': this.save(true); break;
      case 'done': this.save(false); break;
      case 'cancel': this.closed = 'cancelled'; break;
    }
  }

  private save(copy: boolean): void {
    const problem = this.validateDraft();
    if (problem) { this.feedback = problem; return; }
    const result = this.session.save({ copy, sharedProfileIds: this.sharedProfileIds() });
    if (!result.ok) { this.feedback = result.error; return; }
    this.feedback = `Saved ${result.name}`;
    if (!copy) this.closed = 'saved';
  }

  private navigate(delta: number): void {
    this.focusedRow = (this.focusedRow + delta + PLAYER_CONTROLS_ROWS.length) % PLAYER_CONTROLS_ROWS.length;
  }

  private captureBinding(binding: InputBinding): void {
    if (!this.capture) return;
    try {
      this.session.setBinding(this.capture, binding);
      this.feedback = `${formatActionLabel(this.capture)} assigned. Release the input to continue.`;
      this.capture = null;
      this.waitingForNeutral = true;
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : 'Could not assign this input.';
    }
  }

  private cancelCapture(): void {
    this.capture = null;
    this.feedback = 'Assignment cancelled.';
    this.waitingForNeutral = true;
  }

  releaseKeyboard(heldKeys: ReadonlySet<number>): void {
    if (this.session.device.kind === 'keyboard' && heldKeys.size === 0) this.waitingForNeutral = false;
  }

  keyDown(event: Pick<KeyboardEvent, 'key' | 'keyCode' | 'repeat'>): void {
    if (this.session.device.kind !== 'keyboard' || this.closed || this.waitingForNeutral || event.repeat) return;
    if (this.capture) {
      if (event.key === 'Escape') this.cancelCapture();
      else this.captureBinding(buildKeyboardCaptureBinding(event.keyCode));
      return;
    }
    if (event.key === 'Escape') this.closed = 'cancelled';
    else if (event.key === 'ArrowUp') this.navigate(-1);
    else if (event.key === 'ArrowDown') this.navigate(1);
    else if (event.key === 'Enter' || event.key === ' ') this.activate();
    else if (this.focusedRow === 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      this.session.cycleProfile(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  pollPad(pad: ControlsPadSnapshot, time: number): void {
    if (this.session.device.kind !== 'gamepad' || pad.index !== this.session.device.gamepadIndex || this.closed) return;
    const pressed = new Set(pad.buttons.flatMap((button, index) => button.pressed ? [index] : []));
    const edge = (index: number) => pressed.has(index) && !this.previousButtons.has(index);
    if (this.waitingForNeutral) {
      this.previousButtons = pressed;
      this.direction = 0;
      if (controlsPadIsNeutral(pad)) this.waitingForNeutral = false;
      return;
    }
    if (this.capture) {
      if (edge(9)) this.cancelCapture();
      else {
        const button = [...pressed].find(index => !this.previousButtons.has(index));
        if (button !== undefined) this.captureBinding(buildGamepadButtonCaptureBinding(pad.index, button));
        else {
          const axis = pad.axes.findIndex(value => Math.abs(value) >= 0.7);
          if (axis >= 0) this.captureBinding(buildGamepadAxisCaptureBinding(pad.index, axis, pad.axes[axis]!));
        }
      }
    } else {
      // Buttons win over directions so A + a held direction cannot activate a different row.
      if (edge(1)) this.closed = 'cancelled';
      else if (edge(0)) this.activate();
      else {
        const dy = pressed.has(12) || (pad.axes[1] ?? 0) < -0.5 ? -1
          : pressed.has(13) || (pad.axes[1] ?? 0) > 0.5 ? 1 : 0;
        const dx = pressed.has(14) || (pad.axes[0] ?? 0) < -0.5 ? -1
          : pressed.has(15) || (pad.axes[0] ?? 0) > 0.5 ? 1 : 0;
        const direction = dy || (this.focusedRow === 0 ? dx * 2 : 0);
        if (direction && (direction !== this.direction || time >= this.nextRepeat)) {
          if (dy) this.navigate(dy);
          else this.session.cycleProfile(dx as 1 | -1);
          this.nextRepeat = time + (direction === this.direction ? 130 : 350);
        }
        this.direction = direction;
      }
    }
    this.previousButtons = pressed;
  }
}
