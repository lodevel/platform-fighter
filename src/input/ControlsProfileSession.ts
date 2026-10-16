import type { ParticipantInputDevice, PlayerSlot } from '../types';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import { InputBindingsStore } from './InputBindingsStore';
import { InputProfileStore, profileBindings, type ProfileSaveResult } from './InputProfileStore';
import type { RebindingDeviceOption } from '../ui/rebindingScreenFormat';
import { participantInputDevice } from '../match/matchParticipants';

export interface ControlsProfileSelection {
  readonly index: PlayerBindingsIndex;
  readonly bindingProfileId: string;
}
const SLOTS = [1, 2, 3, 4] as const;

/** A profile editor owns drafts; it cannot reassign a player's hardware. */
export class ControlsProfileSession {
  readonly bindings = new InputBindingsStore();
  private readonly devices = new Map<PlayerBindingsIndex, ParticipantInputDevice>();
  private readonly selected = new Map<PlayerBindingsIndex, string>();
  private readonly active: ReadonlySet<PlayerBindingsIndex>;

  constructor(private readonly profiles: InputProfileStore, _legacy: InputBindingsStore, players?: ReadonlyArray<PlayerSlot>) {
    this.active = new Set(players?.filter(player => player.inputType !== 'ai').map(player => player.index) ?? []);
    for (const index of SLOTS) {
      const player = players?.find(candidate => candidate.index === index);
      const device = player && player.inputType !== 'ai' ? participantInputDevice(player)
        : index <= 2 ? { kind: 'keyboard' as const, layout: index === 1 ? 'keyboard_p1' as const : 'keyboard_p2' as const }
          : { kind: 'gamepad' as const, gamepadIndex: index - 3 };
      this.devices.set(index, device);
      const saved = player?.bindingProfileId ? profiles.get(player.bindingProfileId) : undefined;
      const profile = saved?.deviceKind === device.kind ? saved : profiles.defaultForDevice(device);
      this.selectProfile(index, profile.id);
    }
  }

  profileId(index: PlayerBindingsIndex): string { return this.selected.get(index)!; }
  profileName(index: PlayerBindingsIndex): string { return this.profiles.get(this.profileId(index))!.name; }
  deviceFor(index: PlayerBindingsIndex): RebindingDeviceOption {
    const device = this.devices.get(index)!;
    return device.kind === 'keyboard' ? device.layout
      : device.kind === 'gamepad' ? `gamepad_${device.gamepadIndex}` : 'none';
  }
  profileOptions(index: PlayerBindingsIndex): ReadonlyArray<{ id: string; name: string }> {
    const device = this.devices.get(index)!;
    return this.profiles.list(device.kind === 'ai' ? undefined : device.kind).map(({ id, name }) => ({ id, name }));
  }

  selectProfile(index: PlayerBindingsIndex, id: string): void {
    const device = this.devices.get(index)!;
    const profile = this.profiles.get(id);
    if (!profile || profile.deviceKind !== device.kind) return;
    this.selected.set(index, id);
    this.bindings.set(index, { playerIndex: index,
      bindings: profileBindings(profile.bindings, profile.deviceKind, device.kind === 'gamepad' ? device.gamepadIndex : null) });
  }

  private accept(index: PlayerBindingsIndex, result: ProfileSaveResult): ProfileSaveResult {
    if (result.ok) {
      this.selectProfile(index, result.profileId);
      for (const other of SLOTS) if (other !== index && this.profileId(other) === result.profileId) {
        this.selectProfile(other, result.profileId);
      }
    }
    return result;
  }

  createProfile(index: PlayerBindingsIndex, name?: string): ProfileSaveResult {
    return this.accept(index, this.profiles.create(this.profileId(index), this.bindings.get(index).bindings, name));
  }
  renameProfile(index: PlayerBindingsIndex, name: string): ProfileSaveResult {
    return this.accept(index, this.profiles.rename(this.profileId(index), name));
  }
  saveProfile(index: PlayerBindingsIndex): ProfileSaveResult {
    return this.accept(index, this.profiles.save(this.profileId(index), this.bindings.get(index).bindings));
  }
  resetProfile(index: PlayerBindingsIndex): void {
    const selected = this.profiles.get(this.profileId(index))!;
    const base = this.profiles.get(selected.baseId)!;
    const device = this.devices.get(index)!;
    this.bindings.set(index, { playerIndex: index,
      bindings: profileBindings(base.bindings, base.deviceKind, device.kind === 'gamepad' ? device.gamepadIndex : null) });
  }
  snapshot(): ReadonlyArray<ControlsProfileSelection> {
    return [...this.selected].filter(([index]) => this.active.has(index))
      .map(([index, bindingProfileId]) => ({ index, bindingProfileId }));
  }
}

export function applyControlsProfiles(players: ReadonlyArray<PlayerSlot>, selections: ReadonlyArray<ControlsProfileSelection>): ReadonlyArray<PlayerSlot> {
  return players.map(player => {
    const selection = selections.find(value => value.index === player.index);
    return selection && player.inputType !== 'ai' ? { ...player, bindingProfileId: selection.bindingProfileId } : player;
  });
}
