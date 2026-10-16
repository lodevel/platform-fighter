export interface FrameRateSample {
  readonly fps: number;
  readonly frameTimeMs: number;
}

/** Successful rendered frames in the preceding second. The first frame starts
 * the observation period; hidden-tab time is excluded by an explicit reset. */
export class FrameRateSampler {
  private startedAt: number | null = null;
  private previousFrame: number | null = null;
  private publishedAt = 0;
  private frames: number[] = [];

  record(now: number): FrameRateSample | null {
    if (!Number.isFinite(now) || (this.previousFrame !== null && now <= this.previousFrame)) return null;
    this.previousFrame = now;
    if (this.startedAt === null) {
      this.startedAt = this.publishedAt = now;
      return null;
    }
    this.frames.push(now);
    const cutoff = now - 1000;
    // Keep an exact one-second boundary stable despite fractional RAF times.
    while (this.frames.length && this.frames[0]! <= cutoff + 1e-6) this.frames.shift();
    if (now - this.publishedAt < 250) return null;
    this.publishedAt = now;
    const elapsed = Math.min(1000, now - this.startedAt);
    const fps = this.frames.length * 1000 / elapsed;
    return { fps, frameTimeMs: 1000 / fps };
  }

  reset(): void {
    this.startedAt = this.previousFrame = null;
    this.publishedAt = 0;
    this.frames = [];
  }
}

/** Persistent shell UI; the owner calls rendered only after a successful RAF
 * render, so simulation steps and explicit probe redraws never count as FPS. */
export function createFrameRateMeter(host: HTMLElement) {
  const document = host.ownerDocument;
  const node = document.createElement('div');
  node.className = 'frame-rate-meter';
  node.setAttribute('aria-live', 'off');
  node.title = 'Rendered frames per second · last second';
  node.textContent = '-- FPS';
  host.append(node);
  const sampler = new FrameRateSampler();
  const reset = () => {
    sampler.reset();
    if (node.textContent !== '-- FPS') node.textContent = '-- FPS';
  };
  document.addEventListener('visibilitychange', reset);
  return {
    rendered(now: number): void {
      if (document.hidden) return;
      const sample = sampler.record(now);
      if (!sample) return;
      const text = `${Math.round(sample.fps)} FPS`;
      if (node.textContent !== text) node.textContent = text;
    },
    reset,
    dispose(): void {
      document.removeEventListener('visibilitychange', reset);
      node.remove();
    },
  };
}
