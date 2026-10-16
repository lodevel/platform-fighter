import type { ParticipantInputDevice } from '../types';
import { LOGICAL_ACTIONS, type ActionBindings, type InputDeviceKind } from '../types/inputBindings';
import { InputBindingsStore, assertValidPlayerBindings, buildDefaultGamepadBindings,
  DEFAULT_KEYBOARD_P1_BINDINGS, DEFAULT_KEYBOARD_P2_BINDINGS } from './InputBindingsStore';
import type { StorageLike } from './BindingsStorage';
import { fillMissingSmash, keyboardHalfForProfileBase } from './smashBindingDefaults';
import { BOOT_REGISTRY_KEYS } from '../scenes/bootKeys';

export interface InputProfile {
  readonly id: string;
  readonly name: string;
  readonly deviceKind: InputDeviceKind;
  readonly bindings: ActionBindings;
  readonly baseId: string;
  readonly builtin: boolean;
}
export type ProfileSaveResult = { readonly ok: true; readonly name: string; readonly profileId: string }
  | { readonly ok: false; readonly error: string };
export const INPUT_PROFILES_STORAGE_KEY = 'platformfighter.inputProfiles.v1';

/** Profiles contain button/key mappings, never ownership of a physical pad. */
export function profileBindings(bindings: ActionBindings, kind: InputDeviceKind, padIndex: number | null = null): ActionBindings {
  return Object.fromEntries(LOGICAL_ACTIONS.map(action => [action,
    (bindings[action] ?? []).filter(binding => binding.kind === kind).map(binding =>
      binding.kind === 'gamepad' ? { ...binding, gamepadIndex: padIndex, source: { ...binding.source } } : { ...binding }),
  ])) as unknown as ActionBindings;
}

function freezeProfile(profile: InputProfile): InputProfile {
  const bindings = profileBindings(profile.bindings, profile.deviceKind);
  for (const action of LOGICAL_ACTIONS) {
    for (const binding of (bindings[action] ?? [])) {
      if (binding.kind === 'gamepad') Object.freeze(binding.source);
      Object.freeze(binding);
    }
    Object.freeze((bindings[action] ?? []));
  }
  return Object.freeze({ ...profile, bindings: Object.freeze(bindings) });
}

const DEFAULT_PROFILES: ReadonlyArray<InputProfile> = [
  { id: 'keyboard-wasd', name: 'Keyboard WASD', deviceKind: 'keyboard', bindings: DEFAULT_KEYBOARD_P1_BINDINGS },
  { id: 'keyboard-arrows', name: 'Keyboard Arrows', deviceKind: 'keyboard', bindings: DEFAULT_KEYBOARD_P2_BINDINGS },
  { id: 'gamepad-standard', name: 'Standard Gamepad', deviceKind: 'gamepad', bindings: buildDefaultGamepadBindings(0) },
].map(profile => freezeProfile({ ...profile, deviceKind: profile.deviceKind as InputDeviceKind, baseId: profile.id, builtin: true }));

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export class InputProfileStore {
  private readonly profiles = new Map<string, InputProfile>(DEFAULT_PROFILES.map(profile => [profile.id, profile]));

  constructor(legacy?: InputBindingsStore, private readonly storage: StorageLike | null = browserStorage()) {
    let loaded = false;
    try {
      const raw = storage?.getItem(INPUT_PROFILES_STORAGE_KEY);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (typeof value === 'object' && value !== null && 'version' in value && value.version === 1
          && 'profiles' in value && Array.isArray(value.profiles)) {
          for (const candidate of value.profiles) {
            try {
              if (!candidate || typeof candidate.id !== 'string' || !candidate.id.startsWith('custom-')
                || typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 28
                || (candidate.deviceKind !== 'keyboard' && candidate.deviceKind !== 'gamepad')) continue;
              const knownBaseId = DEFAULT_PROFILES.find(profile => profile.id === candidate.baseId
                && profile.deviceKind === candidate.deviceKind)?.id;
              const baseId = knownBaseId
                ?? (candidate.deviceKind === 'gamepad' ? 'gamepad-standard' : 'keyboard-wasd');
              // Profiles saved before the `smash` action existed lack it; fill it
              // (only where free) instead of dropping them. The base preset picks
              // the key (WASD → V, Arrows → Numpad 0); without a known base the
              // profile's own keys vote.
              const bindings: unknown = typeof candidate.bindings === 'object' && candidate.bindings !== null
                && !Array.isArray(candidate.bindings)
                ? fillMissingSmash(candidate.bindings, { keyboardHalf: keyboardHalfForProfileBase(knownBaseId) })
                : candidate.bindings;
              assertValidPlayerBindings({ playerIndex: 1, bindings });
              this.profiles.set(candidate.id, freezeProfile({ id: candidate.id, name: candidate.name.trim(),
                deviceKind: candidate.deviceKind, bindings: bindings as ActionBindings, baseId, builtin: false }));
            } catch { /* Keep other valid profiles and the immutable defaults. */ }
          }
          loaded = true;
        }
      }
    } catch { /* A broken/unavailable saved library must not disable input. */ }
    if (!loaded && legacy) this.importLegacy(legacy);
  }

  list(kind?: InputDeviceKind): ReadonlyArray<InputProfile> {
    return [...this.profiles.values()].filter(profile => !kind || profile.deviceKind === kind);
  }

  get(id: string): InputProfile | undefined { return this.profiles.get(id); }

  defaultForDevice(device: ParticipantInputDevice): InputProfile {
    const id = device.kind === 'gamepad' ? 'gamepad-standard'
      : device.kind === 'keyboard' && device.layout === 'keyboard_p2' ? 'keyboard-arrows' : 'keyboard-wasd';
    return this.profiles.get(id)!;
  }

  private importLegacy(legacy: InputBindingsStore): void {
    for (const slot of [1, 2, 3, 4] as const) {
      const saved = legacy.get(slot).bindings;
      if (JSON.stringify(saved) === JSON.stringify(legacy.getDefault(slot).bindings)) continue;
      for (const kind of ['keyboard', 'gamepad'] as const) {
        if (!LOGICAL_ACTIONS.some(action => (saved[action] ?? []).some(binding => binding.kind === kind))) continue;
        const bindings = profileBindings(saved, kind);
        const baseId = kind === 'gamepad' ? 'gamepad-standard'
          : slot === 2 ? 'keyboard-arrows' : 'keyboard-wasd';
        const id = `custom-imported-${slot}-${kind}`;
        this.profiles.set(id, freezeProfile({ id, name: `Imported P${slot} ${kind === 'gamepad' ? 'Gamepad' : 'Keyboard'}`,
          deviceKind: kind, bindings, baseId, builtin: false }));
      }
    }
  }

  save(id: string, bindings: ActionBindings): ProfileSaveResult {
    const profile = this.get(id);
    if (!profile) return { ok: false, error: 'Choose an existing input profile.' };
    const normalized = profileBindings(bindings, profile.deviceKind);
    if (JSON.stringify(normalized) === JSON.stringify(profile.bindings)) return this.persist(profile);
    if (profile.builtin) return this.create(id, bindings);
    return this.persist(freezeProfile({ ...profile, bindings: normalized }));
  }

  create(baseId: string, bindings: ActionBindings, requestedName?: string): ProfileSaveResult {
    const base = this.get(baseId);
    if (!base) return { ok: false, error: 'Choose a profile to copy first.' };
    let ordinal = 1;
    while (this.profiles.has(`custom-${ordinal}`)) ordinal++;
    let name = requestedName?.trim();
    if (!name) {
      let suffix = 1;
      const label = base.deviceKind === 'gamepad' ? 'My Gamepad' : 'My Keyboard';
      while (this.list().some(profile => profile.name === `${label} ${suffix}`)) suffix++;
      name = `${label} ${suffix}`;
    }
    const error = this.nameError(name);
    if (error) return { ok: false, error };
    return this.persist(freezeProfile({ id: `custom-${ordinal}`, name, deviceKind: base.deviceKind,
      bindings, baseId: base.baseId, builtin: false }));
  }

  rename(id: string, name: string): ProfileSaveResult {
    const profile = this.get(id);
    if (!profile) return { ok: false, error: 'Choose an existing input profile.' };
    const trimmed = name.trim();
    const error = this.nameError(trimmed, id);
    if (error) return { ok: false, error };
    if (profile.builtin) return this.create(id, profile.bindings, trimmed);
    return this.persist(freezeProfile({ ...profile, name: trimmed }));
  }

  private nameError(name: string, id?: string): string | undefined {
    if (!name || name.length > 28) return 'Use a profile name of 1–28 characters.';
    if (this.list().some(profile => profile.id !== id && profile.name.toLowerCase() === name.toLowerCase())) {
      return 'That profile name is already in use.';
    }
    return undefined;
  }

  private persist(profile: InputProfile): ProfileSaveResult {
    if (!this.storage) return { ok: false, error: 'Could not save the profile. Browser storage is unavailable.' };
    const next = new Map(this.profiles).set(profile.id, profile);
    try {
      this.storage.setItem(INPUT_PROFILES_STORAGE_KEY, JSON.stringify({ version: 1,
        profiles: [...next.values()].filter(value => !value.builtin) }));
    } catch { return { ok: false, error: 'Could not save the profile. Browser storage is unavailable or full.' }; }
    this.profiles.set(profile.id, profile);
    return { ok: true, name: profile.name, profileId: profile.id };
  }
}

export function acquireInputProfiles(registry: { get(key: string): unknown; set(key: string, value: unknown): unknown }, legacy: InputBindingsStore): InputProfileStore {
  const existing = registry.get(BOOT_REGISTRY_KEYS.inputProfiles);
  if (existing instanceof InputProfileStore) return existing;
  const profiles = new InputProfileStore(legacy);
  registry.set(BOOT_REGISTRY_KEYS.inputProfiles, profiles);
  return profiles;
}
