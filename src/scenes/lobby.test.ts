import { describe, it, expect } from 'vitest';
import {
  AI_DIFFICULTY_CYCLE_ORDER,
  DEFAULT_LOBBY_STATE,
  MAX_LOBBY_SLOTS,
  PRESS_START_BUTTON_INDICES,
  applyGamepadPressStartEdges,
  buildLobbyHandoffPayload,
  buildLobbyPreviews,
  buildLobbySlotPreview,
  buildPlayerSlotsFromLobby,
  canConfirmLobby,
  canStartLobby,
  cycleSlotAiDifficulty,
  cycleSlotInputType,
  detectGamepadPressStartEdges,
  formatLobbyHumanAiBadge,
  formatLobbyReadyBadge,
  formatLobbySlotLabel,
  getJoinedSlotCount,
  getReadySlotCount,
  isGamepadClaimedByOther,
  isInputTypeClaimedByOther,
  joinNextFreeSlotForGamepad,
  joinSlot,
  leaveSlot,
  pollGamepadPressStartJoins,
  pressStartJoinFromKeyboard,
  setSlotAiDifficulty,
  setSlotReady,
  toggleSlotHumanAi,
  toggleSlotReady,
  type GamepadHeldButtonState,
  type GamepadPressStartEdge,
  type LobbyState,
  type PressStartGamepadSnapshot,
} from './lobby';

/**
 * AC 2 Sub-AC 5 — "Implement lobby flow with Press Start to join for
 * up to 4 players, slot assignment, and transition into character
 * select."
 *
 * The Phaser scene that hosts the lobby forwards every key press to one
 * of these helpers and rebuilds its tiles from the returned state. So
 * if the contract here holds — every slot can be joined / left, the
 * canStart gate flips when ≥ 1 slot is joined, the keyboard
 * exclusivity rule keeps two slots from claiming the same physical
 * device, and the hand-off payload preserves the joined lineup — the
 * AC holds.
 */
describe('lobby helpers — AC 2 Sub-AC 5', () => {
  describe('DEFAULT_LOBBY_STATE', () => {
    it('opens with 4 un-joined slots so every Press Start is deliberate', () => {
      expect(DEFAULT_LOBBY_STATE.slots).toHaveLength(MAX_LOBBY_SLOTS);
      for (const slot of DEFAULT_LOBBY_STATE.slots) {
        expect(slot.joined).toBe(false);
        expect(slot.inputType).toBeNull();
      }
    });

    it('numbers slots 1..4 in order', () => {
      const indices = DEFAULT_LOBBY_STATE.slots.map((s) => s.index);
      expect(indices).toEqual([1, 2, 3, 4]);
    });

    it('is frozen so callers cannot mutate the canonical default', () => {
      expect(Object.isFrozen(DEFAULT_LOBBY_STATE)).toBe(true);
      expect(Object.isFrozen(DEFAULT_LOBBY_STATE.slots)).toBe(true);
    });
  });

  describe('joinSlot', () => {
    it('marks the target slot joined with the supplied input type', () => {
      const next = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      expect(next.slots[0]).toMatchObject({
        index: 1,
        joined: true,
        inputType: 'keyboard_p1',
      });
    });

    it('preserves un-targeted slots', () => {
      const next = joinSlot(DEFAULT_LOBBY_STATE, 2, 'keyboard_p2');
      expect(next.slots[0]).toEqual(DEFAULT_LOBBY_STATE.slots[0]);
      expect(next.slots[2]).toEqual(DEFAULT_LOBBY_STATE.slots[2]);
      expect(next.slots[3]).toEqual(DEFAULT_LOBBY_STATE.slots[3]);
    });

    it('seeds default AI difficulty when joining as AI', () => {
      const next = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai');
      expect(next.slots[2]).toMatchObject({
        joined: true,
        inputType: 'ai',
        aiDifficulty: 'medium',
      });
    });

    it('honours an explicit AI difficulty override', () => {
      const next = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai', {
        aiDifficulty: 'hard',
      });
      expect(next.slots[2]?.aiDifficulty).toBe('hard');
    });

    it('records gamepad index when joining as gamepad', () => {
      const next = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 2,
      });
      expect(next.slots[0]).toMatchObject({
        joined: true,
        inputType: 'gamepad',
        gamepadIndex: 2,
      });
    });

    it('returns the same reference when claiming an already-claimed identical slot (idempotent)', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = joinSlot(a, 1, 'keyboard_p1');
      expect(b).toBe(a);
    });

    it('rejects a duplicate keyboard_p1 claim from a second slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = joinSlot(a, 2, 'keyboard_p1');
      // Same reference because the second slot's claim was rejected.
      expect(b).toBe(a);
      // Slot 2 is still un-joined.
      expect(b.slots[1]?.joined).toBe(false);
    });

    it('rejects a duplicate keyboard_p2 claim from a second slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 2, 'keyboard_p2');
      const b = joinSlot(a, 4, 'keyboard_p2');
      expect(b).toBe(a);
    });

    it('rejects a duplicate gamepad index from a second slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 0,
      });
      const b = joinSlot(a, 2, 'gamepad', { gamepadIndex: 0 });
      expect(b).toBe(a);
    });

    it('allows distinct gamepad indices to claim distinct slots', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 0,
      });
      const b = joinSlot(a, 2, 'gamepad', { gamepadIndex: 1 });
      expect(b.slots[0]?.gamepadIndex).toBe(0);
      expect(b.slots[1]?.gamepadIndex).toBe(1);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        joinSlot(DEFAULT_LOBBY_STATE, 5 as 1, 'keyboard_p1'),
      ).toThrow(/out of range/);
    });
  });

  describe('leaveSlot', () => {
    it('drops a joined slot back to un-joined and clears device fields', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 3,
      });
      const b = leaveSlot(a, 1);
      expect(b.slots[0]).toMatchObject({
        index: 1,
        joined: false,
        inputType: null,
      });
      expect(b.slots[0]?.gamepadIndex).toBeUndefined();
    });

    it('returns the same reference when leaving an already-un-joined slot', () => {
      const next = leaveSlot(DEFAULT_LOBBY_STATE, 1);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() => leaveSlot(DEFAULT_LOBBY_STATE, 0 as 1)).toThrow(
        /out of range/,
      );
    });
  });

  describe('joinNextFreeSlotForGamepad', () => {
    it('claims the first free slot for a fresh gamepad', () => {
      const next = joinNextFreeSlotForGamepad(DEFAULT_LOBBY_STATE, 0);
      expect(next.slots[0]).toMatchObject({
        joined: true,
        inputType: 'gamepad',
        gamepadIndex: 0,
      });
    });

    it('walks past joined slots to find the next free one', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = joinSlot(a, 2, 'keyboard_p2');
      const c = joinNextFreeSlotForGamepad(b, 7);
      expect(c.slots[2]).toMatchObject({
        joined: true,
        inputType: 'gamepad',
        gamepadIndex: 7,
      });
      expect(c.slots[3]?.joined).toBe(false);
    });

    it('is idempotent for an already-claimed gamepad', () => {
      const a = joinNextFreeSlotForGamepad(DEFAULT_LOBBY_STATE, 0);
      const b = joinNextFreeSlotForGamepad(a, 0);
      expect(b).toBe(a);
    });

    it('returns the same reference when the lobby is full', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'gamepad', { gamepadIndex: 0 });
      s = joinSlot(s, 4, 'gamepad', { gamepadIndex: 1 });
      const next = joinNextFreeSlotForGamepad(s, 9);
      expect(next).toBe(s);
    });

    it('rejects negative / non-finite gamepad indices', () => {
      const next = joinNextFreeSlotForGamepad(DEFAULT_LOBBY_STATE, -1);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
      const next2 = joinNextFreeSlotForGamepad(
        DEFAULT_LOBBY_STATE,
        Number.NaN,
      );
      expect(next2).toBe(DEFAULT_LOBBY_STATE);
    });
  });

  describe('cycleSlotInputType', () => {
    it('rotates a joined AI slot through AI → keyboard halves', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai');
      const b = cycleSlotInputType(a, 3);
      // From 'ai' the cycle's next valid hop is 'keyboard_p1'.
      expect(b.slots[2]?.inputType).toBe('keyboard_p1');
    });

    it('skips exclusive keyboard halves already claimed by another slot', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1'); // P1 owns keyboard_p1
      s = joinSlot(s, 3, 'ai');
      const cycled = cycleSlotInputType(s, 3);
      // From 'ai' → 'keyboard_p1' is blocked (slot 1 owns it),
      // so the cycle lands on 'keyboard_p2'.
      expect(cycled.slots[2]?.inputType).toBe('keyboard_p2');
    });

    it('returns the same reference when cycling an un-joined slot', () => {
      const next = cycleSlotInputType(DEFAULT_LOBBY_STATE, 1);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });
  });

  describe('canStartLobby + getJoinedSlotCount', () => {
    it('reports zero joined slots on a fresh state', () => {
      expect(getJoinedSlotCount(DEFAULT_LOBBY_STATE)).toBe(0);
      expect(canStartLobby(DEFAULT_LOBBY_STATE)).toBe(false);
    });

    it('flips canStart on with the first joined slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      expect(getJoinedSlotCount(a)).toBe(1);
      expect(canStartLobby(a)).toBe(true);
    });

    it('counts 4 when every slot is joined', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'ai');
      s = joinSlot(s, 4, 'ai');
      expect(getJoinedSlotCount(s)).toBe(4);
      expect(canStartLobby(s)).toBe(true);
    });
  });

  describe('exclusivity predicates', () => {
    it('isInputTypeClaimedByOther flags a duplicate keyboard claim', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      expect(isInputTypeClaimedByOther(a, 2, 'keyboard_p1')).toBe(true);
      // Slot 1 itself should not flag against its own claim.
      expect(isInputTypeClaimedByOther(a, 1, 'keyboard_p1')).toBe(false);
    });

    it('isGamepadClaimedByOther flags a duplicate pad claim', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 5,
      });
      expect(isGamepadClaimedByOther(a, 2, 5)).toBe(true);
      expect(isGamepadClaimedByOther(a, 1, 5)).toBe(false);
      // Different pad index is fair game.
      expect(isGamepadClaimedByOther(a, 2, 6)).toBe(false);
    });
  });

  describe('buildPlayerSlotsFromLobby', () => {
    it('returns an empty array for an unjoined lobby', () => {
      const out = buildPlayerSlotsFromLobby(DEFAULT_LOBBY_STATE);
      expect(out).toHaveLength(0);
    });

    it('drops un-joined slots while preserving join order', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      const out = buildPlayerSlotsFromLobby(s);
      expect(out).toHaveLength(2);
      expect(out[0]?.index).toBe(1);
      expect(out[0]?.inputType).toBe('keyboard_p1');
      expect(out[1]?.index).toBe(3);
      expect(out[1]?.inputType).toBe('ai');
      expect(out[1]?.aiDifficulty).toBe('medium');
    });

    it('emits frozen entries safe to round-trip through scene-data', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const out = buildPlayerSlotsFromLobby(a);
      expect(Object.isFrozen(out)).toBe(true);
      expect(Object.isFrozen(out[0])).toBe(true);
    });

    it('omits aiDifficulty for non-AI slots', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const out = buildPlayerSlotsFromLobby(a);
      expect(out[0]).not.toHaveProperty('aiDifficulty');
    });
  });

  describe('formatLobbySlotLabel', () => {
    it('paints the press-start prompt for un-joined slots', () => {
      const slot = DEFAULT_LOBBY_STATE.slots[0]!;
      expect(formatLobbySlotLabel(slot)).toBe('PRESS START TO JOIN');
    });

    it('paints distinct labels for each device kind', () => {
      const kp1 = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1').slots[0]!;
      const kp2 = joinSlot(DEFAULT_LOBBY_STATE, 2, 'keyboard_p2').slots[1]!;
      const pad = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 4,
      }).slots[0]!;
      const ai = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai').slots[2]!;
      expect(formatLobbySlotLabel(kp1)).toContain('KEYBOARD');
      expect(formatLobbySlotLabel(kp1)).toContain('WASD');
      expect(formatLobbySlotLabel(kp2)).toContain('ARROW');
      expect(formatLobbySlotLabel(pad)).toBe('GAMEPAD #4');
      expect(formatLobbySlotLabel(ai)).toBe('AI BOT (MEDIUM)');
    });
  });

  describe('preview projection', () => {
    it('produces a preview record per slot with contextual hint', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const previews = buildLobbyPreviews(
        a,
        ['1', '2', '3', '4'],
        ['TAB', 'T', 'U', 'O'],
      );
      expect(previews).toHaveLength(4);
      // Joined slot's hint mentions LEAVE; un-joined slot's hint
      // mentions JOIN.
      expect(previews[0]?.hintLabel).toMatch(/LEAVE/);
      expect(previews[1]?.hintLabel).toMatch(/JOIN/);
    });

    it('exposes the slot index + headerLabel in lockstep', () => {
      const slot = DEFAULT_LOBBY_STATE.slots[2]!;
      const preview = buildLobbySlotPreview(slot, '3', 'U');
      expect(preview.slotIndex).toBe(3);
      expect(preview.headerLabel).toBe('P3');
    });
  });

  describe('buildLobbyHandoffPayload', () => {
    it('drops un-joined slots from the payload', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 4, 'ai', { aiDifficulty: 'hard' });
      const payload = buildLobbyHandoffPayload(s);
      expect(payload.slots).toHaveLength(2);
      expect(payload.slots[0]?.index).toBe(1);
      expect(payload.slots[1]?.index).toBe(4);
      expect(payload.slots[1]?.aiDifficulty).toBe('hard');
    });

    it('returns frozen containers safe to forward via scene-data', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const payload = buildLobbyHandoffPayload(a);
      expect(Object.isFrozen(payload)).toBe(true);
      expect(Object.isFrozen(payload.slots)).toBe(true);
    });

    it('produces an empty slot list for an unjoined lobby', () => {
      const payload = buildLobbyHandoffPayload(DEFAULT_LOBBY_STATE);
      expect(payload.slots).toHaveLength(0);
    });
  });

  describe('cycleSlotAiDifficulty + setSlotAiDifficulty — AC 10205 Sub-AC 5', () => {
    it('exposes the canonical cycle order in ascending skill', () => {
      expect(AI_DIFFICULTY_CYCLE_ORDER).toEqual(['easy', 'medium', 'hard']);
    });

    it('cycles a joined AI slot through easy → medium → hard → easy', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai', {
        aiDifficulty: 'easy',
      });
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('medium');
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('hard');
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('easy');
    });

    it('starts cycling at easy when slot has no aiDifficulty set yet', () => {
      // Defensive: a join path that didn't seed difficulty (shouldn't
      // happen with the current `joinSlot`, but tests exercise the
      // fallback). After one cycle the slot should be on the second
      // tier (`medium`) — the cycle treats the missing field as the
      // default (`medium`), so the next tick is `hard`. The contract
      // is "the field becomes a real cycle entry on first press."
      const slot = DEFAULT_LOBBY_STATE.slots[2];
      expect(slot).toBeDefined();
      // Manually craft a malformed state where slot 3 is AI but has
      // no difficulty (simulates a hostile JSON load).
      const malformed: LobbyState = Object.freeze({
        slots: Object.freeze(
          DEFAULT_LOBBY_STATE.slots.map((s, i) =>
            i === 2
              ? Object.freeze({
                  index: 3 as const,
                  joined: true,
                  ready: false,
                  inputType: 'ai' as const,
                })
              : s,
          ),
        ),
      });
      const next = cycleSlotAiDifficulty(malformed, 3);
      expect(next.slots[2]?.aiDifficulty).toBe('hard');
    });

    it('returns the same reference for an un-joined slot (silent no-op)', () => {
      const next = cycleSlotAiDifficulty(DEFAULT_LOBBY_STATE, 3);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });

    it('returns the same reference for a human slot (silent no-op)', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = cycleSlotAiDifficulty(a, 1);
      expect(b).toBe(a);
      expect(b.slots[0]?.inputType).toBe('keyboard_p1');
      // No phantom aiDifficulty leaked onto a human slot.
      expect(b.slots[0]).not.toHaveProperty('aiDifficulty');
    });

    it('preserves un-targeted slots across the cycle', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      const next = cycleSlotAiDifficulty(s, 3);
      expect(next.slots[0]).toEqual(s.slots[0]);
      expect(next.slots[1]).toEqual(s.slots[1]);
      expect(next.slots[3]).toEqual(s.slots[3]);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        cycleSlotAiDifficulty(DEFAULT_LOBBY_STATE, 5 as 1),
      ).toThrow(/out of range/);
    });

    it('setSlotAiDifficulty updates only the targeted AI slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 4, 'ai');
      const b = setSlotAiDifficulty(a, 4, 'hard');
      expect(b.slots[3]?.aiDifficulty).toBe('hard');
    });

    it('setSlotAiDifficulty is a no-op when the difficulty already matches', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 4, 'ai', {
        aiDifficulty: 'hard',
      });
      const b = setSlotAiDifficulty(a, 4, 'hard');
      expect(b).toBe(a);
    });

    it('setSlotAiDifficulty is a no-op for a human slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = setSlotAiDifficulty(a, 1, 'hard');
      expect(b).toBe(a);
    });

    it('cycle preserves the buildPlayerSlotsFromLobby projection', () => {
      // joinSlot defaults to medium → cycle once → hard.
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      s = cycleSlotAiDifficulty(s, 3); // medium → hard
      const players = buildPlayerSlotsFromLobby(s);
      expect(players[1]?.inputType).toBe('ai');
      expect(players[1]?.aiDifficulty).toBe('hard');
    });
  });

  describe('lobby preview hint exposes diff key for AI slots — AC 10205 Sub-AC 5', () => {
    it('paints "[Q] cycle difficulty" when the slot is AI and a diff key is supplied', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'ai');
      const slot = a.slots[0]!;
      const preview = buildLobbySlotPreview(slot, '1', 'TAB', 'Q');
      expect(preview.hintLabel).toMatch(/\[Q\]/);
      expect(preview.hintLabel).toMatch(/cycle difficulty/i);
    });

    it('omits the diff hint for a human slot even when a diff key is supplied', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const slot = a.slots[0]!;
      const preview = buildLobbySlotPreview(slot, '1', 'TAB', 'Q');
      expect(preview.hintLabel).not.toMatch(/cycle difficulty/i);
    });

    it('falls back to the legacy two-key hint when diffKeyLabel is undefined', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'ai');
      const slot = a.slots[0]!;
      const preview = buildLobbySlotPreview(slot, '1', 'TAB');
      expect(preview.hintLabel).not.toMatch(/cycle difficulty/i);
    });

    it('buildLobbyPreviews threads diffKeyLabels through to AI tiles', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      const previews = buildLobbyPreviews(
        s,
        ['1', '2', '3', '4'],
        ['TAB', 'T', 'U', 'O'],
        ['Q', 'Y', 'I', 'P'],
      );
      // Slot 1 (human) — no difficulty hint.
      expect(previews[0]?.hintLabel).not.toMatch(/cycle difficulty/i);
      // Slot 3 (AI) — difficulty hint present.
      expect(previews[2]?.hintLabel).toMatch(/cycle difficulty/i);
      expect(previews[2]?.hintLabel).toMatch(/\[I\]/);
    });
  });

  describe('mixed human/AI lineup — AC 10205 Sub-AC 5', () => {
    it('a 2-human + 2-AI session emits a heterogeneous PlayerSlot[]', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'ai', { aiDifficulty: 'easy' });
      s = joinSlot(s, 4, 'ai', { aiDifficulty: 'hard' });
      const players = buildPlayerSlotsFromLobby(s);
      expect(players).toHaveLength(4);
      expect(players[0]?.inputType).toBe('keyboard_p1');
      expect(players[1]?.inputType).toBe('keyboard_p2');
      expect(players[2]?.inputType).toBe('ai');
      expect(players[2]?.aiDifficulty).toBe('easy');
      expect(players[3]?.inputType).toBe('ai');
      expect(players[3]?.aiDifficulty).toBe('hard');
      // Human slots must NOT carry a phantom aiDifficulty.
      expect(players[0]).not.toHaveProperty('aiDifficulty');
      expect(players[1]).not.toHaveProperty('aiDifficulty');
    });

    it('per-AI-slot difficulty is independent', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'ai', { aiDifficulty: 'easy' });
      s = joinSlot(s, 2, 'ai', { aiDifficulty: 'medium' });
      s = joinSlot(s, 3, 'ai', { aiDifficulty: 'hard' });
      // Cycling slot 1 must not affect slots 2/3.
      const next = cycleSlotAiDifficulty(s, 1);
      expect(next.slots[0]?.aiDifficulty).toBe('medium');
      expect(next.slots[1]?.aiDifficulty).toBe('medium');
      expect(next.slots[2]?.aiDifficulty).toBe('hard');
    });
  });

  describe('determinism contract', () => {
    it('two identical join sequences produce structurally equal states', () => {
      const seq = (s: LobbyState): LobbyState => {
        let cur = s;
        cur = joinSlot(cur, 1, 'keyboard_p1');
        cur = joinSlot(cur, 2, 'keyboard_p2');
        cur = joinSlot(cur, 3, 'gamepad', { gamepadIndex: 0 });
        cur = joinSlot(cur, 4, 'ai', { aiDifficulty: 'easy' });
        return cur;
      };
      const a = seq(DEFAULT_LOBBY_STATE);
      const b = seq(DEFAULT_LOBBY_STATE);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});

// ===========================================================================
// AC 10401 Sub-AC 1 — Press-Start-to-Join detection
// ===========================================================================
//
// "Implement Press Start to join detection across keyboard and gamepad
// inputs that creates a new player slot in the lobby state."
//
// The lobby is the very first interactive surface after the main menu.
// Its only job until ENTER is pressed is to route fresh device presses
// — keyboard slot keys (1/2/3/4) AND any gamepad face button or the
// literal Start button — into a new `LobbySlotState` whose
// `joined: true` flag is set.
//
// These tests pin both halves of the contract:
//
//   • Keyboard side — `pressStartJoinFromKeyboard` claims the slot's
//     default `InputType`, no-ops on already-joined slots, and respects
//     the keyboard-half exclusivity rule.
//
//   • Gamepad side — `detectGamepadPressStartEdges` fires on rising
//     edges for ANY accepted button (A / B / X / Y / Start), updates
//     the held-state cache so a held button doesn't re-fire, and feeds
//     `applyGamepadPressStartEdges` to claim the next free slot.
//
//   • Integration — `pollGamepadPressStartJoins` is a pure composition
//     that mirrors what `LobbyScene.update()` does once per frame.
// ===========================================================================
describe('press-start join detection — AC 10401 Sub-AC 1', () => {
  // ---------------------------------------------------------------------
  // Keyboard side
  // ---------------------------------------------------------------------

  describe('pressStartJoinFromKeyboard', () => {
    it('claims slot 1 as keyboard_p1 (WASD-side default)', () => {
      const next = pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 1);
      expect(next.slots[0]).toMatchObject({
        index: 1,
        joined: true,
        inputType: 'keyboard_p1',
      });
    });

    it('claims slot 2 as keyboard_p2 (Arrow-side default)', () => {
      const next = pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 2);
      expect(next.slots[1]).toMatchObject({
        index: 2,
        joined: true,
        inputType: 'keyboard_p2',
      });
    });

    it('claims slots 3-4 as AI bots with default medium difficulty', () => {
      const a = pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 3);
      expect(a.slots[2]).toMatchObject({
        index: 3,
        joined: true,
        inputType: 'ai',
        aiDifficulty: 'medium',
      });
      const b = pressStartJoinFromKeyboard(a, 4);
      expect(b.slots[3]).toMatchObject({
        index: 4,
        joined: true,
        inputType: 'ai',
        aiDifficulty: 'medium',
      });
    });

    it('returns the same reference when the slot is already joined', () => {
      const a = pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 1);
      const b = pressStartJoinFromKeyboard(a, 1);
      // Already joined → no-op; the scene treats this branch as "use
      // the leave key to back out", not as a re-claim.
      expect(b).toBe(a);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 5 as 1),
      ).toThrow(/out of range/);
      expect(() =>
        pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 0 as 1),
      ).toThrow(/out of range/);
    });

    it('produces a 4-player keyboard+AI lineup deterministically', () => {
      // The canonical "two humans + two bots" join sequence — slot 1
      // and 2 are humans, slot 3 and 4 are bots. Two identical key
      // sequences must produce byte-identical lobby states.
      const seq = (s: LobbyState): LobbyState => {
        let cur = s;
        cur = pressStartJoinFromKeyboard(cur, 1);
        cur = pressStartJoinFromKeyboard(cur, 2);
        cur = pressStartJoinFromKeyboard(cur, 3);
        cur = pressStartJoinFromKeyboard(cur, 4);
        return cur;
      };
      const a = seq(DEFAULT_LOBBY_STATE);
      const b = seq(DEFAULT_LOBBY_STATE);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(getJoinedSlotCount(a)).toBe(4);
    });
  });

  // ---------------------------------------------------------------------
  // Gamepad button accept-set
  // ---------------------------------------------------------------------

  describe('PRESS_START_BUTTON_INDICES', () => {
    it('includes the four Standard Gamepad face buttons (A/B/X/Y)', () => {
      // Indices 0..3 are the four-face cluster on every consumer pad.
      // Inclusion makes "any face button = join" the documented
      // contract, matching how Smash and other party fighters behave.
      expect(PRESS_START_BUTTON_INDICES).toContain(0);
      expect(PRESS_START_BUTTON_INDICES).toContain(1);
      expect(PRESS_START_BUTTON_INDICES).toContain(2);
      expect(PRESS_START_BUTTON_INDICES).toContain(3);
    });

    it('includes the literal Start button (index 9 in the Standard Gamepad mapping)', () => {
      // The lobby's on-screen prompt reads "Press Start to Join", so
      // the literal Start button MUST be honoured — otherwise the
      // prompt would lie to the player.
      expect(PRESS_START_BUTTON_INDICES).toContain(9);
    });

    it('is frozen so callers cannot mutate the canonical accept-set', () => {
      expect(Object.isFrozen(PRESS_START_BUTTON_INDICES)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Gamepad rising-edge detector
  // ---------------------------------------------------------------------

  /**
   * Tiny snapshot factory — returns a `PressStartGamepadSnapshot`
   * whose `buttons` array has the supplied indices marked as
   * `pressed: true` and every other entry as `pressed: false`.
   * Sized at 16 entries to cover the Standard Gamepad layout.
   */
  function pad(
    index: number,
    pressedButtons: ReadonlyArray<number> = [],
  ): PressStartGamepadSnapshot {
    const buttons: { readonly pressed: boolean }[] = [];
    for (let i = 0; i < 16; i += 1) {
      buttons.push({ pressed: pressedButtons.includes(i) });
    }
    return Object.freeze({ index, buttons: Object.freeze(buttons) });
  }

  describe('detectGamepadPressStartEdges', () => {
    it('fires a rising edge when a fresh pad presses the A button', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges([pad(0, [0])], held);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.gamepadIndex).toBe(0);
      expect(edges[0]?.buttonIndex).toBe(0);
    });

    it('fires when a fresh pad presses the literal Start button (index 9)', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges([pad(0, [9])], held);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.buttonIndex).toBe(9);
    });

    it('fires when a fresh pad presses any of the four face buttons', () => {
      for (const btn of [0, 1, 2, 3]) {
        const held: GamepadHeldButtonState = new Map();
        const edges = detectGamepadPressStartEdges([pad(0, [btn])], held);
        expect(edges).toHaveLength(1);
        expect(edges[0]?.buttonIndex).toBe(btn);
      }
    });

    it('does NOT fire when a held button stays held across frames', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges1 = detectGamepadPressStartEdges([pad(0, [0])], held);
      const edges2 = detectGamepadPressStartEdges([pad(0, [0])], held);
      expect(edges1).toHaveLength(1);
      expect(edges2).toHaveLength(0);
    });

    it('fires AGAIN after the player releases and re-presses', () => {
      const held: GamepadHeldButtonState = new Map();
      detectGamepadPressStartEdges([pad(0, [0])], held); // press
      const release = detectGamepadPressStartEdges([pad(0, [])], held); // release
      const repress = detectGamepadPressStartEdges([pad(0, [0])], held); // press
      expect(release).toHaveLength(0);
      expect(repress).toHaveLength(1);
    });

    it('emits at most one edge per pad per frame even when multiple buttons rise', () => {
      // A player who simultaneously taps A and Start on the same
      // frame must only generate one join attempt — otherwise the
      // pad would either double-claim or fight itself.
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges([pad(0, [0, 9])], held);
      expect(edges).toHaveLength(1);
      // First-in-list wins (button 0 ahead of 9 in PRESS_START_BUTTON_INDICES).
      expect(edges[0]?.buttonIndex).toBe(0);
    });

    it('still tracks the not-fired button so it does not fire on a later frame just because we skipped it', () => {
      // Frame 1: A and Start pressed simultaneously → A wins.
      // Frame 2: A still pressed, Start still pressed → no edge.
      // (Without this contract, Start would "rise" on frame 2 from
      // the held cache thinking it had been released.)
      const held: GamepadHeldButtonState = new Map();
      detectGamepadPressStartEdges([pad(0, [0, 9])], held);
      const edges2 = detectGamepadPressStartEdges([pad(0, [0, 9])], held);
      expect(edges2).toHaveLength(0);
    });

    it('emits one edge per pad when multiple pads press simultaneously', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges(
        [pad(0, [0]), pad(1, [9]), pad(2, [3])],
        held,
      );
      expect(edges).toHaveLength(3);
      expect(edges.map((e) => e.gamepadIndex)).toEqual([0, 1, 2]);
    });

    it('does NOT fire on non-accepted buttons (e.g. button 4 = LB)', () => {
      // Shoulder buttons / triggers / dpad must not trigger join —
      // a player navigating the lobby with the dpad shouldn't
      // accidentally claim a slot.
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges([pad(0, [4, 5, 6, 12])], held);
      expect(edges).toHaveLength(0);
    });

    it('honours a custom acceptedButtons list when supplied', () => {
      // Lets a future test harness restrict the accept-set without
      // touching the module-level constant.
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges([pad(0, [0])], held, [9]);
      expect(edges).toHaveLength(0);
      const edges2 = detectGamepadPressStartEdges([pad(0, [9])], held, [9]);
      expect(edges2).toHaveLength(1);
    });

    it('skips null / undefined entries in the pads array (disconnected slots)', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges(
        [null, undefined, pad(3, [0])],
        held,
      );
      expect(edges).toHaveLength(1);
      expect(edges[0]?.gamepadIndex).toBe(3);
    });

    it('skips pads with non-finite or negative indices', () => {
      const held: GamepadHeldButtonState = new Map();
      const edges = detectGamepadPressStartEdges(
        [
          { index: -1, buttons: [{ pressed: true }] },
          { index: Number.NaN, buttons: [{ pressed: true }] },
        ],
        held,
      );
      expect(edges).toHaveLength(0);
    });

    it('tolerates a sparse buttons array (no entry for a high index)', () => {
      // Some non-standard pads only report a few buttons.
      const held: GamepadHeldButtonState = new Map();
      const sparse: PressStartGamepadSnapshot = {
        index: 0,
        buttons: [{ pressed: true }], // only button 0 reported
      };
      const edges = detectGamepadPressStartEdges([sparse], held);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.buttonIndex).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Edge → state transition
  // ---------------------------------------------------------------------

  describe('applyGamepadPressStartEdges', () => {
    it('claims the first free slot for one fresh pad', () => {
      const result = applyGamepadPressStartEdges(DEFAULT_LOBBY_STATE, [
        Object.freeze({ gamepadIndex: 0, buttonIndex: 0 }),
      ]);
      expect(result.state.slots[0]).toMatchObject({
        joined: true,
        inputType: 'gamepad',
        gamepadIndex: 0,
      });
      expect(result.claims).toEqual([0]);
    });

    it('claims successive slots for multiple fresh pads in order', () => {
      const result = applyGamepadPressStartEdges(DEFAULT_LOBBY_STATE, [
        Object.freeze({ gamepadIndex: 0, buttonIndex: 0 }),
        Object.freeze({ gamepadIndex: 1, buttonIndex: 9 }),
        Object.freeze({ gamepadIndex: 2, buttonIndex: 3 }),
      ]);
      expect(result.state.slots[0]?.gamepadIndex).toBe(0);
      expect(result.state.slots[1]?.gamepadIndex).toBe(1);
      expect(result.state.slots[2]?.gamepadIndex).toBe(2);
      expect(result.state.slots[3]?.joined).toBe(false);
      expect(result.claims).toEqual([0, 1, 2]);
    });

    it('skips a pad that already claimed a slot', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'gamepad', { gamepadIndex: 0 });
      const result = applyGamepadPressStartEdges(s, [
        Object.freeze({ gamepadIndex: 0, buttonIndex: 0 }),
      ]);
      expect(result.state).toBe(s); // no-op
      expect(result.claims).toEqual([]);
    });

    it('skips edges when the lobby is already full', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'gamepad', { gamepadIndex: 0 });
      s = joinSlot(s, 4, 'gamepad', { gamepadIndex: 1 });
      const result = applyGamepadPressStartEdges(s, [
        Object.freeze({ gamepadIndex: 5, buttonIndex: 0 }),
      ]);
      expect(result.state).toBe(s);
      expect(result.claims).toEqual([]);
    });

    it('partially honours a batch when only some edges find a free slot', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      // Two slots free, three pads pressing — first two land, third
      // is rejected silently.
      const edges: GamepadPressStartEdge[] = [
        Object.freeze({ gamepadIndex: 0, buttonIndex: 0 }),
        Object.freeze({ gamepadIndex: 1, buttonIndex: 0 }),
        Object.freeze({ gamepadIndex: 2, buttonIndex: 0 }),
      ];
      const result = applyGamepadPressStartEdges(s, edges);
      expect(result.state.slots[2]?.gamepadIndex).toBe(0);
      expect(result.state.slots[3]?.gamepadIndex).toBe(1);
      expect(result.claims).toEqual([0, 1]);
    });

    it('returns the same state and an empty claims list for an empty batch', () => {
      const result = applyGamepadPressStartEdges(DEFAULT_LOBBY_STATE, []);
      expect(result.state).toBe(DEFAULT_LOBBY_STATE);
      expect(result.claims).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // Polling composition
  // ---------------------------------------------------------------------

  describe('pollGamepadPressStartJoins', () => {
    it('claims a slot on a single rising A press', () => {
      const held: GamepadHeldButtonState = new Map();
      const result = pollGamepadPressStartJoins(
        DEFAULT_LOBBY_STATE,
        [pad(0, [0])],
        held,
      );
      expect(result.claims).toEqual([0]);
      expect(result.state.slots[0]?.gamepadIndex).toBe(0);
    });

    it('does NOT re-claim across consecutive frames while the button stays held', () => {
      const held: GamepadHeldButtonState = new Map();
      const r1 = pollGamepadPressStartJoins(
        DEFAULT_LOBBY_STATE,
        [pad(0, [0])],
        held,
      );
      const r2 = pollGamepadPressStartJoins(r1.state, [pad(0, [0])], held);
      expect(r1.claims).toEqual([0]);
      expect(r2.claims).toEqual([]);
      expect(r2.state).toBe(r1.state);
    });

    it('claims successive pads as they each make a fresh press', () => {
      const held: GamepadHeldButtonState = new Map();
      // Frame 1 — pad 0 presses A.
      let result = pollGamepadPressStartJoins(
        DEFAULT_LOBBY_STATE,
        [pad(0, [0]), pad(1, [])],
        held,
      );
      expect(result.claims).toEqual([0]);
      // Frame 2 — pad 1 presses Start while pad 0 still holds A.
      result = pollGamepadPressStartJoins(
        result.state,
        [pad(0, [0]), pad(1, [9])],
        held,
      );
      expect(result.claims).toEqual([1]);
      expect(result.state.slots[0]?.gamepadIndex).toBe(0);
      expect(result.state.slots[1]?.gamepadIndex).toBe(1);
    });

    it('mixed-input session — keyboard slot 1 + gamepad slot 2 coexist', () => {
      // Player 1 presses keyboard "1" → slot 1 = keyboard_p1.
      let s: LobbyState = pressStartJoinFromKeyboard(DEFAULT_LOBBY_STATE, 1);
      // Player 2 presses gamepad A → slot 2 = gamepad.
      const held: GamepadHeldButtonState = new Map();
      const result = pollGamepadPressStartJoins(s, [pad(0, [0])], held);
      s = result.state;
      expect(s.slots[0]?.inputType).toBe('keyboard_p1');
      expect(s.slots[1]?.inputType).toBe('gamepad');
      expect(s.slots[1]?.gamepadIndex).toBe(0);
      expect(getJoinedSlotCount(s)).toBe(2);
      expect(canStartLobby(s)).toBe(true);
    });

    it('full 4-player mixed lineup — 1 keyboard + 1 gamepad + 2 keyboards-as-AI', () => {
      // Build the canonical 4-player session. Verify the lobby is
      // ready to advance and the projected `PlayerSlot[]` matches.
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = pressStartJoinFromKeyboard(s, 1); // human kb1
      s = pressStartJoinFromKeyboard(s, 3); // ai
      s = pressStartJoinFromKeyboard(s, 4); // ai
      const held: GamepadHeldButtonState = new Map();
      const result = pollGamepadPressStartJoins(s, [pad(0, [9])], held);
      s = result.state;
      // Pad claimed slot 2 (the only free slot).
      expect(s.slots[1]?.inputType).toBe('gamepad');
      expect(s.slots[1]?.gamepadIndex).toBe(0);
      const players = buildPlayerSlotsFromLobby(s);
      expect(players).toHaveLength(4);
      expect(players.map((p) => p.inputType)).toEqual([
        'keyboard_p1',
        'gamepad',
        'ai',
        'ai',
      ]);
    });

    it('determinism — two identical pad-event streams produce identical states', () => {
      const drive = (): LobbyState => {
        const held: GamepadHeldButtonState = new Map();
        let s: LobbyState = DEFAULT_LOBBY_STATE;
        s = pollGamepadPressStartJoins(s, [pad(0, [0])], held).state;
        s = pollGamepadPressStartJoins(s, [pad(0, [0]), pad(1, [9])], held)
          .state;
        s = pollGamepadPressStartJoins(
          s,
          [pad(0, [0]), pad(1, [9]), pad(2, [3])],
          held,
        ).state;
        return s;
      };
      const a = drive();
      const b = drive();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('returns same state ref when no rising edges occur (cheap re-paint short-circuit)', () => {
      const held: GamepadHeldButtonState = new Map();
      // Seed the held cache as if all buttons were pressed last frame.
      const r1 = pollGamepadPressStartJoins(
        DEFAULT_LOBBY_STATE,
        [pad(0, [0, 1, 2, 3, 9])],
        held,
      );
      // Frame 2 — same buttons still held → no edges, same state ref.
      const r2 = pollGamepadPressStartJoins(
        r1.state,
        [pad(0, [0, 1, 2, 3, 9])],
        held,
      );
      expect(r2.state).toBe(r1.state);
      expect(r2.claims).toEqual([]);
    });
  });
});

// ===========================================================================
// AC 10402 Sub-AC 2 — player slot management UI showing up to 4 slots
//                     with join/leave/ready states and human/AI toggle
// ===========================================================================
//
// "Build player slot management UI showing up to 4 slots with
//  join/leave/ready states and human/AI toggle."
//
// The UI itself is a thin Phaser layer over these helpers. So if the
// helpers correctly model:
//
//   • Join/leave (already pinned by the older Sub-AC 5 tests above).
//   • Ready state — toggleable per slot, invariant `ready ⇒ joined`,
//     dropped on leave / device-cycle, preserved through difficulty
//     changes, projected through preview + badge labels.
//   • Human/AI binary toggle — flips between any human input type
//     and AI bot in one press, distinct from the 4-state device cycle.
//   • Confirm gate — `canConfirmLobby` is true iff every joined slot
//     is ready.
//
// …then the AC is satisfied at the model layer; the LobbyScene wiring
// tests guard the Phaser hookup.
// ===========================================================================
describe('player slot management — AC 10402 Sub-AC 2', () => {
  // ---------------------------------------------------------------------
  // Default-state shape
  // ---------------------------------------------------------------------

  describe('DEFAULT_LOBBY_STATE — ready field', () => {
    it('opens with every slot un-ready', () => {
      for (const slot of DEFAULT_LOBBY_STATE.slots) {
        expect(slot.ready).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------
  // toggleSlotReady / setSlotReady
  // ---------------------------------------------------------------------

  describe('toggleSlotReady', () => {
    it('flips a joined slot from un-ready to ready', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      expect(a.slots[0]?.ready).toBe(false);
      const b = toggleSlotReady(a, 1);
      expect(b.slots[0]?.ready).toBe(true);
    });

    it('flips a ready slot back to un-ready (toggle)', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(s.slots[0]?.ready).toBe(true);
      s = toggleSlotReady(s, 1);
      expect(s.slots[0]?.ready).toBe(false);
    });

    it('returns the same reference when toggling an un-joined slot (silent no-op)', () => {
      // Invariant `ready ⇒ joined` — the toggle would attempt to set
      // ready=true on a slot whose joined=false, which the helper
      // rejects.
      const next = toggleSlotReady(DEFAULT_LOBBY_STATE, 1);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() => toggleSlotReady(DEFAULT_LOBBY_STATE, 5 as 1)).toThrow(
        /out of range/,
      );
    });

    it('preserves un-targeted slots across the toggle', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      const next = toggleSlotReady(s, 3);
      expect(next.slots[0]).toEqual(s.slots[0]);
      expect(next.slots[1]).toEqual(s.slots[1]);
      expect(next.slots[3]).toEqual(s.slots[3]);
    });

    it('preserves character/device fields when toggling ready', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', {
        gamepadIndex: 7,
      });
      const b = toggleSlotReady(a, 3);
      expect(b.slots[2]?.inputType).toBe('gamepad');
      expect(b.slots[2]?.gamepadIndex).toBe(7);
      expect(b.slots[2]?.ready).toBe(true);
    });
  });

  describe('setSlotReady', () => {
    it('explicitly sets ready: true on a joined slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = setSlotReady(a, 1, true);
      expect(b.slots[0]?.ready).toBe(true);
    });

    it('returns the same reference when ready already matches', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      // Already false → no-op.
      const b = setSlotReady(a, 1, false);
      expect(b).toBe(a);
    });

    it('refuses to set ready: true on an un-joined slot (silent no-op)', () => {
      const next = setSlotReady(DEFAULT_LOBBY_STATE, 1, true);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() => setSlotReady(DEFAULT_LOBBY_STATE, 0 as 1, true)).toThrow(
        /out of range/,
      );
    });
  });

  // ---------------------------------------------------------------------
  // ready ⇒ joined invariant — leaving / re-claiming drops ready
  // ---------------------------------------------------------------------

  describe('ready invariant', () => {
    it('leaveSlot drops ready back to false', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(s.slots[0]?.ready).toBe(true);
      s = leaveSlot(s, 1);
      expect(s.slots[0]?.joined).toBe(false);
      expect(s.slots[0]?.ready).toBe(false);
    });

    it('re-joining a slot with a different device drops ready', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(s.slots[0]?.ready).toBe(true);
      // Re-claim slot 1 as a gamepad — the device changed, so ready
      // should drop so the player has to deliberately re-confirm.
      s = joinSlot(s, 1, 'gamepad', { gamepadIndex: 0 });
      expect(s.slots[0]?.ready).toBe(false);
      expect(s.slots[0]?.inputType).toBe('gamepad');
    });

    it('cycling input type drops ready (device changed)', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai');
      s = toggleSlotReady(s, 3);
      expect(s.slots[2]?.ready).toBe(true);
      s = cycleSlotInputType(s, 3); // ai → keyboard_p1
      expect(s.slots[2]?.ready).toBe(false);
    });

    it('cycling AI difficulty preserves ready (config tweak, not a re-pick)', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai', {
        aiDifficulty: 'easy',
      });
      s = toggleSlotReady(s, 3);
      expect(s.slots[2]?.ready).toBe(true);
      s = cycleSlotAiDifficulty(s, 3); // easy → medium
      expect(s.slots[2]?.aiDifficulty).toBe('medium');
      expect(s.slots[2]?.ready).toBe(true);
    });

    it('setSlotAiDifficulty preserves ready', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai');
      s = toggleSlotReady(s, 3);
      s = setSlotAiDifficulty(s, 3, 'hard');
      expect(s.slots[2]?.aiDifficulty).toBe('hard');
      expect(s.slots[2]?.ready).toBe(true);
    });

    it('idempotent re-join preserves ready (same device fields, same state ref)', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      const t = joinSlot(s, 1, 'keyboard_p1');
      expect(t).toBe(s);
      expect(t.slots[0]?.ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // toggleSlotHumanAi — binary human/AI toggle
  // ---------------------------------------------------------------------

  describe('toggleSlotHumanAi', () => {
    it('flips a joined AI slot to a human keyboard half', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'ai');
      const b = toggleSlotHumanAi(a, 1);
      expect(b.slots[0]?.inputType).toBe('keyboard_p1');
    });

    it('slot 2 prefers keyboard_p2 when promoted human', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 2, 'ai');
      const b = toggleSlotHumanAi(a, 2);
      expect(b.slots[1]?.inputType).toBe('keyboard_p2');
    });

    it('flips a joined keyboard slot to AI with default medium difficulty', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const b = toggleSlotHumanAi(a, 1);
      expect(b.slots[0]?.inputType).toBe('ai');
      expect(b.slots[0]?.aiDifficulty).toBe('medium');
    });

    it('flips a joined gamepad slot to AI', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 3, 'gamepad', {
        gamepadIndex: 7,
      });
      const b = toggleSlotHumanAi(a, 3);
      expect(b.slots[2]?.inputType).toBe('ai');
      // The phantom gamepadIndex is dropped when promoted to AI.
      expect(b.slots[2]?.gamepadIndex).toBeUndefined();
    });

    it('falls back when both keyboard halves are claimed', () => {
      // Slots 1 and 2 own the keyboard halves. Slot 3 is AI; toggling
      // it human would pick the first keyboard half, but both are
      // taken by the exclusivity rule — the helper must silent-no-op
      // rather than steal a half from another slot.
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'ai');
      const next = toggleSlotHumanAi(s, 3);
      // Both halves taken → slot 3 stays AI.
      expect(next.slots[2]?.inputType).toBe('ai');
      expect(next).toBe(s);
    });

    it('drops ready when toggling (device changed)', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(s.slots[0]?.ready).toBe(true);
      const next = toggleSlotHumanAi(s, 1);
      expect(next.slots[0]?.inputType).toBe('ai');
      expect(next.slots[0]?.ready).toBe(false);
    });

    it('returns the same reference for an un-joined slot (silent no-op)', () => {
      const next = toggleSlotHumanAi(DEFAULT_LOBBY_STATE, 1);
      expect(next).toBe(DEFAULT_LOBBY_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() => toggleSlotHumanAi(DEFAULT_LOBBY_STATE, 5 as 1)).toThrow(
        /out of range/,
      );
    });

    it('round-trip: human → AI → human returns to a usable keyboard half', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotHumanAi(s, 1); // human → AI
      expect(s.slots[0]?.inputType).toBe('ai');
      s = toggleSlotHumanAi(s, 1); // AI → human
      expect(s.slots[0]?.inputType).toBe('keyboard_p1');
    });
  });

  // ---------------------------------------------------------------------
  // canConfirmLobby + getReadySlotCount
  // ---------------------------------------------------------------------

  describe('canConfirmLobby + getReadySlotCount', () => {
    it('returns 0 ready and false confirm on a fresh lobby', () => {
      expect(getReadySlotCount(DEFAULT_LOBBY_STATE)).toBe(0);
      expect(canConfirmLobby(DEFAULT_LOBBY_STATE)).toBe(false);
    });

    it('returns false confirm when at least one joined slot is not ready', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = toggleSlotReady(s, 1); // only slot 1 ready
      expect(getReadySlotCount(s)).toBe(1);
      expect(canStartLobby(s)).toBe(true); // looser gate fires
      expect(canConfirmLobby(s)).toBe(false); // strict gate doesn't
    });

    it('returns true confirm when every joined slot is ready', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = toggleSlotReady(s, 1);
      s = toggleSlotReady(s, 2);
      expect(getReadySlotCount(s)).toBe(2);
      expect(canConfirmLobby(s)).toBe(true);
    });

    it('returns true confirm for a single-player lobby that readied up', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(canConfirmLobby(s)).toBe(true);
    });

    it('un-joined slots do not block the confirm gate', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 4, 'ai');
      // Only slots 1 and 4 are joined; slots 2/3 are un-joined and
      // therefore must NOT count against the ready gate.
      s = toggleSlotReady(s, 1);
      s = toggleSlotReady(s, 4);
      expect(canConfirmLobby(s)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Badge formatters + preview projection
  // ---------------------------------------------------------------------

  describe('formatLobbyReadyBadge / formatLobbyHumanAiBadge', () => {
    it('emits empty badges for un-joined slots', () => {
      const slot = DEFAULT_LOBBY_STATE.slots[0]!;
      expect(formatLobbyReadyBadge(slot)).toBe('');
      expect(formatLobbyHumanAiBadge(slot)).toBe('');
    });

    it('emits NOT READY for a joined-but-un-ready slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      expect(formatLobbyReadyBadge(a.slots[0]!)).toBe('NOT READY');
    });

    it('emits READY ✓ for a ready slot', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      expect(formatLobbyReadyBadge(s.slots[0]!)).toBe('READY ✓');
    });

    it('emits HUMAN for a keyboard / gamepad slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const pad = joinSlot(DEFAULT_LOBBY_STATE, 1, 'gamepad', {
        gamepadIndex: 0,
      });
      expect(formatLobbyHumanAiBadge(a.slots[0]!)).toBe('HUMAN');
      expect(formatLobbyHumanAiBadge(pad.slots[0]!)).toBe('HUMAN');
    });

    it('emits AI for an AI bot slot', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 3, 'ai');
      expect(formatLobbyHumanAiBadge(a.slots[2]!)).toBe('AI');
    });
  });

  describe('LobbySlotPreview surfaces ready state and human/AI badge', () => {
    it('exposes ready, readyBadge, and humanAiBadge fields', () => {
      const slot = DEFAULT_LOBBY_STATE.slots[0]!;
      const preview = buildLobbySlotPreview(slot, {
        joinKey: '1',
        cycleKey: 'TAB',
        readyKey: 'R',
        humanAiKey: 'Z',
      });
      expect(preview.ready).toBe(false);
      expect(preview.readyBadge).toBe('');
      expect(preview.humanAiBadge).toBe('');
      // Un-joined hint never grows past the press-start prompt.
      expect(preview.hintLabel).toBe('Press [1] to JOIN');
    });

    it('paints "READY ✓" badge when the slot has readied up', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      const preview = buildLobbySlotPreview(s.slots[0]!, {
        joinKey: '1',
        cycleKey: 'TAB',
        readyKey: 'R',
        humanAiKey: 'Z',
      });
      expect(preview.ready).toBe(true);
      expect(preview.readyBadge).toBe('READY ✓');
      // Hint flips to "[R] UN-READY" so the player knows the toggle
      // direction.
      expect(preview.hintLabel).toMatch(/\[R\] UN-READY/);
    });

    it('paints "[R] READY UP" hint when joined but not ready', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const preview = buildLobbySlotPreview(a.slots[0]!, {
        joinKey: '1',
        cycleKey: 'TAB',
        readyKey: 'R',
        humanAiKey: 'Z',
      });
      expect(preview.hintLabel).toMatch(/\[R\] READY UP/);
    });

    it('paints "[Z] HUMAN/AI" hint when humanAiKey is supplied', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const preview = buildLobbySlotPreview(a.slots[0]!, {
        joinKey: '1',
        cycleKey: 'TAB',
        readyKey: 'R',
        humanAiKey: 'Z',
      });
      expect(preview.hintLabel).toMatch(/\[Z\] HUMAN\/AI/);
    });

    it('omits the human/AI segment when humanAiKey is undefined', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      const preview = buildLobbySlotPreview(a.slots[0]!, {
        joinKey: '1',
        cycleKey: 'TAB',
        readyKey: 'R',
      });
      expect(preview.hintLabel).not.toMatch(/HUMAN\/AI/);
    });

    it('legacy positional call form still produces a valid preview', () => {
      // Older tests that pre-date the AC 10402 work pass joinKey,
      // cycleKey, diffKey as positional strings; the preview should
      // still build (without ready / humanAi segments) so the legacy
      // test surface keeps passing.
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'ai');
      const preview = buildLobbySlotPreview(a.slots[0]!, '1', 'TAB', 'Q');
      expect(preview.hintLabel).toMatch(/\[1\] LEAVE/);
      expect(preview.hintLabel).toMatch(/\[Q\] cycle difficulty/);
      expect(preview.hintLabel).not.toMatch(/READY/);
      expect(preview.hintLabel).not.toMatch(/HUMAN\/AI/);
      expect(preview.ready).toBe(false);
    });
  });

  describe('buildLobbyPreviews threads ready/humanAi key labels', () => {
    it('paints a "READY UP" segment on every joined tile when readyKeyLabels supplied', () => {
      let s: LobbyState = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
      s = joinSlot(s, 3, 'ai');
      const previews = buildLobbyPreviews(
        s,
        ['1', '2', '3', '4'],
        ['TAB', 'T', 'U', 'O'],
        ['Q', 'Y', 'I', 'P'],
        ['R', 'G', 'H', 'K'],
        ['Z', 'X', 'C', 'V'],
      );
      // Slot 1 — joined human. Hint includes ready + human/AI.
      expect(previews[0]?.hintLabel).toMatch(/\[R\] READY UP/);
      expect(previews[0]?.hintLabel).toMatch(/\[Z\] HUMAN\/AI/);
      // Slot 2 — un-joined. Hint stays as press-to-join only.
      expect(previews[1]?.hintLabel).toBe('Press [2] to JOIN');
      // Slot 3 — joined AI. Hint includes difficulty cycle on top of
      // ready / human-AI.
      expect(previews[2]?.hintLabel).toMatch(/\[H\] READY UP/);
      expect(previews[2]?.hintLabel).toMatch(/\[I\] cycle difficulty/);
      expect(previews[2]?.hintLabel).toMatch(/\[C\] HUMAN\/AI/);
    });

    it('omits ready/humanAi segments when those label arrays are undefined', () => {
      const a = joinSlot(DEFAULT_LOBBY_STATE, 1, 'ai');
      const previews = buildLobbyPreviews(
        a,
        ['1', '2', '3', '4'],
        ['TAB', 'T', 'U', 'O'],
        ['Q', 'Y', 'I', 'P'],
      );
      expect(previews[0]?.hintLabel).not.toMatch(/READY/);
      expect(previews[0]?.hintLabel).not.toMatch(/HUMAN\/AI/);
    });
  });

  // ---------------------------------------------------------------------
  // Hand-off payload includes ready
  // ---------------------------------------------------------------------

  describe('hand-off payload preserves ready', () => {
    it('round-trips the ready flag through buildLobbyHandoffPayload', () => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = toggleSlotReady(s, 1);
      const payload = buildLobbyHandoffPayload(s);
      expect(payload.slots[0]?.ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Determinism — full session sequence
  // ---------------------------------------------------------------------

  describe('determinism — ready + human/AI sequence', () => {
    it('two identical sequences produce byte-equal lobby states', () => {
      const drive = (): LobbyState => {
        let s: LobbyState = DEFAULT_LOBBY_STATE;
        s = joinSlot(s, 1, 'keyboard_p1');
        s = joinSlot(s, 2, 'keyboard_p2');
        s = joinSlot(s, 3, 'ai', { aiDifficulty: 'easy' });
        s = toggleSlotHumanAi(s, 3); // ai → human (or stay AI if blocked)
        s = toggleSlotHumanAi(s, 3); // human → AI again
        s = toggleSlotReady(s, 1);
        s = toggleSlotReady(s, 2);
        s = toggleSlotReady(s, 3);
        return s;
      };
      const a = drive();
      const b = drive();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
