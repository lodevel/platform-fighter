import type { ControlsDeviceAssignment } from '../input/ControlsDeviceSession';
import type { HandCursorState } from './handCursorState';

/** Preserve fighter choices while returning Controls ownership to the roster. */
export function applyControlsToRoster(state: HandCursorState, pads: ReadonlyArray<readonly [number, 1 | 2 | 3 | 4]>, assignments: ReadonlyArray<ControlsDeviceAssignment>): {
  state: HandCursorState; pads: Array<readonly [number, 1 | 2 | 3 | 4]>;
} {
  const nextPads = new Map(pads);
  const slots = state.slots.map(slot => {
    const device = assignments.find(assignment => assignment.index === slot.index)?.inputDevice;
    if (!device || slot.mode !== 'human' || device.kind === 'ai') return slot;
    for (const [pad, owner] of nextPads) if (owner === slot.index) nextPads.delete(pad);
    return { ...slot, inputType: device.kind === 'keyboard' ? device.layout : 'gamepad' as const,
      bindingProfileIndex: slot.index };
  });
  for (const { index, inputDevice } of assignments) {
    if (inputDevice.kind === 'gamepad' && slots.find(slot => slot.index === index)?.mode === 'human') {
      nextPads.set(inputDevice.gamepadIndex, index);
    }
  }
  return { state: { slots }, pads: [...nextPads] };
}
