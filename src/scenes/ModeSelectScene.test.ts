import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * AC 11 — "Both Stock and Time modes selectable pre-match."
 *
 * `ModeSelectScene` itself imports Phaser, which pulls in browser
 * globals at module-eval time and can't be loaded under plain Node.
 * The selection logic it forwards to lives in the Phaser-free
 * `./modeSelect.ts` helper and is fully covered by `modeSelect.test.ts`.
 *
 * This file guards the *wiring* — the static contract that the scene's
 * source text must satisfy for the AC to hold:
 *
 *   1. The scene is registered under the `'ModeSelectScene'` key so
 *      `MainMenuScene` can `scene.start('ModeSelectScene')`.
 *   2. The scene's confirm path starts `MatchScene` and forwards a
 *      `matchConfig` payload (so the chosen mode reaches the match).
 *   3. The scene's cancel path returns to `MainMenuScene`.
 *   4. The scene maps mode-toggle and quantity-cycle keys to the pure
 *      helper's `cycleMode` / `cycleQuantity` transitions.
 *
 * Reading the source as text rather than running it under jsdom keeps
 * the test fast and free of Phaser's browser globals — same strategy
 * as `ResultsScene.test.ts`.
 */
describe('ModeSelectScene — AC 11 wiring contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './ModeSelectScene.ts'),
    'utf8',
  );

  it('registers under the "ModeSelectScene" scene key', () => {
    // MainMenuScene navigates by string key; if this drifts the
    // scene becomes unreachable from the menu and the AC silently
    // breaks.
    expect(SCENE_SRC).toMatch(/key:\s*['"]ModeSelectScene['"]/);
  });

  it('confirm path starts StageSelectScene carrying the pending matchConfig', () => {
    // AC 20104 Sub-AC 4 inserts the stage-select scene between
    // ModeSelect and CharacterSelect. The chosen mode now reaches the
    // match *through* the StageSelectScene's `pendingMatchConfig`
    // payload, which forwards (with the picked stageId + optional
    // saved-stage blob) into CharacterSelectScene, which merges in the
    // synthesised `players[]` and finally launches `MatchScene`. Each
    // scene preserves the mode reach-through so the AC is intact two
    // indirections deeper.
    expect(SCENE_SRC).toMatch(
      /scene\.start\(\s*['"]StageSelectScene['"]\s*,\s*\{\s*pendingMatchConfig/,
    );
  });

  it('cancel path returns to MainMenuScene', () => {
    // ESC must not strand the player on the select screen.
    expect(SCENE_SRC).toMatch(/scene\.start\(\s*['"]MainMenuScene['"]\s*\)/);
  });

  it('binds LEFT / RIGHT to the mode-cycle helper', () => {
    // Any regression in the key-to-helper wiring would silently break
    // the AC's "both modes selectable" contract — the helper's
    // transitions are well-tested but only matter if the scene
    // actually invokes them.
    expect(SCENE_SRC).toMatch(/keydown-LEFT/);
    expect(SCENE_SRC).toMatch(/keydown-RIGHT/);
    expect(SCENE_SRC).toMatch(/cycleMode/);
  });

  it('binds UP / DOWN to the quantity-cycle helper', () => {
    expect(SCENE_SRC).toMatch(/keydown-UP/);
    expect(SCENE_SRC).toMatch(/keydown-DOWN/);
    expect(SCENE_SRC).toMatch(/cycleQuantity/);
  });

  it('ENTER triggers the confirm handler', () => {
    expect(SCENE_SRC).toMatch(/keydown-ENTER/);
  });

  it('ESC triggers the cancel handler', () => {
    expect(SCENE_SRC).toMatch(/keydown-ESC/);
  });

  it('builds the MatchConfig via the pure helper (not ad-hoc literals)', () => {
    // Routing through `buildMatchConfigFromState` is what guarantees
    // the synthesised config matches the unit-tested shape (frozen,
    // mode-aware, with `timeLimitSeconds` iff time mode). Ad-hoc
    // object literals would bypass the AC's contract.
    expect(SCENE_SRC).toMatch(/buildMatchConfigFromState/);
  });
});

describe('GameConfig — ModeSelectScene registration', () => {
  it('registers ModeSelectScene in the scene list so MainMenu can navigate', () => {
    const cfg = readFileSync(
      resolve(__dirname, '../engine/GameConfig.ts'),
      'utf8',
    );
    // Both the import and the SCENES array entry have to exist for
    // Phaser to know about the scene.
    expect(cfg).toMatch(/import\s*\{\s*ModeSelectScene\s*\}/);
    expect(cfg).toMatch(/ModeSelectScene,/);
  });
});

describe('MainMenuScene — ENTER navigates into the pre-match select chain', () => {
  it('navigates to ModeSelectScene on ENTER (AC 11 entry point)', () => {
    const src = readFileSync(
      resolve(__dirname, './MainMenuScene.ts'),
      'utf8',
    );
    // The original AC 2 Sub-AC 5 flow chained MainMenu → LobbyScene →
    // ModeSelectScene. Lobby was later skipped because
    // CharacterSelectScene covers the join/AI/device duties Lobby
    // owned, so MainMenu now lands on ModeSelectScene directly. The
    // unchanged AC 11 contract is that the ENTER press reaches
    // ModeSelectScene at all — what's removed is the Lobby hop, not
    // the AC 11 destination.
    expect(src).toMatch(/scene\.start\(\s*['"]ModeSelectScene['"]\s*\)/);
  });
});
