# Link-only KTX2 pilot

This prepares a reviewable pilot of the separately approved art-budget K1
work, not runtime compression or native-game equivalence. **The original idle
quality-2/quality-4 pilots and the subsequently executed split-alpha pilot all
fail the approved gates and are not accepted.** PNG originals,
`frames.json`, drawing density, roots, scales and animation timings stay
unchanged. DK and Pikachu are outside this KTX2 scope.
UASTC is a lossy codec: passing the quality bounds will not mean pixel identity.
The separately approved DK/Pikachu lossless packing is a different operation.

Tools:

- [Builder](/home/lombet/Workspace/platform-fighter/port/scripts/build-ktx2.mjs):
  pinned KTX-Software 4.4.2, source/layout/recipe/tool SHA cache, explicit rounded
  premultiplication, linear RGBA8 UNORM, unspecified primaries, top-left storage,
  UASTC quality 2, Zstd 18 and one level/no mipmaps. The encoder has no alpha
  association switch, so the builder sets the basic DFD premultiplied-alpha flag
  from the installed Khronos header contract, then validates the container.
- [Quality tool](/home/lombet/Workspace/platform-fighter/tools/ktx2-quality.py):
  separate raw UASTC→RGBA8 and UASTC→BC7 block round trips, the latter decoded
  with Pillow's BC7 decoder. Every drawing is rebuilt into its original logical
  cell before measuring. Reports use the planned RGB/alpha PSNR, flat-area,
  ink and halo thresholds. Source/decoded/error×8 sheets show selected first,
  middle and last drawings at 1× and 3×, alternating light/dark backgrounds.
  Review those composited sheets; the explicitly named premultiplied PNG
  intermediates store shader texels and are not straight-alpha display files.
- [Bounded split-alpha diagnostic](/home/lombet/Workspace/platform-fighter/tools/ktx2-split-alpha-pilot.py):
  Link idle only, fresh opaque premultiplied RGB UASTC quality 4 plus a separate
  lossless R8 alpha container. It imports the unchanged quality metrics,
  reconstructs RGBA8 and BC7 RGB with source-exact alpha and takes the shared
  heavy lock itself. Seven analytical reconstruction oracles pass. Its actual
  encode fails below; no browser consumer was added.

The six small analytical quality oracles pass: rounded premultiplication,
known one-LSB PSNR, alpha-error rejection, halo threshold boundary, trim/root
reconstruction and identical-image acceptance.

The representative set is `idle`, `jab`, `j00entryr`, `d04final` and
`d04finalair`: 213 drawings and 38.5 MiB of source RGBA atlas pixels. The newly
requested denser entry/Final drawings are retained. Only the tiny idle pilot has
run. Other clips wait for a passing pilot and the bugfix QA queue to clear.

## Measured quality-2 failure

[Receipt](q2-idle/receipt.json), [per-drawing quality](q2-idle/quality.json),
[valid KTX metadata](q2-idle/ktx-info.json) and
[pixel diagnostics](q2-idle/diagnostics.json) preserve the actual result.
Encoding plus both decode/measurement/sheet runs took 2.03 seconds. The KTX file is 122.68 KiB;
source atlas RGBA is 1.357 MiB and BC7 blocks are 0.339 MiB. Those are pilot-only
sizes, not the full Link bank or measured GPU residency.

| Atlas metric | Required | UASTC→RGBA8 | UASTC→BC7 |
| --- | --- | --- | --- |
| Occupied RGB PSNR | ≥42 dB | 35.15 dB | 35.07 dB |
| Occupied alpha PSNR | ≥45 dB | 36.13 dB | 35.97 dB |
| Uniform-area pixels with >6 error | ≤0.5% | 0% | 0.0066% |
| Dark-ink pixels with >24 RGB error | ≤1% | 1.69% | 1.79% |
| Transparent pixels decoded with alpha>8 | ≤0.1% | 0.195% | 0.195% |

All 11 drawings fail. The maximum alpha error is 90: one premultiplied source
texel `[16,13,8,149]` decodes as `[16,5,16,239]`. Across the atlas, 6,357 texels
have alpha error >8 and 1,123 exceed 24. BC7 adds RGB RMSE 0.856 and alpha RMSE 0.994
relative to the RGBA8 round trip, so most error is already present before the
BC7 transcode. I inspected the [1× RGBA8 contact sheet](q2-idle/contact-rgba8-1x.png):
flat colours stay close, while the error sheet exposes outline/edge damage.
The [3× sheet](q2-idle/contact-rgba8-3x.png) and both BC7 sheets are retained.

[Identity controls](q2-idle/identity-controls.json) distinguish codec loss from
the tested preparation/transfer path:

- The prepared image equals explicit rounded single-premultiplied source bytes.
- Uncompressed linear RGBA8 KTX create→raw extract returns all 1,422,720 bytes
  identically, including alpha.
- Clearing only the DFD premultiplied flag on a copy of the encoded KTX changes
  none of its raw RGBA8 decoded bytes. The extractor does not multiply again.
- The encoded descriptor validates as linear, unspecified primaries, UASTC,
  premultiplied alpha, top-left storage and exactly one level. A hypothetical
  extra sRGB→linear conversion has RGB RMSE 48.18, versus 4.46 for the measured
  output against the intended premultiplied source.

These controls point to quality-2 codec losses rather than the tested
premultiplication/transfer route. They do not prove actual GPU sampling parity.
No threshold has been weakened.

## Quality 4 also fails

The stronger setting ran only after the critical real-RAF check released the
lock. [Quality-4 metrics](q4-idle/quality.json), [receipt](q4-idle/receipt.json)
and [validated metadata](q4-idle/ktx-info.json) retain its result. It took
5.71 seconds and produced a 125.85 KiB KTX file with the same 0.339 MiB BC7
block footprint. All 11 drawings still fail both round trips.

| Atlas metric | Required | Quality 4 RGBA8 | Quality 4 BC7 |
| --- | --- | --- | --- |
| Occupied RGB PSNR | ≥42 dB | 36.00 dB | 35.89 dB |
| Occupied alpha PSNR | ≥45 dB | 36.34 dB | 36.17 dB |
| Uniform-area pixels with >6 error | ≤0.5% | 0% | 0% |
| Dark-ink pixels with >24 RGB error | ≤1% | 1.38% | 1.52% |
| Transparent pixels decoded with alpha>8 | ≤0.1% | 0.218% | 0.218% |

RGB improves by about 0.85 dB from quality 2; alpha improves by 0.21 dB, while
the halo fraction becomes worse. The maximum RGBA error remains 90. I inspected
the [original-scale selected-drawing sheet](q4-idle/contact-rgba8-1x.png) and
[drawing 0 at 3×](q4-idle/drawing0-rgba8-3x.png). Fine equipment/outline contours
remain altered; a close-looking full-body thumbnail does not pass the numeric
gate. Metrics cover all 11 drawings; the visual sheet samples 0,2,4,6,8,10.
The full 3× and BC7 sheets are retained too.

No other representative clips or full bank are encoded after these failures.
The tested UASTC preset range does not yet meet the approved bounds. Runtime
compression remains disabled. Further delivery needs a new measured codec/alpha
strategy that preserves the existing gates, then representative contact sheets,
human review and actual GPU/fallback checks. This record does not promise that
simply encoding the larger entry/Final bank will resolve the failure.

## Split-alpha idle also fails

The separately authorized fresh opaque-RGB/independent-R8 experiment ran once
after the Edge baseline released the shared heavy lock. It took 5.06 seconds
and exited 2. [Receipt and per-drawing metrics](split-alpha-idle/quality.json),
[RGB metadata](split-alpha-idle/rgb-ktx-info.json),
[alpha metadata](split-alpha-idle/alpha-ktx-info.json) and the
[strategy audit](strategy-audit.md) retain its evidence.

| Atlas metric | Required | Split RGBA8 | Split BC7 |
| --- | --- | --- | --- |
| Occupied RGB PSNR | ≥42 dB | 38.648 dB | 38.477 dB |
| Occupied alpha PSNR | ≥45 dB | Exact alpha | Exact alpha |
| Uniform-area pixels with >6 error | ≤0.5% | 0% | 0% |
| Dark-ink pixels with >24 RGB error | ≤1% | 0.350% | 0.307% |
| Transparent pixels decoded with alpha>8 | ≤0.1% | 0% | 0% |

All 11 drawings fail RGB PSNR in both targets; the other original gates now
pass for every drawing. Alpha create→extract is byte-exact. The fresh opaque
encode improves RGB over the original quality-4 recipe by about 2.6 dB,
but does not satisfy the unchanged ≥42 dB requirement.

Actual payload is 355,680 bytes of BC7 RGB blocks plus 355,680 bytes of R8 alpha:
711,360 bytes (0.6784 MiB), twice the original single-stream block payload.
Delivery containers total 162,069 bytes. These are measured file/payload sizes,
not measured GPU residency. Shader, loader and fallback changes remain absent.

I inspected the composited light/dark [RGBA8 1× contacts](split-alpha-idle/contact-rgba8-1x.png)
and [BC7 1× contacts](split-alpha-idle/contact-bc7-1x.png). Sword, outline and
shield detail still show error. Both outputs also contain 542 source-transparent
texels with nonzero premultiplied RGB, up to 17/255. That colour can leak under
premultiplied blending despite a zero alpha-halo metric. No clamp was applied.
The [RGBA8 3×](split-alpha-idle/contact-rgba8-3x.png) and
[BC7 3×](split-alpha-idle/contact-bc7-3x.png) contacts remain available for review.

No other clips follow this failed split recipe. The
[updated recommendation](RECOMMENDATION.md) describes the remaining decision;
a different direct target encode remains untested. Runtime compression stays
disabled, with the accepted PNG path in use.

```sh
python3 tools/ktx2-quality.py self-test
flock .tmp/dk-heavy.lock node port/scripts/build-ktx2.mjs --clips idle
# Tested comparison; also fails the unchanged gates:
flock .tmp/dk-heavy.lock node port/scripts/build-ktx2.mjs --clips idle --quality 4
# Remaining representatives only after a passing quality pilot and QA clearance:
flock .tmp/dk-heavy.lock node port/scripts/build-ktx2.mjs
```

Generated outputs live under `assets/generated/ktx2/link/<clip>/<recipe-sha>/`;
`index.json` records the source/output hashes, encoder recipe and measured
status. A failed quality gate exits with status 2 and retains the failing
receipts/sheets for review. Repeating the identical recipe reuses its validated
cache; changing source/layout/encoder options or tool code uses a new directory.
The split experiment's separate artifacts live under
`assets/generated/ktx2/link-split-alpha/idle/0f29ee31fdf3931b3c67/`.

Still unfinished: a passing quality pilot, human contact-sheet acceptance, actual ASTC and hardware GPU
checks, runtime KTX2Loader/support detection, compressed-target/fallback logging,
source-versus-compressed browser parity, deployment/transcoder assets and the
full approved Link bank. This pilot does not modify the served game or claim
its memory budget is already achieved.
