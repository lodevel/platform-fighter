# UFD motion extraction and retargeting

Read this when using an Ultimate Frame Data animation as a character-motion
reference. The GIF supplies visual evidence. Its image count, playback speed
and hitbox overlays are not a ready-made sprite, skeleton or gameplay timeline.
Use [source coverage](source-coverage.md) for mechanics and
[animation and art](animation-art.md) for appearance, generation and packing.

## Acquire the actual reference

Open the fighter's UFD page, inspect the intended move and follow its actual
animation link. Check variant, facing, grounded/airborne state and any source
notes. Do not construct a guessed URL from the move name. Record the page URL,
asset URL, retrieval date and the move's displayed timing separately.

When reference acquisition is in scope, download the inspected asset to an
evidence directory. This PowerShell example uses the Link up-tilt link inspected
on 2026-09-24; inspect the current page/link before reusing it:

```powershell
$sourceDirectory = Join-Path $PWD 'docs/review/2026-09-24/link-character/sources'
New-Item -ItemType Directory -Path $sourceDirectory -Force | Out-Null
$sourceUrl = 'https://ultimateframedata.com/hitboxes/link/LinkUTilt.gif'
$sourceFile = Join-Path $sourceDirectory 'LinkUTilt.gif'
if (Test-Path -LiteralPath $sourceFile) { throw 'Reference already exists; inspect it or choose a new filename.' }
Invoke-WebRequest -Uri $sourceUrl -OutFile $sourceFile
```

The same acquisition from a bash / WSL shell (spaces in a UFD path must be
percent-encoded in the URL and replaced in the local filename):

```bash
sourceDirectory=docs/review/2026-09-24/link-character/sources
mkdir -p "$sourceDirectory"
sourceUrl='https://ultimateframedata.com/hitboxes/link/LinkUTilt.gif'
sourceFile="$sourceDirectory/LinkUTilt.gif"
[ -e "$sourceFile" ] && { echo 'Reference already exists; inspect it or choose a new filename.' >&2; exit 1; }
curl -L --retry 3 -sS -o "$sourceFile" "$sourceUrl"
head -c 4 "$sourceFile" | grep -q GIF8 || echo 'not a GIF (probably an HTML error page)' >&2
```

Keep the source GIF. An HTML error page saved with a `.gif` suffix is not a
reference. The extractor below checks the format and records a SHA-256 hash.
Acquiring a reference does not start a generation job or authorize installation
of models, nodes or another service.

## Extract source images without inventing time

The bundled [extract_motion.py](../scripts/extract_motion.py) uses Python and
Pillow. Use the available Python environment with Pillow; the script neither
installs dependencies nor accesses the network. `--input` is a local GIF and
`--source-url` is recorded provenance, not a URL the script will fetch.

```powershell
# The output parent must exist; the output directory itself must be new.
$extractionDirectory = Join-Path $sourceDirectory 'utilt-extracted'
python .agents/skills/add-character/scripts/extract_motion.py `
  --input $sourceFile `
  --source-url $sourceUrl `
  --output $extractionDirectory `
  --character link `
  --move utilt
```

```bash
python3 .agents/skills/add-character/scripts/extract_motion.py \
  --input "$sourceFile" --source-url "$sourceUrl" \
  --output "$sourceDirectory/utilt-extracted" --character link --move utilt
```

A 43-animation bulk run (Donkey Kong, 2026-09-25) totalled ~108 MB of GIFs
and PNGs; keep those under the git-ignored `assets/gen/<fighter>-ufd/` and
record URL, SHA-256, image counts and delays in a tracked JSON under the
evidence directory instead of committing the images.

If `python` is not on PATH, use the discovered interpreter path with PowerShell's
`&` call operator. Do not assume a machine-specific path from an old runbook.

Outputs:

- `source-00000.png`, `source-00001.png`, etc.: lossless RGBA snapshots of each
  decoded GIF image after compositing and disposal. Their original logical
  canvas dimensions are retained; no crop, scale, pose correction or label
  removal is applied. Partial GIF image rectangles are composited into the
  full canvas rather than mistaken for complete source frames.
- `contact-sheet-001.png`, etc.: labeled review thumbnails, at most 16 images
  per page and 1024 by 896 pixels per page. These previews are resized; the
  individual PNGs are not. Their labels identify **source indices**, not game
  frames.
- `manifest.json`: source URL/path/SHA-256, GIF dimensions/version/loop and image
  count, extraction timestamp in UTC, Pillow version, each source index, stored
  delay, disposal method,
  source rectangle, PNG hash and output dimensions. Missing delay/disposal
  metadata remains `null`; an explicit zero remains zero.

Every extracted frame starts with `displayed_frame_label`,
`gameplay_frame_mapping` and `target_pose_key` set to `null`. The extractor
does not infer them from GIF order or delay. It refuses an existing output
directory or file before writing. On extraction failure it removes only the
new directory it created. Unsupported GIF plain-text graphics or reserved
disposal methods fail explicitly rather than producing an inaccurate reference.

The extractor's offline tests use synthetic GIF patches with transparency,
background disposal and restore-previous disposal:

```powershell
python -B -m unittest discover `
  -s .agents/skills/add-character/scripts `
  -p test_extract_motion.py -v
```

When a GIF carries no displayed frame counter (all 43 Donkey Kong assets
inspected on 2026-09-25 had none), the mapping can still be verified when
**both** of the following hold: the image count equals the UFD total frames,
and the image indices showing attack overlays, plus one, equal the UFD active
frames. Record each check per asset; a GIF whose count differs (Hand Slap's
21 images for a 46-frame move, because hitlag freeze frames are not sampled)
stays unverified even when its hit count matches. Later or secondary hits may
render in magenta rather than red; treat the colour per asset, not globally.

## Identify the overlays before tracing or preparing guides

Inspect the full-size source PNGs, not only contact-sheet thumbnails. Read the
current [UFD Smash image legend](https://ultimateframedata.com/smash) and establish
which visualization mode the particular asset uses. Standard attack colors and
hitbox-ID colors have different meanings; blue can describe a wind attack or
an intangible hurtbox depending on the displayed layer. Do not classify regions
by a universal color threshold. The legend does not explicitly define normal
white hurtboxes; record the basis for interpreting a pale body overlay.

1. Separate rendered anatomy/equipment, body-following hurtbox volumes, attack
   regions, and effects/debug graphics. Compare startup, active frames, harmless
   gaps and recovery, alongside the timing table and vulnerability notes. A pale
   body overlay can be the hurtbox display, not an attack or costume material.
   State whether each identification is documented, visually inferred or unresolved.
2. Record the source asset/index, visualization mode or unknown, applicable
   legend, layer/role, interpretation evidence, and obscured/uncertain boundaries
   in the action's overlay record. Unknown layer meaning stays unresolved; do not
   assign damage or vulnerability to it. Missing/hidden overlays do not by
   themselves prove an absent region or intangibility.
3. Use the observed pose-to-volume alignment as evidence for contact and
   vulnerability. Follow the same root, pose and body/equipment anchors. Alignment
   does not mean a pixel-exact silhouette: projected rounded volumes can extend
   beyond a limb or blade, and visible equipment/effects may have no corresponding
   vulnerable or attacking region. Preserve observed offsets, overhangs and gaps;
   do not alter the recorded source geometry merely to make outlines match.
   These are source observations. A custom target uses separately authored
   body-fit geometry through the retargeting procedure below.
4. Keep the original overlay image for collision review. Make separate appearance
   and pose guides that exclude debug volumes, labels and angle lines. A flattened
   GIF cannot reliably reveal the artwork behind every translucent overlap;
   inferred cleanup/landmarks remain inferred and require inspection. Do not
   feed raw overlay edges into a pose/weapon guide as if they were anatomy.

In the Link up-tilt sample inspected on 2026-09-24, pale rounded body volumes
persist across startup/recovery poses, while red regions appear around the
sword swing and extend beyond the visible blade. This supports separating the
body overlay from attack regions in that asset; it does not establish a universal
white-color rule, native 3D dimensions, or a gameplay-frame mapping by itself.
See [geometry authoring](animation-art.md#4-author-gameplay-geometry-independently-of-raster-pixels)
for converting inspected evidence into separately stored collision data.

## Establish the motion-to-gameplay mapping

Review contact sheets, then open individual source PNGs around every relevant
pose/contact boundary. Read any displayed source-frame labels and compare the
move's timing table, visible motion and hitbox appearance/disappearance. Keep
the following concepts separate:

| Quantity | Meaning |
| --- | --- |
| Source index | Zero-based image number inside the downloaded GIF |
| GIF delay | How long the GIF requests that image be displayed |
| Displayed frame label | Number actually shown by the source visualization, if present/readable |
| Gameplay frame | Established move frame after reconciling labels, motion rate and timing evidence |
| Runtime elapsed step | The engine's zero-based simulation position; a verified game frame 8 is elapsed step 7 |
| Target pose key | An authored drawing which can be held across one or several simulation steps |

Do not divide a GIF delay by 16.667 ms or equate image index plus one with a
game frame. A GIF may be slowed, omit images, hold duplicate drawings or
represent source motion counters that differ from game time. Verify that
displayed numbers mean gameplay frames before relying on them. If no reliable
mapping can be established, retain the source image as qualitative motion
evidence and leave the gameplay mapping unresolved.

Maintain a separate reviewed mapping record alongside the untouched extraction
manifest. Include each selected source index/PNG, observed label, game-frame
interval or event, runtime elapsed interval, target pose key, and the reason
the mapping is supported. This initial record deliberately claims no mapping:

```json
{
  "source_index": 0,
  "source_png": "source-00000.png",
  "displayed_frame_label": null,
  "gameplay_frame_mapping": null,
  "target_pose_key": null,
  "status": "unreviewed",
  "evidence": null
}
```

Once inspected, a mapping can record a verified one-based game-frame interval
and the corresponding zero-based half-open runtime interval. For example,
**if** a reviewed image is independently established to depict game frame 8,
record `[8,8]` and elapsed `[7,8)` with the actual source index and observed
label. This is an interval-conversion example, not a claim that any particular
GIF image depicts frame 8. A pose held longer than the selected reference image
needs its own authored hold interval; do not change gameplay timing to fit art.

Check startup, every active boundary, harmless gaps, recovery and first
actionable frame. Account for conditional follow-ups, charge holds, motion-rate
changes, landing interrupts and grounded/airborne variants. Automatic repeated
strikes need distinct motion coverage even if the current renderer reuses art.

### Observed samples, not permanent rules

Inspection on **2026-09-24** found the following downloaded files:

| Reference | GIF images / logical canvas | Stored delays | UFD page's total gameplay frames |
| --- | --- | --- | --- |
| [LinkUTilt.gif](https://ultimateframedata.com/hitboxes/link/LinkUTilt.gif) | 35 / 845x702 | 35 images at 130 ms; 4550 ms total | 35 |
| [LinkFAir.gif](https://ultimateframedata.com/hitboxes/link/LinkFAir.gif) | 50 / 705x549 | 49 at 130 ms, one at 250 ms; 6620 ms total | 51 |

The matching up-tilt count does not prove index-to-game-frame identity. Fair's
50 images versus 51 gameplay frames demonstrates why the quantities must stay
separate. These observations concern those retrieved samples; regenerate the
manifest and recheck the current page when sources change. No individual
source-image/game-frame mapping was established by these counts alone.

## Retarget the motion, preserve the chosen character

For a custom UFD fighter, aim for the user's "copied homework" relationship:
recognizably the donor's full kit performed by the new character. For each action
record its distinguishing cues from inspected source motion: windup, body turn,
contact part, swing/kick direction and arc, strike count/order, rhythm, follow-up
and recovery, as applicable. Carry these cues into target pose instructions.
Adapt joint placement to target proportions while retaining those cues. A generic
swing with matching timing/data is insufficient when the source motion differs.
Compare source and target at corresponding verified move frames, and inspect
target playback at gameplay speed; slowed GIF delays are not its timing target.
Record which cues match, what differs and what is still unverified. Recognizability
is a reviewed visual/behavioral judgment, not proof of identical geometry or balance.

Use separate reference roles:

1. **Motion reference:** the selected UFD poses, with their camera and timing
   evidence. Preserve the move's characteristic direction, contact limb or
   weapon, anticipation, sweep and recovery.
2. **Identity/style reference:** the user's chosen appearance and inspected
   project art. Do not import the source character's costume or rendered style
   merely because its movement is useful. Use the selected final reference,
   including any deliberate [form adaptation](animation-art.md#optionally-adapt-the-reference-form),
   to establish target body proportions, pose landmarks and equipment dimensions.
   Retarget source motion to those proportions and fit animated hurtboxes to the target body. Record
   geometry/reach changes as adaptations; custom proportions are allowed without
   changing pipelines or asking again for authorization.
3. **Target registration:** the agreed body size, camera/facing, simulation-root
   origin, equipment dimensions and target canvas. Preserve the source PNGs at
   their original dimensions; create separate target pose/control assets.

Record how source body/contact landmarks map to the target's anatomy and segment
lengths. Different proportions need a part/joint mapping, not just uniform scaling
of the source outline. Keep the chosen target proportions, pixels-to-world scale
and root contract consistent across poses; do not independently resize every
silhouette. Grounded support points should stay registered where the motion
requires planted contact; airborne feet and articulated limbs may move. Do not
mistake screen-space GIF camera motion for fighter world displacement. Apply
[body retargeting](animation-art.md#retarget-collision-to-the-target-body) to derive
separate target hurtboxes and contact geometry from these posed landmarks.

If using pose controls, inspect their actual support for the selected model.
A body skeleton alone does not specify blade tip, guard, shield angle, cape,
grip, occlusion or every nonhuman body. Add weapon/grip landmarks or compatible
edge/depth/reference controls where needed. The agent prepares and reviews
these controls; the user is not required to draw skeletons or repair frames.
Record inferred/hand-calibrated landmarks as such rather than calling them
native source transforms.

Hitbox/hurtbox overlays, frame numbers, ground guides and source UI remain
reference evidence. Exclude them from final art and from appearance-conditioning
images where they could be reproduced. Keep a separate visual record of the
original overlays to compare contact and vulnerability. Do not turn their
pixel colors into authoritative collision geometry or silently erase missing
bone-transform evidence.

Art and collision remain separately authored data using the same simulation
timeline, root coordinates and facing contract. Validate their alignment in
Character Lab and the running game. Where the source only supports an
approximation, name it. A successful GIF extraction is motion-reference
preparation, not generated sprites or verified character fidelity.
