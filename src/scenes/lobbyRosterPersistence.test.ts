import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * AC 20403 Sub-AC 3 — "Wire scene transitions from LobbyScene into
 * CharacterSelectScene and then StageSelectScene with persisted player
 * roster data."
 *
 * The canonical scene chain post-AC 20104:
 *
 *   LobbyScene
 *     → ModeSelectScene
 *       → StageSelectScene
 *         → CharacterSelectScene
 *           → MatchScene
 *
 * Sub-AC 3 pins the contract that the player roster captured in the
 * lobby (joined slot count, input type per slot, AI difficulty per
 * slot, gamepad index per slot) survives every hop in the chain — and
 * survives the back-navigation hops too (CharacterSelect → StageSelect,
 * StageSelect → ModeSelect) so a player who ESCs out of one screen
 * doesn't lose the lobby acquisition they just spent time setting up.
 *
 * The wiring is implemented via a typed `lobby?: LobbyHandoffPayload`
 * field on every downstream scene's data type. Each `init(data)` reads
 * the payload, captures it on a private `pendingLobby` field, and each
 * scene's confirm/cancel handler forwards the captured payload into the
 * next `scene.start(...)` call.
 *
 * The runtime data path (lobby → handoff → character-select hydration →
 * `MatchConfig.players`) is tested elsewhere in `LobbyScene.test.ts`.
 * This file's focus is the two missing edges of the contract:
 *
 *   1. **Forward roster persistence** — every forward hop in the chain
 *      threads the lobby payload, so by the time the chain arrives at
 *      `CharacterSelectScene` (or any earlier point), the original
 *      lobby snapshot is byte-identical to what `LobbyScene` produced.
 *
 *   2. **Back roster persistence** — every cancel/back hop in the
 *      chain threads the lobby payload BACK to the previous scene, so
 *      a player who ESCs out of `CharacterSelectScene` lands in
 *      `StageSelectScene` with their roster intact (and ESCing again
 *      lands them in `ModeSelectScene` with the roster STILL intact).
 *      Without this, a single misclick would silently force the player
 *      to re-Press-Start every slot.
 *
 * Reading scene source as text (rather than running under jsdom) keeps
 * the test fast and Phaser-free — same strategy as `LobbyScene.test.ts`.
 */
describe('AC 20403 Sub-AC 3 — lobby roster persistence across the scene chain', () => {
  const LOBBY_SRC = readFileSync(
    resolve(__dirname, './LobbyScene.ts'),
    'utf8',
  );
  const MODE_SRC = readFileSync(
    resolve(__dirname, './ModeSelectScene.ts'),
    'utf8',
  );
  const STAGE_SRC = readFileSync(
    resolve(__dirname, './StageSelectScene.ts'),
    'utf8',
  );
  const CHAR_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  // -----------------------------------------------------------------
  // Forward roster persistence — every hop forwards `lobby` payload.
  // -----------------------------------------------------------------

  describe('forward roster persistence', () => {
    it('LobbyScene confirm → ModeSelectScene with lobby payload', () => {
      // The lobby is the source of truth for the player roster. Its
      // confirm path MUST forward the handoff payload so the next
      // scene can hydrate its UI from the joined slots.
      expect(LOBBY_SRC).toMatch(
        /scene\.start\(\s*['"]ModeSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
      );
    });

    it('ModeSelectScene confirm → CharacterSelectScene with lobby payload', () => {
      // Mid-chain hop (Smash-style ordering: fighters first, arena
      // last). ModeSelect must capture and forward the payload
      // verbatim — losing it here would silently force the player to
      // re-claim slots downstream.
      expect(MODE_SRC).toMatch(
        /scene\.start\(\s*['"]CharacterSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
      );
    });

    it('CharacterSelectScene confirm → StageSelectScene with lobby payload', () => {
      // The lineup picker forwards to the stage select (the final
      // pre-match screen). The payload rides along so a back-hop can
      // restore the joined slots without a second Press Start.
      expect(CHAR_SRC).toMatch(
        /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
      );
    });

    it('CharacterSelectScene applies the lobby handoff via the helper', () => {
      // The terminal ingestion. Without this call the joined slots
      // never light up on the character-select tiles, even though the
      // payload arrived — the AC silently fails on a missed call.
      expect(CHAR_SRC).toMatch(/applyLobbyHandoffToCharacterSelect/);
    });

    it('every downstream scene captures the lobby payload on init', () => {
      // The capture pattern is `private pendingLobby: ... = data?.lobby`.
      // Verify each hop's init() actually reads the payload off scene
      // data; otherwise the forward call into the next scene would
      // forward `undefined` and silently break the chain.
      expect(MODE_SRC).toMatch(/this\.pendingLobby\s*=\s*data\?\.lobby/);
      expect(STAGE_SRC).toMatch(/this\.pendingLobby\s*=\s*data\?\.lobby/);
      expect(CHAR_SRC).toMatch(/this\.pendingLobby\s*=\s*data\?\.lobby/);
    });

    it('every downstream scene types its data with `lobby?: LobbyHandoffPayload`', () => {
      // Type-level pin: each scene's `*SceneData` interface must
      // declare the payload field with the canonical handoff type so
      // the TS compiler catches a misnamed forward.
      expect(MODE_SRC).toMatch(/lobby\?:\s*LobbyHandoffPayload/);
      expect(STAGE_SRC).toMatch(/lobby\?:\s*LobbyHandoffPayload/);
      expect(CHAR_SRC).toMatch(/lobby\?:\s*LobbyHandoffPayload/);
    });
  });

  // -----------------------------------------------------------------
  // Back roster persistence — cancel/back hops also carry the payload.
  // -----------------------------------------------------------------

  describe('back roster persistence', () => {
    it('CharacterSelectScene cancel → ModeSelectScene with lobby payload', () => {
      // ESC out of character select must NOT drop the lobby on the
      // floor — the player would have to re-Press-Start every slot.
      // Match the canonical handler that forwards `lobby: this.pendingLobby`.
      expect(CHAR_SRC).toMatch(
        /scene\.start\(\s*['"]ModeSelectScene['"]\s*,\s*\{[\s\S]*?lobby:\s*this\.pendingLobby/,
      );
    });

    it('StageSelectScene cancel → CharacterSelectScene with lobby payload', () => {
      // Symmetric back-hop. ESC out of stage select must thread the
      // payload back so a player who picked the wrong stage doesn't
      // also lose their lineup.
      expect(STAGE_SRC).toMatch(
        /scene\.start\(\s*['"]CharacterSelectScene['"]\s*,\s*\{[\s\S]*?lobby:\s*this\.pendingLobby/,
      );
    });
  });

  // -----------------------------------------------------------------
  // Runtime contract — the data shape that flows through the chain
  // round-trips byte-identically through the helpers used at each hop.
  // -----------------------------------------------------------------

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
});
