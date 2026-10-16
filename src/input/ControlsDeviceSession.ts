import type { ParticipantInputDevice, PlayerSlot } from '../types';
import { LOGICAL_ACTIONS, type ActionBindings, type PlayerBindingsIndex } from '../types/inputBindings';
import { InputBindingsStore, buildDefaultGamepadBindings, DEFAULT_KEYBOARD_P1_BINDINGS, DEFAULT_KEYBOARD_P2_BINDINGS } from './InputBindingsStore';
import { buildMatchParticipants } from '../match/matchParticipants';
import { inferDeviceOption, type RebindingDeviceOption } from '../ui/rebindingScreenFormat';

export interface ControlsDeviceAssignment {
  readonly index: PlayerBindingsIndex;
  readonly inputDevice: ParticipantInputDevice;
}

const SLOTS = [1, 2, 3, 4] as const;

export function controlsDeviceOption(device: ParticipantInputDevice): RebindingDeviceOption {
  return device.kind === 'keyboard' ? device.layout : device.kind === 'gamepad'
    ? `gamepad_${device.gamepadIndex}` as RebindingDeviceOption : 'none';
}

function deviceForOption(option: RebindingDeviceOption): ParticipantInputDevice | undefined {
  if (option === 'none') return undefined;
  return option.startsWith('gamepad_')
    ? { kind: 'gamepad', gamepadIndex: Number(option.slice(8)) }
    : { kind: 'keyboard', layout: option as 'keyboard_p1' | 'keyboard_p2' };
}

/** Keeps the Controls player columns aligned with the actual lobby slots. */
export class ControlsDeviceSession {
  private readonly devices = new Map<PlayerBindingsIndex, ParticipantInputDevice>();
  private readonly active: ReadonlySet<PlayerBindingsIndex>;

  constructor(private readonly store: InputBindingsStore, players?: ReadonlyArray<PlayerSlot>) {
    this.active = new Set(players ? players.filter(player => player.inputType !== 'ai').map(player => player.index) : SLOTS);
    for (const index of SLOTS) {
      const device = deviceForOption(inferDeviceOption(store.get(index)));
      if (device) this.devices.set(index, device);
    }
    // Resolve every source before writing: two players may use each other's
    // saved profile, and overwriting the first must not erase the second.
    if (players?.length) {
      const participants = buildMatchParticipants(players, store);
      for (const participant of participants) {
        if (!participant.bindings) continue;
        const { index, inputDevice } = participant.slot;
        this.devices.set(index, inputDevice!);
        store.set(index, { ...participant.bindings, playerIndex: index });
      }
    }
  }

  deviceFor(index: PlayerBindingsIndex): RebindingDeviceOption {
    const device = this.devices.get(index);
    return device ? controlsDeviceOption(device) : 'none';
  }

  assign(index: PlayerBindingsIndex, option: RebindingDeviceOption): void {
    const next = deviceForOption(option);
    if (!next) return;
    const previous = this.devices.get(index);
    const owner = [...this.devices].find(([other, device]) => other !== index
      && this.active.has(other) && controlsDeviceOption(device) === option);
    // Preserve the known physical-pad identity when reselecting or exchanging
    // an existing assignment; the option string only carries its numeric index.
    const selected = previous && controlsDeviceOption(previous) === option
      ? previous : owner?.[1] ?? next;
    // A physical controller / keyboard half has exactly one active owner.
    // Selecting an occupied device exchanges assignments with that player.
    if (owner && previous && this.active.has(index)) this.retarget(owner[0], previous);
    this.retarget(index, selected);
  }

  /** The screen may already have reset this profile before notifying us. */
  resetDevice(index: PlayerBindingsIndex): void {
    const next = deviceForOption(inferDeviceOption(this.store.getDefault(index)));
    if (!next) return;
    const previous = this.devices.get(index);
    const option = controlsDeviceOption(next);
    const owner = [...this.devices].find(([other, device]) => other !== index
      && this.active.has(other) && controlsDeviceOption(device) === option);
    const selected = previous && controlsDeviceOption(previous) === option
      ? previous : owner?.[1] ?? next;
    if (owner && previous && this.active.has(index)) this.retarget(owner[0], previous);
    this.store.reset(index);
    this.devices.set(index, selected);
  }

  /** Reset ownership together; sequential swaps would read already-reset profiles. */
  resetAllDevices(): void {
    const previous = [...this.devices.values()];
    this.store.resetAll();
    this.devices.clear();
    for (const index of SLOTS) {
      const device = deviceForOption(inferDeviceOption(this.store.get(index)));
      if (!device) continue;
      const known = previous.find(value => controlsDeviceOption(value) === controlsDeviceOption(device));
      this.devices.set(index, known ?? device);
    }
  }

  private retarget(index: PlayerBindingsIndex, device: ParticipantInputDevice): void {
    if (device.kind === 'ai') return;
    const current = this.store.get(index).bindings;
    const previous = this.devices.get(index);
    const sameFamily = previous?.kind === device.kind;
    const defaults = device.kind === 'gamepad' ? buildDefaultGamepadBindings(device.gamepadIndex)
      : device.layout === 'keyboard_p1' ? DEFAULT_KEYBOARD_P1_BINDINGS : DEFAULT_KEYBOARD_P2_BINDINGS;
    const preserve = sameFamily && (device.kind === 'gamepad' || controlsDeviceOption(previous!) === controlsDeviceOption(device));
    const bindings = preserve ? Object.fromEntries(LOGICAL_ACTIONS.map(action => [action,
      (current[action] ?? []).filter(binding => binding.kind === device.kind).map(binding =>
        binding.kind === 'gamepad' && device.kind === 'gamepad'
          ? { ...binding, gamepadIndex: device.gamepadIndex } : binding),
    ])) as unknown as ActionBindings : defaults;
    this.store.set(index, { playerIndex: index, bindings });
    this.devices.set(index, device);
  }

  snapshot(): ReadonlyArray<ControlsDeviceAssignment> {
    return [...this.devices].filter(([index]) => this.active.has(index))
      .map(([index, inputDevice]) => ({ index, inputDevice }));
  }
}

export function applyControlsDevices(
  players: ReadonlyArray<PlayerSlot>, assignments: ReadonlyArray<ControlsDeviceAssignment>,
): ReadonlyArray<PlayerSlot> {
  return players.map(player => {
    const device = assignments.find(assignment => assignment.index === player.index)?.inputDevice;
    if (!device || player.inputType === 'ai') return player;
    return { ...player, inputDevice: device, bindingProfileIndex: player.index,
      inputType: device.kind === 'keyboard' ? device.layout : device.kind === 'ai' ? 'ai' : 'gamepad' };
  });
}
