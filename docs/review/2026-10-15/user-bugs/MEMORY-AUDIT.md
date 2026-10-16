# Texture-memory plan versus delivered runtime

Read-only audit, 2026-10-15. No source, skill or asset changes were made for this
audit. The pre-bug server on 4301 was not changed.

## The recorded user decision

[The art-budget plan's overriding Decisions](../../2026-10-14/art-budget/PLAN.md#decisions-user-2026-10-14--override-the-plan-above)
at lines 235–242 limits the work to Link: DK density/key poses, tight packing and
KTX2 in the Three.js port. It explicitly excludes T3, the DK/Pikachu repack, and
leaves a general roster-wide policy for discussion. The earlier 50–70MB planning
target is therefore not permission to reduce every fighter.

Both saved Claude project memories say the same thing:

- [Current-workspace memory](/home/lombet/.claude/projects/-home-lombet-Workspace-platform-fighter/memory/character-texture-budget.md:15)
- [Earlier-workspace memory](/home/lombet/.claude/projects/-mnt-c-Workspace-platform-fighter/memory/character-texture-budget.md:15)

The exact restriction at line 15 is: **“do not repack, thin, rescale or compress
DK/Pikachu without asking.”** Lines 16–17 leave general per-fighter budgets,
packing/compression for everyone and per-match loading as a user decision.
Preserving all visible pixels does not remove the word “repack” from this
restriction. At the time of this audit, the coordinator held the staged DK
installation and arranged restoration of the recently installed Pikachu repack
while presenting that concrete choice. The user subsequently explicitly approved
lossless packing for both DK and Pikachu; their new installation is authorized by
that later decision. KTX2 remains Link-only. This audit performs no installation.

## What exists and what does not

| Work | Evidence | Status |
| --- | --- | --- |
| Key-pose planning and PNG tight packing | `tools/key-pose-plan.py`, `tools/fighter-pack.py`, `tools/fighter_frames.py`; Link's installed `frames.json` has 227 animation rows, 220 with `atlas`/`trims`. | Delivered tools and installed Link layout support. This count is not a fresh full visual-coverage acceptance. |
| Runtime trimmed-atlas placement | `src/assets/packedFrames.ts`, manifest layout fields, `port/src/engine/sprites/spriteLayer.ts` and `TextureStore.fetch`. | Delivered. Drawing identity/logical cells are distinct from stored trim rectangles. |
| Earlier DK/Pikachu repack experiment | `docs/review/2026-10-14/art-budget/T2a/T2a-proofs.txt` explicitly says staging was scratch, never under `assets/`; it retains pixel-identity and size reports. | Staged experiment, not evidence of an authorized installed compression pipeline. |
| Pinned KTX encoder installation | `~/.local/opt/ktx-4.4.2/bin/ktx --version` with its library path returns `ktx version: v4.4.2`; release identity is recorded in the plan. | Installed. |
| K1 Link encoding, quality tool and CI step | At the initial audit, the planned builder/quality scripts and project `.ktx2`/`.basis` files were absent. A subsequent Link-only pilot added both tools and generated idle KTX2; its quality-2 result fails (details below). | Still unfinished; no accepted pilot, full bank or CI integration. |
| K2 compressed-texture loading | `TextureStore.fetch`, lines 96–107, always uses `ImageBitmapLoader(entry.url)` and `new THREE.Texture(bitmap)`. No project `KTX2Loader`, `detectSupport` or transcode-format selection exists. | Unfinished; runtime is PNG → decoded RGBA. Three's loader/transcoder under `node_modules` is a dependency, not connected application behavior. |
| L2 loading/retention | `preloadMatchArt` selects the current match's fighter prefixes; `TextureStore.retainMatchFighters` disposes banks omitted by the next match. | Partly delivered. Calls occur at match preload; returning to menus does not itself release the previous full bank to idle-only residency. |
| Runtime memory evidence | `TextureStore.diagnostics` reports width×height×4 estimates. Current preload initializes GPU textures, but no compressed format or compressed byte count can be reported by this PNG path. | Useful RGBA estimate, not proof that the KTX2 budget was achieved. |

The initial search covered project sources/tools/scripts, generated/ignored artifacts
and all-ref Git history. No KTX/Basis compression implementation or named-script
history was found at that point. The dependency's existing `KTX2Loader.js` and Basis
transcoder were excluded from claims of project implementation.

K1/K2 were separately approved in the art-budget plan and scheduled alongside
port step 6. They did not become delivered merely because the separate nine-step
port plan was reported complete. Tight PNG packing and GPU texture compression
are separate reductions, and PNG file size is not decoded texture memory.

## Concrete unfinished work

For the already approved Link scope: finish a passing quality/contact-sheet
pilot with the newly prepared pinned/cached KTX2 build and quality tools;
connect the renderer's supported-format detection, premultiplied/linear texture
contract and per-sheet V orientation; serve the required transcoder assets;
log actual selected formats/bytes; and verify both compressed-GPU and RGBA32
fallback paths against the exact production build. Reconcile final Link memory
with the approved target and report any remaining gap.

A broader DK/Pikachu or future-roster policy remains a separate user choice.
The current character skill's
[memory paragraph](/home/lombet/Workspace/platform-fighter/.agents/skills/add-character/references/animation-art.md:417)
requires bounded residency, real uploads, page transitions, cold-load checks and
memory observation while preserving accepted art. It does **not** define a
numeric combined-roster residency gate or reference this approved Link-only
exception. That policy gap should be discussed before editing the skill; it
does not authorize broader repacking or silently impose a new budget.

## Subsequent Link-only diagnostic pilot

The [pilot record](link/ktx2-pilot/README.md) now retains the builder, quality
tool, per-drawing metrics, contact sheets and explicit identity controls. This
is separately authorized follow-up work after the initial read-only audit.

The tiny idle quality-2 run completed in 2.03 seconds and **fails all 11
drawings**: atlas RGB PSNR 35.15 dB versus the required 42, alpha 36.13 dB versus
45, dark-ink error 1.69% versus 1%, and halo error 0.195% versus 0.1%. Maximum
alpha error is 90. Flat-colour error passes. BC7 also fails, with most error
already present in the UASTC RGBA8 round trip.

The prepared pixels exactly equal explicit rounded single premultiplication.
An uncompressed linear-RGBA8 KTX round trip returns all 1,422,720 bytes
identically. Clearing only the premultiplied DFD flag on a copy changes none
of the raw UASTC decoded bytes; this extractor is not multiplying again.
Actual KTX metadata validates linear transfer, unspecified primaries, top-left
orientation and one level. These controls point to codec quality loss rather
than the tested premultiply/transfer path, without claiming GPU equivalence.

The stronger quality-4 idle comparison subsequently ran after the critical
real-RAF check, took 5.71 seconds and also fails all 11 drawings: RGB PSNR
36.00 dB, alpha 36.34 dB, ink error 1.38%, halo error 0.218%, maximum RGBA
error 90. Its contacts and metrics are retained in the pilot record. No
threshold is weakened, no full-bank encoding is queued, and the runtime still
has no KTX2 consumer. Neither pilot changes the app, PNG bank or frame metadata.

## Resumed split-alpha diagnostic

After restart, one bounded Link-idle experiment encoded opaque premultiplied
RGB at UASTC quality 4 and retained alpha in an exact R8 plane. Its
[receipt](link/ktx2-pilot/split-alpha-idle/quality.json) still fails RGB42 for
**all 11 drawings**: atlas RGB PSNR is 38.648 dB through RGBA8 and 38.477 dB
through BC7. Alpha is exact; flat, ink and the alpha-halo check pass. No broader
clip encode or runtime loader followed this failure.

Measured BC7 RGB blocks plus R8 alpha total 711,360 bytes; that is payload,
not measured GPU residency. Both decoded targets retain 542 transparent texels
with nonzero premultiplied RGB (maximum 17/255), which can leak colour under
blending despite the zero alpha-halo score. Contacts and the precise limits are
retained in the [strategy audit](link/ktx2-pilot/strategy-audit.md). Production
continues to use PNG. No quality gate, roster memory policy, DK/Pikachu bank or
source drawing was changed by this diagnostic.
