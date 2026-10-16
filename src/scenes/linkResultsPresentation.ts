/** Result-only source motion selection. No gameplay actor or random stream.
 * Captured entry extents are raw NUANMB last index +1; playing one raw sample
 * per60Hz UI frame and selecting the variant by match identity are explicit
 * menu adapters, not recovered native result-controller behavior. */
import type { MatchConfig } from '../types';
import type { MatchResultPayload } from '../match';
import type { MatchSimData } from '../sim/MatchSim';

export type LinkVictoryVariant = 1 | 2 | 3;
const SOURCE_ENTRY_SAMPLES: Readonly<Record<LinkVictoryVariant, number>> = {
  1: 141, 2: 162, 3: 131,
};

export function selectLinkVictoryVariant(seed: number, endFrame: number, slotIndex: number): LinkVictoryVariant {
  // Pure identity hash; never consume the match's gameplay RNG on render.
  const a = Number.isFinite(seed) ? seed >>> 0 : 0;
  const b = Number.isFinite(endFrame) ? endFrame >>> 0 : 0;
  const c = Number.isFinite(slotIndex) ? slotIndex >>> 0 : 0;
  return (1 + ((a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca6b)) >>> 0) % 3) as LinkVictoryVariant;
}

export function linkResultsMotion(input: {
  readonly winner: boolean;
  readonly variant: LinkVictoryVariant;
  readonly elapsedFrames: number;
}): { readonly motion: string; readonly rawAge: number } {
  const age = Number.isFinite(input.elapsedFrames) ? Math.max(0, Math.floor(input.elapsedFrames)) : 0;
  if (!input.winner) return { motion: 'lose', rawAge: age };
  const entry = SOURCE_ENTRY_SAMPLES[input.variant];
  return age < entry
    ? { motion: `win_${input.variant}`, rawAge: age }
    : { motion: `win_${input.variant}_wait`, rawAge: age - entry };
}

export interface LinkResultsAllocation {
  readonly runtimeIndex: number;
  readonly displaySlotIndex: number;
  readonly winner: boolean;
  readonly variant: LinkVictoryVariant;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Side gutters leave the existing central stats/buttons intact. Two rows
 * support all four actual participant slots, including lobby slot gaps. */
export function allocateLinkResults(input: {
  readonly payload: MatchResultPayload;
  readonly config: MatchConfig | undefined;
  readonly data: MatchSimData | undefined;
  readonly width: number;
  readonly height: number;
}): readonly LinkResultsAllocation[] {
  const contentWidth = Math.min(input.width * .72, 760);
  const gutterWidth = (input.width - contentWidth) / 2;
  const width = Math.max(12, Math.min(196, gutterWidth - 24));
  const height = Math.max(12, Math.min(124, input.height * .17));
  return (input.config?.players ?? []).slice(0, Math.min(4, input.payload.playerNames.length))
    .flatMap((slot, runtimeIndex) => slot.characterId === 'link' ? [{
      runtimeIndex, displaySlotIndex: slot.index,
      winner: input.payload.winnerIndex === runtimeIndex,
      variant: selectLinkVictoryVariant(input.data?.rngSeed ?? 0, input.payload.endFrame, slot.index),
      x: runtimeIndex % 2 === 0 ? gutterWidth / 2 : input.width - gutterWidth / 2,
      y: input.height * (runtimeIndex < 2 ? .43 : .62), width, height,
    }] : []);
}
