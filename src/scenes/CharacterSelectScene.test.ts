import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CharacterSelectScene wiring contract — Smash-style join-=-picked CSS.
 *
 * `CharacterSelectScene` itself imports Phaser, which pulls in browser
 * globals at module-eval time and can't be loaded under plain Node.
 * The selection logic + palette projections it forwards to live in the
 * Phaser-free `./characterSelect.ts` + `./handCursorState.ts` helpers
 * and are fully covered by their own unit suites.
 *
 * This file guards the *wiring* — the static contract that the scene's
 * source text must satisfy:
 *
 *   1. The scene is registered under the `'CharacterSelectScene'` key
 *      so `ModeSelectScene` can `scene.start('CharacterSelectScene', ...)`.
 *   2. Confirm forwards the lineup to `StageSelectScene` (Smash flow:
 *      fighters first, arena last); cancel returns to `ModeSelectScene`.
 *   3. Join = picked: joining a slot routes through `setSlotMode`,
 *      whose auto-pick contract the hand-cursor unit tests pin — no
 *      separate ready / lock-in step exists.
 *   4. Gamepads join in-scene: the update loop pumps every CONNECTED
 *      pad and an unassigned pad's button press claims a slot.
 *   5. The palette pipeline (autoAssignDistinctPalettes, buildSlotPreview,
 *      applyPaletteSwap, RuntimePaletteRenderer) stays the single
 *      colour source shared with MatchScene.
 *
 * Reading the source as text rather than running it under jsdom keeps
 * the test fast and free of Phaser's browser globals — same strategy
 * as `ResultsScene.test.ts` and `ModeSelectScene.test.ts`.
 */
describe('CharacterSelectScene — AC 13 Sub-AC 4 wiring contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('registers under the "CharacterSelectScene" scene key', () => {
    // ModeSelectScene navigates by string key; if this drifts the
    // scene becomes unreachable from the menu and the AC silently
    // breaks.
    expect(SCENE_SRC).toMatch(/key:\s*['"]CharacterSelectScene['"]/);
  });

  it('confirm path forwards the lineup to StageSelectScene (fighters first, arena last)', () => {
    // The Smash-style flow runs Mode → Character → Stage → Match. The
    // chosen lineup reaches the stage select through the
    // `pendingMatchConfig` payload with `players` merged in; the stage
    // select then launches MatchScene with the completed config.
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig:\s*\{\s*\.\.\.base,\s*players\s*\}/,
    );
    // The scene must NOT launch MatchScene directly any more — the
    // stage select is the terminal pre-match hop.
    expect(SCENE_SRC).not.toMatch(/scene\.start\(\s*['"]MatchScene['"]/);
  });

  it('cancel path returns to ModeSelectScene with the lobby payload', () => {
    // ESC backs up ONE step in the flow (to the mode select) and
    // threads the lobby payload so the joined slots survive the
    // round-trip.
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]ModeSelectScene['"]\s*,\s*\{\s*lobby:\s*this\.pendingLobby\s*\}\s*\)/,
    );
  });

  it('runs every state transition through autoAssignDistinctPalettes', () => {
    // Sub-AC 4's headline contract: the scene must call the auto-
    // distinct-palette pass after every transition so duplicate-
    // character lobbies are silently differentiated. If the scene
    // skips this call, two slots can both pick Wolf and end up
    // visually indistinguishable in-match.
    expect(SCENE_SRC).toMatch(/autoAssignDistinctPalettes/);
  });

  it('paints palette previews via buildSlotPreview', () => {
    // The player cards must read from the unit-tested helper rather
    // than reach into the palette table directly. If they bypass the
    // helper, a future palette schema change won't ripple through to
    // the lobby UI.
    expect(SCENE_SRC).toMatch(/buildSlotPreview/);
  });

  it('paints the 8-swatch row via buildSlotPaletteSwatches', () => {
    // The palette swatch row is the visible "palette previews"
    // surface AC 13 Sub-AC 4 calls out. Routing it through the
    // helper guarantees the colours match `palettes.ts` and that the
    // active swatch is highlighted via the same `active` flag the
    // unit tests check.
    expect(SCENE_SRC).toMatch(/buildSlotPaletteSwatches/);
  });

  it('routes the live card preview through applyPaletteSwap (AC 10303 Sub-AC 3 — tint/shader pipeline reuse)', () => {
    // The card preview must paint the body fill / body stroke /
    // facing-arrow accent through the SAME `applyPaletteSwap` helper
    // MatchScene uses. Hand-rolled `setFillStyle(preview.primaryColor, …)`
    // calls would silently diverge from the in-match render whenever a
    // future palette / sprite-tint upgrade lands.
    expect(SCENE_SRC).toMatch(
      /import\s*\{[\s\S]*?applyPaletteSwap[\s\S]*?\}\s*from\s*['"]\.\.\/characters\/PaletteSwapRenderer['"]/,
    );
    expect(SCENE_SRC).toMatch(/applyPaletteSwap\s*\(/);
    // And the call must wire the body + facing-mark targets so the
    // card body and facing arrow both repaint per palette change.
    expect(SCENE_SRC).toMatch(/body:\s*card\.bodyRect/);
    expect(SCENE_SRC).toMatch(/facingMark:\s*card\.facingMark/);
  });

  it('builds the live PaletteSwap via paletteSwapForCharacter (slot index + characterId + paletteIndex)', () => {
    // The colour pipeline is keyed off `(slotIndex, characterId,
    // paletteIndex)`. Building the swap inline here guarantees the
    // helper resolves the colour the SAME way MatchScene does.
    expect(SCENE_SRC).toMatch(
      /import\s*\{[\s\S]*?paletteSwapForCharacter[\s\S]*?\}\s*from\s*['"]\.\.\/characters\/PaletteSwapRenderer['"]/,
    );
    expect(SCENE_SRC).toMatch(
      /paletteSwapForCharacter\([\s\S]*?preview\.slotIndex[\s\S]*?preview\.characterId[\s\S]*?preview\.paletteIndex[\s\S]*?\)/,
    );
  });

  it('builds the per-slot PaletteSwapRemap via the runtime renderer so the shader pipeline stays primed', () => {
    // The shader / canvas-remap pipeline (`paletteSwapShader.ts`) is
    // the future home of sprite-atlas tinting. The lobby preview must
    // exercise the SAME remap descriptor so a future sprite drop-in
    // can replace the rectangle painter without re-deriving colour
    // pairs in two places (AC 20302 Sub-AC 2).
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*RuntimePaletteRenderer\s*\}\s*from\s*['"]\.\.\/characters\/runtimePaletteRenderer['"]/,
    );
    expect(SCENE_SRC).toMatch(/this\.paletteRenderer\.paint\(/);
    expect(SCENE_SRC).toMatch(/PaletteSwapRemap/);
  });

  it('hides the fighter preview on empty cards (no half-picked ghost state)', () => {
    // The Smash-style contract: an EMPTY card shows the join hint, a
    // JOINED card shows a fully-committed fighter. There is no
    // in-between "fighter shown but not ready" render — that ghost
    // state was the headline UX bug the rework removed.
    expect(SCENE_SRC).toMatch(/joinHint\.setVisible\(!joined\)/);
    expect(SCENE_SRC).toMatch(/bodyRect\.setVisible\(joined\)/);
    // No raw `setFillStyle(preview.primaryColor` slip-throughs in the
    // card painter — the body colours go through applyPaletteSwap.
    expect(SCENE_SRC).not.toMatch(
      /card\.bodyRect\.setFillStyle\(\s*preview\.primaryColor/,
    );
    expect(SCENE_SRC).not.toMatch(
      /card\.facingMark\.setFillStyle\(\s*preview\.accentColor/,
    );
  });

  it('routes the portrait gallery body through applyPaletteSwap too (consistent surface)', () => {
    // The portrait gallery (top of screen, 1 cell per character) must
    // paint through the same canonical helper as the player card so
    // a future palette / pipeline change lands on every surface in one
    // pass.
    expect(SCENE_SRC).not.toMatch(
      /tile\.bodyRect\.setFillStyle\(\s*cell\.primaryColor/,
    );
    expect(SCENE_SRC).toMatch(
      /paletteSwapForCharacter\([\s\S]*?cell\.characterId[\s\S]*?\)/,
    );
  });

  it('paints the character portraits grid via buildCharacterPortraitGrid (AC 10303 Sub-AC 3)', () => {
    expect(SCENE_SRC).toMatch(/buildCharacterPortraitGrid/);
  });

  it('declares a portrait tile cache so cells refresh in place', () => {
    // The portraits row must be built once in `create()` and mutated
    // in place on every state transition. Without a cache the scene
    // tears the row down + rebuilds it on every key press, which
    // burns Phaser texture allocations and can cause flicker.
    expect(SCENE_SRC).toMatch(/portraitTiles/);
  });

  it('builds the final lineup via buildPlayerSlotsFromHandCursor (no ad-hoc literals)', () => {
    // The synthesised `PlayerSlot[]` must come from the helper (which
    // funnels through `buildPlayerSlotsFromState`) so duplicates /
    // empty-slot drops behave the way the unit tests lock down.
    expect(SCENE_SRC).toMatch(/buildPlayerSlotsFromHandCursor/);
  });

  it('binds ENTER to the confirm handler', () => {
    // Generic keydown router pattern (event.key === 'Enter') matches
    // the same fix RebindingScene uses to work around Phaser's per-key
    // binding dormancy after a `scene.start` from another scene.
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Enter['"]/);
    expect(SCENE_SRC).toMatch(/handleConfirm/);
  });

  it('binds ESC to the cancel handler', () => {
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    expect(SCENE_SRC).toMatch(/handleCancel/);
  });

  it('sources the per-player colours from the shared menu theme (P1..P4)', () => {
    // The hand cursors, player cards, and portrait chips all read the
    // same per-player palette. It lives in the shared menu theme so
    // HUD / results / lobby colours can't drift apart.
    expect(SCENE_SRC).toMatch(/SLOT_HAND_COLOURS/);
    expect(SCENE_SRC).toMatch(/PLAYER_COLORS/);
    expect(SCENE_SRC).toMatch(
      /import\s*\{[\s\S]*?PLAYER_COLORS[\s\S]*?\}\s*from\s*['"]\.\.\/ui\/menuTheme['"]/,
    );
  });
});

/**
 * Smash-style join-=-picked wiring (replaces the legacy AC 10304
 * two-step join → ready flow).
 *
 * The pure helper (`handCursorState.ts`) pins the auto-pick contract:
 * `setSlotMode(state, i, 'human' | 'bot')` commits the slot-keyed
 * default fighter, so a joined slot is ALWAYS match-ready. These
 * assertions lock down that the scene consumes those helpers rather
 * than re-implementing a ready gate inline.
 */
describe('CharacterSelectScene — Smash-style join = picked wiring', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('imports the confirm gate + pick/remove transitions from the helpers', () => {
    expect(SCENE_SRC).toMatch(/canConfirmMatch/);
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/unselectSlot/);
  });

  it('gates the confirm path on canConfirmMatch', () => {
    // ENTER must short-circuit when the lobby hasn't satisfied the
    // (defensive) palette-collision invariant or has no players.
    expect(SCENE_SRC).toMatch(/if\s*\(\s*!canConfirmMatch\(/);
  });

  it('joins slots through setSlotMode so the auto-pick contract applies (join = valid pick)', () => {
    // Empty-card clicks and "+ CPU" both route through `setSlotMode`,
    // whose unit tests pin the auto-pick: a joining slot immediately
    // commits its default fighter. No separate ready step exists.
    expect(SCENE_SRC).toMatch(/setSlotMode\(\s*this\.state/);
    expect(SCENE_SRC).toMatch(/autoPickDefaultIfNeeded/);
    // Regression guard: the legacy lock-in / ready vocabulary must not
    // come back as scene-level state.
    expect(SCENE_SRC).not.toMatch(/lockInSlotCharacter/);
    expect(SCENE_SRC).not.toMatch(/toggleSlotReady/);
  });

  it('exposes a per-slot back-out path so a misjoin can be cancelled', () => {
    // ✕ on the card, BACKSPACE on the focused slot, and pad B all
    // route through the unit-tested `unselectSlot`.
    expect(SCENE_SRC).toMatch(/unselectSlot\(\s*this\.state/);
    expect(SCENE_SRC).toMatch(/removeSlot/);
    expect(SCENE_SRC).toMatch(/leaveButton/);
  });

  it('paints a READY TO FIGHT banner driven by the participant count', () => {
    // The banner is the single match-start status surface: it invites
    // joins at 0 players, asks for a second at 1, and lights up READY
    // TO FIGHT at ≥ 2 — there is no "someone is still picking" dead
    // state because join = picked.
    expect(SCENE_SRC).toMatch(/participatingSlotCount/);
    expect(SCENE_SRC).toMatch(/READY TO FIGHT/);
    expect(SCENE_SRC).toMatch(/refreshBanner/);
  });

  it('gamepads join in-scene: an unassigned pad button press claims a slot', () => {
    // The update loop pumps EVERY connected pad (not "the pad at the
    // slot's index") and routes an unassigned pad's A / START press
    // through `joinNextEmptySlot`, binding the physical pad to the
    // claimed slot.
    expect(SCENE_SRC).toMatch(/this\.input\.gamepad\?\.gamepads/);
    expect(SCENE_SRC).toMatch(/joinNextEmptySlot/);
    expect(SCENE_SRC).toMatch(/padAssignments/);
  });
});

/**
 * AC 10205 Sub-AC 5 — "Wire AI controller selection into the player
 * slot configuration so human/AI players can be mixed in local
 * multiplayer with difficulty selectable per AI slot."
 */
describe('CharacterSelectScene — AC 10205 Sub-AC 5 wiring (AI controller selection)', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('adds CPUs via explicit host controls (+ CPU button / [C] key) through setSlotMode', () => {
    // Smash-style: the host adds a CPU; the bot joins instantly with
    // an auto-picked fighter (the setSlotMode contract).
    expect(SCENE_SRC).toMatch(/cpuButton/);
    expect(SCENE_SRC).toMatch(/setSlotMode\(\s*this\.state\s*,\s*[\w.]+\s*,\s*'bot'\s*\)/);
  });

  it('cycles CPU difficulty through the unit-tested helper', () => {
    expect(SCENE_SRC).toMatch(/cycleSlotAiDifficulty/);
    expect(SCENE_SRC).toMatch(/diffButton/);
  });

  it('does NOT wire per-slot keyboard AI keys (regression guard against the legacy SLOT_CONTROLS map)', () => {
    expect(SCENE_SRC).not.toMatch(/cycleAiDifficultyKey/);
    expect(SCENE_SRC).not.toMatch(/toggleAiKey/);
    expect(SCENE_SRC).not.toMatch(/SLOT_CONTROLS/);
  });

  it('paints the per-slot inputType label via the shared formatter (no inline string literals)', () => {
    expect(SCENE_SRC).toMatch(/formatInputTypeLabel/);
    expect(SCENE_SRC).toMatch(/inputLabel/);
  });

  it('routes preview.inputType / preview.aiDifficulty into the rendering layer', () => {
    expect(SCENE_SRC).toMatch(/preview\.inputType/);
    expect(SCENE_SRC).toMatch(/preview\.aiDifficulty/);
  });
});

/**
 * AC 10005 Sub-AC 5 — "Build character select screen UI and wire
 * selection to instantiate the correct character with its moveset
 * in-match."
 *
 * This block locks down the *MatchScene* end of the wire — that the
 * match runtime actually reads each slot's `characterId` and
 * dispatches through the Phaser-free character factory rather than
 * hard-coding Wolf/Cat.
 */
describe('MatchScene — AC 10005 Sub-AC 5 wiring (selection → instantiation)', () => {
  const MATCH_SRC = readFileSync(
    resolve(__dirname, './MatchScene.ts'),
    'utf8',
  );

  it('imports the character factory + slot resolver from `../characters`', () => {
    // The factory + resolver live in `src/characters/characterFactory.ts`
    // and are re-exported through `src/characters/index.ts`. If the
    // scene reaches for an inline `new Wolf(...)` / `new Cat(...)`
    // pair instead, the moveset of the player's chosen character
    // never reaches the live match.
    expect(MATCH_SRC).toMatch(/createCharacterById/);
    expect(MATCH_SRC).toMatch(/resolveSlotCharacterId/);
  });

  it('resolves each slot characterId by slot index from matchConfig.players', () => {
    // Lookup must be by slot index (1..4), not by array position —
    // a partial lobby (P1 + P3 only) would otherwise mis-route P3
    // onto the slot-2 spawn point.
    expect(MATCH_SRC).toMatch(
      /resolveSlotCharacterId\(\s*data\?\.matchConfig\?\.players\s*,\s*1\s*,/,
    );
    expect(MATCH_SRC).toMatch(
      /resolveSlotCharacterId\(\s*data\?\.matchConfig\?\.players\s*,\s*2\s*,/,
    );
  });

  it('instantiates each slot via the canonical factory (not hard-coded `new Wolf` / `new Cat`)', () => {
    // The factory is the single source of truth for "id → concrete
    // subclass". Hard-coding `new Wolf(...)` here would silently
    // break the AC for any non-default character the lobby picks.
    expect(MATCH_SRC).toMatch(/createCharacterById\(\s*this\s*,\s*p1CharacterId/);
    expect(MATCH_SRC).toMatch(/createCharacterById\(\s*this\s*,\s*p2CharacterId/);
    // No literal `new Wolf(this,` or `new Cat(this,` should remain
    // — the factory replaces both call sites.
    expect(MATCH_SRC).not.toMatch(/new Wolf\(\s*this\s*,/);
    expect(MATCH_SRC).not.toMatch(/new Cat\(\s*this\s*,/);
  });

  it('feeds the resolved characterId into palette swap resolution (not hard-coded "wolf" / "cat")', () => {
    // The palette ladder is character-specific; if the palette code
    // still hard-codes `'wolf'`/`'cat'` while the body class is
    // dynamic, picking Bear renders Wolf's red palette on a Bear-
    // shaped body. The fix threads the resolved id into both calls.
    expect(MATCH_SRC).toMatch(
      /paletteSwapForCharacter\(\s*1\s*,\s*p1CharacterId\s*,/,
    );
    expect(MATCH_SRC).toMatch(
      /paletteSwapForCharacter\(\s*2\s*,\s*p2CharacterId\s*,/,
    );
  });
});

/**
 * AC 10403 Sub-AC 3 — per-player cursor navigation + character preview.
 *
 * The pure helper (`handCursorState.ts`) covers the cursor transitions;
 * this block locks down that the Phaser scene actually consumes the
 * helper rather than re-implementing the cursor flow inline.
 */
describe('CharacterSelectScene — AC 10403 Sub-AC 3 wiring (cursor navigation)', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('imports moveHand + selectAtCursor + setHoveredTarget from the hand-cursor helper', () => {
    // The scene MUST consume the unit-tested hand-cursor reducer;
    // rolling either inline would bypass the cursor-clamp /
    // hover-routing / palette-collision invariants the helper
    // tests pin.
    expect(SCENE_SRC).toMatch(/moveHand/);
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/setHoveredTarget/);
  });

  it('drives each assigned pad hand in update() (cursor-only navigation)', () => {
    // The hand cursors move via the gamepad poll loop in `update()`.
    // If a future maintainer wires them back to keyboard cycle keys,
    // this test catches the regression.
    expect(SCENE_SRC).toMatch(/this\.input\.gamepad\?\.gamepads/);
    expect(SCENE_SRC).toMatch(/moveHand\(\s*nextState/);
  });

  it('routes the pick through selectAtCursor (light-attack press)', () => {
    // Light-attack on a hovered portrait calls `selectAtCursor`,
    // which atomically sets `pickedCharacterId` AND auto-shifts
    // the slot's palette to avoid collision.
    expect(SCENE_SRC).toMatch(/selectAtCursor\(\s*nextState/);
  });

  it('does NOT re-route cycle keys to setSlotCharacter (regression guard)', () => {
    expect(SCENE_SRC).not.toMatch(/handleCycleCharacter/);
    expect(SCENE_SRC).not.toMatch(/handleMoveCursor/);
    expect(SCENE_SRC).not.toMatch(/setSlotCharacter\(\s*this\.state/);
  });

  it('paints a hover frame on portrait cells from cell.hoveredBySlots', () => {
    // The portrait grid must surface the cursor positions visually so
    // the player can see where their cursor is on the roster.
    expect(SCENE_SRC).toMatch(/cell\.hoveredBySlots/);
    expect(SCENE_SRC).toMatch(/hoverFrame/);
    expect(SCENE_SRC).toMatch(/hoverBadge/);
  });

  it('paints a coloured hand cursor sprite per slot (4 cursors, P1..P4)', () => {
    expect(SCENE_SRC).toMatch(/buildHandCursor/);
    expect(SCENE_SRC).toMatch(/HandCursorGameObjects/);
    expect(SCENE_SRC).toMatch(/this\.hands/);
  });

  it('still runs autoAssignDistinctPalettes after every transition (cursor + pick included)', () => {
    expect(SCENE_SRC).toMatch(/autoAssignDistinctPalettes/);
  });
});

/**
 * Per-player input + confirm/cancel transitions (replaces the legacy
 * AC 20304 cancel→stage-select contract — the stage select now runs
 * AFTER the character select in the Smash-style ordering).
 */
describe('CharacterSelectScene — per-player input + flow transitions', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('builds a hand cursor + player card for every slot 1..4 so all four players can interact independently', () => {
    expect(SCENE_SRC).toMatch(/MAX_PLAYER_SLOTS/);
    expect(SCENE_SRC).toMatch(/buildHandCursor/);
    expect(SCENE_SRC).toMatch(/buildPlayerCard/);
  });

  it('wires per-player back-out via SPECIAL ATTACK / ✕ / BACKSPACE (no per-slot leave key)', () => {
    expect(SCENE_SRC).toMatch(/unselectSlot/);
    expect(SCENE_SRC).toMatch(/removeSlot/);
    // Regression guard — the legacy SLOT_CONTROLS leaveKey must NOT
    // come back, or two input models would coexist confusingly.
    expect(SCENE_SRC).not.toMatch(/leaveKey:/);
  });

  it('wires per-player character pick + palette pick through the hand-cursor reducer', () => {
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/setSlotPalette/);
  });

  it('routes selection-state mutations through the hand-cursor unit-tested helper', () => {
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/unselectSlot/);
    expect(SCENE_SRC).toMatch(/setSlotMode/);
    expect(SCENE_SRC).toMatch(/setSlotPalette/);
    expect(SCENE_SRC).toMatch(/setHoveredTarget/);
    expect(SCENE_SRC).toMatch(/moveHand/);
  });

  it('binds ENTER to the confirm handler and gates it on canConfirmMatch', () => {
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Enter['"]/);
    expect(SCENE_SRC).toMatch(/handleConfirm/);
    expect(SCENE_SRC).toMatch(/if\s*\(\s*!canConfirmMatch\(/);
  });

  it('binds ESC to a cancel handler that transitions to ModeSelectScene', () => {
    // The cancel transition backs up one hop (to the mode select) —
    // the stage select runs AFTER this scene now, so there is no
    // stage pick to preserve on the way back.
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    expect(SCENE_SRC).toMatch(/handleCancel/);
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]ModeSelectScene['"]\s*,/,
    );
  });

  it('threads the pendingMatchConfig + lineup through the confirm transition', () => {
    // The confirm scene-data must forward the captured
    // `pendingMatchConfig` (mode / stocks / timer from ModeSelect)
    // with the lineup merged in, so the stage select can complete the
    // `MatchConfig` without re-deriving anything.
    expect(SCENE_SRC).toMatch(/pendingLobby/);
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig:[\s\S]*?players[\s\S]*?lobby:\s*this\.pendingLobby[\s\S]*?\}\s*\)/,
    );
  });

  it('captures the lobby payload in init() so cancel can forward it back', () => {
    expect(SCENE_SRC).toMatch(/this\.pendingLobby\s*=\s*data\?\.lobby/);
  });
});

describe('GameConfig — CharacterSelectScene registration', () => {
  it('registers CharacterSelectScene in the scene list so ModeSelect can navigate', () => {
    const cfg = readFileSync(
      resolve(__dirname, '../engine/GameConfig.ts'),
      'utf8',
    );
    expect(cfg).toMatch(/import\s*\{\s*CharacterSelectScene\s*\}/);
    expect(cfg).toMatch(/CharacterSelectScene,/);
  });
});

/**
 * Input-device review fixes — mouse/pad hand-cursor ownership, lobby
 * payload re-application, and orphaned-gamepad surfacing.
 *
 * Each block pins one reviewed defect so it can't quietly come back:
 *
 *   A. The mouse only drives its hand on frames where the pointer
 *      actually MOVED, and never drives a pad-bound slot (the per-frame
 *      pointer snap used to pin the first pad-joiner's hand).
 *   B. The lobby hand-off payload only hydrates when NO registry state
 *      was restored (re-applying it on a Stage→Character back-nav wiped
 *      slots added in this scene).
 *   C. A portrait click joining an EMPTY focused slot assigns a real
 *      keyboard device first (the slot default 'gamepad' minted a human
 *      slot no physical pad drives).
 *   D. A restored human-gamepad slot with no bound physical pad paints
 *      a gold "PRESS Ⓐ" re-adopt prompt instead of claiming GAMEPAD.
 *   E. A pad that connects MID-SCENE is latch-primed all-false so its
 *      first press counts (the current-state priming swallowed it).
 */
describe('CharacterSelectScene — input-device review fixes', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('A — only drives the mouse hand when the pointer moved this frame', () => {
    expect(SCENE_SRC).toMatch(/!Number\.isNaN\(this\.lastPointerX\)/);
    expect(SCENE_SRC).toMatch(
      /pointer\.x\s*!==\s*this\.lastPointerX\s*\|\|\s*pointer\.y\s*!==\s*this\.lastPointerY/,
    );
  });

  it('A — never drives a pad-bound focused slot and re-aims the focus when a pad claims it', () => {
    expect(SCENE_SRC).toMatch(
      /pointerMoved\s*&&\s*!padSlots\.has\(this\.focusedMouseSlotIndex\)/,
    );
    expect(SCENE_SRC).toMatch(/retargetMouseFocusOffPadSlots/);
  });

  it('B — applies the lobby hand-off only when no registry state was restored', () => {
    expect(SCENE_SRC).toMatch(
      /if\s*\(\s*data\?\.lobby\s*&&\s*restored\s*===\s*undefined\s*\)/,
    );
  });

  it('C — portrait-click join of an empty focused slot assigns a free keyboard half first', () => {
    expect(SCENE_SRC).toMatch(
      /target\.kind\s*===\s*['"]portrait['"]\s*&&\s*focusedSlot\?\.mode\s*===\s*['"]empty['"]/,
    );
    expect(SCENE_SRC).toMatch(/firstFreeKeyboardInputType/);
    // Stale mouse focus must not survive scene re-entry.
    expect(SCENE_SRC).toMatch(/this\.focusedMouseSlotIndex\s*=\s*1;/);
  });

  it('D — paints orphaned gamepad slots as a gold re-adopt prompt (no match-start gate)', () => {
    expect(SCENE_SRC).toMatch(/orphanedGamepad/);
    expect(SCENE_SRC).toMatch(/GAMEPAD — PRESS Ⓐ/);
    expect(SCENE_SRC).toMatch(/orphanedGamepad\s*\?\s*MENU_COLORS_CSS\.gold/);
  });

  it('E — pre-primes mid-scene pad connects all-false and detaches on SHUTDOWN', () => {
    expect(SCENE_SRC).toMatch(
      /gamepad\?\.on\(Phaser\.Input\.Gamepad\.Events\.CONNECTED/,
    );
    expect(SCENE_SRC).toMatch(
      /gamepad\?\.off\(Phaser\.Input\.Gamepad\.Events\.CONNECTED/,
    );
  });

  it('F — the cursorBounds doc no longer claims a resize re-derivation that does not exist', () => {
    expect(SCENE_SRC).not.toMatch(/Re-derived on resize/);
  });
});

describe('MenuPadNav — mid-scene pad connect pre-priming', () => {
  const NAV_SRC = readFileSync(
    resolve(__dirname, '../ui/menuPadNav.ts'),
    'utf8',
  );

  it('pre-primes a newly-connected pad latch all-false so its first press counts', () => {
    expect(NAV_SRC).toMatch(/Phaser\.Input\.Gamepad\.Events\.CONNECTED/);
    expect(NAV_SRC).toMatch(/onPadConnected/);
    expect(NAV_SRC).toMatch(/a:\s*false/);
  });

  it('drops the latch on disconnect so the map tracks only live pads', () => {
    expect(NAV_SRC).toMatch(/Phaser\.Input\.Gamepad\.Events\.DISCONNECTED/);
    expect(NAV_SRC).toMatch(/latches\.delete\(pad\.index\)/);
  });

  it('keeps the current-state priming for pads already present at first poll', () => {
    // The held-button-across-scene-transition guard must survive: a
    // pad seen for the first time IN poll() still primes from the
    // current button state without emitting events.
    expect(NAV_SRC).toMatch(/a:\s*!!pad\.A/);
  });
});

describe('Scene chain — Mode → Character → Stage → Match (Smash ordering)', () => {
  it('ModeSelect forwards to CharacterSelect; CharacterSelect forwards to StageSelect; StageSelect launches the match', () => {
    const modeSrc = readFileSync(
      resolve(__dirname, './ModeSelectScene.ts'),
      'utf8',
    );
    expect(modeSrc).toMatch(
      /scene\.start\(\s*['"]CharacterSelectScene['"]\s*,\s*\{\s*pendingMatchConfig/,
    );
    const charSrc = readFileSync(
      resolve(__dirname, './CharacterSelectScene.ts'),
      'utf8',
    );
    expect(charSrc).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig/,
    );
    const stageSrc = readFileSync(
      resolve(__dirname, './StageSelectScene.ts'),
      'utf8',
    );
    expect(stageSrc).toMatch(
      /scene\.start\(\s*['"]MatchScene['"]\s*,\s*\{\s*matchConfig\s*\}/,
    );
  });
});
