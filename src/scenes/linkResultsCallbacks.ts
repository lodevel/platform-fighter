/** Exact captured result callbacks on a selected result-only 60Hz clock.
 * Particle shaders/audio content and mesh-part precedence are authored menu
 * adapters, separate from these retained source commands and event ages. */
import facts from './linkResultsCallbackFacts.json';
import type { LinkVictoryVariant } from './linkResultsPresentation';

export type LinkResultCallback = typeof facts.rows[number]['events'][number];
export interface LinkResultCallbackState {
  readonly motion: string;
  readonly lastElapsedFrame: number;
  readonly emitted: readonly string[];
}
export function advanceLinkResultCallbacks(previous: LinkResultCallbackState | null, input: {
  readonly winner: boolean; readonly variant: LinkVictoryVariant; readonly elapsedFrame: number;
}): { readonly state: LinkResultCallbackState; readonly events: readonly LinkResultCallback[] } {
  if (!Number.isSafeInteger(input.elapsedFrame) || input.elapsedFrame < 0 || ![1, 2, 3].includes(input.variant))
    throw new TypeError('Actual finite result callback age/variant required');
  if (previous && input.elapsedFrame < previous.lastElapsedFrame)
    throw new TypeError('Result callback clock rewind needs a new actual outcome lease');
  const motion = input.winner ? `win_${input.variant}` : 'lose';
  if (previous && previous.motion !== motion) throw new TypeError('A changed result outcome needs a new actual UI lease');
  const row = facts.rows.find(row => row.motion === motion)!;
  const emitted = new Set(previous?.emitted ?? []);
  const events = row.events.filter(event => event.nativeFrame <= input.elapsedFrame && !emitted.has(event.id));
  for (const event of events) emitted.add(event.id);
  return { state: Object.freeze({ motion, lastElapsedFrame: input.elapsedFrame, emitted: Object.freeze([...emitted]) }),
    events: Object.freeze(events) };
}
