# Phase 3: comparing cheaper representations

Started 2026-10-18 after the Phase 2 commit (`23ab31d`). Follows the
[character system roadmap](../../../CHARACTER-SYSTEM-ROADMAP.md): candidates are
tried in the [character lab](../character-lab/README.md) on the
[Phase 1 reference set](../phase1-reference-set/README.md), judged against today's
art and the Ultimate original (the 20/20), with their memory measured.

Starting measurement, from Phase 2: no drawing is shared between actions, and
sharing identical or near-identical drawings would save only 5.7% (DK), 9.0%
(Link) and 10.4% (Pikachu). The savings have to come from parts, computed poses
and fewer stored drawings.

## Step 1: costumes in the package and the lab

Every candidate must still recolour correctly, so costumes came first.

**Format.** `character-package/1` gains optional `costumes`
(`character/package/types.ts`):
- colour regions of the art: slot, colour as drawn, HSV tolerance, at most four;
- the costume list: a name and a colour per slot.

Costume 0 is the art as drawn; costume N moves each region by its slot's colour
relative to costume 0, keeping the art's shading. The validator checks colours,
tolerances, the region limit, and that every costume names exactly the slots the
regions use.

**One implementation.** `character/render/recolor.ts` holds what was inside the
game's sprite layer and `port/src/fighters/palette.ts`:
- the colour-shift maths (`costumeShifts`);
- the GLSL that applies the shifts;
- the uniform packing.

The game's sprite layer and the lab both use it. The game keeps its palette
tables and art keys and turns them into package costumes
(`characterCostumes`), which the exporter also writes into each package.

**The game is unchanged.** For all 24 costumes (3 fighters × 8), the new
`costumeRecolor` returns exactly the same shifts as the old one, compared value
by value against the previous commit's code. In Edge, the game's costume page
(production build) still draws all 24 ([screenshot](game-costumes-after.png)).
The only console error is the browser asking for a favicon the page doesn't
declare, which predates this change.

**Lab.** A costume picker appears for packages with costumes. The selected
drawing is recoloured on the GPU by the same GLSL, at the drawing's own
resolution, and then scaled. The game instead recolours after scaling, so edge
pixels can differ slightly between the lab and a match; fills and shading follow
the same shifts.

The lab probe (`tools/character-lab-probe.mjs`) added three costume views and
counts the stage pixels that changed against the same pose as drawn:

| View | Costume | Character pixels | Recoloured |
| --- | --- | ---: | ---: |
| DK jab | 2 Cobalt | 16,516 | 8,882 |
| Link jab, light stage | 2 Goron | 8,238 | 1,710 |
| Pikachu jab, facing left | 1 Scarlet | 5,988 | 3,826 |

Screenshots: [DK](../character-lab/dk-jab-costume-2.png),
[Link](../character-lab/link-jab-costume-2.png),
[Pikachu](../character-lab/pikachu-jab-costume-1.png). DK's red tie and tan face,
and Link's hair, leather and skin, keep their drawn colours, as in the game.
All 12 lab views reported no package problems and no console errors.

**Checks.** Typecheck and layer check, the full suite (582 files, 12,214 tests),
the game build, the lab build, and the re-export of all three packages (zero
differences over 1.52 million ticks; new revisions DK `81042ab0de3c`, Link
`9b29320a7862`, Pikachu `3371fbae1ad1`).

## Step 2: fewer stored drawings, held longer

**Where the memory is.** Final Smashes dominate. They change drawing almost every
tick (Pikachu's every tick), while other moves already hold each drawing about
5 ticks:

| Package | Pixels in Final actions | Median ticks per drawing | Windows lasting 1 tick |
| --- | ---: | ---: | ---: |
| donkeykong | 39% (6 actions) | 5 | 21% |
| link | 8% | 6 | 15% |
| pikachu | 61% (6 actions) | 2 | 50% |

Consecutive drawings differ a lot. The measure below is the mean absolute
premultiplied-RGBA difference over the cells either drawing covers, both placed
at the same root on a 4 design-px grid (`signatureDiff`), on a scale of 0 to 1.
Its median between consecutive drawings is about 0.2 for ordinary moves. Finals
are lower: DK 0.20, Link 0.09, Pikachu 0.06.

**Candidate.** `npm run character:holds -- <id> --max-diff 0.04,0.08,0.12,0.2`
(`character/candidates/`) works one action at a time:
1. It repeatedly drops the drawing that differs least from the kept drawing that
   would replace it, while that difference stays within the limit. The first
   drawing is always kept, and each difference is measured against what is
   actually shown after earlier drops. A drop is refused when the kept drawing
   would then be shown longer than 8 ticks (`--max-hold`) or than the action's
   longest window, whichever is longer.
2. The kept drawing is held over the freed ticks, and its sockets are held with it
   (`retimeAction`).
3. Unused drawings leave the package.

The kept drawings go onto freshly packed pages. Every result is a normal
validated package that the lab lists under `<id>~holds-<limit>`.

The fair baseline is `<id>~repack`: the same drawings on pages packed the same
way. My first shelf packer lost to today's pages (DK 739 vs 678 MiB). Searching
over page widths fixed that: DK 632, Link 284 (today 281), Pikachu 256 (today 279).

**First run, without the hold cap: idles froze.** Breathing changes each drawing
so little that the mean difference stays tiny: Link's idle fell from 11 drawings
to 1 even at 0.04, DK's from 0.08. The user watched the candidates on a phone page
that plays today's art beside each limit, approved the look of 0.12 for the
Finals, and found the idle freeze annoying. Much of the first run's saving on
ordinary moves (18–20% of their pixels at 0.12) came from freezing slow motion
like this. The hold cap above fixes it: idles, waits and other slow loops now keep
every drawing.

**Results with the cap**, as BC7 memory of the whole package against its repacked
baseline ([reports](holds-reports/)):

| Limit | DK | Link | Pikachu |
| --- | --- | --- | --- |
| baseline | 158.1 MiB | 70.9 MiB | 63.9 MiB |
| 0.04 | 150.6 (−5%) | 69.7 (−2%) | 55.5 (−13%) |
| 0.08 | 145.2 (−8%) | 68.4 (−4%) | 47.3 (−26%) |
| **0.12 (chosen)** | 140.9 (−11%) | 66.8 (−6%) | 43.0 (−33%) |
| 0.2 | 134.1 (−15%) | 63.1 (−11%) | 36.7 (−43%) |

Share of drawn pixels removed, by kind of action:

| Limit | DK Finals / others | Link Finals / others | Pikachu Finals / others |
| --- | --- | --- | --- |
| 0.04 | 12% / 0% | 16% / 0% | 22% / 1% |
| 0.08 | 20% / 1% | 31% / 1% | 44% / 2% |
| 0.12 | 26% / 2% | 52% / 2% | 53% / 4% |
| 0.2 | 35% / 3% | 69% / 6% | 67% / 9% |

At 0.12, Pikachu's `final2` keeps 50 of 95 drawings, Link's Final 34 of 72, DK's
Final start 31 of 57 and its punches 66 of 74 (each punch is a different pose).
The idles of all three keep every drawing.

**What this means.** Holding drawings longer is a Final Smash technique. Finals
change drawing almost every tick, and at 0.12 lose a quarter (DK) to a half (Link,
Pikachu) of their pixels. Other moves already hold each drawing about 5 ticks and
barely change. Whole packages save 11% (DK), 6% (Link) and 33% (Pikachu). This
stacks with BC7 and with the techniques below, but it is far from the order of
magnitude a larger roster needs.

**Lab.** A "Compare with" selector adds a third pane showing any served package
(such as a candidate) on the same tick, costume, facing and zoom. The window strip
shows both packages' drawing windows, and the memory panel lists both. The probe
captured each Final at limit 0.12 beside today's art:
[DK](dk-final-holds-0.12.png), [Link](link-final-holds-0.12.png),
[Pikachu](pikachu-final2-holds-0.12.png). These still images show placement only;
the motion has to be watched live.

**Side finding: the stored rectangles are mostly empty.** Only 55% (DK), 38%
(Link) and 48% (Pikachu) of the pixels inside drawing rectangles have any alpha.
Storing drawings as their non-empty tiles instead of whole rectangles would
remove a large part of the remaining memory at no visual cost. It is the next
candidate to try, and it combines with holds.

**Checks** (after the hold cap): typecheck, the full suite (584 files, 12,219
tests), the game build, the lab build, and the lab probe in Edge (15 views, three
of them comparisons).
Shared code was moved rather than copied:
- the window compression the exporter used is now `character/package/schedule.ts`;
- the memory estimate is now `character/package/memory.ts`.

The three console errors in the probe report are reconnect attempts after the
probe stops the dev server.

## Step 3 measurement: non-empty tiles are a small lever

Cutting each drawing into square tiles and storing only tiles with any pixel, each
with a 1 px border so filtering cannot show seams, stores this share of today's
rectangle area (2 px padding included):

| Tile size | DK | Link | Pikachu | Same, identical tiles stored once |
| --- | ---: | ---: | ---: | --- |
| 8 px | 95% | 76% | 87% | 67% / 65% / 46% |
| 16 px | 85% | 74% | 81% | 72% / 68% / 64% |
| 32 px | 88% | 85% | 90% | 80% / 80% / 82% |

The empty space is mostly a thin band around the outline, so tiles recover little
of it. A 16 px tile saves 15–26% and costs about 70–200 quads per drawing plus a
format and renderer change. Not built; held until the options below are compared.

## Step 4: six options compared

Agents explored the options in parallel, each with its own record under
[explore/](explore/). The user followed them on a phone page.

| Option | Memory vs today | Look | Record | Decision |
| --- | --- | --- | --- | --- |
| Store drawings at the size shown (1080p, Finals kept sharp) | DK 97, Link 34, Pikachu 28 MiB | Same on 1080p, softer on 1440p/4K | [resolution](explore/resolution/README.md) | **Pursue** |
| Palette: 16 or 32 colours per character | ½ (16) or ≈ 0.63 (32, 5-bit packed) | Near lossless | [vector](explore/vector/README.md), §indexed | **Pursue, 32 colours favoured by the user** |
| Reuse squares of similar drawings, or warp them | −10 to −25% | Small errors; warps blur and smear | [delta](explore/delta/README.md) | Rejected: not worth the complexity |
| Shapes (vector) instead of images | More memory (Link 4.8×) | Worse in 99% of drawings | [vector](explore/vector/README.md) | Rejected |
| Load Finals only when used | Lower average, same worst case | — | [resolution](explore/resolution/README.md) | Rejected: four Finals at once need the total |
| Body parts on a skeleton | Parts 0.2 MiB per view | Moves, but less natural | [skeleton](explore/skeleton/README.md), [parts generation](explore/parts-generation/README.md), [rig](explore/rig/README.md) | Parked on branch `explore/skeleton-rig` |

The skeleton option went furthest: the local generator produced a consistent 19-part
DK set (closed outlines, joint caps, no hand edits), and the package format, the
evaluator and the lab gained a rig with swappable parts that plays DK's jab (fitted to
Ultimate) and idle. The user found the motion less natural than today's drawings. The
code lives on the branch `explore/skeleton-rig`, not on this one.

## Next

Store drawings at the size they are shown, reduced to the character's palette, on
top of the held drawings: a candidate for all three fighters in 16 and 32 colours,
judged by eye against today's art.
