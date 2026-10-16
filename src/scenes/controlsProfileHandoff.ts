import type { ControlsProfileSelection } from '../input/ControlsProfileSession';
import type { HandCursorState } from './handCursorState';

export { applyControlsProfiles, type ControlsProfileSelection } from '../input/ControlsProfileSession';

export function applyControlsProfilesToRoster(
  state: HandCursorState, selections: ReadonlyArray<ControlsProfileSelection>,
): HandCursorState {
  return { slots: state.slots.map(slot => {
    const selection = selections.find(value => value.index === slot.index);
    return selection && slot.mode === 'human'
      ? { ...slot, bindingProfileId: selection.bindingProfileId } : slot;
  }) };
}
