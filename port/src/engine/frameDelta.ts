/** Milliseconds from `last` to `now`, within [0, maxMs]. Callers mix animation-frame stamps with
 * `performance.now()` reads (a probe's draw between frames), and the next frame's stamp can be older
 * than that read; a negative delta would run every frame-rate-independent blend backward. */
export function frameDeltaMs(now: number, last: number, maxMs = 100): number {
  return Math.min(maxMs, Math.max(0, now - last));
}
