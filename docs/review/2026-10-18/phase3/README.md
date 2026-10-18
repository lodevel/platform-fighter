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

## Next

Candidate representations on the reference set, starting with the cheapest to
try: fewer stored drawings per action with deliberate holds, then reusable parts.
