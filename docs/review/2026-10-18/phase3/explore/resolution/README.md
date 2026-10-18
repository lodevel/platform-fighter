# Option: store drawings at the resolution they are shown

2026-10-18. Phase 3 exploration. No game code changed. Scripts are in [scripts/](scripts/);
numbers in [memory.json](memory.json), [memory-combined.json](memory-combined.json),
[residency.json](residency.json), [quality.json](quality.json).

## 1. What the game does today

- Camera zoom is clamped 0.4 to 1.4 (`MATCH_CAMERA_OPTIONS`, `src/camera/cameraFraming.ts`). I found no zoom above 1.4
  in code; the "Final up to 2.8" figure is a headroom assumption, not a camera setting.
- Renderer: `setPixelRatio(min(devicePixelRatio, 2))`, so buffer width = CSS width x min(DPR, 2). Zoom 1.0 is one buffer
  pixel per design pixel on a 1920 buffer.
- Textures: `LinearFilter`, **no mipmaps** (`uploadAsSprite`). Minification is plain bilinear.
- **Zoom classes do not exist in code.** Nothing downscales. The 2026-10-16 probe rejected the idea.
- **Residency: everything.** `preloadLegacyMatchArt` loads every sheet of every fighter in the match (about 425 sheets,
  313 MiB BC7, 1,248 MiB RGBA8 for DK+Link+Pikachu) before the match starts. Only the first 64 MiB are warmed to the GPU;
  the rest upload on first draw. Only the menu idle cards are evicted.

Stored density (texels per design px, 1 / `scale`) and screen density at zoom 1.4:

| Class | Stored | 1080p (1920 buf) | 1440p (2560) | 4K or 1080p at DPR 2 (3840) |
| --- | ---: | ---: | ---: | ---: |
| Screen px per design px at zoom 1.4 | | 1.40 | 1.87 | 2.80 |
| Normal moves, all fighters | 2.14 | 1.53x too big | 1.15x | 0.77x (already upscaled) |
| DK Final | 2.93 | 2.1x | 1.57x | 1.05x |
| Pikachu Final | 4.29 | 3.1x | 2.3x | 1.53x |
| Link Final | 2.14 | 1.53x | 1.15x | 0.77x |

Zoom 1.0 to 0.4 raises the oversize further (2.1x to 5.3x for normal moves) with no mipmaps. The typical match sits at
1.0 to 1.4 on small stages (zoom = fit of the fighters plus 280 px padding, clamped).

## 2. Memory (BC7, drawings downscaled with premultiplied Lanczos, then repacked by the real `repack` and counted by `packageMemory`)

Target density T per class; a drawing is never enlarged. "Final" = actions with `final` in the name (not the victim poses).

| Candidate | Normal / Final density | DK | Link | Pikachu |
| --- | --- | ---: | ---: | ---: |
| today (repacked) | 2.14 / 2.14-4.29 | 158.1 | 70.9 | 63.9 |
| A: 1080p, Finals same | 1.40 / 1.40 | 56.1 (x0.35) | 31.0 (x0.44) | 15.6 (x0.24) |
| B: 1080p, Finals kept for 2x headroom | 1.40 / 2.80 | 97.2 (x0.61) | 34.4 (x0.49) | 27.8 (x0.44) |
| C: 1440p, Finals 2.8 | 1.87 / 2.80 | 129.2 (x0.82) | 55.8 (x0.79) | 36.2 (x0.57) |
| D: 1440p, Finals same | 1.87 / 1.87 | 98.9 (x0.63) | 54.4 (x0.77) | 27.2 (x0.43) |
| B + holds 0.12 | | 82.5 | 30.9 | 18.8 |
| A + holds 0.12 | | 51.7 | 29.2 | 12.9 |
| C + holds 0.12 | | 113.8 | 51.9 | 26.9 |

MiB, all pages, validator reports 0 problems on every candidate. Savings track (T x scale)^2: a clean quadratic.
Whole roster (3 fighters): today 293 MiB, A 103, B 159, C 221.

## 3. Quality

Reference drawings: DK jab (largest drawing), Link spin attack (`d02specialairhi`), Pikachu `final2`. Each is drawn the way
the game draws it (premultiplied bilinear, no mipmaps, six sub-pixel offsets) and compared with the true area average of the
original over each screen pixel. Share of covered pixels off by more than 32/255 ([quality.json](quality.json)):

| Drawing, display | today | A | B | C |
| --- | ---: | ---: | ---: | ---: |
| DK jab, 1080p z1.4 | 0.59% | 0.09% | 0.09% | 0.10% |
| DK jab, 1080p z1.0 | 2.6% | 0.03% | 0.03% | 0.7% |
| DK jab, 1080p z0.7 | 8.4% | 1.1% | 1.1% | 4.7% |
| DK jab, 1440p z1.4 | 0.06% | 0.59% | 0.59% | 0.03% |
| DK jab, 4K z1.4 | 0.00% | 1.5% | 1.5% | 0.21% |
| Link spin, 1080p z1.4 | 1.3% | 0.9% | 0.9% | 5.6% |
| Link spin, 1080p z1.0 | 6.1% | 0.4% | 0.4% | 7.4% |
| Link spin, 1440p z1.4 | 0.19% | 2.5% | 2.5% | 5.7% |
| Link spin, 4K z1.4 | 0.00% | 4.8% | 4.8% | 6.9% |
| Pikachu Final, 1080p z1.4 | 8.7% | 6.8% | 2.8% | 2.8% |
| Pikachu Final, 1080p z1.0 | 12.7% | 3.7% | 6.6% | 6.6% |
| Pikachu Final, 1440p z1.4 | 5.4% | 9.7% | 1.2% | 1.2% |

Reading it:
- **At the display the storage targets, a downscaled drawing is as good as today's, or better.** Today's 1.53x bilinear
  minification skips texels and shimmers (visible jagged stair in Pikachu's Final: [crop](pikachu-final2-crop5x.png)).
  Pre-filtering with Lanczos fixes that. DK and Link at 1080p z1.4: [match size](donkeykong-jab-match-size.png),
  [crop](link-d02specialairhi-crop5x.png), [diff](donkeykong-jab-diff.png).
- **Zoomed out (z1.0 and below) the downscaled art is clearly better**, because today has no mipmaps. This is an existing
  quality problem the option fixes for free. Pikachu Final at z0.7: 16% today, 5% in A.
- **The cost is on bigger displays.** A (1080p storage) shown on 1440p or 4K is upscaled 1.33x or 2x and goes soft
  ([DK on 1440p](donkeykong-jab-on-1440p.png)); today's art is already soft on 4K but only by 1.3x. A is therefore a
  quality ceiling at 1080p, a visible downgrade for 1440p and 4K players. C stays near today's look at 1440p.
- Non-integer ratios (C at 1080p, 1.33x) alias more than 1.0x or 2x; Link's thin outlines show it (5.6%). Integer or
  near-1 ratios behave best.
- The measure counts Lanczos sharpness as error against a box-filtered reference, so small percentages are not "defects".
  Judge with the crops. No viewer has yet looked at these in motion.

## 4. Residency (separate option)

Pages are one per action, so action groups are exact (BC7 of today's art, [residency.json](residency.json)):

| Group | DK | Link | Pikachu |
| --- | ---: | ---: | ---: |
| Final actions | 60.5 | 6.0 | 38.2 |
| Held item | 21.4 | 11.7 | 6.2 |
| Victim, cargo, captured | 11.1 | 6.4 | 0.9 |
| Everything else | 65.0 | 46.8 | 18.6 |
| Total | 158.1 | 70.9 | 63.9 |

Loading Finals on demand cuts the resident set by 38% (DK), 8% (Link), 60% (Pikachu); also deferring held-item and victim
groups gives 59%, 34%, 71%. Only the owner of a Final needs it: in a 3-fighter match the other fighters' Finals could stay
cold. This is the same memory a smaller store would save for Finals, so the two overlap: after B, DK's Finals fall from
60.5 to 55 MiB, so streaming still matters for DK; for Pikachu A already cuts the Finals from 38 to 4 MiB.

Latency risk (from the 2026-10-16 probe, one sheet, cold worker): DK Final sheet 147 to 283 ms transcode plus fetch and
GPU upload. A Final Smash starts seconds after the Smash Ball is picked, so prefetching at pickup would hide it; no
measurement of a miss during play exists. Earlier decision (2026-10-16): residency was rejected as the memory answer
because it moves when pixels are resident, not how many there are. It remains a peak-memory tool, not a stored-size tool.

## Verdict

| | |
| --- | --- |
| Memory factor | x0.35 to x0.44 for DK and Link, x0.24 for Pikachu (A); x0.6 to x0.8 if 1440p must stay crisp (C) |
| Quality cost | none at 1080p z1.4, better zoomed out; soft on 1440p and 4K unless storage follows the display |
| Effort | small: an offline Lanczos pass plus a per-display bank choice (the package format already has a `scale` per drawing). No new renderer |
| Risk | one fixed storage density caps sharpness; larger displays need a second, bigger bank or fall back to today's art |

It is a constant factor, not an order of magnitude, and only recovers density the game does not use. Best use: pick the
density from the real display buffer at load (1080p, 1440p, 4K banks, or one bank plus mipmaps), with Finals at the display
density rather than 2x. Adding mipmaps to today's art would also fix zoom-out aliasing, at +33% memory.

Combination: it multiplies with the others, because it shrinks pixels per drawing while holds drop drawings (measured:
B + holds 0.12 = 82.5 / 30.9 / 18.8 MiB vs 97.2 / 34.4 / 27.8). It scales rect sizes inside tiles and parts, so
tile and rig options get the same x(T x scale)^2 on their pixels. Rigs that draw parts as vectors or at runtime need no
stored resolution at all and would make this option moot for the parts they replace.
