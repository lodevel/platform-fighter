import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_LOBBY_STATE,
  buildLobbyHandoffPayload,
  joinSlot,
  toggleSlotReady,
  type LobbyState,
} from './lobby';
import {
  DEFAULT_CHARACTER_SELECT_STATE,
  applyLobbyHandoffToCharacterSelect,
  buildPlayerSlotsFromState,
  lockInSlotCharacter,
  setSlotCharacter,
  setSlotPalette,
} from './characterSelect';
import type { MatchConfig, PlayerSlot } from '../types';

/**
 * AC 2 Sub-AC 5 — "Implement lobby flow with Press Start to join for
 * up to 4 players, slot assignment, and transition into character
 * select."
 *
 * `LobbyScene` itself imports Phaser, which pulls in browser globals
 * at module-eval time and can't be loaded under plain Node. The
 * selection logic + projection helpers live in the Phaser-free
 * `./lobby.ts` helper and are fully covered by `lobby.test.ts`.
 *
 * This file guards the *wiring* — the static contract that the scene's
 * source text must satisfy for the AC to hold:
 *
 *   1. The scene is registered under the `'LobbyScene'` key so
 *      `MainMenuScene` can `scene.start('LobbyScene')`.
 *   2. The scene's confirm path starts `ModeSelectScene` and forwards
 *      a `lobby` payload (so the joined lineup propagates).
 *   3. The scene's cancel path returns to `MainMenuScene`.
 *   4. The scene exposes a join key for every slot 1..4 so all four
 *      players can Press Start.
 *   5. The scene polls the Gamepad API so a fresh pad press claims a
 *      slot without the player having to touch the keyboard.
 *   6. The scene is registered in `GameConfig.SCENES` so Phaser knows
 *      about it on boot.
 *   7. `MainMenuScene`'s ENTER handler routes through `LobbyScene`
 *      (rather than skipping straight to mode select).
 *   8. The downstream scenes (Mode/Stage/Character Select) thread the
 *      `lobby` payload through their scene-data so the lineup
 *      survives the round-trip.
 *
 * Reading the source as text rather than running it under jsdom keeps
 * the test fast and free of Phaser's browser globals — same strategy
 * as `CharacterSelectScene.test.ts` and `ResultsScene.test.ts`.
 */
describe('LobbyScene — AC 2 Sub-AC 5 wiring contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './LobbyScene.ts'),
    'utf8',
  );

  it('registers under the "LobbyScene" scene key', () => {
    expect(SCENE_SRC).toMatch(/key:\s*['"]LobbyScene['"]/);
  });

  it('confirm path starts ModeSelectScene with a lobby payload', () => {
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]ModeSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
    );
  });

  it('cancel path returns to MainMenuScene', () => {
    expect(SCENE_SRC).toMatch(/scene\.start\(\s*['"]MainMenuScene['"]\s*\)/);
  });

  it('gates the confirm path on canStartLobby', () => {
    // ENTER must short-circuit when no players have joined. Looking
    // for the literal `if (!canStartLobby(this.state)) return` guard.
    expect(SCENE_SRC).toMatch(/if\s*\(\s*!canStartLobby\(/);
  });

  it('exposes a join key for every slot 1..4', () => {
    expect(SCENE_SRC).toMatch(/joinKey:\s*['"]ONE['"]/);
    expect(SCENE_SRC).toMatch(/joinKey:\s*['"]TWO['"]/);
    expect(SCENE_SRC).toMatch(/joinKey:\s*['"]THREE['"]/);
    expect(SCENE_SRC).toMatch(/joinKey:\s*['"]FOUR['"]/);
    expect(SCENE_SRC).toMatch(/keydown-\$\{ctl\.joinKey\}/);
  });

  it('imports the unit-tested helper functions instead of re-implementing them', () => {
    // AC 10401 Sub-AC 1 — the scene routes both press-start paths
    // (keyboard via `pressStartJoinFromKeyboard`, gamepad via
    // `pollGamepadPressStartJoins`) through the helpers; both
    // helpers transitively use `joinSlot` / `joinNextFreeSlotForGamepad`
    // so the helpers stay the single source of truth.
    expect(SCENE_SRC).toMatch(/pressStartJoinFromKeyboard/);
    expect(SCENE_SRC).toMatch(/pollGamepadPressStartJoins/);
    expect(SCENE_SRC).toMatch(/leaveSlot/);
    expect(SCENE_SRC).toMatch(/canStartLobby/);
    expect(SCENE_SRC).toMatch(/buildLobbyHandoffPayload/);
  });

  it('polls the Gamepad API so a pad press can claim a slot', () => {
    // The Gamepad API is the Seed's "gamepads unlimited via Gamepad
    // API" path. A fresh pad-button-down must drive the lobby's
    // press-start helper; the polling lives on `update()` so Phaser
    // drives the sample loop.
    expect(SCENE_SRC).toMatch(/this\.input\.gamepad/);
    expect(SCENE_SRC).toMatch(/pollGamepadPressStartJoins\(/);
  });

  it('binds ENTER and ESC to confirm / cancel handlers', () => {
    expect(SCENE_SRC).toMatch(/keydown-ENTER/);
    expect(SCENE_SRC).toMatch(/keydown-ESC/);
  });

  it('paints "PLAYER LOBBY" as the title', () => {
    // Surfaces a dev-readable title so the player knows where they
    // are in the flow.
    expect(SCENE_SRC).toContain('PLAYER LOBBY');
  });

  // -----------------------------------------------------------------
  // AC 10205 Sub-AC 5 — wire AI controller selection into the slot
  // configuration so per-AI-slot difficulty is selectable.
  // -----------------------------------------------------------------

  it('exposes a per-slot diffKey for AI difficulty cycling', () => {
    // The SLOT_CONTROLS table must declare a diffKey for each slot so
    // the keyboard handler binds Q/Y/I/P to the cycle dispatch.
    expect(SCENE_SRC).toMatch(/diffKey:\s*['"]Q['"]/);
    expect(SCENE_SRC).toMatch(/diffKey:\s*['"]Y['"]/);
    expect(SCENE_SRC).toMatch(/diffKey:\s*['"]I['"]/);
    expect(SCENE_SRC).toMatch(/diffKey:\s*['"]P['"]/);
    expect(SCENE_SRC).toMatch(/keydown-\$\{ctl\.diffKey\}/);
  });

  it('routes the diff key through cycleSlotAiDifficulty', () => {
    // The scene must consume the unit-tested helper rather than
    // re-implementing the cycle inline. If a future maintainer
    // breaks this contract by hand-rolling the cycle in the scene,
    // the lobby silently no-ops on the diff key.
    expect(SCENE_SRC).toMatch(/cycleSlotAiDifficulty/);
  });

  it('threads the diff key label through to buildLobbySlotPreview', () => {
    // The preview hint row paints "[Q] cycle difficulty" only when
    // the scene actually forwards the diffKeyLabel; otherwise the
    // helper falls back to the legacy two-key hint.
    expect(SCENE_SRC).toMatch(/diffKey:\s*ctl\.diffKeyLabel/);
  });

  // -----------------------------------------------------------------
  // AC 10402 Sub-AC 2 — player slot management UI
  //
  // "Build player slot management UI showing up to 4 slots with
  //  join/leave/ready states and human/AI toggle."
  //
  // The static contract the scene source must satisfy:
  //
  //   • SLOT_CONTROLS declares a per-slot READY key and HUMAN/AI key.
  //   • Each key is bound through Phaser's keydown listener.
  //   • The handlers route through the unit-tested helpers
  //     (`toggleSlotReady`, `toggleSlotHumanAi`).
  //   • The scene paints a ready badge + human/AI badge on every
  //     tile so the player can see the four required states
  //     (joined / un-joined / ready / human-or-AI) at a glance.
  //   • The header label shows ready count + advance gate.
  // -----------------------------------------------------------------

  it('declares a per-slot READY key for each of the 4 slots', () => {
    expect(SCENE_SRC).toMatch(/readyKey:\s*['"]R['"]/);
    expect(SCENE_SRC).toMatch(/readyKey:\s*['"]G['"]/);
    expect(SCENE_SRC).toMatch(/readyKey:\s*['"]H['"]/);
    expect(SCENE_SRC).toMatch(/readyKey:\s*['"]K['"]/);
    expect(SCENE_SRC).toMatch(/keydown-\$\{ctl\.readyKey\}/);
  });

  it('declares a per-slot HUMAN/AI toggle key for each of the 4 slots', () => {
    expect(SCENE_SRC).toMatch(/humanAiKey:\s*['"]Z['"]/);
    expect(SCENE_SRC).toMatch(/humanAiKey:\s*['"]X['"]/);
    expect(SCENE_SRC).toMatch(/humanAiKey:\s*['"]C['"]/);
    expect(SCENE_SRC).toMatch(/humanAiKey:\s*['"]V['"]/);
    expect(SCENE_SRC).toMatch(/keydown-\$\{ctl\.humanAiKey\}/);
  });

  it('routes the ready key through toggleSlotReady', () => {
    expect(SCENE_SRC).toMatch(/toggleSlotReady\(/);
  });

  it('routes the human/AI key through toggleSlotHumanAi', () => {
    expect(SCENE_SRC).toMatch(/toggleSlotHumanAi\(/);
  });

  it('imports the AC 10402 helpers (canConfirmLobby + getReadySlotCount)', () => {
    expect(SCENE_SRC).toMatch(/canConfirmLobby/);
    expect(SCENE_SRC).toMatch(/getReadySlotCount/);
  });

  it('declares ready and human/AI badge texts on each slot tile', () => {
    // Tile-build code paints two bold corner badges so the player
    // can read both ready state and human/AI classification at a
    // glance without parsing the multi-segment hint row.
    expect(SCENE_SRC).toMatch(/readyBadge:\s*Phaser\.GameObjects\.Text/);
    expect(SCENE_SRC).toMatch(/humanAiBadge:\s*Phaser\.GameObjects\.Text/);
  });

  it('threads readyKeyLabel + humanAiKeyLabel into buildLobbySlotPreview', () => {
    // The preview hint row only paints "[R] READY UP" / "[Z] HUMAN/AI"
    // when the scene forwards the corresponding labels.
    expect(SCENE_SRC).toMatch(/readyKey:\s*ctl\.readyKeyLabel/);
    expect(SCENE_SRC).toMatch(/humanAiKey:\s*ctl\.humanAiKeyLabel/);
  });

  it('paints ready/human-AI hint row above the tiles', () => {
    // A second hint row tells the player which keys do what without
    // overflowing the primary hint above.
    expect(SCENE_SRC).toMatch(/READY UP/);
    expect(SCENE_SRC).toMatch(/HUMAN\/AI/);
  });
});

describe('GameConfig — LobbyScene registration', () => {
  it('imports LobbyScene and includes it in the scene list', () => {
    const cfg = readFileSync(
      resolve(__dirname, '../engine/GameConfig.ts'),
      'utf8',
    );
    expect(cfg).toMatch(/import\s*\{\s*LobbyScene\s*\}/);
    expect(cfg).toMatch(/LobbyScene,/);
  });
});

describe('MainMenuScene — ENTER routes past Lobby into the select chain', () => {
  // The original AC 2 Sub-AC 5 flow had MainMenu → Lobby → ModeSelect.
  // Lobby was later skipped because CharacterSelectScene covers
  // everything Lobby used to (join / AI / device + character / palette
  // / ready), so the unmodified-ENTER path now lands on
  // ModeSelectScene directly. LobbyScene remains registered + reachable
  // (e.g. from older save data or future re-introduction), but it is
  // no longer the entry point.
  it('starts ModeSelectScene on ENTER (default path)', () => {
    const src = readFileSync(
      resolve(__dirname, './MainMenuScene.ts'),
      'utf8',
    );
    expect(src).toMatch(/scene\.start\(\s*['"]ModeSelectScene['"]\s*\)/);
  });

  it('does not route ENTER to LobbyScene anymore', () => {
    const src = readFileSync(
      resolve(__dirname, './MainMenuScene.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/scene\.start\(\s*['"]LobbyScene['"]\s*\)/);
  });
});

describe('ModeSelectScene + StageSelectScene — forward the lobby payload', () => {
  it('ModeSelectScene starts StageSelectScene with a lobby field', () => {
    const src = readFileSync(
      resolve(__dirname, './ModeSelectScene.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
    );
  });

  it('StageSelectScene starts CharacterSelectScene with a lobby field', () => {
    const src = readFileSync(
      resolve(__dirname, './StageSelectScene.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /scene\.start\(\s*['"]CharacterSelectScene['"]\s*,\s*\{[\s\S]*?lobby/,
    );
  });

  it('CharacterSelectScene applies the lobby hand-off via the helper', () => {
    const src = readFileSync(
      resolve(__dirname, './CharacterSelectScene.ts'),
      'utf8',
    );
    expect(src).toMatch(/applyLobbyHandoffToCharacterSelect/);
  });
});

describe('applyLobbyHandoffToCharacterSelect — lobby → character select hydration', () => {
  it('lights up joined slots and resets unjoined ones to un-joined', () => {
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 3, 'ai', { aiDifficulty: 'hard' });
    const handoff = buildLobbyHandoffPayload(lobby);
    const next = applyLobbyHandoffToCharacterSelect(
      DEFAULT_CHARACTER_SELECT_STATE,
      handoff,
    );

    // Slot 1 → joined as keyboard P1.
    expect(next.slots[0]).toMatchObject({
      index: 1,
      joined: true,
      inputType: 'keyboard_p1',
    });
    // Slot 2 → not in lobby payload, so it was reset to un-joined
    // even though the default state had it un-joined already (this
    // also normalises the "default state pre-joined slot 1 but lobby
    // says only 3 joined" case).
    expect(next.slots[1]?.joined).toBe(false);
    // Slot 3 → joined as AI with the lobby's difficulty.
    expect(next.slots[2]).toMatchObject({
      index: 3,
      joined: true,
      inputType: 'ai',
      aiDifficulty: 'hard',
    });
    // Slot 4 → not in lobby payload.
    expect(next.slots[3]?.joined).toBe(false);
  });

  it('forces ready: false on every slot so the player has to re-confirm', () => {
    const lobby = joinSlot(DEFAULT_LOBBY_STATE, 1, 'keyboard_p1');
    const handoff = buildLobbyHandoffPayload(lobby);
    const next = applyLobbyHandoffToCharacterSelect(
      DEFAULT_CHARACTER_SELECT_STATE,
      handoff,
    );
    for (const s of next.slots) {
      expect(s.ready).toBe(false);
    }
  });

  it('drops the default joined-on-slot-1 if the lobby payload omits it', () => {
    // The default character-select state pre-joins slot 1 as a
    // smoke-test convenience. The lobby is the canonical authority,
    // so a hand-off that doesn't include slot 1 must reset it to
    // un-joined.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 2, 'keyboard_p2');
    const handoff = buildLobbyHandoffPayload(lobby);
    const next = applyLobbyHandoffToCharacterSelect(
      DEFAULT_CHARACTER_SELECT_STATE,
      handoff,
    );
    expect(next.slots[0]?.joined).toBe(false);
    expect(next.slots[1]?.joined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 10404 Sub-AC 4 — lobby-to-match transition contract
//
// "Wire lobby-to-match transition that passes selected players, characters,
//  and input bindings into the match scene."
//
// The lobby is the canonical entry point; the chain is:
//
//   LobbyScene → ModeSelectScene → StageSelectScene → CharacterSelectScene
//              → MatchScene
//
// At each hop, the lobby's `LobbyHandoffPayload` rides along on
// `scene-data.lobby` until `CharacterSelectScene` ingests it via
// {@link applyLobbyHandoffToCharacterSelect} and synthesises the final
// `MatchConfig.players` lineup via {@link buildPlayerSlotsFromState}.
// The `MatchConfig` is then handed to `MatchScene.create()` via
// `scene.start('MatchScene', { matchConfig })`.
//
// This block is the explicit end-to-end *contract* test that the wiring
// preserves all three pieces:
//
//   1. **Selected players** — every slot the lobby's `Press Start to Join`
//      claimed survives into `MatchConfig.players` (and unjoined slots are
//      dropped, not silently spawned as ghosts).
//   2. **Characters** — each player's `characterId` reflects the
//      character-select pick (not the lobby's stub default).
//   3. **Input bindings** — each player's `inputType` matches what the
//      lobby chose (keyboard P1, keyboard P2, gamepad, AI), with the
//      AI tier (`aiDifficulty`) preserved verbatim. The runtime
//      `InputBindingsStore` is keyed by player slot 1..4, so passing
//      `inputType` + `index` is sufficient — `MatchScene` resolves the
//      action map from the registry-backed bindings store keyed by
//      `bindingsSlot === PlayerSlot.index`.
//
// Tests below treat the wire as a black box: build a synthetic lobby,
// roll it through the helpers in the same order the scene chain does,
// and assert the resulting `MatchConfig.players` payload satisfies the
// three contract clauses.
// ---------------------------------------------------------------------------

/**
 * Roll a lobby state through the lobby → handoff → character-select →
 * match-config pipeline the live scenes use. Returns the synthesised
 * `MatchConfig.players` array — the canonical bridge from "what the
 * lobby decided" to "what `MatchScene` consumes."
 *
 * Mirrors the in-scene flow:
 *
 *   1. {@link buildLobbyHandoffPayload} — the lobby's exit projection
 *      (un-joined slots dropped, gamepadIndex / aiDifficulty preserved).
 *   2. {@link applyLobbyHandoffToCharacterSelect} — character-select
 *      ingestion (joined / inputType / aiDifficulty mirrored, ready=false
 *      forced so the player must re-confirm).
 *   3. Optional `customise` callback — lets a test play character /
 *      palette picks on top of the hydrated state to mirror the player
 *      walking through character select.
 *   4. {@link buildPlayerSlotsFromState} — the synthesised
 *      `MatchConfig.players` array `MatchScene` reads.
 */
function rollLobbyToMatchPlayers(
  lobby: LobbyState,
  customise?: (
    s: ReturnType<typeof applyLobbyHandoffToCharacterSelect>,
  ) => ReturnType<typeof applyLobbyHandoffToCharacterSelect>,
): ReadonlyArray<PlayerSlot> {
  const handoff = buildLobbyHandoffPayload(lobby);
  let csState = applyLobbyHandoffToCharacterSelect(
    DEFAULT_CHARACTER_SELECT_STATE,
    handoff,
  );
  if (customise) csState = customise(csState);
  return buildPlayerSlotsFromState(csState);
}

describe('AC 10404 Sub-AC 4 — lobby → match wiring contract', () => {
  // -----------------------------------------------------------------
  // Static contract — the scene chain is wired correctly.
  //
  // Reads the source files and verifies the chain's static structure:
  // each scene starts the next with the lobby payload threaded through;
  // CharacterSelectScene applies the handoff and starts MatchScene with
  // a synthesised matchConfig.
  // -----------------------------------------------------------------

  it('CharacterSelectScene starts MatchScene with the matchConfig payload', () => {
    // The terminal hop. CharacterSelectScene synthesises the final
    // `MatchConfig` and forwards it via scene-data so MatchScene's
    // `create(data)` reads `data.matchConfig.players` directly.
    const src = readFileSync(
      resolve(__dirname, './CharacterSelectScene.ts'),
      'utf8',
    );
    expect(src).toMatch(
      /scene\.start\(\s*['"]MatchScene['"]\s*,\s*\{[\s\S]*?matchConfig/,
    );
  });

  it('MatchScene reads matchConfig.players to spawn the lineup', () => {
    // The receiver. MatchScene must consume `data.matchConfig.players`
    // when wiring fighters / palettes / per-slot characters; without
    // this read the lobby's selection is silently ignored and the
    // scene falls back to its M1 dev-mode defaults.
    const src = readFileSync(
      resolve(__dirname, './MatchScene.ts'),
      'utf8',
    );
    expect(src).toMatch(/data\?\.matchConfig\?\.players/);
    // Sub-AC 4 — characterId resolution comes from the matchConfig's
    // players array via `resolveSlotCharacterId`, which is the
    // canonical "lobby slot N → character N" lookup. If a future
    // refactor inlines a hardcoded character id here the lobby's
    // pick is silently dropped.
    expect(src).toMatch(/resolveSlotCharacterId\(\s*data\?\.matchConfig\?\.players/);
    // Sub-AC 4 — paletteIndex is also read from the matchConfig so the
    // colour the player picked in character select actually paints
    // on the in-match fighter.
    expect(src).toMatch(/data\?\.matchConfig\?\.players\?\.find/);
  });

  it('MatchScene reads input bindings from the shared bindings store', () => {
    // Sub-AC 4 — input bindings flow through the shared
    // `InputBindingsStore` on the registry, keyed by `bindingsSlot`
    // which equals `PlayerSlot.index`. Every per-player input read in
    // the gameplay loop must route through the central `InputResolver`
    // / `inputDispatcher`, which reads the store; the source must NOT
    // hardcode key tables in the per-step input path.
    //
    // AC 50202 Sub-AC 2 — gameplay input consumers resolve every
    // action through the central `InputResolver` keyed by the slot's
    // `bindingsSlot`, replacing the previous per-frame
    // `inputService.sampleCharacterInput` path while still reading
    // through the same `InputBindingsStore` so the rebinding scene's
    // mutations carry into the match unchanged.
    const src = readFileSync(
      resolve(__dirname, './MatchScene.ts'),
      'utf8',
    );
    expect(src).toMatch(/acquireBindingsStore/);
    expect(src).toMatch(/InputBindingsStore/);
    expect(src).toMatch(/bindingsSlot/);
    expect(src).toMatch(/inputResolver/);
    expect(src).toMatch(/buildCharacterInputFromResolver/);
    // The dispatcher must read from the SAME bindings store the
    // rebinding scene mutates so per-player rebinds committed before
    // FIGHT carry into the match.
    expect(src).toMatch(/bindings:\s*bindingsStore/);
  });

  // -----------------------------------------------------------------
  // Runtime contract — data actually flows through the helpers.
  //
  // Builds a synthetic lobby with mixed input types, rolls it through
  // the scene chain's pure helpers, and asserts the synthesised
  // `MatchConfig.players` carries the lobby's selections.
  // -----------------------------------------------------------------

  it('preserves every joined slot from the lobby into MatchConfig.players', () => {
    // Lobby with all 4 slots joined: P1 keyboard, P2 keyboard, P3 pad,
    // P4 AI. The synthesised lineup must include exactly those 4
    // entries, indexed 1..4 in order.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');
    lobby = joinSlot(lobby, 3, 'gamepad', { gamepadIndex: 0 });
    lobby = joinSlot(lobby, 4, 'ai', { aiDifficulty: 'hard' });

    const players = rollLobbyToMatchPlayers(lobby);
    expect(players).toHaveLength(4);
    expect(players.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('drops un-joined slots so a 2-player lobby produces a 2-player match', () => {
    // Sub-AC 4 — the canonical "2P keyboard match" path. Lobby joins
    // slots 1 and 2 only; the synthesised lineup must NOT carry
    // ghost entries for slots 3/4 (which would otherwise spawn empty
    // fighters in MatchScene).
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');

    const players = rollLobbyToMatchPlayers(lobby);
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.index)).toEqual([1, 2]);
  });

  it('passes each slot input type from the lobby into MatchConfig.players', () => {
    // Sub-AC 4 — "input bindings" clause. The lobby's per-slot
    // `inputType` (keyboard_p1 / keyboard_p2 / gamepad / ai) IS the
    // input-binding selection — `MatchScene` reads this to decide
    // which `bindingsSlot` profile to pull live actions from on every
    // fixed step.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');
    lobby = joinSlot(lobby, 3, 'gamepad', { gamepadIndex: 0 });
    lobby = joinSlot(lobby, 4, 'ai', { aiDifficulty: 'medium' });

    const players = rollLobbyToMatchPlayers(lobby);
    expect(players[0]?.inputType).toBe('keyboard_p1');
    expect(players[1]?.inputType).toBe('keyboard_p2');
    expect(players[2]?.inputType).toBe('gamepad');
    expect(players[3]?.inputType).toBe('ai');
  });

  it('preserves AI difficulty per slot (easy / medium / hard)', () => {
    // Sub-AC 4 — AI bots are fully-described players too: their tier
    // selects the behaviour-tree profile MatchScene wires up. A
    // dropped difficulty would silently demote a Hard bot to the
    // default Medium and break the player's expected match shape.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'ai', { aiDifficulty: 'easy' });
    lobby = joinSlot(lobby, 2, 'ai', { aiDifficulty: 'medium' });
    lobby = joinSlot(lobby, 3, 'ai', { aiDifficulty: 'hard' });

    const players = rollLobbyToMatchPlayers(lobby);
    expect(players[0]?.aiDifficulty).toBe('easy');
    expect(players[1]?.aiDifficulty).toBe('medium');
    expect(players[2]?.aiDifficulty).toBe('hard');
  });

  it('omits aiDifficulty from human slots (no phantom field on keyboard / gamepad)', () => {
    // Defence-in-depth: even though the lobby's `joinSlot` only sets
    // `aiDifficulty` for AI slots, a future hand-off path that loads a
    // crafted JSON could carry the phantom field. The
    // `applyLobbyHandoffToCharacterSelect` helper strips it before
    // synthesis so MatchConfig.players never carries a stale
    // difficulty on a human slot.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 3, 'gamepad', { gamepadIndex: 0 });

    const players = rollLobbyToMatchPlayers(lobby);
    expect(players[0]?.aiDifficulty).toBeUndefined();
    expect(players[1]?.aiDifficulty).toBeUndefined();
  });

  it('passes selected characters from character select into MatchConfig.players', () => {
    // Sub-AC 4 — "characters" clause. The lobby provides the slot
    // claim; the player picks the fighter in CharacterSelectScene.
    // The synthesised lineup must carry the picked characterId
    // (Wolf / Cat / Owl / Bear), not the slot's lobby-stub default.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');
    lobby = joinSlot(lobby, 3, 'ai', { aiDifficulty: 'medium' });
    lobby = joinSlot(lobby, 4, 'ai', { aiDifficulty: 'hard' });

    // Walk the character-select picks the player would make: P1 picks
    // Bear, P2 sticks with Cat (default), P3 picks Wolf, P4 picks Owl.
    const players = rollLobbyToMatchPlayers(lobby, (s) => {
      let next = s;
      next = setSlotCharacter(next, 1, 'bear');
      next = setSlotCharacter(next, 3, 'wolf');
      next = setSlotCharacter(next, 4, 'owl');
      return next;
    });

    expect(players).toHaveLength(4);
    expect(players[0]?.characterId).toBe('bear');
    expect(players[1]?.characterId).toBe('cat'); // slot 2 default
    expect(players[2]?.characterId).toBe('wolf');
    expect(players[3]?.characterId).toBe('owl');
  });

  it('passes selected palette indices through to MatchConfig.players', () => {
    // Sub-AC 4 — the palette index is part of the "selected characters"
    // contract: each `PlayerSlot` carries `paletteIndex` so the match
    // scene paints the right colour on the visual rectangle (and, in
    // a future sub-AC, on the sprite atlas).
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');

    const players = rollLobbyToMatchPlayers(lobby, (s) => {
      // Player 1 cycles to palette 5; Player 2 stays on the default.
      return setSlotPalette(s, 1, 5);
    });
    expect(players[0]?.paletteIndex).toBe(5);
    // Slot 2's default palette mirrors `defaultPaletteIndexForSlot(2)`
    // which equals slot index - 1.
    expect(players[1]?.paletteIndex).toBe(1);
  });

  it('produces a fully-formed MatchConfig.players array shape', () => {
    // Defence-in-depth: every entry must be a fully-frozen `PlayerSlot`
    // with all required fields populated. A missing field would fail
    // type-checking at the `MatchScene` consumer but fall through at
    // runtime in JS — pin the contract here so a future helper change
    // can't silently drop a field.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 4, 'ai', { aiDifficulty: 'hard' });

    const players = rollLobbyToMatchPlayers(lobby);
    expect(Object.isFrozen(players)).toBe(true);
    for (const p of players) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(typeof p.index).toBe('number');
      expect(typeof p.characterId).toBe('string');
      expect(typeof p.paletteIndex).toBe('number');
      expect(typeof p.inputType).toBe('string');
    }
  });

  it('full round-trip: lobby → handoff → CharacterSelect → MatchConfig is byte-identical for replays', () => {
    // Determinism gate. Two lobbies that joined the same devices in
    // the same order must produce IDENTICAL `MatchConfig.players`
    // arrays. The replay header pins this — if the projection is
    // non-deterministic, a re-record diverges and the replay test
    // fixture stops being useful.
    const buildLobby = (): LobbyState => {
      let s: LobbyState = DEFAULT_LOBBY_STATE;
      s = joinSlot(s, 1, 'keyboard_p1');
      s = joinSlot(s, 2, 'keyboard_p2');
      s = joinSlot(s, 3, 'gamepad', { gamepadIndex: 1 });
      s = joinSlot(s, 4, 'ai', { aiDifficulty: 'hard' });
      // Ready up every slot to mirror the live scene's confirm gate.
      s = toggleSlotReady(s, 1);
      s = toggleSlotReady(s, 2);
      s = toggleSlotReady(s, 3);
      s = toggleSlotReady(s, 4);
      return s;
    };

    const playersA = rollLobbyToMatchPlayers(buildLobby(), (s) =>
      lockInSlotCharacter(s, 1),
    );
    const playersB = rollLobbyToMatchPlayers(buildLobby(), (s) =>
      lockInSlotCharacter(s, 1),
    );
    // Structural deep-equal — frozen object identity won't match across
    // two independent runs but the JSON projection must.
    expect(JSON.stringify(playersA)).toBe(JSON.stringify(playersB));
  });

  it('lineup synthesises into a complete MatchConfig consumable by MatchScene', () => {
    // Final integration check: build the canonical 2P stocks-mode
    // MatchConfig the scene chain produces and verify it satisfies
    // the `MatchConfig` shape `MatchScene.create(data)` reads.
    let lobby: LobbyState = DEFAULT_LOBBY_STATE;
    lobby = joinSlot(lobby, 1, 'keyboard_p1');
    lobby = joinSlot(lobby, 2, 'keyboard_p2');

    const players = rollLobbyToMatchPlayers(lobby);
    const matchConfig: MatchConfig = Object.freeze({
      mode: 'stocks',
      stockCount: 3,
      stageId: 'flat',
      players,
      rngSeed: 0xdeadbeef,
    }) as MatchConfig;

    // The ontology fields MatchScene reads directly:
    expect(matchConfig.players).toHaveLength(2);
    expect(matchConfig.players[0]?.characterId).toBeDefined();
    expect(matchConfig.players[0]?.inputType).toBe('keyboard_p1');
    expect(matchConfig.players[1]?.inputType).toBe('keyboard_p2');
    expect(matchConfig.stageId).toBe('flat');
    expect(matchConfig.rngSeed).toBe(0xdeadbeef);
  });
});
