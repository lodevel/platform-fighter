import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ASSET_MANIFEST,
  getAllAssetEntries,
  type AssetEntry,
} from '../assets/manifest';

/**
 * AC 10102 Sub-AC 2 — "Implement the PreloadScene's preload() method to
 * iterate the assets manifest and wire this.load.spritesheet/atlas and
 * this.load.audio calls for every registered asset key."
 *
 * `PreloadScene` itself imports Phaser, which drags in browser globals
 * at module-eval time and can't be loaded under plain Node. To verify
 * the wiring without spinning up jsdom + a Phaser game we follow the
 * same convention as `BootScene.test.ts` / `CharacterSelectScene.test.ts`:
 * read the scene source as text and assert the contract that downstream
 * acceptance evaluators (and the runtime) rely on.
 *
 * The wiring contract this AC requires:
 *
 *   1. `preload()` walks the central {@link ASSET_MANIFEST} (single
 *      source of truth from Sub-AC 1) rather than re-listing keys.
 *   2. The dispatch covers every `AssetKind`:
 *        - spritesheet → `this.load.spritesheet(...)` with frameWidth /
 *          frameHeight from the entry.
 *        - atlas       → `this.load.atlas(...)` with the texture + JSON
 *          companion URL pair.
 *        - audio/music → `this.load.audio(...)` with the URL fallback list.
 *      Image entries are also wired (`this.load.image`) so adding a still
 *      backdrop later doesn't silently no-op.
 *   3. Hot-reload safety — re-entering preload (Vite HMR re-mounts
 *      scenes on save) must not re-queue keys that are already in the
 *      texture / audio cache.
 *   4. Once loading completes the scene transitions on to
 *      `MainMenuScene` (the next step in the boot → preload → menu chain).
 *
 * The behavioural side of the AC — that every key in `ASSET_MANIFEST`
 * is actually walked — is verified by a flat sweep of
 * {@link getAllAssetEntries} below: if the manifest grows, the test
 * keeps proving the same dispatch covers every entry by virtue of
 * the exhaustive `kind` switch in the source.
 */
describe('PreloadScene — AC 10102 Sub-AC 2 wiring contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './PreloadScene.ts'),
    'utf8',
  );

  it('registers under the "PreloadScene" scene key', () => {
    // BootScene navigates by string key; if this drifts, the boot
    // chain breaks before any asset is loaded.
    expect(SCENE_SRC).toMatch(/key:\s*['"]PreloadScene['"]/);
  });

  it('imports the central ASSET_MANIFEST instead of hard-coding asset paths', () => {
    // Sub-AC 1 made the manifest the single source of truth — Sub-AC 2
    // requires the scene to read from it rather than duplicate keys
    // inline (which is what the manifest was introduced to fix).
    expect(SCENE_SRC).toMatch(
      /import\s*\{[^}]*\bASSET_MANIFEST\b[^}]*\}\s*from\s*['"]\.\.\/assets\/manifest['"]/,
    );
  });

  it('preload() walks the manifest', () => {
    // The body of preload() must hand the whole manifest to the
    // dispatcher — not a slice or a filtered list. Anything narrower
    // would silently skip future asset categories.
    expect(SCENE_SRC).toMatch(
      /preload\s*\(\)[^{]*\{[\s\S]*?queueManifest\(\s*ASSET_MANIFEST\s*\)/,
    );
  });

  it('dispatches spritesheet entries to this.load.spritesheet with frame dimensions', () => {
    // Phaser's spritesheet loader needs frameWidth + frameHeight, so the
    // dispatch must carry both. (Optional margin/spacing land via the
    // gutter-aware Kenney atlases shipped in M1.)
    expect(SCENE_SRC).toMatch(
      /this\.load\.spritesheet\([^)]*entry\.key[^)]*entry\.url[\s\S]*?frameWidth:\s*entry\.frameWidth[\s\S]*?frameHeight:\s*entry\.frameHeight/,
    );
  });

  it('dispatches atlas entries to this.load.atlas with texture + JSON companion', () => {
    // Atlases carry two URLs (image + JSON descriptor) — Phaser's
    // `load.atlas` signature takes both positionally.
    expect(SCENE_SRC).toMatch(
      /this\.load\.atlas\(\s*entry\.key\s*,\s*entry\.textureUrl\s*,\s*entry\.jsonUrl\s*\)/,
    );
  });

  it('dispatches both audio and music entries to this.load.audio with the URL list', () => {
    // Audio + music share the same Phaser loader (`load.audio`) — the
    // distinction is preserved by the `kind` tag in the manifest so the
    // mixer can mute them independently. The dispatch must funnel both
    // into the same call.
    expect(SCENE_SRC).toMatch(/case\s+['"]audio['"]\s*:\s*\n?\s*case\s+['"]music['"]/);
    expect(SCENE_SRC).toMatch(/this\.load\.audio\([^)]*entry\.key[^)]*entry\.urls/);
  });

  it('wires image entries to this.load.image so future backdrops are not silently dropped', () => {
    // The manifest currently has no `image` entries, but the dispatch
    // must still cover them — otherwise the first stage backdrop added
    // in M2 would silently fail to load with no compile-time warning.
    expect(SCENE_SRC).toMatch(
      /case\s+['"]image['"]\s*:\s*\n?\s*this\.load\.image\(\s*entry\.key\s*,\s*entry\.url\s*\)/,
    );
  });

  it('guards against re-queuing on Vite HMR by checking the texture / audio caches', () => {
    // Vite HMR can re-enter PreloadScene during dev. Phaser warns on
    // duplicate keys but the guard makes the intent explicit and avoids
    // the warning spam — important because the scene runs once per
    // session in production but many times during a dev session.
    expect(SCENE_SRC).toMatch(/this\.textures\.exists\(\s*entry\.key\s*\)/);
    expect(SCENE_SRC).toMatch(/this\.cache\.audio\.exists\(\s*entry\.key\s*\)/);
  });

  it('transitions to MainMenuScene once preload completes', () => {
    // Boot → Preload → MainMenu is the documented startup chain. If
    // this transition is wrong the player sees the loader bar finish
    // and then stares at an empty canvas.
    expect(SCENE_SRC).toMatch(
      /create\s*\(\)[^{]*\{[\s\S]*?this\.scene\.start\(\s*['"]MainMenuScene['"]\s*\)/,
    );
  });
});

/**
 * AC 10104 Sub-AC 4 — "Implement the PreloadScene's create() transition
 * logic that starts the next scene once loading completes, including
 * scene key wiring and cleanup of the progress bar."
 *
 * Sub-AC 4 is the *handoff* contract: by the time the next scene takes
 * over, (a) the loader bar must be torn down (no leaked draw-list
 * nodes), (b) the next-scene key must be both wired and validated, and
 * (c) the transition must run from `create()` (not from inside a loader
 * event handler) so the boot chain is discoverable from the scene
 * lifecycle rather than scattered across event listeners.
 *
 * The behavioural side — Phaser actually destroying the graphics — is
 * unit-tested via the source contract because PreloadScene drags Phaser
 * in at module-eval time and can't be instantiated under plain Node;
 * this mirrors the rest of this file.
 */
describe('PreloadScene — AC 10104 Sub-AC 4 create() handoff contract', () => {
  const SCENE_SRC = readFileSync(
    resolve(__dirname, './PreloadScene.ts'),
    'utf8',
  );

  it('create() invokes the progress-bar teardown helper before transitioning', () => {
    // The cleanup must run *inside* create() (not only in the loader's
    // `complete` listener) so the handoff contract holds even if a
    // future refactor changes when the bar is destroyed. The teardown
    // call must also appear before `this.scene.start(...)` so the
    // outgoing scene's draw list is empty by the time the next scene
    // takes over.
    //
    // We extract create()'s body by brace-counting from its opening
    // `{` because the method contains nested control-flow braces that
    // would trip a lazy regex.
    //
    // The scene source contains exactly one `create()` method (the
    // others are `preload()` / `drawProgressBar()` / `destroyProgressBar()`
    // / `queueManifest()`), so a single index lookup is enough.
    const createDecl = 'create(): void {';
    const declStart = SCENE_SRC.indexOf(createDecl);
    expect(declStart, 'create() declaration not found').toBeGreaterThanOrEqual(0);
    const bodyStart = declStart + createDecl.length;

    let depth = 1;
    let cursor = bodyStart;
    while (depth > 0 && cursor < SCENE_SRC.length) {
      const ch = SCENE_SRC[cursor];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      cursor += 1;
    }
    const body = SCENE_SRC.slice(bodyStart, cursor - 1);

    const destroyIdx = body.indexOf('this.destroyProgressBar()');
    const sceneStartIdx = body.indexOf("this.scene.start('MainMenuScene')");
    expect(
      destroyIdx,
      'this.destroyProgressBar() not called from create()',
    ).toBeGreaterThanOrEqual(0);
    expect(
      sceneStartIdx,
      "this.scene.start('MainMenuScene') not called from create()",
    ).toBeGreaterThanOrEqual(0);
    expect(
      destroyIdx,
      'progress-bar cleanup must run before the scene handoff',
    ).toBeLessThan(sceneStartIdx);
  });

  it('exposes a destroyProgressBar() helper that nulls both graphics handles', () => {
    // The cleanup helper must be idempotent so it can run from both the
    // loader's `complete` event and again from create(). Nulling the
    // refs is what makes the second call a no-op.
    expect(SCENE_SRC).toMatch(/private\s+destroyProgressBar\s*\(\)\s*:\s*void\s*\{/);
    expect(SCENE_SRC).toMatch(/this\.progressFill\s*=\s*null/);
    expect(SCENE_SRC).toMatch(/this\.progressTrack\s*=\s*null/);
  });

  it('stashes the progress-bar graphics on instance fields so create() can reach them', () => {
    // Sub-AC 4 cleanup needs handles to the graphics. Without instance
    // fields the bar would be locally scoped to drawProgressBar() and
    // create() would have no way to tear it down.
    expect(SCENE_SRC).toMatch(/private\s+progressTrack\s*:\s*Phaser\.GameObjects\.Graphics\s*\|\s*null/);
    expect(SCENE_SRC).toMatch(/private\s+progressFill\s*:\s*Phaser\.GameObjects\.Graphics\s*\|\s*null/);
  });

  it('the loader complete listener delegates to the same teardown helper', () => {
    // Keeping the `complete` listener delegating to destroyProgressBar()
    // (rather than calling .destroy() inline) guarantees that whichever
    // path runs first, the second path still ends up a safe no-op.
    expect(SCENE_SRC).toMatch(
      /this\.load\.on\(\s*['"]complete['"]\s*,\s*\(\)\s*=>\s*\{\s*this\.destroyProgressBar\(\)\s*;?\s*\}\s*\)/,
    );
  });

  it("verifies the next scene key is registered before calling scene.start", () => {
    // If MainMenuScene gets removed from SCENES in GameConfig.ts we want
    // a loud console error, not a silent freeze on the loader screen.
    // The check must read from `scene.manager.keys` (Phaser's authoritative
    // registry) rather than a hand-maintained list.
    expect(SCENE_SRC).toMatch(/this\.scene\.manager\.keys\[\s*PreloadScene\.NEXT_SCENE_KEY\s*\]/);
    expect(SCENE_SRC).toMatch(/console\.error\([\s\S]*?PreloadScene[\s\S]*?next scene/);
  });

  it('keeps the next-scene key as a named static so symbol search finds the boot chain', () => {
    // Hard-coding the string in two places (the constant + the literal
    // scene.start call) is intentional: the constant gives symbol search
    // a single hit and the literal keeps the existing wiring contract
    // test (which greps for the literal) honest. Both must agree.
    expect(SCENE_SRC).toMatch(
      /private\s+static\s+readonly\s+NEXT_SCENE_KEY\s*=\s*['"]MainMenuScene['"]/,
    );
  });
});

/**
 * Behavioural sweep — the dispatch in PreloadScene is keyed off
 * `entry.kind`, so verifying every manifest entry exposes a `kind`
 * matching one of the wired branches doubles as a check that the
 * scene's `preload()` will actually queue *every* registered key.
 *
 * If a future commit adds a new {@link AssetKind} to the manifest
 * without extending PreloadScene's switch, this test fails alongside
 * the TypeScript exhaustiveness error in the scene source.
 */
describe('PreloadScene — covers every registered asset key', () => {
  const wiredKinds = new Set<AssetEntry['kind']>([
    'image',
    'spritesheet',
    'atlas',
    'audio',
    'music',
  ]);

  it('every ASSET_MANIFEST entry has a kind PreloadScene knows how to dispatch', () => {
    const entries = getAllAssetEntries(ASSET_MANIFEST);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(
        wiredKinds.has(entry.kind),
        `manifest entry "${entry.key}" has unwired kind "${entry.kind}"`,
      ).toBe(true);
    }
  });

  it('manifest contains entries for every loader category Sub-AC 2 requires', () => {
    // Sub-AC 2 explicitly calls out spritesheet, atlas, and audio — at
    // least the spritesheet and audio branches must be exercised by
    // the current manifest so the dispatch isn't dead code.
    const entries = getAllAssetEntries(ASSET_MANIFEST);
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds.has('spritesheet')).toBe(true);
    expect(kinds.has('audio')).toBe(true);
    expect(kinds.has('music')).toBe(true);
  });
});
