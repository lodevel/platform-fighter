import { describe, it, expect } from 'vitest';
import {
  buildSnapshotFromGamepads,
  detectActiveInputDevice,
  detectAllActiveInputDevices,
  formatDetectedDeviceLabel,
  getDetectedDeviceTint,
  type DetectionGamepadSnapshot,
  type InputDeviceSnapshot,
} from './inputDeviceDetection';
import {
  DEFAULT_LOBBY_STATE,
  joinSlot,
  leaveSlot,
  type LobbySlotState,
  type LobbyState,
} from './lobby';

/**
 * AC 50002 Sub-AC 2 — "Implement active input device detection per
 * player slot (keyboard vs gamepad) and display the detected device
 * type in the UI."
 *
 * The lobby's status label tells you what device a slot was *configured*
 * with (KEYBOARD (WASD) / GAMEPAD #1 / AI BOT). The detection module
 * answers the orthogonal "is the configured device actually wired up
 * right now?" question, so the lobby tile can paint a chip that flips
 * to a warning state when a gamepad walks off mid-lobby.
 */
describe('input device detection — AC 50002 Sub-AC 2', () => {
  // -------------------------------------------------------------------------
  // buildSnapshotFromGamepads
  // -------------------------------------------------------------------------
  describe('buildSnapshotFromGamepads', () => {
    it('returns an empty connected list when no pads are present', () => {
      const snap = buildSnapshotFromGamepads([]);
      expect(snap.connectedGamepadIndices).toEqual([]);
      expect(snap.keyboardAvailable).toBe(true);
    });

    it('skips null / undefined / sparse entries (browser pads array shape)', () => {
      const pads: ReadonlyArray<DetectionGamepadSnapshot | null | undefined> = [
        null,
        undefined,
        { index: 1 },
        null,
        { index: 3 },
      ];
      const snap = buildSnapshotFromGamepads(pads);
      expect(snap.connectedGamepadIndices).toEqual([1, 3]);
    });

    it('excludes pads whose `connected` flag is explicitly false', () => {
      const snap = buildSnapshotFromGamepads([
        { index: 0, connected: true },
        { index: 1, connected: false },
        { index: 2 }, // omitted = connected
      ]);
      expect(snap.connectedGamepadIndices).toEqual([0, 2]);
    });

    it('sorts and deduplicates indices so two snapshots with the same set match structurally', () => {
      const a = buildSnapshotFromGamepads([
        { index: 2 },
        { index: 0 },
        { index: 2 },
      ]);
      const b = buildSnapshotFromGamepads([{ index: 0 }, { index: 2 }]);
      expect(a.connectedGamepadIndices).toEqual([0, 2]);
      expect(b.connectedGamepadIndices).toEqual([0, 2]);
    });

    it('honours the keyboardAvailable override', () => {
      const snap = buildSnapshotFromGamepads([], false);
      expect(snap.keyboardAvailable).toBe(false);
    });

    it('rejects negative / non-finite indices', () => {
      const snap = buildSnapshotFromGamepads([
        { index: -1 },
        { index: Number.NaN },
        { index: Number.POSITIVE_INFINITY },
        { index: 0 },
      ] as ReadonlyArray<DetectionGamepadSnapshot>);
      expect(snap.connectedGamepadIndices).toEqual([0]);
    });

    it('returns a deeply-frozen snapshot so consumers cannot mutate it', () => {
      const snap = buildSnapshotFromGamepads([{ index: 0 }]);
      expect(Object.isFrozen(snap)).toBe(true);
      expect(Object.isFrozen(snap.connectedGamepadIndices)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // detectActiveInputDevice — per-slot rules
  // -------------------------------------------------------------------------
  describe('detectActiveInputDevice', () => {
    const emptySnapshot: InputDeviceSnapshot = buildSnapshotFromGamepads([]);

    it('returns kind="none" with empty label for an un-joined slot', () => {
      const slot: LobbySlotState = DEFAULT_LOBBY_STATE.slots[0]!;
      const result = detectActiveInputDevice(slot, emptySnapshot);
      expect(result).toMatchObject({
        slotIndex: 1,
        kind: 'none',
        connected: false,
        gamepadIndex: null,
        label: '',
      });
    });

    it('detects a keyboard_p1 slot as kind="keyboard" when the keyboard is available', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const result = detectActiveInputDevice(state.slots[0]!, emptySnapshot);
      expect(result.kind).toBe('keyboard');
      expect(result.connected).toBe(true);
      expect(result.label).toBe('KEYBOARD');
    });

    it('detects a keyboard_p2 slot as kind="keyboard" (the half collapses to a single chip)', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 2, 'keyboard_p2');
      const result = detectActiveInputDevice(state.slots[1]!, emptySnapshot);
      expect(result.kind).toBe('keyboard');
      expect(result.label).toBe('KEYBOARD');
    });

    it('flags a keyboard slot as MISSING when the snapshot reports no keyboard', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const noKeyboard = buildSnapshotFromGamepads([], false);
      const result = detectActiveInputDevice(state.slots[0]!, noKeyboard);
      expect(result.kind).toBe('none');
      expect(result.connected).toBe(false);
      expect(result.label).toBe('KEYBOARD MISSING');
    });

    it('detects a gamepad slot as connected when the configured pad index is in the snapshot', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', { gamepadIndex: 0 });
      const snap = buildSnapshotFromGamepads([{ index: 0 }]);
      const result = detectActiveInputDevice(state.slots[2]!, snap);
      expect(result.kind).toBe('gamepad');
      expect(result.connected).toBe(true);
      expect(result.gamepadIndex).toBe(0);
      expect(result.label).toBe('GAMEPAD #0');
    });

    it('flags a gamepad slot as MISSING when the configured pad index has disconnected', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', { gamepadIndex: 2 });
      // Snapshot only carries pad 0 — pad 2 has walked off.
      const snap = buildSnapshotFromGamepads([{ index: 0 }]);
      const result = detectActiveInputDevice(state.slots[2]!, snap);
      expect(result.kind).toBe('none');
      expect(result.connected).toBe(false);
      expect(result.gamepadIndex).toBe(2);
      expect(result.label).toBe('GAMEPAD #2 MISSING');
    });

    it('handles a gamepad slot with no recorded gamepadIndex', () => {
      // Hand-rolled slot — joinSlot would set gamepadIndex from opts.
      const slot: LobbySlotState = Object.freeze({
        index: 4 as const,
        joined: true,
        ready: false,
        inputType: 'gamepad' as const,
      });
      const result = detectActiveInputDevice(slot, emptySnapshot);
      expect(result.kind).toBe('none');
      expect(result.connected).toBe(false);
      expect(result.gamepadIndex).toBeNull();
      expect(result.label).toBe('GAMEPAD MISSING');
    });

    it('detects an AI slot as kind="ai" with label "AI"', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 4, 'ai');
      const result = detectActiveInputDevice(state.slots[3]!, emptySnapshot);
      expect(result).toMatchObject({
        slotIndex: 4,
        kind: 'ai',
        connected: true,
        gamepadIndex: null,
        label: 'AI',
      });
    });

    it('returns a frozen record', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const result = detectActiveInputDevice(state.slots[0]!, emptySnapshot);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('un-joined detection is idempotent — re-leaving a slot stays kind="none"', () => {
      const joined = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const left = leaveSlot(joined, 1);
      const result = detectActiveInputDevice(left.slots[0]!, emptySnapshot);
      expect(result.kind).toBe('none');
      expect(result.label).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // detectAllActiveInputDevices — full lobby projection
  // -------------------------------------------------------------------------
  describe('detectAllActiveInputDevices', () => {
    it('produces 4 entries in slot-index order for a fresh lobby', () => {
      const snap = buildSnapshotFromGamepads([]);
      const all = detectAllActiveInputDevices(DEFAULT_LOBBY_STATE, snap);
      expect(all).toHaveLength(4);
      expect(all.map((s) => s.slotIndex)).toEqual([1, 2, 3, 4]);
      for (const s of all) {
        expect(s.kind).toBe('none');
        expect(s.label).toBe('');
      }
    });

    it('mixes keyboard / gamepad / ai correctly across a populated lobby', () => {
      let state: LobbyState = DEFAULT_LOBBY_STATE;
      state = joinSlot(state, 1, 'keyboard_p1');
      state = joinSlot(state, 2, 'keyboard_p2');
      state = joinSlot(state, 3, 'gamepad', { gamepadIndex: 0 });
      state = joinSlot(state, 4, 'ai');

      const snap = buildSnapshotFromGamepads([{ index: 0 }]);
      const all = detectAllActiveInputDevices(state, snap);
      expect(all.map((s) => s.kind)).toEqual([
        'keyboard',
        'keyboard',
        'gamepad',
        'ai',
      ]);
      expect(all.map((s) => s.label)).toEqual([
        'KEYBOARD',
        'KEYBOARD',
        'GAMEPAD #0',
        'AI',
      ]);
    });

    it('flips a gamepad slot to the warning state when the pad disconnects mid-lobby', () => {
      let state: LobbyState = DEFAULT_LOBBY_STATE;
      state = joinSlot(state, 3, 'gamepad', { gamepadIndex: 0 });

      const wired = buildSnapshotFromGamepads([{ index: 0 }]);
      const unwired = buildSnapshotFromGamepads([]);

      const before = detectAllActiveInputDevices(state, wired);
      const after = detectAllActiveInputDevices(state, unwired);
      expect(before[2]!.connected).toBe(true);
      expect(before[2]!.label).toBe('GAMEPAD #0');
      expect(after[2]!.connected).toBe(false);
      expect(after[2]!.label).toBe('GAMEPAD #0 MISSING');
    });

    it('returns a frozen array of frozen records', () => {
      const all = detectAllActiveInputDevices(
        DEFAULT_LOBBY_STATE,
        buildSnapshotFromGamepads([]),
      );
      expect(Object.isFrozen(all)).toBe(true);
      for (const s of all) expect(Object.isFrozen(s)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // formatDetectedDeviceLabel — chip text helper
  // -------------------------------------------------------------------------
  describe('formatDetectedDeviceLabel', () => {
    it('formats keyboard / ai / none consistently', () => {
      expect(formatDetectedDeviceLabel('keyboard')).toBe('KEYBOARD');
      expect(formatDetectedDeviceLabel('ai')).toBe('AI');
      expect(formatDetectedDeviceLabel('none')).toBe('');
    });

    it('emits the pad index when given a gamepad kind', () => {
      expect(formatDetectedDeviceLabel('gamepad', 0)).toBe('GAMEPAD #0');
      expect(formatDetectedDeviceLabel('gamepad', 3)).toBe('GAMEPAD #3');
    });

    it('falls back to bare "GAMEPAD" when no pad index is supplied', () => {
      expect(formatDetectedDeviceLabel('gamepad')).toBe('GAMEPAD');
      expect(formatDetectedDeviceLabel('gamepad', null)).toBe('GAMEPAD');
    });
  });

  // -------------------------------------------------------------------------
  // getDetectedDeviceTint — UI colour mapping
  // -------------------------------------------------------------------------
  describe('getDetectedDeviceTint', () => {
    it('returns the "all good" tint for connected slots', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', { gamepadIndex: 0 });
      const result = detectActiveInputDevice(
        state.slots[2]!,
        buildSnapshotFromGamepads([{ index: 0 }]),
      );
      expect(getDetectedDeviceTint(result)).toBe('#a0d0e8');
    });

    it('returns the warning tint for a missing gamepad', () => {
      const state = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', { gamepadIndex: 2 });
      const result = detectActiveInputDevice(
        state.slots[2]!,
        buildSnapshotFromGamepads([]),
      );
      expect(getDetectedDeviceTint(result)).toBe('#d0a060');
    });

    it('returns the warning tint for un-joined slots (consistent fallback)', () => {
      const result = detectActiveInputDevice(
        DEFAULT_LOBBY_STATE.slots[0]!,
        buildSnapshotFromGamepads([]),
      );
      expect(getDetectedDeviceTint(result)).toBe('#d0a060');
    });
  });

  // -------------------------------------------------------------------------
  // Determinism — two identical inputs always produce equal outputs
  // -------------------------------------------------------------------------
  describe('determinism', () => {
    it('two calls with the same inputs produce structurally equal outputs', () => {
      let state: LobbyState = DEFAULT_LOBBY_STATE;
      state = joinSlot(state, 1, 'keyboard_p1');
      state = joinSlot(state, 3, 'gamepad', { gamepadIndex: 1 });

      const snap = buildSnapshotFromGamepads([{ index: 1 }, { index: 0 }]);
      const a = detectAllActiveInputDevices(state, snap);
      const b = detectAllActiveInputDevices(state, snap);
      // Different instances (frozen so identity comparison would
      // require explicit memoisation), but the values are equal.
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
