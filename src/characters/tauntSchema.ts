/** Source-gated taunt commitment, separate from legacy input "taunt" (Dodge). */
export type TauntKind = 'up' | 'side' | 'down';
export interface TauntSpec {
  readonly cancelAfterFrames: number;
  /** Explicit presentation adapter limit; this is not an additional action lock. */
  readonly presentationFrames: number;
}
export type TauntSet = Readonly<Record<TauntKind, TauntSpec>>;
export interface TauntPresentationState {
  readonly kind: TauntKind;
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
  readonly cancellable: boolean;
  /** Simulation input frame the taunt began on (identifies one taunt for presentation owners). */
  readonly entryFrame: number;
}
export function validateTauntSet(set: TauntSet): void {
  for (const kind of ['up', 'side', 'down'] as const) {
    const spec = set?.[kind];
    if (!spec || !Number.isInteger(spec.cancelAfterFrames) || spec.cancelAfterFrames < 1 ||
        !Number.isInteger(spec.presentationFrames) || spec.presentationFrames < spec.cancelAfterFrames) {
      throw new Error(`taunts.${kind}: requires positive integer cancelAfterFrames and presentationFrames >= cancelAfterFrames`);
    }
  }
}
