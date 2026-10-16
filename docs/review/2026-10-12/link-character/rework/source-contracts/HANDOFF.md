# Link source handoff — 2026-10-12

This package is fresh source preparation for the user-requested rebuild. It does
not inherit the old Link implementation's completion or acceptance. No Link
game code, production art, tests, typecheck, browser probes or build were changed
or run by the source owner. One complete verification remains scheduled at the
end of the rebuild, under the coordinator's control.

The sole canonical action ledger is `../inventory.json`: 373 action/entity/control
rows, 424 applicable catalog contexts, and 270 groups sharing the exact native
resource filename. Its 707-entry motion coverage accounts for other-fighter,
unsupported-item, water/ladder and common-helper scenarios individually. This is
an accepted planning partition; complete art batching still needs the fresh
posed reference, source poses and clock correspondence. The fresh concepta2 identity has been accepted by the coordinator; it is not yet a posed-motion or runtime geometry approval. A shared resource filename is
not a claim that all its status clocks, collision or conditions are identical.

Useful contracts for implementation:

- `normals-and-defense.json` maps all 16 stable normal attack IDs to current
  revision-pinned Wiki packets/timing, fresh UFD fields and native callback/resource
  selectors. Preserve `link.utilt/usmash/dtilt/dsmash` and the other existing public
  IDs; source-motion inventory IDs do not silently rename saved fighter exports.
- `grabs-throws-getups.json` preserves standing/dash/pivot ground/air capture
  capsules, absolute throws separately from geometric hits, and distinct getup,
  trip and ledge cases. Native parameter-supported receiving is NORMAL/HIGH;
  exact common lookup is separate. Alternative templates stay source-accounted
  conditional candidates rather than definitively absent features.
- `mechanics.json` covers bow, Boomerang, Spin Attack, Remote Bomb, passive shield
  and Sword Beam. Double-arrow damage selects
  `floor((4 + 8 * effectiveRatio) * 0.8)` for **each** arrow. A registered native
  shared FLY initializer resolves the ambiguous Wiki antecedent: double scaling
  precedes the sole integer conversion. The superseded nested interpretation is
  retained in `bow-rounding-selection-history.json`. Public CHARGE residency at least
  36 selects effective FULL ratio 1, separate from total button duration. The
  recovered HOLD exec branch explicitly clamps a lower native counter to 60;
  HOLD residency 180 is a separate auto-release counter. Exact startup scheduler
  correspondence remains a gap. Only the second arrow gets the 0.9 speed multiplier. The FULL
  `charge_attack_mul` branch selects supporting Ultimate table value 1; patch,
  original parameter extraction and numerical accessor precision remain limits.
- `item-compatibility.json` records Link's own callbacks, rates, native acquisition,
  carry and shooting fields. Heavy back release at motion 20 with offset (-20,15)
  occurs **before** reversal in that callback. Do not reverse first or copy DK's
  release/socket profile. Light back reversal at 4 precedes release at 9.
- `fighter-parameters.json` retains 369 Link parameter fields and consumer families;
  304 comparable fields match the retained declared 13.0.1 workbook. This supports
  those values, not a claim that every source script identifies that game patch.
  `../sources/native/link-motion-parameters.json` retains another 127 motion/common
  fields, including NORMAL/HIGH/S selectors and lift midpoint frames 5/17/22.
- `native-events.json` transcribes 470 game/expression functions and 147 complete
  ATTACK packets, plus capture/absolute-throw, flag, article, equipment, protection
  and cleanup commands. Lexical frame/wait operations and branch/loop source remain
  raw; they are not a simulated gameplay timeline. The pinned script repository
  itself warns that dump errors remain. Wiki explicit current values take priority.
- `wiki-technical.json` transcribes 40 revision-pinned pages and 175 hit/throw/capture
  rows, with exact named fields and source sections. Implicit template fields and
  explicit values remain distinct.
- `final-smashes.json`, `final-native-events.json`, `final-motions.json` and
  `final-inventory-proposals.json` cover the three user-required Ultimate Final
  Smashes and shared Meter/Smash Ball acquisition/activation. DK/Pikachu proposals
  are for the coordinator's existing canonical ledgers; those ledgers were not
  edited here. Do not port Konga Beat, steerable Volt Tackle or Triforce Slash.

Source references ready for subsequent pose work:

- `assets/gen/link-native-reference/model.7z` and `motion.7z` are MEGA-MAC
  authenticated public archives, with full hashes and historical timestamps in
  `../sources/native/archive-acquisition.json`. CPU extraction is complete under
  `assets/gen/link-native-reference/extracted`: all 270 planned body filenames
  exist in base c00, with 262 different c00_v1 alternatives retained. The source
  owner has not rendered any mesh guides. Archive timestamps do not establish a
  current vanilla patch. Eighteen static c00 diffuse/eye/equipment textures are
  decoded under `assets/gen/link-native-reference/decoded-c00`; input/output hashes
  and the exact pinned converter are in `decoded-texture-receipts.json`.
- All 37 actual assets linked by the fresh UFD page are acquired: 32 GIFs and five
  static PNGs. Exact URLs, paths and hashes are in `../sources/ufd/asset-receipts.json`.
  Static arrow/Boomerang images do not supply their fighter's full windup motion.
- `pilot-utilt-source.json` supports the 35-image GIF timeline using actual attack
  overlays at indices 7–11, matching public frames 8–12. The selected source resource
  is `c02attackhi3.nuanmb`; its published 56-frame natural tail is separate from the
  GIF's 35 images and public FAF 36.
- `pilot-jab-source.json` similarly supports GIF indices 6–7 as public frames 7–8.
  Native raw attack frame 8/rate 0.8 and native motion cancel 25 differ from the
  selected public timeline/FAF 24; retain that clock/source discrepancy.
- `pilot-fair-source.json` is qualitative only: 50 images versus 51 UFD frames,
  with attack overlays at source indices 14–15 and 22–23. The 250 ms delay at one
  image does not prove where a gameplay frame was omitted or held. Two distinct
  slashes and their harmless body-turn gap must remain visible.

Remaining source fidelity limits include common entry/exit scheduler clocks,
initial jump and powered-Spin kinetic setup, bow startup/air cancel details,
Boomerang article ownership/return kinetics and lifetime counter correspondence,
Remote Bomb item-event handler and bounce consumers, passive-shield equipment
admission/SDI, Sword Beam article charge scaling, and Final Smash common
capture/resource-loss/protection cleanup. Bow dynamic damage ordering and HOLD
clamp, Spin Hold/air-end/FallSpecial transitions, Bomb owner/nonheld admission
and one-shot generate/detonate callbacks, and detailed Pika vortex/AncientArrow
status paths have now been recovered. Published values remain selected where
available. Named necessary authored adapters remain separate from native parity.

`boomerang-packet-correction.json` preserves a secondary-document transposition
found during cross-review. Correct angle/base/growth are clean 70/80/40, late
65/60/40 and returning 70/50/40. The staged runtime values were already correct.

Native status handoff additions:

- `final-status-consumers.json` maps Pika timed camera-bound transitions, captured
  targets and terrain/cliff-disabled vortex admission; AncientArrow flight range
  versus impact visibility; and DK startup/attack/end cleanup. The angle-unit
  inference and decompiler discrepancy remain explicit in `sv-math-angle-audit.json`.
- `arrow-status-consumers.json` maps HOLD-to-60 charge clamp and terrain
  STICK-to-item conversion. Fighter HIT_STICK expires without materializing a
  pickup. Native `to_item` construction and reflected ownership remain gaps.
- `link-special-status-consumers.json` maps Spin charge and air-end/FallSpecial
  consumers, Boomerang flick/blank/catch admission and Bomb owner/nonheld/standby
  checks, one-shot generation and detonation. Ultimate VL fields carry hashes,
  table cells and exact caller references; unknown patch remains explicit.
- `../sources/native/final-animation-extents.json` records full raw Pika and Link
  animation endpoints separately from motion cancel/FAF and elapsed status clocks.
  Pika final2 is 94 versus cancel80; air2 is39 versus cancel37. Link ground/air
  Final resources end at130/102. These source endpoints are not tested runtime exits.
- `pilot-bair-source.json` supports both kick windows from the 30-image UFD GIF
  and preserves raw native tail49/cancel31. Anatomical first right and second left
  leg contacts are separate from projected screen direction.

The source ledger now records 67 prepared action selections and 212 exact fighter
pickup/throw callback contexts, with selected contracts and explicit remaining
consumer limits. `source-milestone-reconciliation.json` preserves IDs and hashes;
`inventory.milestoneDefinitions` states that source=true is selection readiness,
not full native parity. All other completion flags remain false. Shared Smash
Ball/Meter cases are separate from the ordinary16 weapon contexts; runtime owns
catalog integration. No Link tests, build or gameplay acceptance has run.

Raw availability closes file acquisition only: all270 parsed resource metadata
and hashes are bound in `inventory.clipPlan.nativeAsset`. Posed evaluation,
source-to-gameplay clocks, fresh reference motion fit, installed art and final
verification remain separate gates. Source actor parameters and normal/high
receiving selectors do not prove the missing common lookup itself.

Shared Ball proposal/drop/flight source selections and approved necessary adapters are retained in `shared-smashball-coordinator-selection.json`. Known drop fields2/30 remain formula-unresolved; frequency-compensated chance and removal4800 binding stay distinct from authored roaming, returned HP, drop law and UI depletion. `final-selected-packet-binding.json` supplies all84 complete Final packets with explicit Wiki-priority overrides and links to phase clocks. Pika alternate FinalStart49 stays source-accounted with unresolved common-prelude applicability; captured fighter Final/main selects Final63.

End verification preparation: `final-combat-modifiers.json` selects stale/fresh and variable-KB rage for Final attacks, with Ultimate fixed-KB rage exemption, qualifying damage-taken1v1, and explicit Meter applied-damage versus original-reference-base interpretation. `../verification/final-independent-fixture-plan.json` prepares18 independent numeric cases and10 realcontact/lifecycle families; none ran. `donkey-final-clock-crossread.json` retains captured Attack133→End, ground/air cancel70/47 and natural89/49, groundrate.8 at30, separately from unresolved publiccombined209. `bow-equipment-lifecycle.json` distinguishes sourced rangedHAVE/postBowBACK from unavailable initialordinary Bowarticle creation/visibility; BowB ancestry isnot persistentbackBow proof.

CPU equipment source preparation: `native-equipment-visibility-schedules.json` and270 immutable source shards expose815 visibility windows plus8480 raw material tracks. Defaulteyelidnative0 and longest-prefix mesh selection are explicit guide semantics; all first/last/visibility/pupil changes are pose candidates, not art counts or gameplay frames. Generic equipment wording in the canonical inventory now uses conditional Bowarticle HAVE/post-useBACK, with initial/commonBACK gaps; `bow-equipment-summary-correction.json` records exact affected IDs and hashes.

Common state route planning: `common-state-conditions.json` binds187 applicable locomotion/defense/grab/victim/receiving/ledge/getup/tech/taunt/results rows and22 conditional receiving overrides to explicit entry/input/state/exit/equipment conditions and named Link-owned selectors over existing engine snapshots. No common rate/selectorthreshold, idlevariant cadence or unavailable Sleep/Bind producer is invented. Per-rowreferences livein the singleinventory; applicability and allmilestoneflags unchanged.

Adaptive source motion preparation: `native-pose-trajectories/index.json` describesall270 resourcecandidates;262 NPZs retain11864 guardedinteger samples for16 named body/equipment bones. Eight constructor failures stayrequiredsource gaps with exacterrors; noguard wasdisabled andnomatricesfabricated. Perresource descriptorreferences areboundin inventory.clipPlan.nativeAsset without upgrading poseInspected/clockMapped/art/runtime flags. No rendering orgameplay check wasrun.

Eight trajectory-reader rejections now have a source-approved exact binding policy in `trajectory-track-binding-policy.json`: four hand-only overlays contain19/21 matching channels and five unbound fingertip effectors each; four receiving templates contain24 matching body channels and two unbound generic nodes. Raw channel values, actual skeleton/mesh/helper crossreads and primary renderer pin/lines are retained. Golden owns the opt-in reader implementation; default strict guards remain unchanged. Hand overlays require an actual body context rather than bind-body guides. All eight remain required; no art/runtime/verification gates were raised.


Common producer follow-up: [common-state-producers-HANDOFF.md](common-state-producers-HANDOFF.md) and [common-state-producers.json](common-state-producers.json) normalize eight Sleep/Bind/CameraHit/DownSpot/prone-Food rows. Bind/paralysis conflation corrected; CameraHit selected as screen-KO impact; prone Food priority/temporary receipt specified. DownSpot exact common producer remains required unresolved and distinct from DOWN_DAMAGE jablock. Public sleep/stun formulas retained, modded common hooks bounded, no production/checks or milestone upgrades.


Selected receiving follow-through: [downspot-public-crumple-selection.json](downspot-public-crumple-selection.json) records the coordinator-selected public-crumple adapter and untested pure leaf, including strict authoring metadata parsing. Native DownSpot caller remains missing; no native-rate inference. [normal-packet-index/index.json](normal-packet-index/index.json) is the corrected complete normal/capture packet handoff: balanced nested templates restored39smash rows, nine approved literal-Wiki-bone corrections preserved, and pummel1.3/hit1/FAF7 added. Historical derived snapshots remain under normal-packet-index/historical. No checks or milestone upgrade.

Supplemental source trajectories: [supplemental index](native-pose-trajectories/supplemental-audited-receiving-2026-10-13/index.json) adds four audited receiving resources/209integer samples beside the unchanged original262/eight-rejection receipt. Four hand resources remain raw matched overlays pending actual body composition; no standalone body matrices or target collision fit.


Ranged pilot root crossread: [bow-pilot-root-crossread.json](bow-pilot-root-crossread.json) retains nine ground source pairs plus immutable raw matrices. BowRoot is identity and its animated Have already matches actor-Trans-relative bodyHaveL at those samples (max0.000197native position difference); applying bodyHaveL again would duplicate placement. This supports a bounded source-guide own-rig/actor-root-once adapter. Common initial/HAVE/BACK attachment, real article/body status clocks and end22 BACK visibility remain separately unresolved. No rendered pilot or runtime acceptance claimed.

Final Meter damage attribution: [final-meter-damage-credit.json](final-meter-damage-credit.json) distinguishes actual self-explosion contact from direct scripted recoil. The selected policy grants the victim 9 points per actual percent received, including own Bomb contact; distinct attackers receive 3. Same-owner dealt credit is zero as an explicitly authored attribution exception, with its native caller still missing. Partial passive gain continues at 1 point per 15 advancing resource steps during an active Final, and real damage receipts continue; actual global pause/stop freezes the passive clock. Other fighters' activation remains suppressed while a Final is active. Exact native cinematic gauge timing remains unresolved. Seven end-stage fixtures are prepared, not run; no production edits or milestone upgrades are claimed.

Compact special packet handoff: [special-packet-index/index.json](special-packet-index/index.json) supplies four ground Spin phases, eleven air Spin phases and their 23 complete public packets with exact native flags and lifecycle callbacks. Sword Beam is a separate detached article packet with retained endpoint parameters; its charge interpolation caller remains a gap. [normal-clock-landmarks.json](special-packet-index/normal-clock-landmarks.json) records public active windows and native lexical phase starts for all 16 normal actions, without asserting a recovered common scheduler. The normal source index now contains 95 body rows, with the page's additional Sword Beam row separately retained. [beam-classification-correction.json](special-packet-index/beam-classification-correction.json) preserves the prior 96-row index and the exact mistaken body binding; raw Wiki captures are unchanged. No checks or completion flags changed.

Semantic clock audit: [normal-clock-caveats.json](special-packet-index/normal-clock-caveats.json) records five public/native start conflicts (jab 1, down tilt, forward smash, down smash and forward air), exact retained motion-rate/clear events, and continuous versus separated hit phases. The coordinator selected native contact landmark N as evaluated raw sample N; this is an engine presentation convention, with the common scheduler still unrecovered. Up tilt 8 and back air 6/15 align numeric landmarks, but no universal public-frame-minus-one rule is sourced. Down-air bounce still needs its distinct event/refresh consumer. No production, fullpack, source-value or milestone changes; no checks ran.

Normal phase source guide preparation: [normal-phase-source-centres/index.json](normal-phase-source-centres/index.json) retains all 95 body packet rows at 28 semantic group entries across 16 actions. Guarded named-bone evaluation resolves 68 native endpoint sets and 68 exact public-offset sets. The two up-air `6.9 to -1.5` ranges match both captured capsule endpoints on all axes; [public-capsule-range-reconciliation.json](normal-phase-source-centres/public-capsule-range-reconciliation.json) preserves the original scalar-only preparation and exact crossread. All native centres are unchanged. The 27 required gap rows remain explicit: 26 virtual `top` rows without aliases and one missing down-air bounce phase. Raw matrices and actor-root projection use sample N, subtract sampled Trans once, then x=5z/y=-5y. Source radii, target support shifts and visible target collision fit remain separate; no gameplay mapping or acceptance is claimed. All input hashes, including the coordinator's pilot exporter and shared evaluator, remained unchanged during extraction. No checks or milestones changed.
