/** Contact-time world anchor for an airborne reference angle-367 hit. */
export interface ReferenceAutolinkContext {
  readonly target: { readonly x: number; readonly y: number };
  readonly sourceVelocity: { readonly x: number; readonly y: number };
}

/**
 * Project calibration for contextual angle-367 transport, in pixel units.
 * Source scripts establish the autolink angle, not this precise algorithm.
 * Sample the contact anchor once; after hitlag/SDI, pull toward that anchor
 * while retaining source motion. The local downward cap is +5px/step;
 * both that cap and the 0.2 positional factor are authored calibration,
 * not recovered Ultimate numerical parameters.
 * The later five-step speed cap remains unverified and is not implemented.
 */
export function referenceAutolinkVelocity(
  context: ReferenceAutolinkContext,
  position: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  return {
    x: context.sourceVelocity.x + 0.2 * (context.target.x - position.x),
    y: Math.min(5, context.sourceVelocity.y + 0.2 * (context.target.y - position.y)),
  };
}

/** Invalid transient contact metadata cannot replace an otherwise valid hit. */
export function validReferenceAutolinkContext(
  context: ReferenceAutolinkContext | undefined,
): context is ReferenceAutolinkContext {
  return context !== undefined
    && Number.isFinite(context.target.x) && Number.isFinite(context.target.y)
    && Number.isFinite(context.sourceVelocity.x) && Number.isFinite(context.sourceVelocity.y);
}
