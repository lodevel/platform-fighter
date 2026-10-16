import type { ParticipantInputDevice, PlayerSlot } from '../types';
import type { InputProfileStore } from '../input/InputProfileStore';
import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import {
  InputBindingsStore,
  buildDefaultGamepadBindings,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
} from '../input/InputBindingsStore';

export interface MatchParticipant {
  readonly slot: PlayerSlot;
  readonly participantId: string;
  readonly runtimePlayerIndex: 0 | 1 | 2 | 3;
  readonly bindings: PlayerBindings | null;
}

export function participantInputDevice(slot: PlayerSlot, store?: InputBindingsStore): ParticipantInputDevice {
  if (slot.inputDevice) return slot.inputDevice;
  if (slot.inputType === 'ai') return { kind: 'ai' };
  // Old sessions predate physical ownership. Respect a device changed in Controls,
  // while ordinary untouched defaults must not turn a sparse keyboard slot into a pad.
  const profileIndex = slot.bindingProfileIndex ?? slot.index;
  const profile = store?.get(profileIndex);
  if (profile && JSON.stringify(profile) !== JSON.stringify(store?.getDefault(profileIndex))) {
    const bindings = LOGICAL_ACTIONS.flatMap((action) => (profile.bindings[action] ?? []));
    if (bindings.length && bindings.every((binding) => binding.kind === 'gamepad')) {
      const indices = new Set(bindings.map((binding) => binding.kind === 'gamepad' ? binding.gamepadIndex : null));
      if (indices.size === 1) return { kind: 'gamepad', gamepadIndex: [...indices][0] ?? (slot.index - 1) % 2 };
    }
    if (bindings.length && bindings.every((binding) => binding.kind === 'keyboard')) {
      return { kind: 'keyboard', layout: slot.inputType === 'keyboard_p2' ? 'keyboard_p2' : 'keyboard_p1' };
    }
  }
  if (slot.inputType === 'gamepad') {
    // Legacy configurations use the first pad for slots 1/3 and the second for 2/4.
    return { kind: 'gamepad', gamepadIndex: (slot.index - 1) % 2 };
  }
  return { kind: 'keyboard', layout: slot.inputType };
}

/** Prefer an existing profile for this device, so custom mappings survive joining. */
export function bindingProfileForDevice(
  store: InputBindingsStore,
  lobbySlot: PlayerBindingsIndex,
  device: ParticipantInputDevice,
): PlayerBindingsIndex {
  if (device.kind === 'keyboard') return device.layout === 'keyboard_p1' ? 1 : 2;
  if (device.kind === 'ai') return lobbySlot;
  const candidates = [lobbySlot, 1, 2, 3, 4] as const;
  for (const candidate of candidates) {
    const actions = store.get(candidate).bindings;
    if (LOGICAL_ACTIONS.some((action) => (actions[action] ?? []).some(
      (binding) => binding.kind === 'gamepad' && binding.gamepadIndex === device.gamepadIndex,
    ))) return candidate;
  }
  return lobbySlot;
}

/** Resolve sparse lobby entries to contiguous simulation indices without changing identity. */
export function buildMatchParticipants(
  players: ReadonlyArray<PlayerSlot>,
  store: InputBindingsStore,
  profiles?: InputProfileStore,
): ReadonlyArray<MatchParticipant> {
  if (players.length < 1 || players.length > 4) throw new Error('A match requires 1 to 4 participants');
  const slots = new Set<number>();
  const ids = new Set<string>();
  const devices = new Set<string>();
  return players.map((slot, runtimePlayerIndex) => {
    const participantId = slot.participantId ?? `player-${slot.index}`;
    if (slots.has(slot.index) || ids.has(participantId)) throw new Error('Duplicate match participant');
    slots.add(slot.index);
    ids.add(participantId);
    // Named profiles describe controls, never physical ownership. Older callers
    // without the profile library retain their legacy import behavior.
    const device = participantInputDevice(slot, profiles ? undefined : store);
    if (device.kind === 'gamepad' && (!Number.isInteger(device.gamepadIndex) || device.gamepadIndex < 0)) {
      throw new Error('Reconnect each controller before starting the match');
    }
    const profileIndex = slot.bindingProfileIndex ?? (!slot.inputDevice
      && JSON.stringify(store.get(slot.index)) !== JSON.stringify(store.getDefault(slot.index))
      ? slot.index : bindingProfileForDevice(store, slot.index, device));
    let bindings: PlayerBindings | null = null;
    let bindingProfileId = slot.bindingProfileId;
    if (device.kind !== 'ai') {
      const deviceKey = device.kind === 'gamepad' ? `pad:${device.gamepadIndex}` : device.layout;
      if (devices.has(deviceKey)) throw new Error('A physical input device cannot own two fighters');
      devices.add(deviceKey);
      const selectedProfile = bindingProfileId ? profiles?.get(bindingProfileId) : undefined;
      const namedProfile = selectedProfile?.deviceKind === device.kind
        ? selectedProfile : profiles?.defaultForDevice(device);
      if (namedProfile) bindingProfileId = namedProfile.id;
      const preferred = namedProfile?.bindings ?? store.get(profileIndex).bindings;
      const hasDeviceBindings = LOGICAL_ACTIONS.some((action) =>
        (preferred[action] ?? []).some((binding) => binding.kind === device.kind));
      const source = namedProfile || hasDeviceBindings ? preferred : device.kind === 'gamepad'
        ? buildDefaultGamepadBindings(device.gamepadIndex)
        : device.layout === 'keyboard_p1' ? DEFAULT_KEYBOARD_P1_BINDINGS : DEFAULT_KEYBOARD_P2_BINDINGS;
      const actions = Object.fromEntries(LOGICAL_ACTIONS.map((action) => [action,
        (source[action] ?? []).filter((binding) => binding.kind === device.kind).map((binding) =>
          binding.kind === 'gamepad' && device.kind === 'gamepad'
            ? { ...binding, gamepadIndex: device.gamepadIndex }
            : binding),
      ])) as unknown as ActionBindings;
      bindings = { playerIndex: (runtimePlayerIndex + 1) as PlayerBindingsIndex, bindings: actions };
    }
    const resolvedSlot: PlayerSlot = {
      ...slot,
      participantId,
      inputDevice: device,
      bindingProfileIndex: profileIndex,
      ...(bindingProfileId ? { bindingProfileId } : {}),
      inputType: device.kind === 'keyboard' ? device.layout : device.kind === 'ai' ? 'ai' : 'gamepad',
    };
    return { slot: resolvedSlot, participantId, runtimePlayerIndex: runtimePlayerIndex as 0 | 1 | 2 | 3, bindings };
  });
}

/** Keyboard keyCodes bound anywhere in a set, or only on `action` when given. */
function keyboardKeyCodes(bindings: ActionBindings, action?: LogicalAction): Set<number> {
  const codes = new Set<number>();
  for (const name of action ? [action] : LOGICAL_ACTIONS) {
    for (const binding of (bindings[name] ?? [])) if (binding.kind === 'keyboard') codes.add(binding.keyCode);
  }
  return codes;
}

function withoutSmashKey(participant: MatchParticipant, keyCode: number): MatchParticipant {
  const bindings = participant.bindings!;
  return { ...participant, bindings: { ...bindings, bindings: { ...bindings.bindings,
    smash: bindings.bindings.smash.filter((binding) => binding.kind !== 'keyboard' || binding.keyCode !== keyCode),
  } } };
}

/**
 * Keyboard players share one keyboard, so a key two of their layouts bind
 * acts for both players on every press. The smash action can create that
 * on upgrade: P1 on the built-in WASD profile smashes on V while a P2
 * layout saved before smash existed already used V for another action.
 * For each key two keyboard participants share, the smash binding gives
 * way: the key is dropped from the later player's smash, or — when only
 * the earlier player smashes with it — from the earlier player's. Every
 * other action is left exactly as bound, so a clash between two
 * non-smash actions is not touched. Each drop is reported through `warn`.
 * Returns new participants; the inputs are not mutated.
 */
export function dropSharedKeyboardSmashKeys(
  participants: ReadonlyArray<MatchParticipant>,
  warn: (message: string) => void = (message) => console.warn(message),
): ReadonlyArray<MatchParticipant> {
  const result = [...participants];
  const label = (p: MatchParticipant) => `P${p.runtimePlayerIndex + 1}`;
  const keys = (p: MatchParticipant, action?: LogicalAction) =>
    p.bindings ? keyboardKeyCodes(p.bindings.bindings, action) : new Set<number>();
  for (let later = 1; later < result.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      for (const keyCode of keys(result[later]!)) {
        // Each pass removes the key from one smash list, so this ends.
        for (;;) {
          const a = result[earlier]!;
          const b = result[later]!;
          if (!keys(a).has(keyCode) || !keys(b).has(keyCode)) break;
          const target = keys(b, 'smash').has(keyCode) ? later
            : keys(a, 'smash').has(keyCode) ? earlier : null;
          if (target === null) break;
          result[target] = withoutSmashKey(result[target]!, keyCode);
          warn(`Match controls: ${label(a)} and ${label(b)} both bind key code ${keyCode}; `
            + `dropped it from ${label(result[target]!)}'s Smash so one press does not act for both players.`);
        }
      }
    }
  }
  return result;
}

/**
 * Match-local projection. Never overwrite the user's persisted binding
 * profiles. Keyboard keys two players share are dropped from a smash
 * binding here (see {@link dropSharedKeyboardSmashKeys}).
 */
export function createMatchBindingsStore(
  participants: ReadonlyArray<MatchParticipant>,
  warn?: (message: string) => void,
): InputBindingsStore {
  const resolved = dropSharedKeyboardSmashKeys(participants, warn);
  const store = new InputBindingsStore();
  // No controls belong to vacant runtime slots. Disconnect monitoring and
  // reconnect matching inspect the same store and must not see phantom pads.
  for (const playerIndex of [1, 2, 3, 4] as const) {
    store.set(playerIndex, { playerIndex,
      bindings: Object.fromEntries(LOGICAL_ACTIONS.map((action) => [action, []])) as unknown as ActionBindings,
    });
  }
  for (const participant of resolved) {
    const playerIndex = (participant.runtimePlayerIndex + 1) as PlayerBindingsIndex;
    const bindings = participant.bindings ?? {
      playerIndex,
      bindings: Object.fromEntries(LOGICAL_ACTIONS.map((action) => [action, []])) as unknown as ActionBindings,
    };
    store.set(playerIndex, bindings);
  }
  return store;
}
