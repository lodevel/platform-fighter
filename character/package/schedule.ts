import type { Schedule, Window } from './types';

/**
 * Run-length windows for per-tick values. With a loop length the first `loop` ticks repeat.
 * Otherwise trailing nulls become `stop` and a final value that never changes becomes `hold`.
 * A gap (null between drawings) has no window form and is returned as a problem.
 */
export function compress<V extends object>(values: readonly (V | null)[], loop: number | null): Schedule<V & Window> | string {
  const same = (a: V | null, b: V | null) => JSON.stringify(a) === JSON.stringify(b);
  let length: number, after: Schedule<Window>['after'];
  if (loop) {
    if (loop > values.length) return `loop ${loop} exceeds the sampled range`;
    length = loop; after = 'loop';
  } else {
    let shown = values.length;
    while (shown > 0 && values[shown - 1] === null) shown--;
    if (shown === 0) return 'never shows a drawing';
    if (shown < values.length) { length = shown; after = 'stop'; } else {
      let start = shown - 1;
      while (start > 0 && same(values[start - 1]!, values[shown - 1]!)) start--;
      length = start + 1; after = 'hold';
    }
  }
  const windows: (V & Window)[] = [];
  for (let t = 0; t < length; t++) {
    const value = values[t];
    if (value === null || value === undefined) return `no drawing at tick ${t} inside the action`;
    const last = windows.at(-1);
    if (last && same(stripWindow(last), value)) windows[windows.length - 1] = { ...last, end: t + 1 };
    else windows.push({ ...value, start: t, end: t + 1 });
  }
  return { after, windows };
}

const stripWindow = <V extends object>(window: V & Window): V => { const { start: _s, end: _e, ...rest } = window; return rest as unknown as V; };
