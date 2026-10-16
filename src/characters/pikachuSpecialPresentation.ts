import type { PikachuSpecialRuntime } from './pikachuSpecialRuntime';

export type PikachuSpecialSnapshot = NonNullable<ReturnType<PikachuSpecialRuntime['snapshot']>>;
export interface PikachuSpecialBodyClock {
  readonly sheet: string;
  readonly phase: 'call' | 'self-hit' | 'start' | 'hold' | 'ready' | 'release' | 'hit' | 'first' | 'second' | 'end';
  /** Status-local gameplay clock; distinct from the native motion clock. */
  readonly localFrame: number;
  /** Sampled native motion coordinate, including fractional playback. */
  readonly nativeFrame: number;
  readonly nativeEndExclusive: number;
}

/** Source-clock selection only. This does not qualify unavailable artwork.
 * The consumer must select an actually accepted sample window for this sheet.
 * Source contracts: sources/special-body-runtime-clock-contract.json. */
export function resolvePikachuSpecialBodyClock(s: PikachuSpecialSnapshot): PikachuSpecialBodyClock {
  const air = !s.grounded;
  const clock = (sheet: string, phase: PikachuSpecialBodyClock['phase'], localFrame: number,
    nativeFrame = localFrame, nativeEndExclusive = Number.POSITIVE_INFINITY): PikachuSpecialBodyClock =>
    ({ sheet, phase, localFrame, nativeFrame, nativeEndExclusive });
  switch (s.kind) {
    case 'thunder': {
      if (s.branchFrame !== null) return clock(s.bornGrounded ? 'down_special_hit' : 'down_special_air_hit',
        'self-hit', s.frame - s.branchFrame, undefined, s.bornGrounded ? 41 : 35);
      return clock(air ? 'down_special_air' : 'down_special', 'call', s.frame, undefined, 86);
    }
    case 'thunderJolt':
      return clock(air ? 'neutral_special_air' : 'neutral_special', 'call', s.frame,
        s.frame <= 18 ? s.frame : 18 + (s.frame - 18) / 0.77, 60);
    case 'quickAttack': {
      if (s.frame < 14) return clock(air ? 'up_special_air_start' : 'up_special_start', 'start', s.frame, undefined, 14);
      if (s.frame < s.firstBurstEnd) return clock('up_special', 'first', s.frame - 14, undefined, 5);
      if (s.second && s.frame >= s.secondBurstStart && s.frame < s.secondBurstEnd)
        return clock('up_special', 'second', s.frame - s.secondBurstStart, undefined, 5);
      const anchor = s.second && s.frame >= s.secondBurstEnd ? s.secondBurstEnd : s.firstBurstEnd;
      const endAir = !(s.quickEndGrounded ?? s.grounded);
      return clock(endAir ? 'up_special_air_end' : 'up_special_end', 'end', s.frame - anchor, undefined, endAir ? 50 : 33);
    }
    case 'skullBash': {
      if (s.hit && s.branchFrame !== null) return clock(air ? 'side_special_air_hit' : 'side_special_hit',
        'hit', s.frame - s.branchFrame, undefined, 22);
      if (s.frame < 13) return clock(air ? 'side_special_air_start' : 'side_special_start', 'start', s.frame, undefined, 13);
      if (s.holding) {
        const local = Math.max(0, s.heldFrames - 1);
        return clock(air ? 'side_special_air_hold' : 'side_special_hold', 'hold', local, local % 6, 6);
      }
      if (s.normalizedFrame < 13) return clock(air ? 'side_special_air_ready' : 'side_special_ready',
        'ready', s.frame - 13 - s.heldFrames, undefined, s.releaseDelay);
      if (s.normalizedFrame <= 51) return clock('side_special', 'release', s.normalizedFrame - 13,
        s.normalizedFrame - 12, 40);
      return clock(air ? 'side_special_air_miss_end' : 'side_special_end', 'end', s.normalizedFrame - 52,
        undefined, air ? 22 : 44);
    }
  }
}
