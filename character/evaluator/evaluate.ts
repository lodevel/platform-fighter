import type { ActionId, CharacterPackage, DrawingId, Schedule, Window } from '../package/types';

export type Facing = 1 | -1;

export interface DisplayRequest {
  readonly action: ActionId;
  /** Ticks since the action started, as decided by the game. Fractions are floored. */
  readonly tick: number;
  readonly facing: Facing;
}

export interface SocketPose {
  readonly space: 'body-centre' | 'root';
  /** Facing applied: x is mirrored and the angle negated when facing left. */
  readonly x: number;
  readonly y: number;
  readonly angle?: number;
  readonly length?: number;
}

export interface DisplayPose {
  /** null when a `stop` schedule has ended: nothing is drawn. */
  readonly drawing: DrawingId | null;
  readonly sample?: number;
  readonly bodyCentreFromRootY: number;
  readonly sockets: Readonly<Record<string, SocketPose>>;
}

/** What the character shows for one action at one tick. Pure: the same request always gives the same pose. */
export function evaluate(pkg: CharacterPackage, request: DisplayRequest): DisplayPose {
  const action = pkg.actions[request.action];
  if (!action) throw new Error(`${pkg.id}: unknown action ${request.action}`);
  const shown = windowAt(action.drawings, request.tick);
  const sockets: Record<string, SocketPose> = {};
  for (const [name, track] of Object.entries(action.sockets ?? {})) {
    const at = windowAt(track.schedule, request.tick);
    if (!at) continue;
    sockets[name] = {
      space: track.space, x: at.x * request.facing, y: at.y,
      ...(at.angle === undefined ? {} : { angle: at.angle * request.facing }),
      ...(at.length === undefined ? {} : { length: at.length }),
    };
  }
  return {
    drawing: shown?.drawing ?? null,
    ...(shown?.sample === undefined ? {} : { sample: shown.sample }),
    bodyCentreFromRootY: action.bodyCentreFromRootY, sockets,
  };
}

/** The window covering `tick`, following the schedule's `after` rule past its last window. */
export function windowAt<W extends Window>(schedule: Schedule<W>, tick: number): W | null {
  const windows = schedule.windows, length = windows[windows.length - 1]!.end;
  let t = Math.floor(Math.max(0, tick));
  if (t >= length) {
    if (schedule.after === 'stop') return null;
    t = schedule.after === 'loop' ? t % length : length - 1;
  }
  let low = 0, high = windows.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (windows[mid]!.start <= t) low = mid; else high = mid - 1;
  }
  return windows[low]!;
}

/** Ticks the action's drawing schedule covers before its `after` rule applies. */
export const scheduleLength = (schedule: Schedule<Window>): number => schedule.windows[schedule.windows.length - 1]!.end;
