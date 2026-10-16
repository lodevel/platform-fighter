/** A callback failure must not cancel the application's future animation frames.
 * The owner handles a failed stage once and suspends that subsystem safely. */
export type FramePhase = 'input' | 'screen' | 'renderer';
export interface FrameFault {
  readonly phase: FramePhase;
  readonly now: number;
  readonly message: string;
  readonly stack: string | null;
}
export interface FrameLoopOptions {
  readonly requestFrame: (callback: (now: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly stages: ReadonlyArray<{phase: FramePhase; run: (now: number) => void}>;
  readonly onFault: (fault: FrameFault) => void;
}
export function startFrameLoop(options: FrameLoopOptions): () => void {
  let stopped = false, request = 0;
  const tick = (now: number) => {
    if (stopped) return;
    // Schedule before user code: even a failing update or recovery callback
    // cannot permanently sever the browser's only RAF chain.
    request = options.requestFrame(tick);
    for (const stage of options.stages) {
      try { stage.run(now); }
      catch (error) {
        options.onFault({phase: stage.phase, now,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack ?? null : null});
        break;
      }
    }
  };
  request = options.requestFrame(tick);
  return () => { stopped = true; options.cancelFrame(request); };
}
