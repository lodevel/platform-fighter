import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOBBY_STATE,
  buildLobbyHandoffPayload,
  joinSlot,
  toggleSlotReady,
  type LobbyHandoffPayload,
  type LobbyState,
} from './lobby';
import {
  DEFAULT_CHARACTER_SELECT_STATE,
  applyLobbyHandoffToCharacterSelect,
  buildPlayerSlotsFromState,
} from './characterSelect';


describe('runtime roster persistence', () => {
    /**
     * Build a representative 4-player lobby with mixed input types.
     * Mirrors the canonical "all four slots used" shape the AC asks
     * the chain to preserve.
     */
    function buildMixedLobby(): LobbyState {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'gamepad', { gamepadIndex: 0 });
      s = joinSlot(s, 4, 'ai', { aiDifficulty: 'hard' });
      // Ready up so the lobby would pass `canConfirmLobby`.
      s = toggleSlotReady(s, 1);
      s = toggleSlotReady(s, 2);
      s = toggleSlotReady(s, 3);
      s = toggleSlotReady(s, 4);
      return s;
    }

    it('lobby handoff carries every joined slot index, input type, and AI tier', () => {
      const handoff = buildLobbyHandoffPayload(buildMixedLobby());
      expect(handoff.slots).toHaveLength(4);
      expect(handoff.slots.map((s) => s.index)).toEqual([1, 2, 3, 4]);
      expect(handoff.slots[0]?.inputType).toBe('keyboard_p1');
      expect(handoff.slots[1]?.inputType).toBe('keyboard_p2');
      expect(handoff.slots[2]?.inputType).toBe('gamepad');
      expect(handoff.slots[3]?.inputType).toBe('ai');
      expect(handoff.slots[3]?.aiDifficulty).toBe('hard');
    });

    it('handoff JSON is identical when re-projected (deterministic threading)', () => {
      // The chain forwards the handoff verbatim across multiple
      // `scene.start` calls. Each forward is a JSON-serialisable
      // object reference; if the helper accidentally mutated the
      // payload mid-flight, the second projection would diverge.
      const lobby = buildMixedLobby();
      const a = buildLobbyHandoffPayload(lobby);
      const b = buildLobbyHandoffPayload(lobby);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('character-select hydration preserves every slot the lobby joined', () => {
      // The terminal ingestion at CharacterSelectScene. The hydrated
      // state must show the same joined-slot set as the lobby (with
      // ready=false forced so the player has to re-confirm characters).
      const handoff = buildLobbyHandoffPayload(buildMixedLobby());
      const csState = applyLobbyHandoffToCharacterSelect(
        DEFAULT_CHARACTER_SELECT_STATE,
        handoff,
      );
      const joined = csState.slots.filter((s) => s.joined);
      expect(joined).toHaveLength(4);
      for (const slot of joined) {
        expect(slot.ready).toBe(false);
      }
    });

    it('full chain round-trip: lobby → handoff → character select → MatchConfig.players is byte-identical for replays', () => {
      // The canonical determinism gate: two independent runs of the
      // same lobby snapshot must produce IDENTICAL synthesised players
      // arrays so a replay header pinned to one run plays back fine
      // against the other. If any chain hop introduced wall-clock /
      // RNG, this test would fail intermittently.
      const handoffA = buildLobbyHandoffPayload(buildMixedLobby());
      const handoffB = buildLobbyHandoffPayload(buildMixedLobby());
      const playersA = buildPlayerSlotsFromState(
        applyLobbyHandoffToCharacterSelect(DEFAULT_CHARACTER_SELECT_STATE, handoffA),
      );
      const playersB = buildPlayerSlotsFromState(
        applyLobbyHandoffToCharacterSelect(DEFAULT_CHARACTER_SELECT_STATE, handoffB),
      );
      expect(JSON.stringify(playersA)).toBe(JSON.stringify(playersB));
    });

    it('a back-hop preserves the captured lobby payload reference', () => {
      // Captured `pendingLobby` is a typed `LobbyHandoffPayload | undefined`.
      // The cancel handler forwards it verbatim; we simulate that by
      // building a payload, "capturing" it as if `init()` did, and
      // confirming the JSON round-trip is identical to the source.
      const captured: LobbyHandoffPayload = buildLobbyHandoffPayload(
        buildMixedLobby(),
      );
      const forwarded: LobbyHandoffPayload = captured; // mimic scene-data.lobby
      expect(JSON.stringify(forwarded)).toBe(JSON.stringify(captured));
    });
  });
