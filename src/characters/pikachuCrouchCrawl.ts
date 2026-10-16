/** Source-guided crouch/crawl presentation and transport. Native Trans delta is a measured
 * motion transport, not a common-status rate/eligibility/commitment assertion.
 * Caller owns action state entry, clock freezing, interruptions and exit.
 * Authored beta phase: one native frame per fixed step,5px/native unit.
 * motion-list.yml squat_f/b: loop=true, move=true, turn=false. */
export const PIKACHU_CRAWL_NATIVE_TRANS_Z = {"crawl":[0.0,0.6296693682670593,1.259329080581665,1.8889985084533691,2.5186679363250732,3.148327589035034,3.7779970169067383,4.407666206359863,5.037326335906982,5.666995525360107,6.296674728393555,6.92634391784668,7.556003570556641,8.185672760009766,8.81534194946289,9.445002555847168,10.074700355529785],"crawl_back":[0.0,-0.44499534368515015,-0.8899999856948853,-1.3350046873092651,-1.7799999713897705,-2.2249953746795654,-2.6700000762939453,-3.115004539489746,-3.559999942779541,-4.0050048828125,-4.449999809265137,-4.894995212554932,-5.340000152587891,-5.784995079040527,-6.230000019073486,-6.675004482269287,-7.119999885559082,-7.565004825592041,-8.010000228881836,-8.454995155334473,-8.899999618530273,-9.34500503540039,-9.789999961853027]} as const;
const drawingSamples = { crawl: [0,4,8,12,16], crawl_back: [0,6,11,17,22] } as const;
export type PikachuCrawlSheet = keyof typeof PIKACHU_CRAWL_NATIVE_TRANS_Z;

export function pikachuCrawlMotion(sheet: PikachuCrawlSheet, age: number, facing: 1 | -1) {
  if (!Number.isInteger(age) || age < 0) return null;
  const trans = PIKACHU_CRAWL_NATIVE_TRANS_Z[sheet], loopFrames = trans.length - 1;
  const phase = age % loopFrames;
  const samples = drawingSamples[sheet];
  let artFrameIndex = samples.length - 2; // endpoint retained in art, excluded from looping playback
  while (artFrameIndex > 0 && phase < samples[artFrameIndex]!) artFrameIndex -= 1;
  return { sheet, phase, loopFrames, artFrameIndex,
    velocityX: (trans[phase + 1]! - trans[phase]!) * 5 * facing };
}

/** Body/receiving must share the same source-native phase. These primary
 * cancel metadata values do not supply unknown common status gates/rates.
 * Returned last drawing holds until caller's explicitly authored phase exit. */
export function pikachuCrouchTransitionDrawing(kind: 'start' | 'end', age: number) {
  if (!Number.isInteger(age) || age < 0) return null;
  const sheet = kind === 'start' ? 'crouch_start' : 'crouch_end';
  const finalNativeSample = kind === 'start' ? 14 : 15;
  const localFrame = Math.min(age, finalNativeSample);
  return { sheet, localFrame, artFrameIndex: localFrame < 7 ? 0 : localFrame < finalNativeSample ? 1 : 2,
    nativeCancelMotionFrame: 7, nativeFinalFrameIndex: finalNativeSample };
}

export type PikachuCrouchCrawlPhase = 'start' | 'hold' | 'end' | 'crawl' | 'crawl_back';
export interface PikachuCrouchCrawlState {
  readonly phase: PikachuCrouchCrawlPhase;
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
}
export interface PikachuCrouchCrawlInput {
  readonly down: boolean;
  readonly moveX: number;
  readonly facing: 1 | -1;
  readonly grounded: boolean;
  /** False for damage, capture, commitments, death or a newly entered action. */
  readonly eligible: boolean;
  /** False during hitlag/pause. Eligibility interruptions still clear state. */
  readonly advance?: boolean;
}
export const PIKACHU_CROUCH_BETA_TRANSITION_FRAMES = 7;

/** Explicit beta status uses source cancel7 as chosen transition duration;
 * source native14/15 endpoints remain drawing evidence, not invented locks.
 * Caller defines the down/horizontal intent thresholds and action priorities.
 * Crawl chooses direction relative to latched body facing and never turns it. */
export function tickPikachuCrouchCrawl(state: PikachuCrouchCrawlState | null,
  input: PikachuCrouchCrawlInput): PikachuCrouchCrawlState | null {
  if (!input.eligible || !input.grounded) return null;
  if (input.advance === false) return state;
  const enter = (phase: PikachuCrouchCrawlPhase, facing = state?.facing ?? input.facing) =>
    ({ phase, facing, framesElapsed: 0 });
  if (!state) return input.down ? enter('start', input.facing) : null;
  // Ordinary release waits for the chosen source-cancel boundary. Priority
  // interruptions above still clear immediately; no release-input buffer is
  // needed because the current intent is resolved at the boundary.
  if (state.phase === 'start' && state.framesElapsed + 1 < PIKACHU_CROUCH_BETA_TRANSITION_FRAMES)
    return { ...state, framesElapsed: state.framesElapsed + 1 };
  if (!input.down) {
    if (state.phase !== 'end') return enter('end');
    return state.framesElapsed + 1 < PIKACHU_CROUCH_BETA_TRANSITION_FRAMES
      ? { ...state, framesElapsed: state.framesElapsed + 1 } : null;
  }
  if (state.phase === 'end') return enter('start', input.facing);
  const relative = input.moveX * state.facing;
  const phase: PikachuCrouchCrawlPhase = relative > 0 ? 'crawl' : relative < 0 ? 'crawl_back' : 'hold';
  return phase === state.phase ? { ...state, framesElapsed: state.framesElapsed + 1 } : enter(phase);
}

export function pikachuCrouchCrawlDrawing(state: PikachuCrouchCrawlState) {
  if (state.phase === 'crawl' || state.phase === 'crawl_back') {
    const motion = pikachuCrawlMotion(state.phase, state.framesElapsed, state.facing);
    return motion && { ...motion, localFrame: motion.phase, facing: state.facing };
  }
  if (state.phase === 'start' || state.phase === 'end') {
    const drawing = pikachuCrouchTransitionDrawing(state.phase, state.framesElapsed);
    return drawing && { ...drawing, facing: state.facing, velocityX: 0 };
  }
  // Native squat_wait is nonloop. Preserve its final accepted drawing rather
  // than inventing a60-step wrap. The actor may hold this phase indefinitely.
  const localFrame = Math.min(59, state.framesElapsed);
  return { sheet: 'crouch' as const, localFrame,
    artFrameIndex: localFrame < 15 ? 0 : localFrame < 30 ? 1 : localFrame < 45 ? 2 : localFrame < 59 ? 3 : 4,
    facing: state.facing, velocityX: 0 };
}
export function pikachuCrouchCrawlVelocity(state: PikachuCrouchCrawlState | null) {
  if (!state || state.phase !== 'crawl' && state.phase !== 'crawl_back') return null;
  return pikachuCrawlMotion(state.phase, state.framesElapsed, state.facing)?.velocityX ?? null;
}
