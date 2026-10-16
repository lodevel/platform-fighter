# Donkey Kong — complete attack-value correction

Pipeline: UFD-based, Super Smash Bros. Ultimate Donkey Kong, existing appearance.
Scope: correct the complete attack numeric inventory and preserve it through
saved fighters and live matches. Existing art was accepted by the user and is
retained. This record supersedes the numeric and variant gaps in the September
25 character record and the earlier October 6 Giant Punch balance record.
Source patch label: unknown; UFD does not identify a patch on the captured page.

## Sources and exhaustive comparison

The [UFD page](https://ultimateframedata.com/donkey_kong) was captured on October
6 in [sources/ufd-page.html](sources/ufd-page.html), with parsed rows in
[sources/ufd-moves.json](sources/ufd-moves.json) and its hash in
[sources/ufd-source.json](sources/ufd-source.json).
[Pinned native scripts](https://github.com/WuBoytH/SSBU-Dumped-Scripts/tree/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_donkey/donkey)
provide the missing per-region launch and interaction values. All 42 captured
motions have individual URLs and SHA-256 hashes in
[sources/verified.json](sources/verified.json). Recovery actionability comes from
the [pinned motion list](https://github.com/WuBoytH/SSBU-Dumped-Motion-Lists/blob/3f14a9d46b69eb9e7cd622bddde459192848580e/fighter/donkey/motion/body/c00/motion_list.yml),
copied to [sources/motion-list.yml](sources/motion-list.yml).

The independent raw-script parser in `tools/dk-attack-data-audit.ts` compares
**138 records across 42 motions**: 125 attack regions, seven released normal/cargo
throws, and six standing/dash/pivot grab regions. It checks damage, angle,
BKB/KBG/FKB, set-weight, hitlag/SDI, shield damage, radius, situation/category
masks and launch direction, with grab capsule endpoints and throw release/total
timing checked separately. **29 timing comparisons** cover the available UFD
startup/total/recovery/landing fields and four native recovery cancel frames.
The resumed audit passes with **zero mismatches**, including a complete saved
move-data round trip. [comparison.json](comparison.json) contains every compared
source/runtime row; [before.json](before.json) preserves the original inventory.

Source priorities and clock conversions remain explicit:

- Grounded Spinning Kong linking damage follows UFD's 1.3%; the pinned script's
  1.4% remains visible as `rawScript.damage` in the comparison.
- Forward tilt uses UFD total 34, despite native motion cancel frame 36.
- Partial punch total 62 includes seven charge-entry frames and release total
  55; full release total is 47. UFD's full-charge startup string also describes
  frame 19–20 after starting the release.
- Getup/trip/ledge totals 45/49/55 follow native cancel frames 46/50/56.
- Inclusive one-based active frames become zero-based half-open intervals:
  source 7–8 becomes `[6,8)`. Script motion clocks are kept separate from game
  clocks, particularly aerial Spinning Kong.
- Root-bone geometry uses 5 pixels per native unit, y up converted to screen y
  down, with feet 42 pixels below body centre. Non-root bone positions retain
  authored anchors and are explicitly approximate projections.

## Delivered changes

`donkeykongAttackData.ts` retains the pinned native rows;
`donkeykongSourceMoves.ts` resolves them onto canonical moves and every active
window. Runtime, schemas, serializer and factory now carry the affected fields.
The legacy full-kit generator refuses to overwrite the audited DK kit;
`tools/gen-donkeykong-attack-data.py` verifies captured hashes before regenerating
the native attack table.

| Inventory | Result |
| --- | --- |
| Jab 1/2; forward/up/down tilt; dash attack; forward/up/down smash | All distinct region numbers, early/late windows, priorities and masks retained; up/down angled forward tilts select their 9% variants; down tilt retains its separate five-frame hitstun bonus. |
| Neutral/forward/back/up/down aerial | Per-region and early/late numbers retained, including landing/autocancel data. |
| Giant Punch ground/air, partial/full | Seven-frame charge entry, four-frame shield cancel, 111-frame full charge; integer partial damage 10–27 ground / 6–23 air; full 28 ground / 25 air, distinct launch/armour records, 27-frame full recovery and grounded 18-damage waist region. |
| Headbutt ground/air and ground/air targets | Distinct native regions and launch records; 25 shield-damage bonus reaches the damage handler without adding percent damage. |
| Spinning Kong ground/air | Opening masks, all linking regions and 3.5-damage rear regions preserved; aerial per-hit region data and grounded finisher retained. |
| Hand Slap ground/air | Both grounded slap windows, their ground-only mask, and separate aerial clap records retained. |
| Standing/dash/pivot grab; pummel | Native 7/10/11-frame startup and ground/air capsules; pummel connects on frame 2 with 1.6 damage and 15-frame hitstop. |
| Normal back/up/down throws; forward cargo entry; cargo forward/back/up/down throws | Independent damage/launch/release/recovery records; normal forward throw enters carry without damage, then attack/grab plus direction releases a cargo throw. |
| Face-up/down getup attacks; trip attack; ledge attack | Independent sourced windows, numbers and action totals; separate live routes. |

Standing/dash/pivot grab selection uses the existing run-speed discriminator;
pivot reverses facing at entry. Normal attack selection remains contextual:
ground direction/flick, airborne direction relative to facing, held special
charge and shield banking, and recovery-state attack input. A caller's initial
fixture placement does not bypass actual Matter contact or recipient masks.

## Production acceptance

The production build completed before the reboot; resumed TypeScript checking
passes. Its gameplay source identity was recomputed after resuming and found in
the exact served bundle, so browser results use the current gameplay sources.
The interrupted public copy was repaired by copying the **200 manifest runtime
assets**, including palette variants, without copying generation intermediates.

- URL: `http://127.0.0.1:4176/platform-fighter/`.
- Bundle: `index-CQB-RR2I.js`.
- Bundle SHA-256: `3e67d9f13278b56170ca0ce9c19eb2f2c4e880c3cb1b0838481ec7586fb6788a`.
- Gameplay identity: `platform-fighter-sha256-1e83a4885053d0a42e5ba79a802242b44cb596577a6fe123152b3fa10ba4a164`.

[Live attack matrix](browser/report.json): **94 scenarios, 227/227 checks pass**, both facings, all
listed attack routes, seven throw releases, pummel, shield bonus, and six grab
ground/air variants. Every route contacts through actual sensors and physics;
throw percent is compared with source damage. Each grab fixture verifies its
target is actually grounded or airborne at the moment of capture, rather than
inferring that state from the spawn height. Zero page errors, console errors or
failed requests were recorded. The harness uses fixture input
sampling and initial placement; it does not establish physical bindings.

The initial diagnostic matrix is preserved in
[diagnostic-before-fixture-fixes.json](browser/diagnostic-before-fixture-fixes.json).
Vertical attacks needed targets above/below their contact regions; overlapping
air fixtures were separating, and elevated fixtures could land on the upper
platform before contact. Running grab fixtures initially ran into the victim
and lost speed. Those fixture positions were corrected without changing source
values or gameplay. Lab pointer presses needed spacing across render frames
after roster pagination. A subsequent grab-state run was terminated before
writing its report and was restarted; it is not counted as successful evidence.

[Launch report](launch/dk-knockback-acceptance.json): **56/56 scenarios contact,
234/234 assertions pass**, 14 grounded moves, DK recipient, 0%/150%, both facings,
real damage delivery, launches and stock-loss handling. Full punch uses
BKB35/KBG73 and causes two direct high-percent KOs. Neutral defender trajectories
are observations, not native KO thresholds or proof that recovery is impossible.
The flat floor is 1180 pixels with 2780-pixel blast width, an intentional project
calibration documented in the [balance record](../dk-balance/README.md).

[Character Lab report](lab/registry-lab-observations.json): actual pointer
pagination/selection, SAVE TUNE and TEST FIGHT preserve **22 live attacks plus
the grab slot**, all nested variants and tuning. Escape/L returns to the same
draft. After a full page reload, selecting the saved tune and testing it rebuilds
the complete canonical kit. The browser's localStorage is isolated from the
user's saved tunes.

[DK keyboard report](keyboard/donkeykong/report.json) and
[Cat keyboard report](keyboard/cat/report.json): real F/G browser events start
jab, reach 111-frame full charge after entry, and release a contacting punch
with BKB35/KBG73. Three checks pass for each recipient with no page errors.
These establish ordinary keyboard routing, not human controller feel.

**479/479 tests pass in 18 affected/shared files**: 289 in
[dk-tests-resumed.log](dk-tests-resumed.log), plus 190 in
[dk-shared-tests-resumed.log](dk-shared-tests-resumed.log). These include actual
Matter contact, saved fighter construction, all source-record comparisons,
charge boundaries, normal/cargo throw releases, recovery and shared collisions.
TypeScript exit 0 is recorded by the resumed command; its
[log](dk-type-resumed.log) is empty on success. The earlier broad run had two
pre-existing Link jab buffer assertions, documented in the September record;
they are outside these changes. The entire repository suite was not rerun.

The [match image](browser/match.png) and
[saved Lab image](lab/dk-live-kit-saved.png) were visually inspected: the existing
DK art renders in the match and the complete saved tune is selected in Lab.
These images do not prove native collision fidelity or improve the accepted art.

## Remaining limits

The subsequent [targeted collision correction](../dk-collision/README.md)
supersedes generic non-root fallback positioning, fixes mirrored hurtbox
contacts and supports hurtboxes beyond the movement collider. It records its
own production bundle and contact/Lab regression evidence. The limits below
still apply to native parity and complete pose-following anatomy.

Numeric agreement is confined to the recorded fields and source priorities.
Exact Ultimate physics and collision parity remain incomplete:

- Angle 366 is preserved, with an explicit 80-degree fallback rather than
  wrapping to 6 degrees. Native 366 transport is unimplemented; 367 transport
  remains a contextual calibration.
- Native bury, per-bone intangibility, no-clang behavior, animated 3D bone
  transforms and full posed hurtboxes are absent. Non-root region positions,
  Headbutt travel and much shared movement remain authored projections/calibration.
- UFD does not publish aerial Spinning Kong total. The 63-frame commitment,
  sustained rise, gravity boundary and steering retain the documented project
  calibration. Correct region numbers do not prove exact recovery motion.
- Hold-to-charge control, cargo hold duration/attachment/movement and certain
  shared defense/interaction rules retain existing project adaptations. Hand
  Slap's native shield-setoff multiplier remains a separate engine gap.
- Existing art defects and shared fallback recovery sheets remain accepted
  limitations in [OPEN-ISSUES.md](../../2026-09-25/donkeykong-character/OPEN-ISSUES.md).
- Existing saved tunes retain their authored snapshots; BASE corrections do
  not silently overwrite them. No commit, push or deployed-site update is
  established by this local acceptance.

Reproduce with the production preview running on port 4176:

```bash
npx tsc --noEmit
npx tsx tools/dk-attack-data-audit.ts
node tools/dk-all-moves-acceptance.mjs
node tools/dk-lab-acceptance.mjs
PF_PROBE_OUT=docs/review/2026-10-06/dk-all-attack-values/keyboard/donkeykong node tools/dk-balance-input-acceptance.mjs donkeykong
PF_PROBE_OUT=docs/review/2026-10-06/dk-all-attack-values/keyboard/cat node tools/dk-balance-input-acceptance.mjs cat
PF_REWORK_URL=http://127.0.0.1:4176/platform-fighter/ PF_PROBE_OUT=docs/review/2026-10-06/dk-all-attack-values/launch PF_ALL_GROUNDED=1 PF_TARGETS=donkeykong PF_PERCENTS=0,150 PF_FACINGS=1,-1 PF_EXPECT_CORRECTED_SCALE=1 PF_EXPECT_FLOOR_WIDTH=1180 node tools/dk-knockback-acceptance.mjs
```
