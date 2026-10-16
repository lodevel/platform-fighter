# Link KTX2 strategy audit after both failed idle pilots

Investigation, 2026-10-15. Initial diagnosis used read-only inputs and in-memory
arrays. The separately authorized bounded
[split-alpha script](../../../../../../tools/ktx2-split-alpha-pilot.py) is now
prepared; its seven analytical oracles pass. One authorized idle encode then
ran under the shared heavy lock and **failed all 11 drawings on RGB PSNR**.
No production asset, threshold or runtime change was made.
DK and Pikachu remain outside the compression scope. The existing
[pilot record](README.md), [recommendation](RECOMMENDATION.md) and overriding
[art-budget decisions](../../../../2026-10-14/art-budget/PLAN.md) remain binding.

The tested bounded experiment was **fresh maximum-quality opaque RGB UASTC,
plus source-exact R8 alpha**, with the same premultiplied RGB values and atlas
layout. Removing lossy alpha improved occupied RGB by about 2.6 dB, while
remaining roughly 3.5 dB short of acceptance. There is now evidence against
this specific split design as well as the original RGBA design. No broader
encode or loader implementation follows these failures. Existing evidence
cannot establish that any single 8 bpp block encoding will satisfy the gates.

## What the per-drawing failures establish

The [quality-4 report](q4-idle/quality.json) has these ranges across all 11
drawings, not merely the atlas average:

| Metric | RGBA8 round trip | BC7 round trip | Required |
| --- | --- | --- | --- |
| Occupied RGB PSNR | 35.68–36.41 dB | 35.61–36.29 dB | ≥42 dB |
| Occupied alpha PSNR | 35.83–36.76 dB | 35.71–36.58 dB | ≥45 dB |
| Ink pixels with RGB error >24 | 0.648–1.830% | 0.972–2.073% | ≤1% |
| Transparent pixels with alpha >8 | 0.122–0.273% | 0.122–0.273% | ≤0.1% |

All 11 drawings fail RGB, alpha and halo. Nine fail ink; drawings 3 and 10
pass ink in both targets. Flat-area error passes throughout. This is not a
single bad drawing that can be excluded while preserving the requested bank.
The 42/45 dB gates correspond to occupied-channel RMSE limits of approximately
2.026/1.434 byte values. The failed result needs materially smaller errors.

The existing identity controls rule out the tested double-premultiplication,
DFD-flag and transfer-conversion hypotheses. They do not verify GPU behavior.
The [drawing-0 comparison](q4-idle/drawing0-rgba8-3x.png) was inspected again:
damage appears on the sword/outline, equipment detail and colour boundaries;
the flat tunic areas mostly remain stable. This visual observation agrees with
the numeric edge/ink failures, without replacing the gates.

## Additional diagnostics without re-encoding

I loaded the quality-4 cached decoded RGBA8/BC7 PNGs and `layout.json` named
by the receipt, then used the existing quality
tool's `metrics` and `cell` functions on in-memory arrays. Source preparation
was independently repeated from the installed PNG with `premultiply`.
These are hypothetical reconstruction diagnostics, not accepted codec outputs.

| In-memory reconstruction | Atlas RGB PSNR | Atlas ink failure | Drawings passing all gates |
| --- | --- | --- | --- |
| RGBA8 RGB + exact source alpha | 35.998 dB | 1.378% | 0/11 |
| Above, RGB clamped to source alpha | 36.002 dB | 1.378% | 0/11 |
| BC7 RGB + exact source alpha | 35.892 dB | 1.521% | 0/11 |
| Above, RGB clamped to source alpha | 35.896 dB | 1.521% | 0/11 |

Replacing alpha makes stored alpha exact and the measured halo fraction zero.
It leaves the RGB and ink failures. Clamping each RGB channel to alpha is
insufficient too. Therefore retaining the existing compressed RGB while merely
adding a source-alpha texture cannot deliver K1.

Of 12,224 source-occupied 4×4 atlas blocks, 6,005 contain varying source alpha.
They account for 62.98% of occupied RGB squared error in RGBA8 and 62.82% in
BC7. Blocks with uniform alpha still contribute the remainder. Fully opaque
source texels have RGB RMSE 3.890/3.941 respectively, above the 2.026 limit.
These values came from squared RGB errors masked by source alpha >0, aggregated
over aligned 4×4 blocks. They support investigating channel allocation, while
also showing why exact alpha alone cannot guarantee success.

## Encoder and format limits

Installed `ktx create --help` from KTX-Software 4.4.2 confirms:

- UASTC quality is 0–4. Both pilot receipts preserve the actual arguments;
  quality 4 is already the maximum exposed search setting.
- `--uastc-rdo` enables an additional post-process; it is absent in both
  recipes. Turning it off again cannot repair these outputs.
- Zstd is outer supercompression. Changing its level changes delivery storage,
  not the reconstructed block texels or GPU block footprint.
- Direct ASTC creation has an `exhaustive` preset. The CLI does not expose a
  direct BC7 encoder: `--encode` accepts `basis-lz` or `uastc`; direct ASTC is
  selected through an ASTC `--format`.

The codec's [primary specification](https://github.com/BinomialLLC/basis_universal/wiki/UASTC-Texture-Specification/b624c07ad3c659e7b0f0badcb36e9a6b8820a99d)
describes UASTC as a 128-bit 4×4 subset with quantized endpoints, interpolation
weights, limited partitions, opaque modes and alpha modes. A block that crosses
several flat colours, thin ink and independently varying coverage must fit all
of those values into this restricted representation. More encoder search can
choose better blocks; it cannot represent arbitrary RGBA byte combinations
exactly. This is an explanation for a plausible failure mechanism, not a proof
that every other 4×4 encoder will fail this particular source.

The same specification states that UASTC→ASTC preserves the already encoded
texels. Selecting ASTC as a transcode target cannot recover the lost pixels.
A **fresh direct ASTC encode from the PNG** searches a larger format space and
is a legitimate separate diagnostic, with target-specific support and fallback
work. It is not the same operation as transcoding these failed files. The
[official encoding reference](https://github.khronos.org/KTX-Software/ktxtools/ktx_create.html)
supports the distinction; the installed help establishes the pinned version's
actual option surface.

## Concrete split-alpha pilot contract

The bounded pilot used the following contract before any renderer work:

1. Prepare the existing rounded premultiplied RGB bytes, set encoded alpha to
   constant 255 (or use RGB input), and retain original alpha bytes separately.
   Preserve atlas dimensions, trims, logical cell reconstruction and roots.
   Do not encode straight RGB and silently change the filtering contract.
2. Encode **only idle**, UASTC quality 4, RDO off, one level, linear transfer,
   unchanged orientation and no resampling. Cache the distinct split recipe,
   including source-alpha hash, preparation/measurement code and all settings.
3. Decode the new RGB through both RGBA8 and BC7, ignore its synthetic alpha,
   recombine RGB with the exact source alpha and run unchanged atlas **and
   every-drawing** RGB42/alpha45/flat/ink/halo checks. Produce source/decoded
   contacts at 1× and 3×. Do not confuse the opaque RGB file's synthetic alpha
   with the actual reconstructed sprite's alpha.
4. Require source-exact alpha bytes after the proposed lossless storage path.
   An alpha image that is itself UASTC, BC4 or another lossy block encoding is
   not a lossless-alpha solution. An uncompressed single-channel R8 texture
   can be supercompressed in storage while retaining one byte per texel at
   upload; actual loader and GPU support still need verification.

The current `ktx2-quality.py` assumes one RGBA stream. A future split pilot
therefore needs an explicit recombination input path and focused oracle cases
for alpha substitution, RGB-only failure, RGB/alpha orientation mismatch and
zero-alpha colour leakage. These checks must use the same existing thresholds.

The existing halo gate considers alpha only; exact alpha automatically passes
it even if RGB corruption creates bright energy in source-transparent texels.
Keep that gate intact, but inspect composited light/dark contacts and filtered
GPU edges too. Do not describe a zero halo metric as proof of all visual edge
parity.

If accepted pixels eventually exist, renderer integration must sample
premultiplied colour and alpha with the same UVs, orientation, dimensions,
filtering and level selection, then pass `vec4(premultipliedRGB, alpha)` to the
existing tint/recolour/blending path. Multiplying sampled premultiplied RGB by
alpha again darkens edges. Encoding straight RGB and multiplying **after**
linear filtering also changes the source contract: in general
`filter(colour) * filter(alpha) != filter(colour * alpha)`.

## Memory and decisions

| Representation, no mips | Nominal GPU texel payload | Idle atlas estimate |
| --- | --- | --- |
| Original RGBA8 | 4 bytes/texel | 1.3568 MiB |
| One UASTC→BC7/ASTC 4×4 stream | 1 byte/texel | 0.3392 MiB |
| RGB 4×4 blocks + exact R8 alpha | 2 bytes/texel | 0.6784 MiB |

Idle is 156×2280, divisible by four. These estimates exclude driver allocation,
padding on other dimensions, CPU buffers, decoder state and duplicate retained
textures. They are not measured GPU residency. A nominally single-channel
alpha PNG uploaded as RGBA8 would instead cost four bytes/texel for alpha
alone; the real R8 upload is essential to the estimate. RGBA32 fallback for
the opaque colour plus a separate R8 alpha plane would total five bytes/texel;
prefer the existing single-source PNG fallback or a proved merged RGBA8 path.

The coordinator authorized the narrowly scoped RGB-only/alpha reconstruction
script and its single idle execution after the Edge baseline released the lock. Accepting
its doubled compressed payload, choosing a target-specific ASTC path, or
changing the delivery budget/renderer contract needs an explicit recorded
decision before presenting that altered design as delivered. No quality gate,
drawing density or source scale needs to change for the proposed experiment.

After a passing idle result, the already selected jab, denser entry, grounded
Final and aerial Final representatives still require numeric and contact
acceptance. Actual GPU targets, RGBA fallback, runtime support detection,
linear/premultiplied parity, byte diagnostics and deployment/transcoder assets
remain separate required work. A second failed strategy should return to the
quality/storage decision with its measurements; it should not trigger a
full-bank encode or an unsupported claim that the budget is achieved.

## Executed split-alpha result: failed

[Full receipt and per-drawing metrics](split-alpha-idle/quality.json),
[RGB metadata](split-alpha-idle/rgb-ktx-info.json) and
[R8 metadata](split-alpha-idle/alpha-ktx-info.json) retain the actual run.
It took 5.06 seconds, exited 2 and released the heavy-job lock before the next
Edge profiling slot. The source/layout were checked again at completion.
Generated encoded/decoded artifacts remain in
`assets/generated/ktx2/link-split-alpha/idle/0f29ee31fdf3931b3c67/`.

| Atlas result | Reconstructed RGBA8 | Reconstructed BC7 | Required |
| --- | --- | --- | --- |
| Occupied RGB PSNR | 38.648 dB | 38.477 dB | ≥42 dB |
| Alpha | Exact bytes | Exact bytes | ≥45 dB |
| Flat-area error >6 | 0% | 0% | ≤0.5% |
| Ink error >24 | 0.350% | 0.307% | ≤1% |
| Alpha-halo fraction | 0% | 0% | ≤0.1% |

Every drawing passes alpha, flat, ink and the existing alpha-halo check.
Every drawing still fails RGB: individual PSNR is 38.434–38.890 dB in RGBA8,
38.244–38.686 dB in BC7. Maximum reconstructed RGB error is 66.
The alpha R8 create→extract path returns all 355,680 source-alpha bytes exactly.
Both containers validate as linear, unspecified primaries, top-left orientation
and one level. RGB metadata identifies UASTC RGB; alpha identifies R8_UNORM,
with independent straight-association metadata, not a premultiplied alpha flag.

Actual RGB BC7 payload is 355,680 bytes and actual extracted R8 payload is
355,680 bytes: **711,360 bytes (0.6784 MiB) combined**. Delivery containers total
162,069 bytes (125,375 RGB + 36,694 alpha). These are measured payload/file
sizes, not measured GPU allocation; no shader, loader or fallback was implemented.

I inspected the composited [RGBA8 1× contacts](split-alpha-idle/contact-rgba8-1x.png)
and [BC7 1× contacts](split-alpha-idle/contact-bc7-1x.png), which alternate light
and dark backgrounds. Broad flat colours stay stable and alpha contours improve;
the error panels still show the sword, hair/face outlines, shield decorations
and internal colour boundaries. Full [RGBA8 3×](split-alpha-idle/contact-rgba8-3x.png)
and [BC7 3×](split-alpha-idle/contact-bc7-3x.png) contacts are retained for review.
No contact-sheet or browser acceptance is claimed.

Both reconstructions also contain **542 source-transparent texels with nonzero
RGB, up to 17/255**, despite exact alpha and a zero alpha-halo score. Under
premultiplied blending that RGB can add colour to the background. No clamp was
applied to conceal it. This independently reinforces the requirement for
composited and filtered GPU checks even if a later candidate passes PSNR.

Do not repeat this split recipe on jab, entry, Finals or the full bank. Keep
the existing PNG runtime path. A fresh direct ASTC or other independently
chosen encode remains an untested target-specific experiment, with no evidence
yet that it can meet these gates. A different storage/rendering representation
or a changed budget is a concrete design decision, not a missing higher UASTC
quality preset. The original quality thresholds remain unchanged.
