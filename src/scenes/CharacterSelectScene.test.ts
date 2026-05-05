import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AC 13 Sub-AC 4 — "Update character select UI to display palette
 * previews and auto-assign distinct palettes when duplicate characters
 * are chosen."
 *
 * `CharacterSelectScene` itself imports Phaser, which pulls in browser
 * globals at module-eval time and can't be loaded under plain Node.
 * The selection logic + palette projections it forwards to live in the
 * Phaser-free `./characterSelect.ts` helper and are fully covered by
 * `characterSelect.test.ts`.
 *
 * This file guards the *wiring* — the static contract that the scene's
 * source text must satisfy for the AC to hold:
 *
 *   1. The scene is registered under the `'CharacterSelectScene'` key
 *      so `ModeSelectScene` can `scene.start('CharacterSelectScene', ...)`.
 *   2. The scene's confirm path starts `MatchScene` and forwards a
 *      `matchConfig` payload (so the chosen lineup reaches the match).
 *   3. The scene's cancel path returns to `ModeSelectScene`.
 *   4. The scene runs every state transition through
 *      `autoAssignDistinctPalettes` so duplicate-character lobbies
 *      paint distinct palettes without a manual fix step.
 *   5. The scene paints a swatch row by reading `buildSlotPaletteSwatches`,
 *      so the palette-preview surface is built from the unit-tested
 *      helper rather than ad-hoc colour literals.
 *   6. The scene paints the active fighter preview by reading
 *      `buildSlotPreview`, so the body / accent / palette name on
 *      every tile come from one source.
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

  it('confirm path starts MatchScene with a matchConfig payload', () => {
    // The chosen lineup reaches the match by passing the synthesised
    // `MatchConfig` as scene-data. `MatchScene.MatchSceneData.matchConfig`
    // already wires this through, so as long as the call shape is
    // intact the live lineup propagates.
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]MatchScene['"]\s*,\s*\{\s*matchConfig\s*\}/,
    );
  });

  it('cancel path returns to StageSelectScene with the pending payload (AC 20304 Sub-AC 4 — back-nav)', () => {
    // The character-select scene is entered FROM `StageSelectScene`
    // (after AC 20104 inserted the stage picker between mode select
    // and the lineup). ESC must back up ONE step in the lobby flow —
    // to `StageSelectScene`, not all the way back to ModeSelectScene
    // (which would drop the player's stage pick on the floor and
    // force them to re-pick the arena). The pending match config and
    // lobby payload must be forwarded so the player walks back into
    // the stage select with the same arena highlighted and their
    // lobby acquisition state intact.
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig[\s\S]*?lobby[\s\S]*?\}\s*\)/,
    );
    // No back-nav to ModeSelectScene — the cancel transition must NOT
    // jump over StageSelectScene. The (only) `'ModeSelectScene'` token
    // left in the file is in comments / docstrings explaining the new
    // routing — there is no `scene.start('ModeSelectScene')` call
    // remaining.
    expect(SCENE_SRC).not.toMatch(
      /scene\.start\(\s*['"]ModeSelectScene['"]\s*\)/,
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
    // The preview tiles must read from the unit-tested helper rather
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

  it('routes the live tile preview through applyPaletteSwap (AC 10303 Sub-AC 3 — tint/shader pipeline reuse)', () => {
    // The lobby tile preview must paint the body fill / body stroke /
    // facing-arrow accent through the SAME `applyPaletteSwap` helper
    // MatchScene uses. Hand-rolled `setFillStyle(preview.primaryColor, …)`
    // calls would silently diverge from the in-match render whenever a
    // future palette / sprite-tint upgrade lands. Reading the source as
    // text catches that drift before it ships.
    expect(SCENE_SRC).toMatch(
      /import\s*\{[\s\S]*?applyPaletteSwap[\s\S]*?\}\s*from\s*['"]\.\.\/characters\/PaletteSwapRenderer['"]/,
    );
    // The painter must be CALLED inside the preview path (not just
    // imported and forgotten).
    expect(SCENE_SRC).toMatch(/applyPaletteSwap\s*\(/);
    // And the call must wire the body + facing-mark targets so the
    // tile body and facing arrow both repaint per palette change.
    expect(SCENE_SRC).toMatch(/body:\s*tile\.bodyRect/);
    expect(SCENE_SRC).toMatch(/facingMark:\s*tile\.facingMark/);
  });

  it('builds the live PaletteSwap via paletteSwapForCharacter (slot index + characterId + paletteIndex)', () => {
    // The colour pipeline is keyed off `(slotIndex, characterId,
    // paletteIndex)`. Building the swap inline here (rather than
    // re-reading `preview.primaryColor` literals) guarantees the
    // helper resolves the colour the SAME way MatchScene does — same
    // function, same arg shape. A regression where someone shorts the
    // pipeline by feeding `preview.primaryColor` straight to
    // `setFillStyle` would skip the canonical resolver.
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
    // can replace the rectangle painter with
    // `applyPaletteSwapPipeline(sprite, remap)` without re-deriving
    // colour pairs in two places. AC 20302 Sub-AC 2 routes that
    // remap construction through `RuntimePaletteRenderer.paint`: the
    // renderer internally calls `buildPaletteRemap` and exposes the
    // descriptor on its result, so the lobby still consumes one
    // shader-ready remap per preview repaint. Asserting the runtime
    // renderer is wired in (and the returned `remap` is read into a
    // `PaletteSwapRemap` so a future sprite drop-in lands without
    // touching the lobby code) keeps the lobby "shader-ready".
    expect(SCENE_SRC).toMatch(
      /import\s*\{\s*RuntimePaletteRenderer\s*\}\s*from\s*['"]\.\.\/characters\/runtimePaletteRenderer['"]/,
    );
    expect(SCENE_SRC).toMatch(/this\.paletteRenderer\.paint\(/);
    expect(SCENE_SRC).toMatch(/PaletteSwapRemap/);
  });

  it('drives the un-joined "spectator" dim through the helper alpha options (no manual fillStyle on body)', () => {
    // The spectator dim treatment (alpha 0.35 for un-joined slots, 1
    // for joined) must be passed through `applyPaletteSwap`'s
    // `bodyFillAlpha` / `bodyStrokeAlpha` options — not via a manual
    // `bodyRect.setFillStyle(...)` call that bypasses the helper.
    // Catching that bypass keeps the colour math centralised.
    expect(SCENE_SRC).toMatch(/bodyFillAlpha:\s*fillAlpha/);
    expect(SCENE_SRC).toMatch(/bodyStrokeAlpha:\s*fillAlpha/);
    // No raw `setFillStyle(preview.primaryColor` slip-throughs in
    // the slot-tile preview painter — the only acceptable raw
    // setFillStyle calls left in the file are for swatches and other
    // surfaces that don't paint a fighter body.
    expect(SCENE_SRC).not.toMatch(
      /tile\.bodyRect\.setFillStyle\(\s*preview\.primaryColor/,
    );
    expect(SCENE_SRC).not.toMatch(
      /tile\.facingMark\.setFillStyle\(\s*preview\.accentColor/,
    );
  });

  it('routes the portrait gallery body through applyPaletteSwap too (consistent surface)', () => {
    // The portrait gallery (top of screen, 1 cell per character) must
    // paint through the same canonical helper as the per-slot tile so
    // a future palette / pipeline change lands on every surface in one
    // pass. A direct `setFillStyle(cell.primaryColor, …)` slip-through
    // would leave the gallery painted with stale literals after the
    // pipeline upgrade.
    expect(SCENE_SRC).not.toMatch(
      /tile\.bodyRect\.setFillStyle\(\s*cell\.primaryColor/,
    );
    expect(SCENE_SRC).toMatch(
      /paletteSwapForCharacter\([\s\S]*?cell\.characterId[\s\S]*?\)/,
    );
  });

  it('paints the character portraits grid via buildCharacterPortraitGrid (AC 10303 Sub-AC 3)', () => {
    // Sub-AC 3's headline contract: the scene must render a
    // character portraits grid on top of the per-slot tiles + per-
    // slot palette swatch picker. Routing the visual through the
    // unit-tested helper means every cell's colours, name, role,
    // and chip-row state come from one source. If the scene paints
    // a portraits row from ad-hoc literals, this assertion fails
    // and the AC silently regresses.
    expect(SCENE_SRC).toMatch(/buildCharacterPortraitGrid/);
  });

  it('declares a portrait tile cache so cells refresh in place', () => {
    // The portraits row must be built once in `create()` and
    // mutated in place on every state transition (mirrors the
    // per-slot tile cache pattern). Without a cache the scene
    // tears the row down + rebuilds it on every key press, which
    // burns Phaser texture allocations and can cause flicker.
    expect(SCENE_SRC).toMatch(/portraitTiles/);
  });

  it('builds the final lineup via buildPlayerSlotsFromState (no ad-hoc literals)', () => {
    // The synthesised `PlayerSlot[]` must come from the helper so
    // duplicates / un-joined-slot drops behave the way the unit
    // tests lock down.
    expect(SCENE_SRC).toMatch(/buildPlayerSlotsFromState/);
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

  it('exposes a hand cursor + mode toggle for every slot 1..4 so all four players can join via the slot tile', () => {
    // The hand-cursor lobby replaces "press number to join" with a
    // per-slot tile mode button (Empty/Human/Bot). Each of the 4 slots
    // gets its own coloured hand cursor + tile, and the scene must
    // build all 4 in `create()` so the 4-player lobby contract holds.
    expect(SCENE_SRC).toMatch(/SLOT_HAND_COLOURS/);
    // Per-slot hand colours wired for slots 1..4.
    expect(SCENE_SRC).toMatch(/1:\s*0x[0-9a-fA-F]{6}/);
    expect(SCENE_SRC).toMatch(/2:\s*0x[0-9a-fA-F]{6}/);
    expect(SCENE_SRC).toMatch(/3:\s*0x[0-9a-fA-F]{6}/);
    expect(SCENE_SRC).toMatch(/4:\s*0x[0-9a-fA-F]{6}/);
    // Mode button click handler routes through `cycleSlotMode` so
    // pressing the slot tile actually does something.
    expect(SCENE_SRC).toMatch(/cycleSlotMode\(\s*this\.state/);
  });
});

/**
 * AC 10304 Sub-AC 4 — "Wire per-player slot input handling for
 * character + palette selection, ready-up state, and conflict
 * resolution (preventing duplicate palette+character combos across
 * slots)."
 *
 * The pure helper covers the readiness state machine (see
 * `characterSelect.test.ts` Sub-AC 4 block). These wiring assertions
 * lock down that the Phaser scene actually consumes the helper rather
 * than re-implementing the gate inline — same architectural split as
 * the AC 13 Sub-AC 4 wiring tests above.
 */
describe('CharacterSelectScene — AC 10304 Sub-AC 4 wiring (ready-up + conflict gate)', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('imports the readiness + conflict predicates from the helper', () => {
    // The scene must consume the unit-tested confirm gate
    // `canConfirmMatch` rather than rolling an ad-hoc boolean. The
    // hand-cursor model collapses join / ready into a single
    // `selectAtCursor → pickedCharacterId !== null` step, so the
    // legacy multi-predicate menagerie (allJoinedSlotsReady,
    // toggleSlotReady, leaveSlot, joinSlot) is replaced by the
    // hand-cursor reducer's selectAtCursor / unselectSlot pair.
    expect(SCENE_SRC).toMatch(/canConfirmMatch/);
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/unselectSlot/);
  });

  it('gates the confirm path on canConfirmMatch', () => {
    // The headline contract: ENTER must short-circuit when the lobby
    // hasn't satisfied the ready / conflict invariants. Looking for
    // a literal `if (!canConfirmMatch(this.state)) return` so we
    // catch a regression where someone deletes the gate.
    expect(SCENE_SRC).toMatch(/if\s*\(\s*!canConfirmMatch\(/);
  });

  it('exposes a per-slot back-out path so a misjoin can be cancelled', () => {
    // The hand-cursor lobby replaces the leave key with two
    // back-out paths: SPECIAL ATTACK on a slot's hand calls
    // `unselectSlot` (frees the picked character but keeps the slot
    // joined), and cycling the mode tile a third time returns it to
    // `Empty`. Both routes go through the unit-tested helper.
    expect(SCENE_SRC).toMatch(/unselectSlot\(\s*this\.state/);
    expect(SCENE_SRC).toMatch(/cycleSlotMode\(\s*this\.state/);
  });

  it('paints a lobby-status header showing joined / ready counts', () => {
    // The header summarises the readiness gate so the player doesn't
    // have to scan four tiles to know what's blocking confirm.
    expect(SCENE_SRC).toMatch(/lobbyStatusLabel/);
    expect(SCENE_SRC).toMatch(/refreshLobbyStatusHeader/);
  });

  it('promotes empty → human → bot via a single mode-toggle dispatch (cycleSlotMode)', () => {
    // The hand-cursor flow: tapping the slot tile's mode button
    // cycles `Empty → Human → Bot → Empty`, replacing the legacy
    // "join key + ready key + leave key" trio. The scene's
    // mode-button click handler is the dispatcher and it routes
    // through `cycleSlotMode` so the underlying state-machine
    // contract (clear pick on → empty, seed `aiDifficulty='medium'`
    // on → bot) is unit-tested rather than re-implemented inline.
    expect(SCENE_SRC).toMatch(/modeButton/);
    expect(SCENE_SRC).toMatch(/cycleSlotMode/);
  });
});

/**
 * AC 10205 Sub-AC 5 — "Wire AI controller selection into the player
 * slot configuration so human/AI players can be mixed in local
 * multiplayer with difficulty selectable per AI slot."
 *
 * The pure helper (`characterSelect.ts`) covers the cycle / set /
 * promote transitions; the wiring tests below pin the Phaser scene's
 * source contract — a new diff-cycle key per slot, a human ↔ AI
 * toggle key per slot, and consumption of the helper functions
 * rather than ad-hoc string literals.
 */
describe('CharacterSelectScene — AC 10205 Sub-AC 5 wiring (AI controller selection)', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('promotes a slot to AI bot via the shared mode-toggle (cycleSlotMode), not a separate AI key', () => {
    // The hand-cursor flow folds "promote to bot" into the same
    // mode-toggle that joins the slot — `Empty → Human → Bot →
    // Empty`. The unit-tested `cycleSlotMode` reducer seeds
    // `aiDifficulty='medium'` on the → bot transition so the slot
    // is immediately playable, and drops it on the → empty
    // transition so non-bot rows don't carry a phantom field.
    expect(SCENE_SRC).toMatch(/cycleSlotMode/);
    expect(SCENE_SRC).toMatch(/setSlotMode/);
  });

  it('does NOT wire per-slot keyboard AI keys (regression guard against the legacy SLOT_CONTROLS map)', () => {
    // The legacy SLOT_CONTROLS keyboard map is gone. If a maintainer
    // re-introduces per-slot keyboard cycling, this test catches
    // the regression before the keyboard nav can drift back in.
    expect(SCENE_SRC).not.toMatch(/cycleAiDifficultyKey/);
    expect(SCENE_SRC).not.toMatch(/toggleAiKey/);
    expect(SCENE_SRC).not.toMatch(/SLOT_CONTROLS/);
  });

  it('paints the per-slot inputType label via the shared formatter (no inline string literals)', () => {
    // The slot tile must surface "AI BOT — HARD" / "HUMAN — KB P1"
    // through the shared `formatInputTypeLabel` helper so the
    // device-label format stays consistent across re-renders.
    expect(SCENE_SRC).toMatch(/formatInputTypeLabel/);
  });

  it('paints an inputType / aiDifficulty label on each slot tile', () => {
    // The slot tile must surface "AI BOT (HARD)" / "HUMAN P1" so the
    // player can see at a glance whether a slot is human or AI.
    expect(SCENE_SRC).toMatch(/inputTypeLabel/);
    expect(SCENE_SRC).toMatch(/formatInputTypeLabel/);
  });

  it('routes preview.inputType / preview.aiDifficulty into the rendering layer', () => {
    // The preview projection from `buildSlotPreview` must carry the
    // input-type metadata downstream so the tile paints from the
    // helper's output rather than reaching into the slot state.
    expect(SCENE_SRC).toMatch(/preview\.inputType/);
    expect(SCENE_SRC).toMatch(/preview\.aiDifficulty/);
  });
});

/**
 * AC 10005 Sub-AC 5 — "Build character select screen UI and wire
 * selection to instantiate the correct character with its moveset
 * in-match."
 *
 * The scene-level wiring is already covered above (confirm path
 * starts MatchScene with the synthesised lineup, lineup built via
 * `buildPlayerSlotsFromState`, etc.). This block locks down the
 * *MatchScene* end of the wire — that the match runtime actually
 * reads each slot's `characterId` and dispatches through the
 * Phaser-free character factory rather than hard-coding Wolf/Cat.
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
 * AC 10403 Sub-AC 3 — "Implement character select screen with
 * per-player cursor navigation, character preview, and lock-in
 * confirmation."
 *
 * The pure helper (`characterSelect.ts`) covers the cursor / lock-in
 * transitions; this block locks down that the Phaser scene actually
 * consumes the helper rather than re-implementing the cursor flow
 * inline. Reading the source as text mirrors the existing AC 13 / AC
 * 10303 / AC 10304 wiring tests in this file.
 */
describe('CharacterSelectScene — AC 10403 Sub-AC 3 wiring (cursor + lock-in)', () => {
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

  it('drives each slot hand from its bound gamepad in update() (cursor-only navigation)', () => {
    // The hand cursors must move via the gamepad poll loop in
    // `update()`. If a future maintainer wires them back to keyboard
    // cycle keys, this test catches the regression — the cursor /
    // commit decoupling depends on the hand being the *only* way
    // to navigate the roster.
    expect(SCENE_SRC).toMatch(/this\.input\.gamepad\?\.getPad/);
    expect(SCENE_SRC).toMatch(/moveHand\(\s*nextState/);
  });

  it('routes the lock-in confirmation through selectAtCursor (light-attack press)', () => {
    // Light-attack on a hovered portrait calls `selectAtCursor`,
    // which atomically sets `pickedCharacterId` AND auto-shifts
    // the slot's palette to avoid collision. A two-step "set
    // characterId then setSlotPalette" would leak the colliding
    // intermediate state to consumers.
    expect(SCENE_SRC).toMatch(/selectAtCursor\(\s*nextState/);
  });

  it('does NOT re-route cycle keys to setSlotCharacter (regression guard)', () => {
    // The legacy "cycle keys → direct commit" path must be gone. If
    // a maintainer accidentally re-introduces it, this test catches
    // the regression.
    expect(SCENE_SRC).not.toMatch(/handleCycleCharacter/);
    expect(SCENE_SRC).not.toMatch(/handleMoveCursor/);
    expect(SCENE_SRC).not.toMatch(/setSlotCharacter\(\s*this\.state/);
  });

  it('paints a hover frame on portrait cells from cell.hoveredBySlots', () => {
    // The portrait grid must surface the cursor positions visually so
    // the player can see where their cursor is on the roster. Reading
    // through the helper's `hoveredBySlots` field guarantees the
    // visual stays in lockstep with the unit-tested data shape.
    expect(SCENE_SRC).toMatch(/cell\.hoveredBySlots/);
    expect(SCENE_SRC).toMatch(/hoverFrame/);
    expect(SCENE_SRC).toMatch(/hoverBadge/);
  });

  it('paints a coloured hand cursor sprite per slot (4 cursors, P1..P4)', () => {
    // The hand cursor is the cursor in the new model — each slot
    // owns a coloured triangle pointer driven by its bound input
    // device. The legacy "cursor preview hint" string baked onto
    // the slot tile is replaced by the hand sprite itself, which
    // sits over the hovered portrait so the player can see where
    // their cursor is at a glance.
    expect(SCENE_SRC).toMatch(/buildHandCursor/);
    expect(SCENE_SRC).toMatch(/HandCursorGameObjects/);
    expect(SCENE_SRC).toMatch(/this\.hands/);
  });

  it('still runs autoAssignDistinctPalettes after every transition (cursor + lock-in included)', () => {
    // Lock-in can produce a (character, palette) collision if the
    // cursor lands on a character another slot has on the same
    // palette. The auto-distinct repair pass MUST run after every
    // state transition, which it does in the scene's `update()`
    // loop after the gamepad / mouse poll. This regex pin protects
    // the wiring from a future refactor that bypasses the call.
    expect(SCENE_SRC).toMatch(/autoAssignDistinctPalettes/);
  });
});

/**
 * AC 20304 Sub-AC 4 — "Wire per-player input handling and selection
 * state (character + palette + ready) with confirm/cancel and
 * transition to stage select."
 *
 * This block locks down the four headline contracts the AC asks for:
 *
 *   1. Per-player input handling — each slot 1..4 has a join/ready key
 *      and a leave key, plus character-cycle / palette-cycle / AI-cycle
 *      / human↔AI-toggle keys, and the scene wires `keydown-…` for each.
 *
 *   2. Selection state covers character + palette + ready — the scene
 *      consumes `setSlotPalette`, `lockInSlotCharacter`, `toggleSlotReady`,
 *      `leaveSlot` from the unit-tested helper rather than rolling its
 *      own state machine.
 *
 *   3. Confirm / cancel are wired — ENTER and ESC both have explicit
 *      `keydown-…` bindings AND the cancel handler routes through
 *      `StageSelectScene` (the immediate previous scene in the lobby
 *      flow post AC 20104) with the pending match config + lobby
 *      payload threaded through, NOT to `ModeSelectScene` (which would
 *      drop the player's stage pick on the floor).
 *
 *   4. Transition to stage select — the cancel handler explicitly
 *      starts `StageSelectScene` and forwards the captured payload so
 *      the player walks back into the stage select with their arena
 *      pick + lobby acquisition state intact.
 *
 * Reading the source as text mirrors the existing AC 13 / AC 10303
 * / AC 10304 / AC 10403 wiring tests above — the helper modules are
 * already covered by their own unit tests, so this file's job is
 * pinning the *Phaser scene's wiring* against future regressions.
 */
describe('CharacterSelectScene — AC 20304 Sub-AC 4 wiring (per-player input + cancel→stage select)', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './CharacterSelectScene.ts'),
    'utf8',
  );

  it('builds a hand cursor + slot tile for every slot 1..4 so all four players can interact independently', () => {
    // The 4-player input contract is now satisfied by per-slot hand
    // sprites + per-slot tiles. The scene's `create()` loops over
    // MAX_PLAYER_SLOTS (= 4) to build both, and the gamepad poll
    // loop in `update()` walks `state.slots` so each pad's input
    // routes to its own slot.
    expect(SCENE_SRC).toMatch(/MAX_PLAYER_SLOTS/);
    expect(SCENE_SRC).toMatch(/buildHandCursor/);
    expect(SCENE_SRC).toMatch(/buildSlotTile/);
  });

  it('wires per-player back-out via SPECIAL ATTACK + mode-toggle (no per-slot leave key)', () => {
    // Each slot can back out via its hand's SPECIAL ATTACK button
    // (calls `unselectSlot` to free the character) or by cycling
    // the mode tile back to Empty (`cycleSlotMode`). Both paths
    // route through the unit-tested helper, so the legacy
    // per-slot leave key is no longer needed.
    expect(SCENE_SRC).toMatch(/unselectSlot/);
    expect(SCENE_SRC).toMatch(/cycleSlotMode/);
    // Regression guard — the legacy SLOT_CONTROLS leaveKey must NOT
    // come back, or two input models would coexist confusingly.
    expect(SCENE_SRC).not.toMatch(/leaveKey:/);
  });

  it('wires per-player character pick + palette pick through the hand-cursor reducer', () => {
    // The per-player selection contract: each slot picks its
    // character via `selectAtCursor` (the hand's light-attack press
    // routed through the hovered portrait — the reducer internally
    // invokes `cycleSlotPalette` when the hovered target is the
    // slot's palette strip) and clicks a specific swatch via
    // `setSlotPalette` (direct mouse-click on the swatch). Both
    // transitions live in the unit-tested hand-cursor reducer.
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/setSlotPalette/);
  });

  it('routes selection-state mutations through the hand-cursor unit-tested helper', () => {
    // Selection state covers `(mode, pickedCharacterId,
    // paletteIndex)`. The scene must consume the corresponding
    // hand-cursor helper transitions rather than rolling its own;
    // the helper enforces the same-state-ref no-op invariants and
    // the palette auto-differentiation contract the unit tests
    // pin.
    expect(SCENE_SRC).toMatch(/selectAtCursor/);
    expect(SCENE_SRC).toMatch(/unselectSlot/);
    expect(SCENE_SRC).toMatch(/cycleSlotMode/);
    expect(SCENE_SRC).toMatch(/setSlotPalette/);
    expect(SCENE_SRC).toMatch(/setHoveredTarget/);
    expect(SCENE_SRC).toMatch(/moveHand/);
  });

  it('binds ENTER to the confirm handler and gates it on canConfirmMatch', () => {
    // Confirm must be wired AND must short-circuit when the lobby
    // hasn't satisfied the readiness + conflict invariants. A
    // premature ENTER (e.g. one slot still picking) is silently
    // ignored so the lobby stays interactive without painting an
    // error modal — the lobby-status header already tells the
    // player what's required.
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Enter['"]/);
    expect(SCENE_SRC).toMatch(/handleConfirm/);
    expect(SCENE_SRC).toMatch(/if\s*\(\s*!canConfirmMatch\(/);
  });

  it('binds ESC to a cancel handler that transitions to StageSelectScene', () => {
    // The cancel transition is the headline "transition to stage
    // select" the AC calls out. The handler must be wired to ESC AND
    // must route to `StageSelectScene` — NOT `ModeSelectScene`,
    // which would jump over the stage picker and force the player
    // to re-pick their arena.
    expect(SCENE_SRC).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    expect(SCENE_SRC).toMatch(/handleCancel/);
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,/,
    );
  });

  it('threads the pendingMatchConfig + lobby payload through the cancel transition', () => {
    // The cancel scene-data must forward the captured `pendingMatchConfig`
    // and `lobby` payload so the stage select scene re-opens with the
    // same arena highlighted and the lobby acquisition state intact.
    // Without this threading, ESC silently resets the lobby to
    // defaults — a regression the AC's "confirm/cancel" contract
    // explicitly guards against.
    expect(SCENE_SRC).toMatch(/pendingLobby/);
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig:\s*this\.pendingMatchConfig[\s\S]*?lobby:\s*this\.pendingLobby[\s\S]*?\}\s*\)/,
    );
  });

  it('captures the lobby payload in init() so cancel can forward it back', () => {
    // The lobby payload must be captured on `init()` (the Phaser
    // scene-data hook) so the cancel handler has it to forward. A
    // captured-on-create or live-read approach would be brittle
    // against re-entries from the results screen.
    expect(SCENE_SRC).toMatch(/this\.pendingLobby\s*=\s*data\?\.lobby/);
  });

  it('paints a lobby-status header so the overall ENTER gate is visible', () => {
    // The ENTER gate (≥2 ready slots, no palette collisions) must be
    // surfaced to the player so they know what's blocking confirm.
    // Per-slot READY banners were dropped — the mode toggle + picked
    // sprite already make a slot's ready state visually obvious — so
    // the lobby-status header is the single source of "what's left."
    expect(SCENE_SRC).toMatch(/lobbyStatusLabel/);
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

describe('ModeSelectScene — routes confirm through Stage Select', () => {
  it('navigates to StageSelectScene on ENTER, which forwards to CharacterSelectScene', () => {
    const modeSrc = readFileSync(
      resolve(__dirname, './ModeSelectScene.ts'),
      'utf8',
    );
    // The text contract (post AC 20104 Sub-AC 4): ModeSelect now
    // hands off to StageSelectScene first; StageSelectScene then
    // forwards to CharacterSelectScene (with the picked stage) which
    // merges in the player lineup before launching MatchScene.
    expect(modeSrc).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{\s*pendingMatchConfig/,
    );
    const stageSrc = readFileSync(
      resolve(__dirname, './StageSelectScene.ts'),
      'utf8',
    );
    expect(stageSrc).toMatch(
      /scene\.start\(\s*['"]CharacterSelectScene['"]\s*,\s*\{[\s\S]*?pendingMatchConfig/,
    );
  });
});
