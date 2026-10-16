/** DK-only press/wind/fire controls. No shared charge behavior is replaced.
 * Source/input clocks: completion-2026-10-08/mechanics/giant-punch-input-contract.json.
 * UFD selects 7 entry / 4 ordinary cancel; the 110-frame full charge is SmashWiki's
 * ("Total charge time 110 frames (6.0.0 onward)"; UFD lists 111). Native motion-list
 * aerial jump cancel_frame6 supplies five selected cancel steps.
 * Controller buffering/tie priority are explicit project adapters: no entry
 * buffer; fire > jump > guard > roll. State is plain replayable data.
 */
export type DonkeyKongPunchExit = 'idle' | 'shield' | 'roll-forward' | 'roll-back'
  | 'ground-jump' | 'air-jump' | 'air-dodge' | 'landing';
type CancelIntent = 'ground-shield' | 'ground-jump' | 'air-jump' | 'air-dodge'
  | 'roll-forward' | 'roll-back';

export interface DonkeyKongPunchState {
  readonly phase: 'start' | 'loop' | 'cancel' | 'end';
  readonly phaseAge: number;
  readonly chargeFrames: number;
  readonly cancelIntent: CancelIntent | null;
}

export interface DonkeyKongPunchClocks {
  readonly entryFrames: number;
  readonly maxChargeFrames: number;
  readonly cancelFrames: number;
  readonly airJumpCancelFrames: number;
  readonly fullBankEndFrames: number;
}

export const DONKEYKONG_PUNCH_CLOCKS: DonkeyKongPunchClocks = Object.freeze({
  entryFrames: 7, maxChargeFrames: 110, cancelFrames: 4,
  airJumpCancelFrames: 5, fullBankEndFrames: 4,
});

export type DonkeyKongPunchCommand = {
  readonly kind: 'fire'; readonly chargeFrames: number; readonly full: boolean;
} | { readonly kind: 'bank'; readonly chargeFrames: number; readonly exit: DonkeyKongPunchExit };

export interface DonkeyKongPunchTransition {
  readonly state: DonkeyKongPunchState | null;
  readonly command: DonkeyKongPunchCommand | null;
}

export interface DonkeyKongPunchObservation {
  readonly specialPressed: boolean;
  readonly shieldPressed: boolean;
  readonly shieldHeld: boolean;
  readonly dodgePressed: boolean;
  readonly jumpPressed: boolean;
  /** Relative to the entry facing; normalized by the input consumer. */
  readonly rollDirection: -1 | 0 | 1;
  readonly grounded: boolean;
  readonly canAirJump: boolean;
  readonly canAirDodge: boolean;
  readonly frozen?: boolean;
}

function validateClocks(clocks: DonkeyKongPunchClocks): void {
  for (const value of Object.values(clocks)) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError('Punch phase clocks must be positive integers');
  }
}

/** Called for an actionable fresh neutral special. Partial banks resume;
 * a full bank fires directly without a new charging-entry animation. */
export function beginDonkeyKongPunch(bankFrames = 0,
  clocks: DonkeyKongPunchClocks = DONKEYKONG_PUNCH_CLOCKS): DonkeyKongPunchTransition {
  validateClocks(clocks);
  if (!Number.isInteger(bankFrames) || bankFrames < 0) throw new RangeError('Punch bank must be a nonnegative integer');
  const chargeFrames = Math.min(bankFrames, clocks.maxChargeFrames);
  return chargeFrames === clocks.maxChargeFrames
    ? { state: null, command: { kind: 'fire', chargeFrames, full: true } }
    : { state: { phase: 'start', phaseAge: 0, chargeFrames, cancelIntent: null }, command: null };
}

function finishBank(state: DonkeyKongPunchState, exit: DonkeyKongPunchExit): DonkeyKongPunchTransition {
  return { state: null, command: { kind: 'bank', chargeFrames: state.chargeFrames, exit } };
}

/** One tick per unfrozen gameplay step, after entry creation. Caller owns
 * the start-frame convention, resource consumption, action/pose clocks,
 * kinetic state, damage/capture interruption and stock reset. */
export function tickDonkeyKongPunch(state: DonkeyKongPunchState,
  input: DonkeyKongPunchObservation,
  clocks: DonkeyKongPunchClocks = DONKEYKONG_PUNCH_CLOCKS): DonkeyKongPunchTransition {
  validateClocks(clocks);
  if (input.frozen) return { state, command: null };
  const phaseAge = state.phaseAge + 1;
  if (state.phase === 'start') {
    return { state: phaseAge >= clocks.entryFrames
      ? { ...state, phase: 'loop', phaseAge: 0 } : { ...state, phaseAge }, command: null };
  }
  if (state.phase === 'end') {
    return phaseAge >= clocks.fullBankEndFrames ? finishBank(state, 'idle')
      : { state: { ...state, phaseAge }, command: null };
  }
  if (state.phase === 'cancel') {
    const intent = state.cancelIntent!;
    if (input.grounded && (intent === 'air-jump' || intent === 'air-dodge')) return finishBank(state, 'landing');
    const duration = intent === 'air-jump' ? clocks.airJumpCancelFrames : clocks.cancelFrames;
    if (phaseAge < duration) return { state: { ...state, phaseAge }, command: null };
    let exit: DonkeyKongPunchExit = 'idle';
    if (intent === 'ground-shield') exit = input.grounded && input.shieldHeld ? 'shield' : 'idle';
    else if (intent === 'ground-jump') exit = input.grounded ? 'ground-jump' : 'idle';
    else if (intent === 'air-jump') exit = input.canAirJump ? 'air-jump' : 'idle';
    else if (intent === 'air-dodge') exit = input.canAirDodge ? 'air-dodge' : 'idle';
    else if (input.grounded) exit = intent;
    return finishBank(state, exit);
  }

  // Held or released special has no effect: only another fresh press fires.
  if (input.specialPressed) return { state: null,
    command: { kind: 'fire', chargeFrames: state.chargeFrames,
      full: state.chargeFrames >= clocks.maxChargeFrames } };
  let cancelIntent: CancelIntent | null = null;
  if (input.jumpPressed && (input.grounded || input.canAirJump)) {
    cancelIntent = input.grounded ? 'ground-jump' : 'air-jump';
  } else if (input.shieldPressed || input.dodgePressed) {
    if (input.grounded) cancelIntent = input.rollDirection === 0 ? 'ground-shield'
      : input.rollDirection > 0 ? 'roll-forward' : 'roll-back';
    else if (input.canAirDodge) cancelIntent = 'air-dodge';
  } else if (input.grounded && input.rollDirection !== 0) {
    cancelIntent = input.rollDirection > 0 ? 'roll-forward' : 'roll-back';
  }
  // The selecting cancel tick is the first of the selected four/five steps.
  if (cancelIntent) return { state: { ...state, phase: 'cancel', phaseAge: 1, cancelIntent }, command: null };
  const chargeFrames = Math.min(clocks.maxChargeFrames, state.chargeFrames + 1);
  return { state: { ...state, chargeFrames, phaseAge: chargeFrames === clocks.maxChargeFrames ? 0 : phaseAge,
    phase: chargeFrames === clocks.maxChargeFrames ? 'end' : 'loop' }, command: null };
}
