/** Drawing-only phase resampling. Source catch clocks and gameplay commitment
 * stay owned by the grab state machine. This module installs no assets.
 */
export type DonkeyKongGrabVariant = 'standing' | 'dash' | 'pivot';
export interface DonkeyKongGrabTimeline {
  readonly variant: DonkeyKongGrabVariant;
  readonly startupFrames: number;
  readonly activeFrames: number;
  readonly recoveryFrames: number;
}
export interface DonkeyKongGrabDrawingClock {
  readonly variant: DonkeyKongGrabVariant;
  readonly phase: string;
  readonly phaseFramesElapsed: number;
  readonly spec: {
    readonly startupFrames: number;
    readonly activeFrames: number;
    readonly whiffRecoveryFrames: number;
  };
}
const duration = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function mapDonkeyKongGrabDrawingAge(timeline: DonkeyKongGrabTimeline,
  clock: DonkeyKongGrabDrawingClock): number | null {
  if (timeline.variant !== clock.variant || !['standing', 'dash', 'pivot'].includes(timeline.variant)) return null;
  const source = [timeline.startupFrames, timeline.activeFrames, timeline.recoveryFrames];
  const configured = [clock.spec.startupFrames, clock.spec.activeFrames, clock.spec.whiffRecoveryFrames];
  if (!source.every(duration) || !configured.every(duration)
    || !duration(clock.phaseFramesElapsed) || !Number.isSafeInteger(source.reduce((sum,n) => sum+n,0))) return null;
  const index = ['whiffStartup', 'whiffActive', 'whiffRecovery'].indexOf(clock.phase);
  if (index < 0 || source[index] === 0 || configured[index] === 0
    || clock.phaseFramesElapsed >= configured[index]!) return null;
  const offset = source.slice(0,index).reduce((sum,n) => sum+n,0);
  // Exact integer resampling also keeps an unchanged phase at its original
  // age; floating division can otherwise round a boundary one frame earlier.
  const local = Number(BigInt(clock.phaseFramesElapsed) * BigInt(source[index]!) / BigInt(configured[index]!));
  return offset + local;
}
