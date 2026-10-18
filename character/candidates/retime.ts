import { scheduleLength, windowAt } from '../evaluator/evaluate';
import { compress } from '../package/schedule';
import type { Action, DrawingId, Schedule, Window } from '../package/types';

/** The window values without their span. */
const valueOf = <W extends Window>(window: W): Omit<W, 'start' | 'end'> => { const { start: _s, end: _e, ...rest } = window; return rest; };

/**
 * A schedule on a new clock: for ticks before `length` it shows what the original
 * showed at `map(tick)`; from `length` on it follows the original.
 */
export function retimeSchedule<W extends Window>(schedule: Schedule<W>, map: (tick: number) => number, length: number): Schedule<W> {
  const own = scheduleLength(schedule), horizon = schedule.after === 'loop' ? own : Math.max(length, own) + 1;
  const values = Array.from({ length: horizon }, (_, t) => {
    const window = windowAt(schedule, t < length ? map(t) : t);
    return window && valueOf(window);
  });
  const result = compress(values, schedule.after === 'loop' ? own : null);
  if (typeof result === 'string') throw new Error(`retimed schedule: ${result}`);
  return result as unknown as Schedule<W>;
}

/** The action with its drawings and sockets retimed together, so a held drawing keeps its own sockets. */
export function retimeAction(action: Action, map: (tick: number) => number): Action {
  const length = scheduleLength(action.drawings);
  return {
    ...action,
    drawings: retimeSchedule(action.drawings, map, length),
    ...(action.sockets ? { sockets: Object.fromEntries(Object.entries(action.sockets).map(([name, track]) =>
      [name, { ...track, schedule: retimeSchedule(track.schedule, map, length) }])) } : {}),
  };
}

/**
 * Which drawing windows to keep when drawings are held longer: repeatedly drops the
 * window whose drawing differs least from the kept drawing that would replace it
 * (the previous kept window), while that difference is at most `maxDiff`. The first
 * window is always kept. A drop is refused when the replacing drawing would then be
 * shown longer than `maxHold` ticks or the action's longest window, whichever is
 * longer, so slow motion such as breathing keeps moving. Returns the tick map for
 * `retimeAction`.
 */
export function holdMap(windows: readonly (Window & { readonly drawing: DrawingId })[], diff: (shown: DrawingId, replaced: DrawingId) => number,
  maxDiff: number, maxHold: number): (tick: number) => number {
  const kept = windows.map(() => true), longest = Math.max(maxHold, ...windows.map(w => w.end - w.start));
  const previous = (i: number) => { let p = i - 1; while (!kept[p]) p--; return p; };
  const heldUntil = (i: number) => { let n = i + 1; while (n < windows.length && !kept[n]) n++; return windows[n - 1]!.end; };
  for (;;) {
    let best = -1, bestCost = Infinity;
    for (let i = 1; i < windows.length; i++) {
      if (!kept[i]) continue;
      const shown = previous(i);
      if (heldUntil(i) - windows[shown]!.start > longest) continue;
      const cost = diff(windows[shown]!.drawing, windows[i]!.drawing);
      if (cost <= maxDiff && cost < bestCost) { best = i; bestCost = cost; }
    }
    if (best < 0) break;
    kept[best] = false;
  }
  // Each tick shows the last kept window at or before it, frozen on that window's last tick.
  const shownAt: number[] = [];
  let last = windows[0]!;
  windows.forEach((window, i) => {
    if (kept[i]) last = window;
    for (let t = window.start; t < window.end; t++) shownAt.push(Math.min(t, last.end - 1));
  });
  return tick => shownAt[tick] ?? tick;
}
