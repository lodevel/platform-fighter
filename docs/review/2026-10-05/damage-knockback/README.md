# High-damage launches and flat-stage scale

Follow-up: [October 6 balance and stage calibration](../../2026-10-06/dk-balance/README.md)
widened the default floor to 1180 px and corrected the separate full-charge
Giant Punch launch record. Measurements below describe the earlier 800 px build.

Targeted follow-up to the user's report that opponents at 150-200% feel almost
impossible to KO. UFD remains the primary character source. Existing DK art and
the previously verified recovery implementation are retained.

Subsequent report: [opponents still feel hard to eject at 200%](200-percent-follow-up.md).
The public hosted game serves older combat/stage data, and old saved DK tunes
can reproduce weak launches. The user's actual URL and tune remain unconfirmed;
the original match fixtures do not establish that their report is resolved.

## Diagnosis

DK's reference damage/percent/weight calculation already increases launch speed.
Its charged damage survives charge release, collision-region selection and match
stale handling. No missing percent or charged-damage factor was found.

The flat stage was authored on a different scale from reference movement:

| Measurement | Previous flat stage | Battlefield at 5 pixels per reference unit |
| --- | ---: | ---: |
| Main platform width | 1600 px | about 800 px |
| Blast-zone width | 3320 px | 2400 px |
| Floor to KO ceiling | 1530 px | 960 px |
| Side-platform surface above floor | 222 px | 120.595 px |
| Top-platform surface above floor | 432 px | 235.945 px |

The production baseline uses the actual 1920x1080 game size, without resizing
the simulation. Against DK, an uncharged Giant Punch at 100% travels about
455 px horizontally, and at 150% about 710 px. With the victim 70 px right of
stage centre, the old floor needs 730 px of travel merely to leave its edge;
both trajectories can land safely. At the consistent 800 px platform width,
those same launches put the victim offstage and make recovery necessary.
Fully charged Giant Punch already KOs in baseline checks at 75% and 150%.
The report therefore does not establish that all strong launches are suppressed.

Two related runtime/data faults were also reproduced:

- Pass-through platforms were marked solid for a fighter outside their horizontal
  column, even when that fighter was below the platform. A fast diagonal launch
  entered the column within the same compressed physics frame and struck the
  side/underside before the next mask update, canceling its horizontal velocity.
- Grounded Spinning Kong missed its finisher against DK across 60-120 px spacing
  in both facings. Only the fixed-knockback linking hits landed, so their weak
  launch stayed the same from 0% to 200%. Target weight was incorrectly ignored;
  inner regions inherited the outer launch; and airborne autolink angle 367 was
  reduced to a static 80-degree launch. Correcting the first two source-record
  errors alone still missed the finisher in the observed scenarios.

## Correction

The default flat stage now uses the native-scale floor/platform coordinates and
blast distances above. Spawns remain over its narrower floor. Custom flat-floor
dimensions retain adequate margins; the separate original hazard/custom layouts
keep their authored geometry.

One-way masks now account for below-platform/drop-through approaches before
horizontal overlap. Approaches from above retain landing collision. This prevents
the first fast launch step from running into a temporarily solid platform side.

DK's fixed-KB records preserve actual target weight, and the inner spin regions
use their distinct sourced launch records. The generator carries the same data;
it was syntax-checked without regenerating the previously edited complete kit.
The airborne Hand Slap's first fixed-KB hit shares the corrected weight flag.

Outer spin links retain reference angle 367 through authoring, serialization,
collision delivery and match use. Airborne contact supplies the selected
capsule's world midpoint and attacker velocity. At hitlag release, after SDI,
the victim receives source velocity plus 20% of displacement toward that
sampled anchor, with downward pull capped at 5 px/step. Ordinary KB still owns
reaction duration; launch and natural gravity remain separate. New damage,
capture/reset and release discard the transient context. Grounded hits retain
the 80-degree branch. This positional pull is a project calibration, not a
recovered exact Ultimate autolink implementation.

## Sources and limits

- [UFD Donkey Kong](https://ultimateframedata.com/donkey_kong), checked
  2026-10-05: move damage, attack windows and full-charge requirements.
- The calculator's own
  [stage-data artifact](https://raw.githubusercontent.com/rubendal/SSBU-Calculator/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/Stages/ssbustagedata.json)
  supplies native Battlefield/Final Destination geometry. The captured
  [complete artifact](sources/ssbustagedata.json) has SHA-256
  `013a80b00f746e8086ae1b52b853d9df72143af50b72087a11b4c9249df70b31`;
  [selected records](sources/battlefield-and-fd.json) ease inspection.
- The project's reference movement/launch conversion is 5 pixels per native
  unit. Native Y points up; local Y points down. Geometry is translated around
  the local main platform's centre and surface.
- The captured primary
  [DK attack script digest](../../2026-09-25/donkeykong-character/sources/dk-scripts-digest.txt)
  records `SpecialHi` outer links at angle 367, inner links at angle 20 with
  KBG 100 / FKB 65, first inner contact at angle 80 / FKB 30, and
  `set_weight=False` on all fixed hits (including aerial Hand Slap).
  Its pinned upstream is
  [SpecialHi.txt](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_donkey/donkey/SpecialHi.txt).

This is a simplified Battlefield layout: the floor width is rounded to 800 px,
and its 80 px rectangular depth and the 24 px thick pass-through platforms
remain project approximations. The contact-sampled autolink anchor, 20% pull
and 5 px downward cap are authored; a later native speed cap and exact moving
anchor behavior have not been verified or implemented. Original
hazard stages and saved custom stages have their own geometry and remain
separate from this correction. The full-charge DK punch still uses the
previously recorded approximate launch record; source BKB/KBG differences
cannot explain the old floor's excessive safety.

High percent is vulnerability, not an automatic KO condition. Move strength,
weight, position, influence and recovery affect the outcome. Do not make every
jab or linking hit lethal at 100%, or replace sourced move values to compensate
for a geometry mismatch. Runtime thresholds here are project acceptance checks,
not exact Ultimate kill percentages or human playtest evidence.

## Verification

`npm run build` passes, including TypeScript and Vite; output is in
[build.txt](build.txt). Final match checks load `index-B4ia6NWm.js` from the
production preview at `http://127.0.0.1:4175/platform-fighter/`, with SHA-256
`4ffde095b044c0d6f57b60a02df2bd8f4d7feb6698bfac364d9f97d938a890f2` and engine
`platform-fighter-sha256-d26a8298dfe3491ee246032886d8b7816eb1a7d851faa0a2b4faa6d5a0fa51c5`.
Both canonical reports independently record that bundle and engine identity.

- [Strong-move report](browser-after/dk-knockback-acceptance.json): **48 scenarios,
  176/176 assertions**. DK and Link targets; 0/100/150/200%; both facings;
  uncharged/full Giant Punch and uncharged forward smash. Every attack contacts.
  At 0%, these moves do not directly KO during hitstun. At 100/150%, the
  uncharged punch puts targets beyond the main floor. Full punch and forward
  smash at 150/200% cross a blast zone while the victim is still in hitstun.
- [Spin report](browser-after/spin/dk-knockback-acceptance.json): **32 scenarios,
  80/80 assertions**. DK and Link; 150/200%; both facings; 60/80/100/120 px
  spacing. Every scenario reaches the finisher at elapsed action frame 61
  (UFD frame 62), and its launch is stronger at 200%. All 32 recorded scenarios
  lose a stock. At 80 px against DK, finisher launch magnitude rises from
  28.0748 px/step at 150% to 32.4756 at 200%.
- **Zero page errors, console errors or failed requests** in both final reports.
  These use actual attack sensors, the match damage handler, shared Matter
  stepping and stock-loss handling. Only initial placement/percent and input
  sampling are controlled; no direct hit injection or game-size resizing.

Representative DK-target outcomes from centre stage, neutral defender input:

| Move / starting damage | Previous production | Corrected production |
| --- | --- | --- |
| Uncharged punch / 100% | 455.52 px horizontal flight; lands safely | Offstage when control returns; recovery required |
| Full punch / 150% | Already KOs | Direct side KO; stock loss recorded 34 outer simulation steps after contact |
| Forward smash / 150% | Already KOs | Direct top KO; stock loss recorded 42 outer simulation steps after contact |
| Grounded spin / 150% | DK receives only linking hits; no finisher or KO | Finisher contacts and launches to a side KO |

The older [40-scenario baseline](browser-before/dk-knockback-acceptance.json)
records `index-1uuMguBt.js` / SHA-256
`051da41e653cd84dd53b2d1afb7ec60b6ffceaa0c7af5332fb4301f83c93a398`.
DEV/source-override and temporary-production folders are diagnostic history,
not the final acceptance record. The DEV report also contains aborted startup
requests from slow module loading; the canonical production reports do not.

The [stage-start screenshot](browser-after/battlefield-scale-match-start.png),
[100% offstage screenshot](browser-after/donkeykong-giant-punch-uncharged-100-offstage.png),
[150% airborne launch](browser-after/donkeykong-giant-punch-full-150-launch.png)
and [actual stock loss](browser-after/donkeykong-giant-punch-full-150-ko.png)
were visually inspected. The camera follows the launch, the defender is beyond
the main platform with control restored at 100%, and the strong 150% hit produces
a respawn at 0% with four stocks. Existing art defects remain outside this fix.

Focused coverage includes 17 launch/KO physics checks, 17 autolink checks,
75 stage-definition checks and 8 actual-scene pass-through physics checks;
all pass. The earlier [focused run](tests.txt) passed 258 checks across 11 files.
The [broad run](broad-tests.txt) passed 5504 of 5509 checks across 162 files.
Two failures were stale angle-367 rejection/editor expectations; their fixtures
were corrected and those files pass on rerun (**59 serializer + 7 aerial
serializer checks**). The remaining three are the already recorded Link
landing/run-speed expectation and two jab-chain frame assertions; see the
[September 25 baseline](../../2026-09-25/donkeykong-character/README.md).
The broad suite is therefore not claimed fully green.

Reproduce final runtime acceptance with a running production preview:

```bash
PF_REWORK_URL=http://127.0.0.1:4175/platform-fighter/ \
PF_PROBE_OUT=docs/review/2026-10-05/damage-knockback/browser-after \
PF_MOVES=giant-punch-uncharged,giant-punch-full,forward-smash \
PF_PERCENTS=0,100,150,200 PF_FACINGS=1,-1 \
PF_EXPECT_CORRECTED_SCALE=1 PF_SCREENSHOTS=1 \
node tools/dk-knockback-acceptance.mjs

PF_REWORK_URL=http://127.0.0.1:4175/platform-fighter/ \
PF_PROBE_OUT=docs/review/2026-10-05/damage-knockback/browser-after/spin \
PF_MOVES=grounded-spinning-kong PF_PERCENTS=150,200 PF_FACINGS=1,-1 \
PF_SPIN_SPACINGS=60,80,100,120 PF_EXPECT_SPIN_FINISHER=1 \
node tools/dk-knockback-acceptance.mjs
```
