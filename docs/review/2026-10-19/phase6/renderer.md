# Phase 6, step R: the package renderer

Part of the [Phase 6 plan](PLAN.md). The game can draw a fighter from its character
package behind a dev flag. Legacy stays the default for every fighter.

## Shipping packages

`npm run character:package [-- <ids>]` (`scripts/build-shipping-packages.ts`) runs, per
fighter: export → `character:holds --max-diff 0.12` → `character:shrink --colors 256` → copy
`<id>~holds-0.12~small-c256` into `assets/characters/<id>/package/` (character.json + pages/).
Work files go to `.tmp/shipping-packages`. It then rewrites `assets/characters/packages.json`,
the small index the game imports (revision, pages, drawings, GPU and disk bytes).

The run for all three took 2 min 46 s. The revisions equal the Phase 3 candidates:

| Fighter | Revision | Pages | Drawings | Disk | GPU estimate (`packageMemory`) |
| --- | --- | ---: | ---: | ---: | ---: |
| donkeykong | `aef1887a68b4` | 208 | 1,511 | 18.7 MiB | 86,502,208 B (82.5 MiB) |
| link | `7a5bd7dcf89c` | 229 | 1,653 | 9.8 MiB | 32,405,936 B (30.9 MiB) |
| pikachu | `32ffd430468a` | 205 | 1,156 | 4.9 MiB | 19,701,088 B (18.8 MiB) |

Package files are fetched at runtime through `manifestAssetUrl`, never bundled:
- dev: `assets/` is Vite's `publicDir`; `/characters/link/package/character.json` answered 200;
- preview: the shared-files plugin serves `assets/` under the base;
- deploy: `scripts/copy-runtime-assets.ts` copies every indexed package into `dist/`
  (checked: `dist/characters/link/package` is identical to the source).

## Loading (`port/src/fighters/packageLibrary.ts`)

- `acquire(id, { signal, progress })` returns a lease; holders of the same fighter share one
  load. The last `release()` starts a 3 s grace period, then the textures are disposed.
- Load: fetch character.json, `validatePackage`, check the pinned revision from the index,
  then fetch and decode the pages 6 at a time.
- Pages are decoded by `character/render/indexedPng.ts`: 8-bit greyscale PNG → one byte per
  pixel, through `DecompressionStream`. No image decoder or colour management touches the
  indices. It also runs in Node (the checks load all three shipped packages).
- Each page becomes an R8 `DataTexture` (nearest, no mipmaps, `unpackAlignment` 1). The CPU
  copy is that same byte array, kept so a lost context can upload again.
- One palette `DataTexture`: 256 × costumes, straight RGBA, row N = `costumePalette(pkg, N)`.
- With a renderer attached (the match lease attaches it), pages upload as they decode.
- Aborting a holder's signal releases its lease. When nobody holds the package, loading stops
  and the textures made so far are disposed. A failed load is forgotten, so the next
  `acquire` tries again.

## Drawing (`port/src/engine/sprites/spriteLayer.ts`)

A `SpriteDraw` may carry `indexed: { page, rect, palette, paletteRow }`. The rest of the draw
path is shared: the rect becomes the logical frame, and placement, origin, flip, rotation,
clipping, depth order, tint, alpha and blending are unchanged. The same material handles both
paths, with a uniform branch in the fragment shader:
1. `texelFetch` the 4 indices around the sample point (clamped to the page edge);
2. look each up in the costume's palette row and premultiply;
3. blend bilinearly, as a linearly filtered RGBA sheet would;
4. apply the existing tint and alpha. Recolour does not apply; a costume is a palette row.

`facingOriginX` (the origin mirrored for a root-anchored flip) is now shared by `poses.ts`
and the package backend.

## Backend (`port/src/fighters/backends/packageSprite.ts`)

- Capability `package-sprite`. One profile per shipped package (`package.<id>`, revision =
  package revision, resource `package:<id>`), registered beside the legacy profiles.
- Each appearance instance holds a lease for its fighter, so menus, previews and matches share
  one copy. The match's resource provider holds the packages for the whole match and uploads
  them to the match renderer.
- `packageDraws(loaded, request, display)` takes an `ActionDisplay`
  (`src/characterPresentation/contracts.ts`, added by step 0): action, tick, facing, optional
  rotation about a pivot, squash about the root, and an upper-body overlay clipped at the
  waist. Match requests are placed at the body centre (root = body centre −
  `bodyCentreFromRootY`); preview and knockout-flight requests at their root.
- Until step 0 is wired, `requestDisplay` stands in: the request's action id and clock age.
  This is right for menus and previews. In a match the id is the simulation state, so an
  action the package names differently shows `idle` and is reported as `missingAction`.
- Dev opt-in: `?packages=link` (or `link,pikachu`, or `all`) is read once per match in
  `prepareMatchResources`. Fighters not named go back to legacy if a package was selected.
- `snapshot()` draws menu art from the package through the same sprite snapshotter.
- `__sim.presentation(i)` reports capability, revision, action, drawing, palette row and
  submission. `__menu.packages()` reports the library (refs, pages, measured and estimated
  bytes).

## Browser check

`tools/package-renderer-probe.mjs` against the production build (`vite preview`, headless
Chromium, SwiftShader). Each match ran 200 idle frames on `flat`, then left to the title
screen and waited out the grace period.

| Match | Fighters drawn from packages | Ready | GPU textures | Package bytes uploaded | Legacy sheets decoded (RGBA estimate) | Packages after leaving |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| legacy | none | 6.2 s | 17 | 0 | 593.6 MB | 0 |
| `?packages=all` | Link, Pikachu (costume 1, facing left) | 5.4 s | 444 | 52,123,408 B | 2.5 MB (items, idle cards) | 0 |
| `?packages=link` | Link; Pikachu legacy | 6.3 s | 244 | 32,414,128 B | 298.7 MB | 0 |
| `?packages=all`, DK costume 2 | DK, Pikachu | 6.5 s | 423 | 106,219,680 B | 3.0 MB | 0 |

Uploaded bytes against the estimate, per package:

| Package | Uploaded | `packageMemory().gpuBytes` | Difference |
| --- | ---: | ---: | --- |
| link | 32,414,128 | 32,405,936 | +8,192: palette, 256 × 8 costumes × 4 B |
| pikachu | 19,709,280 | 19,701,088 | +8,192: palette |
| donkeykong | 86,510,400 | 86,502,208 | +8,192: palette |

"Uploaded" is the texel bytes given to WebGL. The driver's real allocation is not visible
from a page.

Package against legacy at the same frame, over a 320 px crop around each fighter:

| Fighter | Mean RGB difference (0–255) | Pixels differing by > 24 |
| --- | ---: | ---: |
| Link | 0.76 | 0.78% |
| Pikachu (costume 1, facing left) | 0.40 | 0.22% |

Screenshots: [legacy Link](renderer/legacy-link.png) / [package Link](renderer/packages-all-link.png),
[package Pikachu, costume 1](renderer/packages-all-pikachu.png),
[package DK, costume 2](renderer/dk-costume-2-donkeykong.png), whole frames in
[renderer/](renderer/). Report: [renderer/report.json](renderer/report.json). No page or
console errors.

## Checks

- `npm run typecheck` (with the layer check) and `npm run build`.
- Targeted tests, 118 in 20 files: `port/src/engine`, `port/src/fighters`, `port/src/match`,
  `character/render`. New: `indexedPng.test.ts`, `packageLibrary.check.ts` (sharing, grace,
  cancel, pin, retry, all shipped packages), `packageSprite.check.ts` (anchor on the root in
  both facings, pivot and squash, overlay clip, idle fallback, profiles, opt-in), and
  indexed cases in `spriteLayer.check.ts`.

## Left for the next steps

- **Wire step 0.** Give `PackageSpriteAppearance` the selector's `display` instead of
  `requestDisplay`. It can hold its own `createLegacyArtSelector()` and pass
  `selector.current()?.display`, as the legacy backend does.
- **Load on select** (step 2): the fighter select screen takes `packageLibrary.acquire` leases.
- **Lab:** `character/lab/packageView.ts` still reads indexed pages through a canvas. It could
  use `decodeIndexedPng` to get exact indices.
- **Draw cost:** each page is its own texture (444 for two fighters). That is fine for one
  drawing per fighter. Fewer, larger pages would only matter for upload batching.
