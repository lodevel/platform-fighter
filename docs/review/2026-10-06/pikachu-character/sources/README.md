# Pikachu source record

Checked 2026-10-06. Source identity is Pikachu in Super Smash Bros. Ultimate;
appearance is Pikachu with no intrinsically held equipment. This record supplies
research for a full fighter. Acquisition and extraction do not establish runtime,
collision, visual acceptance, or complete source parity.

## Captures and provenance

| Capture | Provenance and coverage |
| --- | --- |
| `ufd-pikachu.html`, `ufd-moves.json` | [Pikachu UFD](https://ultimateframedata.com/pikachu), current page downloaded on the check date. All 35 move/state containers, displayed timings, damage, notes, variants and asset links preserved. No game patch label is stated. Unknown `--` and `**` fields remain strings. |
| `ufd-stats.html` | [UFD stats](https://ultimateframedata.com/stats), downloaded on the check date. Includes jump heights/durations, movement, landing and defense tables. |
| `ufd-smash.html` | [UFD legend](https://ultimateframedata.com/smash), downloaded on the check date. Standard attack colors differ from hitbox-ID coloring; asset interpretation requires inspection. |
| `scripts/`, `script-inventory.json` | [Vanilla ACMD capture](https://github.com/WuBoytH/SSBU-Dumped-Scripts/tree/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_pikachu), pinned revision `59004685238a3f6f93bae905d3a4e079701c40b4`. 335 fighter motions and 12 entity motions. All eight object directories acquired: fighter, cloud, dengeki, dengekidama, kaminari, monsterball, specialupdummy and vortex. README warns the translation can contain errors; it does not state the game patch. The pinned commit is dated 2026-03-10, which does not establish the capture's game patch. |
| `native-attacks.json` | Lossless named/raw argument extraction from those scripts: 145 expanded `ATTACK` and eight `ATTACK_ABS` records. All scalar fields, bones, full 3D endpoints, flags/masks, conditions, source line, finite-loop iteration, clears, size changes, hit application and other game commands preserved. Includes mode/item captures beyond the ordinary-kit scope, to avoid dropping source entries. |
| `native-grab-records.json` | Hash-verified extraction of all six native `CATCH` regions, full pummel/throw records and catch-only commands. Original ground/air capsules, throw-kind and catch-kind ABS rows, immediate clears and the down-throw motion21/UFD29 clock discrepancy remain explicit. |
| `motion-list.yml` | [Pikachu motion list](https://github.com/WuBoytH/SSBU-Dumped-Motion-Lists/blob/3f14a9d46b69eb9e7cd622bddde459192848580e/fighter/pikachu/motion/body/c00/motion_list.yml), pinned `3f14a9d46b69eb9e7cd622bddde459192848580e`. Resource/script/animation identity and flags; not bone transforms or animation lengths. |
| `native-fighter-pikachu.json` | [Native fighter table export](https://github.com/Coolsonickirby/SmashUltimateToolsRewrite/blob/609dc95fca419b428f481741a5751559d9098577/defaults/prcFighterParam.json), pinned `609dc95fca419b428f481741a5751559d9098577`. Independently downloaded again; full export bytes match the existing September capture. Includes the complete Pikachu entry and typed flattened values. Game patch unstated. |
| `status/`, `status-verified.json` | [Native status capture](https://github.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/tree/413d42149b8a4d74c71bf9bd955d747b496e7577/ghidra_scripts/lua2cpp_pikachu.nro/pikachu), pinned `413d42149b8a4d74c71bf9bd955d747b496e7577`: 226 fighter/entity C captures. Game patch unstated. README warns some called functions were not dumped and common status scripts are unavailable. |
| `status-param-references.json` | Named parameter references from status captures, resolved using [ParamLabels](https://github.com/ultimate-research/param-labels/blob/06ead522c1a294afbf6e71025d05e9c5829465f6/ParamLabels.csv), pinned `06ead522c1a294afbf6e71025d05e9c5829465f6`. This supplies parameter identities, not their values. Nearest-two-hash extraction is explicitly contextual and requires manual review. |
| `ufd-motion-links.json`, `verified.json` | 37 linked UFD visual assets downloaded under ignored `assets/gen/pikachu-ufd/`: 36 GIFs and one ledge-grab PNG. URLs, byte counts and SHA-256 recorded. The separate art owner extracts/inspects these references; download alone supplies no verified frame mapping. |
| `inventory-route-audit.json` | Read-only audit of the parent's action inventory against the exact script captures and motion resources. Motion identity, script identity and runtime routing are separate. |
| `native-viewer-13.0.1.json` | Independent [versioned 13.0.1 vanilla ACMD and motion export](https://github.com/rubendal/ssbu/blob/2e8f0d245481cb0c936524b6ffe1cdea867c4f68/public/data/patch/13.0.1/character/Pikachu/data.json), pinned `2e8f0d245481cb0c936524b6ffe1cdea867c4f68`. Corroborates nair1.8, fair1.4, bair3.6 and Quick Attack2/3. Does not contain the required numerical special parameter table. |
| `calculator-pikachu.json` | [Calculator Pikachu export](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/pikachu/data.json), pinned `233590e94bc4bd8813f2d1a2af45c8c46648f351`. General fighter/movement/footstool/crawl fields; no numerical special movement. Historical fields do not supersede current UFD timings. |
| `skull-bash-measurement.csv`, `skull-bash-measurement.json` | [Original charge formula table by @gengar6tomo](https://docs.google.com/spreadsheets/d/129oYK5oSNvmlOmEwDvMxy_ouXzGWbdBgT_KGRVYEPNg/edit), linked by the [Ultimate verification wiki](https://w.atwiki.jp/smashsp_kensyou/pages/105.html). CSV captured and hashed; typed Pikachu row retained. Measurement/formula provenance, game patch unstated. |
| `special-parameter-search.json` | Extended repository/export/parameter-patch search with pinned URLs and reasons for excluding modified values and the older Smash4 `.bin` parameter sheet. No native values are inferred from a mod patch. |
| `special-parameter-wiki-leads.json`, `special-native-literals.json` | Revision-pinned secondary special-parameter locator tables, plus five separately verified native status literals. All 226 status hashes rechecked. The [decomposition](special-parameter-leads.md) keeps missing PRC values, entity initialization and clock differences explicit. |
| `native-vl-sheet-pikachu.csv`, `native-vl-sheet-pikachu.json`, `required-special-parameters.json` | [Original Ultimate parameter research table](https://docs.google.com/spreadsheets/d/1rwDPL1jhE-KuEbbcBkkTb44z1smJp9rYme_xb4BIJTk/edit#gid=1036933026): 78 scalar rows, explicit separate game columns, all44 prior status-read fields resolved by exact group/field hashes and pinned getter lines. Patch and original dump metadata unknown. Captured page/workbook/headers and revision14813 metadata retained. See [contract and limits](native-vl-sheet-contract.md). |
| `native-vl-prcrs-pikachu.prc/json`, `native-vl-prcrs-sheet-comparison.json` | [Actual Pikachu PRC fixture](https://github.com/ultimate-research/prc-rs/blob/c5855b8d0e910b1c3622c3131e6dfe0567d62397/src/tests/vl.prc), explicitly identified by the primary parser tests. The 6,385-byte binary decodes into 20 root fields; all 78 sheet rows match native storage precision and all 44 required fields gain actual PRC types, offsets and float32 bits. First-added 2022-10-12; unchanged bytes verified against that first commit. Game patch and unmodified original extraction remain unknown. See [binary contract](native-vl-prcrs-contract.md). |
| `native-hurtbox-declarations.json`, `native-resource-paths.json`, `formats/`, `hurtbox-format-captures.json` | Twelve exact historical `hit_data` capsule declarations, 12 virtual hit nodes and four flip pairs from the binary; primary SSBH skeleton/animation/helper parser formats and independently pinned resource paths. Model/motion bytes, posed matrices, native initialization/scale/projection consumer and current-patch provenance remain missing. Movement contacts, shields and clip spheres are separate. |
| `hurtbox-consumers/`, `hurtbox-consumer-evidence.json` | Primary original Cross Mod and newer Visionary hurtbox readers/renderers, native pose/status API bindings and parameter-loader/module interfaces. Both viewers interpret `size` as local radius, but their nonuniform scaling policies differ; exact native scale/virtual-node/list-index/override consumers remain unverified. Two native Quick Attack NORMAL restores and twelve Final Smash XLU assignments retained. See [consumer contract](hurtbox-consumer-contract.md). |

Reproduction tools: `python3 tools/pikachu-source-acquire.py --download` for the
ACMD/UFD downloads, `--status` for the status captures, and
`python3 tools/pikachu-source-extract.py` for offline argument/event extraction.
`python3 tools/pikachu-source-grab-extract.py` additionally extracts the CATCH
records without changing the primary attack capture.
The acquisition script uses previously inspected `/tmp` source-tree inventories;
it is a session acquisition helper, not a self-contained external dependency
installer. Hash manifests identify the actual captures.

## Clocks and geometry

`frame` and `end_frame` in the native extraction are **motion-script frames**.
Finite literal loops are expanded: nair contacts at 3/9/15/21, bair at
4/8/12/16/20/24, down smash at 8/11/14/17/20/23 and forward-throw catch-only
hits at 11/15/19/23. The end is the next clear/replacement in the captured trace,
not first-actionable time. Conditional branches remain unevaluated. Their
sequentially read clocks and inferred ends are not a gameplay execution oracle.
Native status exits, rate changes and dynamic parameter arithmetic require
independent handling. Unknown status-end frames remain null.

UFD gameplay frame `s` through inclusive `e` converts to elapsed `[s - 1, e)`.
Do not apply that conversion mechanically to a different script clock or a
zero-frame entity action. GIF image count/delay does not establish game frames.

Native `top` positions are root-relative with y up and z forward. Non-root
regions (`kneel`, `hip`, `tail1/3/4`, `neck`, `rot`, `trans`, `sphere`) require
matching animated transforms. Their offsets/radii are retained in full but no
bone transforms have been obtained. Orthographic 2D conversion, world scale,
root height, anatomy anchors and hurtbox fitting remain separately authored
geometry unless supported by further evidence. Pixels never establish exact
3D region geometry or damage values.

The subsequently captured historical Pikachu PRC fixture supplies 12 typed
damage-receiving capsule declarations with bone hashes, both local endpoints,
native sizes and status/part/height categories. This closes declaration coverage
for that fixture, not per-frame posed geometry. Its virtual-node groups are
preserved without inventing their consumer semantics. The primary format and
remaining resource/transform contract is recorded in
[native-vl-prcrs-contract.md](native-vl-prcrs-contract.md).

## Explicit UFD/native discrepancies and omissions

| Action | Current UFD | Pinned native capture | Required treatment |
| --- | --- | --- | --- |
| Jab | Displays 1.4/1.2 | IDs 0/1/2 have 1.4/1.2/1.0 | Preserve third source region; UFD is not the exhaustive region table. |
| Neutral air linker | 1.7 | 1.8 | Keep both values and disclose any selected precedence; no established version explanation. |
| Forward air linker | 1.3 | 1.4 | Same unresolved conflict; four distinct linking regions and rehit 3 remain required. |
| Back air finisher | 3.5 | 3.6 | Same unresolved conflict. |
| Down smash finisher | Startup lists 23, activeframes text stops at 20–21 | ATTACK at 23, clear at 24 | Include frame-23 finisher; the displayed active text omits it. |
| Quick Attack order | Displays Early/Late 3.0/2.0 | First burst 2.0/KBG50/THRU, second 3.0/KBG150/ON | Status capture independently proves first uses `special_air_hi1` and second `special_air_hi2`; cannot silently reverse source identity to match UFD text. Ordering/value conflict remains visible. |
| Thunder body contact | Active text 1–2 | `SpecialLwHit`/`SpecialAirLwHit` starts at motion0, clears at3 | Clocks are not established as identical; leave reconciliation pending visual/status review. |
| Skull Bash | Damage range 10–21.4 | ACMD creates placeholder damage1 then raises CALC_ATTACK_POWER flag | Actual damage comes from status interpolation with per-fighter parameter values; damage1 is not a playable damage specification. |
| Down throw release | Startup29, total51 and damage5 | Applies throw-kind ABS5 at motion21; ATTACK3 at14 immediately clears in the same execute block | Select UFD elapsed28 release explicitly, retain motion21 conflict and do not invent a successful pre-release3damage event. Independent versioned13.0.1 ACMD export corroborates motion21. |

Thunderjolt has six arc records (inner/outer, early/mid/late damage
6/5, 5/4, 4/3) plus ground/surface damage4.8. UFD's displayed summary
6.0/4.8 is not an exhaustive region/age table. Preserve the full native records
and entity status transitions; do not count two summary numbers as full coverage.

## Proven special state evidence and remaining source gaps

Quick Attack's [warp main](https://github.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/blob/413d42149b8a4d74c71bf9bd955d747b496e7577/ghidra_scripts/lua2cpp_pikachu.nro/pikachu/pikachu/status/SpecialHiWarp/main.c)
tests the attack counter. Counter zero selects Hash40 `0xff4037c3f`, verified
by CRC32/length as `special_air_hi1`; positive selects `0xf6d0a2d85`,
`special_air_hi2`. Its move timer reads `param_special_hi.special_hi_move_time_`.
Warp init assigns stored x/y warp speed to control energy and disables motion,
gravity and stop energy. Warp direction/speed and second-warp acceptance reference
`special_hi_warp_stick_`, `special_hi_warp2_angle_`,
`special_hi_warp_spd_multi_`, `special_hi_warp_spd_add_`,
`special_hi_warp_second_`, `special_hi_warp_xmax_` and
`special_hi_warp_angle_`. The newly acquired Ultimate parameter research export
supplies values for these exact fields: speed additive11/multiplier0, move
counter5, stick0.5, second-angle35°, second multiplier0.9, ending horizontal0.6
and wall-slide57°. Its patch is unstated. Native clocks, transitions and geometry
still need independent handling; one impulse with ordinary gravity cannot
establish this behavior.

Skull Bash's [attack main](https://github.com/Coolsonickirby/SSBU-Dumped-Status-Scripts/blob/413d42149b8a4d74c71bf9bd955d747b496e7577/ghidra_scripts/lua2cpp_pikachu.nro/pikachu/pikachu/status/SpecialSAttack/main.c)
sets AIR situation and uses shared motion `special_s` (Hash40 `0x976c3b29b`),
even after ground entry. It is not a missing `SpecialAirS` attack script.
Attack main-loop computes damage from a minimum, maximum, charge-frame range
and hold count, then changes ATTACK0 power. The newly captured table supplies
charge80/flick20, damage6.2–21.4, release speeds and ending/hit coefficients.
Charge speed, hold count, brake trigger/end, hit interruption and landing
variants still require the captured native formulas and state transitions.
The common fighter table's `special_s_brake = 0.2` alone is insufficient.

The original charge research supplies Skull Bash damage
`6.2 + (21.4 - 6.2) * Charge / 80`, charge range0–80, hold start frame14,
and directional-flick bonus20 charge frames. This explains UFD's10.0 minimum
for flick input (`6.2 + 15.2 * 20 / 80 = 10`) while a non-flick release can
start at6.2. The measurement is retained as original research with its patch
unknown; it supplies neither native trajectory parameters nor the varying
release-to-contact delay. Input-normal and flick variants must remain distinct.

Thunder has separate cloud, bolt, self-hit ground and self-hit aerial captures.
Bolt early6/late8 and self-hit15 source regions are preserved. Native generation,
bolt travel/lifetime/detection, self-contact transition and altered physics are
not established merely by those damage records.

The original Ultimate-specific vl research table closes numeric coverage for
all 44 previously identified status-read fields and supplies additional entity
scalar rows. It is distinct from the excluded Smash4-only document. A
typed historical Pikachu PRC binary was subsequently acquired from the primary
parser's explicitly named fixture: all 78 sheet rows agree at storage precision,
and all 44 status-read fields have typed binary evidence. Its original game patch
and unmodified archive extraction remain unverified. Mod patches and secondary
wiki numbers were not substituted.
Entity construction/trajectory formulas and Thunder scaling, full collision
transforms, source-clock reconciliation, common input/shared algorithms and
running-game comparison remain required gaps.

## Route corrections from the action inventory audit

`RunBrake` needs the actual `RunBrakeR`/`RunBrakeL` variant identities. Taunts
need `AppealHiR/L`, `AppealSR/L` and `AppealLwR/L`. `Rebirth` and
`ItemLightWait` have no exact resource/capture identity in this acquired list
and remain unresolved. Resource `attack_s4_hold` invokes `game_attacks4charge`
(similarly up/down smash); resource `squat_wait` invokes `game_squatwait1`.
Jump/fall/ledge motion resources can be present without a per-motion game
script capture. Missing ACMD file is not proof that the source action is absent.

The final action inventory, implementation/visual/runtime columns and accepted
motion mapping remain owned by the parent character record. This source record
does not upgrade any of those statuses.

The scoped runtime preparations and checks are described in
[normal-preparation.md](normal-preparation.md) and
[grab-preparation.md](grab-preparation.md). They are outside roster registration;
unsupported pose transforms, native rehit clock parity and hold policy remain
explicit requirements. Automatic sourced back/down-air landing contacts now have
a consumer and measured floor-contact evidence in
[landing-attack-runtime.md](landing-attack-runtime.md).
The separate native60-frame damage cap and120-frame keep timer, current forced
release limitation, and unresolved hold-pose/flag clock conversion are audited
in [smash-hold-contract.md](smash-hold-contract.md). No consumer numbers changed.
