<!-- Planning agent output, 2026-10-14 (read-only analysis). Binding rule: ~50-70 MB GPU per fighter; see memory character-texture-budget. -->

# Art-budget pipeline for all fighters: plan

Read-only analysis; I changed nothing. I measured the numbers below from the tree today with in-memory scripts.

**The four rules alone do not get DK into 50–70 MB.**
- Link and Pikachu fit.
- DK lands at about 101 MiB after all four rules. His drawings are already fairly tight in their cells, so cropping only saves ×0.57, not ×0.39.
- There is one cheap fix (option iii in "Needs the user").

## Measured facts

| | DK | Pikachu | Link (41 staged clips) |
|---|---|---|---|
| Clips / drawings | 203 / 1,350 (6.6 per clip) | 188 / 1,097 (5.8 per clip) | 41 / 1,842 (45 per clip) |
| Decoded atlases today | 711 MiB | 915 MiB | 682 MiB |
| Tight-packed (bounding box + 1 px, shelf-packed, 4 px aligned) | 406 MiB (×0.57) | 113 MiB (×0.12) | 276 MiB (×0.40) |
| Duplicate drawings | 23 (7 MiB) | 10 (1 MiB) | not worth deduplicating |

The runtime already treats each clip as a grid of cells:
- Phaser's `load.spritesheet` cuts each strip into a grid of `frameWidth × frameHeight` cells (`PreloadScene.queueManifest`).
- The port's `TextureStore` and `SpriteLayer.place` use the same grid maths.
- `sourceCells`, `columns` and `rows` are read by tools only, never by `src/`.
- DK and Pikachu manifest entries are built from frames.json (`manifest.ts` lines ~1308 and ~1318).

## a. Key-pose selection rule

**Where DK's ~7 come from.** `docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/clip-plan.json` (`meta.rule`) and its `clip-plan-summary.md`. The plan was applied by hand; no tool for it is committed.

**The rule, made a tool.** New `tools/key-pose-plan.py`, a pure function. Samples are 1-based native frames.
1. **Inputs per clip:**
   - N = native frame count (from the nuanmb header);
   - loop or not;
   - C = native cancel frame or first actionable frame (FAF);
   - active windows (from the fighter's attack data; for Link, `linkAttackGeometry.json` rows grouped by role and consecutive sample);
   - strike samples K: the first sample of each strike or multi-hit rung;
   - event samples: article release (`releasePoints`), throw release, item release, catch-box start;
   - family: gap limit G = 6 for attacks, specials, throws, catches and item swings; 8 for everything else.
2. **Mandatory samples:**
   - sample 1;
   - every K and every event sample;
   - the start and end of every window;
   - the end E = C if C > 0, otherwise N; for loops, N−1.
   - Charge or hold loops take no contact samples.
3. **Fill.** For each gap (a, b) longer than G, split it into k = ceil((b−a)/G) equal parts and insert round(a + j(b−a)/k) for j = 1…k−1. Ties go to the lower frame.
4. **Cap of 12.** Re-fill with the smallest G' that fits. If it still doesn't fit, drop window ends, latest first. Never drop sample 1, a contact or E.
5. **Loop seam.** Drop any loop sample held for less than 2 frames, unless it is a contact. The runtime already skips these (`selectDonkeyKongNativeSampleFrame`).
6. **Thinning existing drawings.** Snap each planned sample to the nearest existing drawing, ties to the earlier one. A mandatory sample must exist exactly. If it doesn't, the tool fails; render that frame with `link-render-clip.py --frames <sample−1>`.
   - For new clips, render exactly samples−1.

**Output.** `nativeSampleIndices` as today. `actionFrameStarts`, `itemAttachmentPoses`, the `item-axes.json` drawings and any `hurtboxPoses` are filtered by the same indices and re-indexed. Timing stays native and the selector is unchanged.

**Self-test.** Feed the inputs stored in `clip-plan.json` and reproduce its `nativeSamples` for all 150 clips. Hand-edited clips (extras2) are listed as exceptions.

**Effect on Link (simulated with today's data).** 1,842 → 345 drawings, about 8.4 per clip. That is high because the staged set is mostly attacks; DK's attacks also reach 8–12. Examples:
- air_dodge 64 → 11
- usmash 95 → 12
- walk 41 → 6

## b. Tight packing

**Format.** Each clip keeps its union cell: `frameWidth`, `frameHeight` and `root` don't change. New fields:
```
"atlas": [W, H],
"trims": [[x, y, w, h, dx, dy], ...]   // one per drawing: rect in the atlas, offset in the cell
```
`sourceCells`, `columns`, `rows` and `pages` are dropped.
- This is exactly Phaser's trimmed JSON-hash frame: `frame{x,y,w,h}`, `trimmed:true`, `spriteSourceSize{dx,dy,w,h}`, `sourceSize{frameWidth,frameHeight}`.
- `load.atlas(key, url, <object>)` accepts the JSON as an in-memory object. Phaser's own parser then handles origin, flip and crop for trimmed frames, and numeric frame names "0"…"n-1" keep `setFrame(i)` and `generateFrameNumbers` working.

**Packer, `tools/fighter-pack.py`.**
- One `tight_pack(cells)` step:
  - each rect = alpha bounding box + 1 px, clamped to the cell;
  - deterministic shelf/maxrects order (−h, −w, index);
  - 2 px gutter, rect origins aligned to 4 px;
  - atlas size a multiple of 4 and at most 4096; fail otherwise. Paging is removed, since every clip fits once thinned.
- Two inputs:
  - the existing render path (cutouts → `render_cell`);
  - a new `--repack-installed <fighter>` mode: cut each drawing's cell out of the installed strip with no resampling, tight-pack, rewrite only the layout fields and `sha256`, and leave every other key in place and in order.
- New helper `tools/fighter_frames.py`: reads a drawing's cell from either layout. Used by the packer and `contact-sheet.py`.
- `tools/link-convert-installed.py` gains `--keep <plan.json>`.

**Consumers (minimal, one implementation).**
- New `src/assets/packedFrames.ts` (no Phaser):
  - `phaserAtlasJson(entry)`;
  - `frameRect(entry, i)`: returns the trim, or the grid rect for legacy sheets.
- `manifest.ts`: `SpritesheetAssetEntry` gains optional `atlas` and `trims`, which the DK, Pikachu and Link builders pass through from frames.json. The kind stays `spritesheet`, so `MANIFEST_ART_CATALOG` and the tests are untouched.
- `PreloadScene`: a spritesheet entry with `trims` loads via `load.atlas(key, url, phaserAtlasJson(entry))`.
- `MatchScene.ts` lines ~2026/2033/2034 (Pikachu shooting crop): `frame.width/height` → `frame.realWidth/realHeight`. Same in `CharacterEditorScene` 150/162 until it is deleted.
- Port `textureStore.ts`: carries `trims` and the atlas size from the entry.
- Port `spriteLayer.place`:
  - quad = trim rect at `-origin·cell + (dx, dy)`;
  - when flipped, x starts at `origin·W − W + dx`, which is Phaser's flip rule;
  - UVs are rect ÷ the metadata atlas size, so they are independent of the texture's resolution.
- No change needed in:
  - the DK and Pikachu presentation modules (origins are root ÷ the logical cell);
  - the sprite driver;
  - `artFrameSelector`;
  - `poses.ts`;
  - `finalBodyPose`;
  - `spriteSnapshot` (uses the logical size).

**Repack DK and Pikachu with the same pixels.**
- Per drawing, the cell rebuilt from the new atlas must equal the old cell in premultiplied RGBA. Bytes must be identical wherever alpha > 0.
- Record a per-drawing `rgbaSha256` in the pack report. This follows the Pikachu `atlasRepack` precedent with `cellPixelsUnchanged`.

**Verification.**
- Goldens IDENTICAL: the sim reads only `nativeSampleIndices`, `frameWindows` and the pose rows, which don't change.
- `animation-acceptance.mjs` Phaser screenshots before and after: diff 0.
- Port `parity.mjs`: max 1/255.
- A new `packedFrames.test.ts` and a port `spriteLayer.check.ts` showing that a full-cell trim places the quad exactly like the grid path, for every origin, flip and rotation.
- `SIMULATION_BUILD_ID` changes (it hashes `assets/characters/`). Expected.

## c. Loading only the match's fighters

**Shared, no Phaser: new `src/assets/fighterAssets.ts`.**
- `fighterAssetEntries(id)`: manifest entries with the `char.<id>.` prefix plus any declared extras.
- `menuAssetEntries()`: every fighter's `idle` plus all non-fighter assets.
- `matchFighterIds(data)`: each player's `characterId` and `assetCharacterId`.

**Phaser.**
- Move the loader switch from PreloadScene into `src/assets/phaserAssetQueue.ts`, together with `releaseFighters(scene, keep)`. Release removes textures and their anims; otherwise the `anims.exists` short-cut keeps animations pointing at freed frames.
- `PreloadScene` queues `menuAssetEntries()` only.
- Add `MatchScene.preload()`: queue the match's fighters with a progress bar, and release fighters that are not in this match.
  - Phaser runs `preload` on every `scene.start`, so stage select, rematch, replays, the 169 probes and the golden harness all pass through it.
  - Probes already wait for `isActive('MatchScene')`, which is false while loading.
- `CharacterEditorScene.preload` queues every fighter until step 9 deletes it.
- **Recommendation:** with 3 fighters, tight-packed Phaser holds about 744 MiB if everything is loaded. Build this only if a 4th fighter lands before port step 9 (decision 3).

**Port.**
- `TextureStore` gains `preload(keys)` and `release(keys)` (dispose).
- The match screen awaits `preload(fighterAssetEntries(ids))` before the first sim step.
- At the next match start it releases fighters no longer used, so a rematch is instant.
- Menus, the select screen, the lineup and the snapshotter use only `idle`.

## d. KTX2: port only

- **Phaser is PNG only.** Phaser 3 has no KTX2/Basis transcoding, and Phaser is removed in step 9.
- **PNGs stay the lossless source** for tools and for Phaser.

**Toolchain on this WSL machine (checked).**
- No `basisu`, `toktx` or `ktx`, and the Ubuntu 24.04 package lists have nothing for them.
- gcc/make/curl/wget are present, cmake is not.
- three 0.170 already ships `KTX2Loader.js` and `libs/basis/basis_transcoder.{js,wasm}`.
- Plan: install a pinned KTX-Software 4.x Linux release tarball into `~/.local/opt/ktx`. This needs your approval; CI would download the same pinned version.

**Encoding: `port/scripts/build-ktx2.mjs`.**
- Premultiply alpha first, because compressed textures can't be premultiplied at upload. The shader already expects premultiplied texels.
- `ktx create --format R8G8B8A8_UNORM --assign-oetf linear --assign-primaries none --encode uastc --uastc-quality 2 --zstd 18`, no mipmaps.
- **Gotcha:** the output must be linear (UNORM). Otherwise `parseColorSpace` picks an sRGB format and the GPU sampler darkens every colour compared with Phaser.
- Output goes to `assets/generated/ktx2/<fighter>/<clip>.ktx2`: sha-cached like the palette build, git-ignored, outside the build-ID hash.

**Runtime.**
- `TextureStore` takes the renderer (`KTX2Loader.detectSupport`).
- `colorSpace` = NoColorSpace, linear filtering.
- Compressed textures cannot be flipped on upload, so `spriteLayer` gets a per-sheet `flipY` flag for the V coordinate.
- Expose the chosen transcode target for probes.

**Quality check: `tools/ktx2-quality.py`.** Decode with `ktx extract --transcode rgba8` (the same result as the BC7/ASTC transcode) and compare each drawing with the premultiplied source:
- PSNR over pixels with α > 0: RGB ≥ 42 dB, alpha ≥ 45 dB.
- Flat areas (3×3 uniform in the source): at most 0.5% off by more than 6/255.
- Ink (luminance < 0.2, α ≥ 200): at most 1% off by more than 24/255.
- Halo: at most 0.1% of pixels with source α = 0 decode to α > 8.
- Contact sheets at 1× and 3× (source | decoded | diff ×8) for your eye.
- Pilot on DK idle and jab, Pikachu idle and Link jab to fix the UASTC level and thresholds.

**Fallback.** KTX2Loader's UASTC priority is ASTC → BC7 → ETC2 → BC3 → PVRTC → RGBA32.
- ETC2 and BC3 are also 1 byte per pixel, but lower quality.
- With no compressed format at all (e.g. SwiftShader), the texture becomes RGBA32 at the step-2 sizes. Accepted; it is logged.

## e. Budget per fighter (MiB of decoded GPU textures, whole kit)

"Full kit" means about 215 clips and about 1,400 drawings at DK density. That is my estimate.

| After step | DK | Pikachu | Link, 41 staged | Link, full kit |
|---|---|---|---|---|
| Today | 711 | 915 | 682 | (about 4.5 GB at one drawing per frame) |
| 1. DK density | 711 (already) | 915 (already) | ~128 (345 drawings) | ~520 |
| 2. Tight packing | 406 | 113 | 55 | ~225 |
| 3. KTX2 (BC7/ASTC, ×0.25) | **101** | 28 | 14 | ~56 |
| 3b. Optional texel scale f = 0.8 | 65 | 18 | 9 | ~36 |
| 4. Per match | only fighters in the match; menus hold `idle` only (≤1 MiB each in KTX2) | | | |

**8 different fighters, after step 3:**
- all heavyweights (DK-class): ~810 MiB;
- a typical mix (2 heavy, 4 Link-class, 2 Pikachu-class): ~480 MiB;
- with f = 0.8: ~520 and ~310.

The same fighter picked twice loads once, because costumes are a shader recolour.

**Phaser era (no KTX2):** 3 fighters tight, all loaded, about 744 MiB; today it is over 2.8 GB.

## f. Ordering and work packages

| WP | Content | Files owned | When | Verification | Effort |
|---|---|---|---|---|---|
| T0 | `tools/fighter-texture-budget.py`: per-clip and total size today, tight and BC7 | new tool | now | reproduces the numbers above | 0.5 d, Sonnet low |
| T1 | `tools/key-pose-plan.py` plus adapters (DK from `clip-plan.json`; Link from geometry, attack data and nuanmb headers) | new tool | now | `clip-plan.json` reproduced; every Link window edge and release sample kept | 1–1.5 d, Sonnet medium |
| T2a | Packer tight output and `--repack-installed`; `fighter_frames.py`; converter `--keep` | `tools/fighter-pack.py`, `tools/fighter_frames.py`, `tools/link-convert-installed.py`, `tools/contact-sheet.py` | now | cells rebuild byte-identical; same output on a second run | 1.5 d, Sonnet high |
| T4 | Link staging v2: thinned and tight | `docs/review/2026-10-14/link-takeover/A3-staging/**` | after T1 and T2a | schema checks; parallel arrays re-indexed; before/after contact sheets for you | 0.5–1 d, Sonnet medium |
| T2b | Runtime support (no behaviour change yet) | new `src/assets/packedFrames.ts`, `manifest.ts`, `PreloadScene.ts`, `MatchScene.ts` (3 lines), `CharacterEditorScene.ts` (2 lines), port `textureStore.ts` and `spriteLayer.ts`, tests | **after step 4** (manifest edits), **before A4** | goldens IDENTICAL; parity; new tests | 1–1.5 d, Sonnet high |
| T3 | Repack DK and Pikachu | `assets/characters/{donkeykong,pikachu}/**` | after T2b | pixel identity per drawing; goldens IDENTICAL; screenshot diff 0; port parity | 0.5–1 d, Sonnet medium |
| A4 | (existing) installs **T4 staging**, already thinned and tight | as in the Link plan | after T2b and T3 | as planned | — |
| C-render | Each new Link clip: T1 plan → `link-render-clip.py --frames` → tight pack | as in the Link plan | after A4 | per clip: every hit/event sample kept, no invisible frames | — |
| L1 (optional) | Phaser per-match loading | new `src/assets/fighterAssets.ts` and `phaserAssetQueue.ts`, `PreloadScene`, `MatchScene.preload`, `CharacterEditorScene.preload` | after A4 (A4 rewrites PreloadScene) | probes; goldens IDENTICAL; no Link textures after a DK-vs-Pikachu match | 1–1.5 d, Sonnet high |
| K1 | KTX2 build and quality tool, pilot first | `port/scripts/build-ktx2.mjs`, `tools/ktx2-quality.py`, CI step | pilot now (after encoder install); full run with port step 6 | thresholds above; your look at the contact sheets | 1.5–2 d, Sonnet high |
| K2 + L2 | Port KTX2 loading and per-match loading | port `textureStore.ts`, `spriteLayer.ts`, `ui/screens/match.ts`, presenter | with port step 6 | KTX2 vs PNG parity within K1 bounds; `renderer.info` plus byte estimate match the table; RGBA32 fallback path tested | 2–2.5 d, Sonnet high |

Total ≈ 10–13 agent-days, mostly in parallel with A1, A2, B and the art work. Step 5's goldens are unaffected: T3 keeps state identical, and A4 re-records Link anyway.

## Needs the user

1. **DK at about 101 MiB.** Pick one:
   - (i) accept heavyweights at about 100;
   - (ii) re-thin DK with cap 8 (about 75–80, but it drops accepted drawings);
   - (iii) **recommended:** texel scale f = 0.8 applied only in the KTX2 build. DK goes to 65, Link to ~36, Pikachu to 18.
     - At 1080p, even at the camera's maximum zoom of 1.4, each texel still covers less than one screen pixel (0.82), so nothing is lost there.
     - Close-ups get slightly softer at 1440p and 4K.
     - No code cost, because UVs are normalised.
2. **Encoder install.** Download the pinned KTX-Software release binaries; nothing is in apt. CI needs the same.
3. **Phaser per-match loading (L1).** Build it now, or only if a 4th fighter arrives before step 9?
4. **Menu art.** Use each fighter's `idle` clip as its portrait (no new art), or make dedicated portraits?
5. **Mipmaps.** Off by default to match Phaser. On costs +33% and reduces shimmer at zoom 0.4.
6. **Visual acceptance of thinned Link.** For example idle 26 → 12 drawings and air_dodge 64 → 11. Shown as T4 contact sheets.

### Critical Files for Implementation
- /mnt/c/Workspace/platform-fighter/tools/fighter-pack.py
- /mnt/c/Workspace/platform-fighter/tools/link-convert-installed.py
- /mnt/c/Workspace/platform-fighter/src/assets/manifest.ts and /mnt/c/Workspace/platform-fighter/src/scenes/PreloadScene.ts
- /mnt/c/Workspace/platform-fighter/port/src/engine/sprites/textureStore.ts and /mnt/c/Workspace/platform-fighter/port/src/engine/sprites/spriteLayer.ts
- /mnt/c/Workspace/platform-fighter/docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/clip-plan.json (rule source and planner self-test)
- /mnt/c/Workspace/platform-fighter/src/characters/linkAttackGeometry.json (Link windows and release samples for thinning)

## Decisions (user, 2026-10-14) — override the plan above

- **Scope: Link only.** DK and Pikachu are NOT reduced ("I didn't tell you to reduce DK or Pikachu ... Accept 100"). T3 (repack DK/Pikachu) and the texel scale option are NOT done. Link gets DK density (T1), tight packing (T2a) and KTX2 (K1/K2, port only).
- **KTX-Software:** install for Link's textures.
- **TODO — general policy, to decide with the user:** a per-fighter GPU budget for the 12+ roster; whether tight packing / KTX2 / per-match loading (L1/L2) apply to every fighter; menu portraits; mipmaps.
- Coordinator calls: no Phaser per-match loading for now (3 fighters; Phaser leaves in port step 9); mipmaps off (match Phaser); menus use `idle`.
- T2b (runtime support for the tight `atlas`/`trims` format) is still needed, because Link is installed tight-packed.
- **KTX-Software installed:** v4.4.2 (Khronos release, published 2025-10-04), `~/.local/opt/ktx-4.4.2/` (run with `LD_LIBRARY_PATH=~/.local/opt/ktx-4.4.2/lib`). Tarball `KTX-Software-4.4.2-Linux-x86_64.tar.bz2`, sha1 checked against the release's `.sha1`, sha256 `a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245`. CI must pin the same file.

## User decision and delivery audit — 2026-10-15

The user explicitly approved **“Apply lossless packing to DK and Pikachu”**
after reviewing the staged 2,495-drawing plan and its measured combined decoded
size of 2,042.59 → 876.60 MiB. This supersedes the old T3 exclusion for a
layout-only repack. Drawing count, visible RGBA pixels, premultiplied logical
canvases, source ROOT, timing, receiving and attachment metadata must remain
unchanged. It does not authorize thinning, rescaling or lossy/GPU compression
of DK/Pikachu, or settle the general roster budget.

The current implementation audit found that Link tight PNG packing, trim-aware
rendering and the KTX encoder installation landed. K1 generation/quality tools,
actual KTX2 assets and K2 runtime loading did **not** land. Earlier estimated
BC7 numbers must not be presented as measured compressed runtime memory. See
[the memory audit](../../2026-10-15/user-bugs/MEMORY-AUDIT.md).
