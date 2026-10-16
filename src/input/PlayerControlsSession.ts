import type { ParticipantInputDevice, PlayerSlot } from '../types';
import { LOGICAL_ACTIONS, type InputBinding, type LogicalAction, type PlayerBindingsIndex } from '../types/inputBindings';
import { participantInputDevice } from '../match/matchParticipants';
import { captureBindingsForAction } from '../ui/bindingCapture';
import { detectIntraPlayerConflicts, formatConflictEntryPrompt, groupConflictsForBanner } from '../ui/bindingConflicts';
import { InputBindingsStore } from './InputBindingsStore';
import { InputProfileStore, profileBindings, type InputProfile, type ProfileSaveResult } from './InputProfileStore';

export interface PlayerControlsSaveOptions {
  readonly copy?: boolean;
  /** Optional name for a new copy; an ordinary save preserves the selected name. */
  readonly name?: string;
  readonly sharedProfileIds?: ReadonlyArray<string>;
}

/** An isolated human player's draft. Discarding the session cancels its edits. */
export class PlayerControlsSession {
  readonly index: PlayerBindingsIndex;
  readonly device: Exclude<ParticipantInputDevice, { kind: 'ai' }>;
  readonly bindings = new InputBindingsStore();
  private selected: InputProfile;

  constructor(private readonly profiles: InputProfileStore, player: PlayerSlot) {
    const device = participantInputDevice(player);
    if (player.inputType === 'ai' || device.kind === 'ai') {
      throw new Error('Only a human player can edit controls.');
    }
    if (device.kind === 'gamepad' && (!Number.isInteger(device.gamepadIndex) || device.gamepadIndex < 0)) {
      throw new Error('Choose a connected controller before editing controls.');
    }
    this.index = player.index;
    this.device = Object.freeze({ ...device });
    const saved = player.bindingProfileId ? profiles.get(player.bindingProfileId) : undefined;
    this.selected = saved?.deviceKind === device.kind ? saved : profiles.defaultForDevice(device);
    this.loadDraft(this.selected);
  }

  get profileId(): string { return this.selected.id; }
  get profileName(): string { return this.selected.name; }

  profileOptions(): ReadonlyArray<{ id: string; name: string }> {
    return this.profiles.list(this.device.kind).map(({ id, name }) => ({ id, name }));
  }

  selectProfile(id: string): void {
    const profile = this.profiles.get(id);
    if (!profile || profile.deviceKind !== this.device.kind) return;
    this.selected = profile;
    this.loadDraft(profile);
  }

  cycleProfile(direction: 1 | -1): void {
    const options = this.profileOptions();
    const current = options.findIndex(profile => profile.id === this.profileId);
    const next = options[(current + direction + options.length) % options.length];
    if (next) this.selectProfile(next.id);
  }

  setBinding(action: LogicalAction, binding: InputBinding): void {
    if (!LOGICAL_ACTIONS.includes(action)) throw new Error('Choose an existing action to rebind.');
    // A stick push on the Smash row expands to the whole stick; each entry
    // must still come from this player's device.
    const bindings = captureBindingsForAction(action, binding);
    for (const entry of bindings) this.assertOwnedBinding(entry);
    this.bindings.setAction(this.index, action, bindings);
  }

  /** Restore the selected profile's base mapping without changing saved data. */
  reset(): void {
    this.loadDraft(this.profiles.get(this.selected.baseId)!);
  }

  save(options: PlayerControlsSaveOptions = {}): ProfileSaveResult {
    const draft = this.bindings.get(this.index);
    // The public draft store is also usable by views; do not silently normalize
    // foreign-device edits away when converting the draft to a reusable profile.
    try {
      for (const action of LOGICAL_ACTIONS) for (const binding of (draft.bindings[action] ?? [])) {
        this.assertOwnedBinding(binding);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Use this player’s input device.' };
    }
    const conflicts = detectIntraPlayerConflicts(draft);
    if (conflicts.length) {
      // A whole stick clashing on several half-axes reads as one conflict.
      const first = groupConflictsForBanner(conflicts)[0]!;
      return { ok: false, error: `Controls were not saved. ${formatConflictEntryPrompt(first).trim()}` };
    }
    const normalized = profileBindings(draft.bindings, this.device.kind);
    const changed = JSON.stringify(normalized) !== JSON.stringify(this.selected.bindings);
    if (!changed && !options.copy) {
      // Selection of an existing mapping works even when storage is unavailable.
      return { ok: true, profileId: this.profileId, name: this.profileName };
    }
    const copy = options.copy || this.selected.builtin || options.sharedProfileIds?.includes(this.profileId);
    const result = copy
      ? this.profiles.create(this.profileId, normalized, options.name)
      : this.profiles.save(this.profileId, normalized);
    if (result.ok) this.selectProfile(result.profileId);
    return result;
  }

  private loadDraft(profile: InputProfile): void {
    this.bindings.set(this.index, { playerIndex: this.index,
      bindings: profileBindings(profile.bindings, profile.deviceKind,
        this.device.kind === 'gamepad' ? this.device.gamepadIndex : null) });
  }

  private assertOwnedBinding(binding: InputBinding): void {
    if (binding.kind !== this.device.kind) {
      throw new Error(`Use PLAYER ${this.index}’s ${this.device.kind === 'gamepad' ? 'controller' : 'keyboard'} to rebind this action.`);
    }
    if (binding.kind === 'gamepad' && this.device.kind === 'gamepad'
      && binding.gamepadIndex !== this.device.gamepadIndex) {
      throw new Error(`Use PLAYER ${this.index}’s controller to rebind this action.`);
    }
  }
}
