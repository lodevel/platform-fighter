# Link: deferred frame-generation handoff

Status: **generation deferred at the user's request**, September 23, 2026.
No generator or credentials are required now. No new images were generated or
installed. Continue authorized mechanics and verification independently;
resume generation when the user supplies or selects a generator. The previous
built-in attempt returned no image. Do not repeat it while generation is deferred.

## What is ready

[normal-frames.json](normal-frames.json) specifies **16 normal attacks and 116
proposed pose keys**: active intervals, full pose holds, individual drawing
instructions, charge/follow-up conditions and source-animation links. **Up tilt
is the first pilot, with nine drawings** and a distinct pose for every active
tick. This is a generator handoff, not configuration loaded by the game.

Timing was compared with [UFD Link](https://ultimateframedata.com/link) and the
current [Link definitions](../../../src/characters/Link.ts). The web reader
could not display UFD's GIFs in this pass. These pose descriptions are authored
2D proposals: the supervising agent must view each linked motion and confirm
sweep order, body orientation and weapon hand before submitting that batch.
No native skeletal reconstruction is claimed.

For existing mechanics evidence, see the
[UFD stats record](../../review/2026-09-23/ufd-stats/README.md) and
[animation/collision audit](../../review/2026-09-23/frame-inspection/README.md).

## Identity and canvas

Inspect the local [idle](../../../assets/characters/link/animations/idle.png),
[tilt](../../../assets/characters/link/animations/tilt.png) and
[up-air](../../../assets/characters/link/animations/uair.png) sheets for
**identity and style**, not correct attack motion. Preserve the green tunic,
dark green cape, blond hair, pointed ears, boots, silver sword with blue/gold
hilt and blue shield. The old generation JSON's no-shield prompt conflicts
with today's visible character; use the inspected current appearance.
UFD supplies motion reference without changing the costume to its blue outfit.

Proposed output: **individual 512 x 512 RGBA PNGs**, with the simulation-root
reference at **(256,256)**, standing body height **144 pixels** excluding
equipment, and neutral standing feet at **(256,328)**. Uniform 0.5 rendering
would preserve a 72-world-pixel body and provide room for current attack reach.
This is provisional until pilot inspection, not installed renderer metadata.

The root is a coordinate origin, not a fixed hip or foot. Allow intentional
pose displacement and moving airborne feet. Keep equipment lengths fixed.
Author a right-facing fighter; rear strikes extend left relative to that
orientation. Keep the whole sword arc inside the canvas. Never crop or scale
each pose independently. If the generator requires another resolution, scale
the entire canvas/anchor contract uniformly and record the conversion.

## Reusable prompt

> Create one production sprite pose of the same right-facing Link in the local
> identity references. Preserve his green tunic, dark green cape, blond hair,
> pointed ears, boots, silver sword with blue/gold hilt, blue shield, body
> proportions and rendering style. Use the UFD reference to establish motion
> and anatomy. Follow the selected pose instruction and shared canvas/root
> registration. Show the complete figure and weapon on actual transparent
> alpha. Keep equipment proportions and handedness consistent with the
> reviewed reference pack. No text, frame numbers, extra characters, floor,
> shadow, collision overlay, projectile or unrelated effect.

Append the selected pose instruction from the JSON, preceding/following pose
context and verified motion references. Frame numbers are integration metadata,
not lettering to draw. If the viewed motion contradicts a proposed pose,
correct the prompt before generation without changing sourced active intervals.

## First batch: up tilt

All ranges are one-based and inclusive. Drawings are held for these intervals;
they are not nine equally timed movie frames.

| File | Game frames | Pose requirement |
| --- | --- | --- |
| link-utilt-01.png | 1-4 | Grounded preparation, softened knees and guarded off arm |
| link-utilt-02.png | 5-7 | Shoulder/weapon anticipation for the upward sweep |
| link-utilt-03.png | 8 | First active reference pose |
| link-utilt-04.png | 9 | Next active arc position |
| link-utilt-05.png | 10 | Middle active overhead silhouette |
| link-utilt-06.png | 11 | Next active arc position |
| link-utilt-07.png | 12 | Last active sweep position |
| link-utilt-08.png | 13-24 | Retract from the sweep; no contact |
| link-utilt-09.png | 25-35 | Return to grounded guard |

The JSON expands each instruction. Review the source motion before specifying
front-to-back or back-to-front ordering; timing alone does not establish it.
A 2/5/2 startup/contact/recovery drawing allocation produces these holds with
the current phase selector once the new route/allocation is wired.

## Supervised production

1. Prepare the identity references and view the up-tilt motion. Generate one
   contact pose to check scale, registration and identity.
2. After the agent's inspection passes, produce the nine-pose pilot. Inspect
   every image together and at gameplay scale; request specific corrections.
3. Address nair/bair kicks and the upright uair thrust. Current inspected
   sheets show sword swings or an almost horizontal overhead blade instead.
4. Produce the distinct smashes/follow-up, dash attack, two forward-air slashes
   and remaining normal keys. Review one batch before expanding the next.
5. Follow [remaining-states.md](remaining-states.md) for locomotion, defense,
   specials, grabs and separate objects, resolving its named timing gaps first.

The agent supervises reference selection, prompt assembly, submissions once
generation is available, review, targeted revisions, packing and integration.
No repeated request for an API key or provider is needed during this deferral.
Use the future generator's actual capabilities; no endpoint, seed support or
native resolution is assumed.

Return individual named PNGs, optional review contact sheets, exact prompts,
reference roles, settings/seed where supported, ordered filenames and measured
dimensions/anchors. Labels belong outside exported cells. Keep accepted images;
do not regenerate a whole accepted pack to correct one pose. Choose runtime
packing only after inspection and respect the actual texture-size limit.

## Integration and acceptance

- Confirm real alpha, exact pose count, intact equipment, consistent scale,
  identity and origin. Inspect all poses, including at gameplay size.
- Preserve the 72px world body. Add shared per-clip canvas/root metrics in
  MatchScene and Character Lab: applying the existing 75px display height to
  the new padded canvases would shrink the body.
- Add distinct routes where missing. The current selector reuses the same art
  sections for separated strikes; a longer strip alone cannot select distinct
  fair/bair/up-smash/down-smash strikes. Add explicit pose-key selection.
- Reconcile fighter-facing art with current back-air attack axes and rear-strike
  sprite flips. Avoid mirroring an already authored rear motion twice.
- Keep hitlag/pause on the simulation clock, preserve contacts and hit groups,
  and let landing/rebound/charge/follow-up events select their real branches.
- Check Lab direct entry and real production-match contact, both facings,
  startup/contacts/gaps/recovery and saved tunes. Record the actual build,
  measurements and inspected screenshots.
- Do not alter mechanics to fit generated drawings or infer exact bone
  transforms from pixels. Animated geometry/hurtboxes remain separate work.

## Baseline and readiness

The current 28 strips contain 92 poses, all in 256 x 256 cells. PNG headers,
manifest and frames.json agree. Magenta RGB under zero alpha is transparent,
not an opaque-background defect. Up tilt/dash share tilt; all smashes share
smash; jabs/down tilt and all five aerials have separate routes. None of the
normal moves' declared art-phase totals matches its delivered strip, so the
runtime uses fallback partitions.

Proposed holds are art decisions within sourced action timing. Except for the
demonstrated up-tilt allocation, check or extend pose selection before using
them. This handoff completes the requested preparation; images, reference-motion
review, asset acceptance and runtime integration remain explicitly deferred.

## Preparation validation

September 23 checks passed: all 16 action durations, active intervals and charge
hold points match current Link definitions; the 116 unique pose keys cover their
uninterrupted timelines without gaps, overlaps or crossing contact boundaries.
Every explicit hit-window group matches the runtime name. All 16 local links
in the handoff and canonical skill resolve. An independent review checked
scope, the up-tilt hold calculation, asset baseline and deferred integration.
These checks establish consistency of the instructions; they do not establish
native pose fidelity or replace future asset and running-game acceptance.