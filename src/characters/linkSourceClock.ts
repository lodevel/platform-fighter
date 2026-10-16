/** STAGED for src/characters/linkSourceClock.ts.
 * Source-event bookkeeping only, independent of target anatomy/physics.
 * Project contract: entry gameplay age0 corresponds to native frame1.
 * Rates and exit conditions MUST come from the action's resolved contract;
 * neither native cancel0 nor a missing rate invents a commitment here.
 */
export interface LinkSourceClock {
  readonly gameplayAge: number;
  readonly nativeFrame: number;
}
export interface LinkSourceEvent<T> {
  readonly nativeFrame: number;
  /** Original callback order within one source frame. */
  readonly sourceOrder: number;
  readonly payload: T;
}
export interface LinkSourceClockStep<T> {
  readonly clock: LinkSourceClock;
  readonly events: readonly T[];
}

function ordered<T>(events: readonly LinkSourceEvent<T>[]): readonly LinkSourceEvent<T>[] {
  return [...events].sort((a,b)=>a.nativeFrame-b.nativeFrame||a.sourceOrder-b.sourceOrder);
}

/** Commands at source frame0 or1 execute on the selected entry sample.
 * The caller commits these once, alongside the state that entered the action.
 */
export function beginLinkSourceClock<T>(events: readonly LinkSourceEvent<T>[]): LinkSourceClockStep<T> {
  return {clock: Object.freeze({gameplayAge: 0, nativeFrame: 1}),
    events: Object.freeze(ordered(events).filter(event=>event.nativeFrame<=1).map(event=>event.payload))};
}

/** A supplied continuous native advance permits source-rate resampling,
 * including fractional samples. Crossed callbacks retain same-frame order.
 * Calling this does not infer looping, interruption, recovery or actionability.
 */
export function advanceLinkSourceClock<T>(clock: LinkSourceClock, input: {
  readonly frozen: boolean;
  readonly nativeFrameAdvance: number;
  readonly events: readonly LinkSourceEvent<T>[];
}): LinkSourceClockStep<T> {
  if (!Number.isFinite(input.nativeFrameAdvance)||input.nativeFrameAdvance<0)
    throw new RangeError('Link source frame advance must be finite and nonnegative');
  if(input.frozen)return{clock,events:Object.freeze([])};
  const next=Object.freeze({gameplayAge:clock.gameplayAge+1,nativeFrame:clock.nativeFrame+input.nativeFrameAdvance});
  return {clock:next,events:Object.freeze(ordered(input.events)
    .filter(event=>event.nativeFrame>clock.nativeFrame&&event.nativeFrame<=next.nativeFrame).map(event=>event.payload))};
}

/** Read-only drawing coordinate: native frame1 maps to zero-based sample age0.
 * Body, receiving, attachments and outgoing events share this committed value.
 */
export function linkSourceDrawingAge(clock: LinkSourceClock): number {
  return clock.nativeFrame-1;
}
