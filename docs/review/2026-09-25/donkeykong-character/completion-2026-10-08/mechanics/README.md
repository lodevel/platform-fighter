# DK mechanics contracts, October 8 completion

This is a source/implementation contract, not runtime or visual acceptance.
The coordinator's canonical inventory is the coverage record. The prior frozen
October 8 production baseline remains valid for its old build only.

Native Ultimate attack scripts are pinned to
`WuBoytH/SSBU-Dumped-Scripts@59004685238a3f6f93bae905d3a4e079701c40b4`;
the retained local files and SHA receipts are in
`../../../../2026-10-06/dk-all-attack-values/sources/verified.json`.
UFD supplies the selected gameplay timelines; primary script events supply
region identities, status attributes and interaction flags. This record uses
zero-based half-open ages: native inclusive frames `[s,e]` become `[s-1,e)`.
Published technical pages were inspected October 8, 2026.

| Source motion | Selected protection ages | Receiving bones |
| --- | --- | --- |
| AttackS3, AttackS3Hi, AttackS3Lw | [5,9) | arml |
| AttackHi3 | [4,11) | armr |
| AttackLw3 | [4,7) | arml, shoulderl |
| AttackS4 | [19,26) | head, arml, armr |
| AttackHi4 | [11,15) | head, armr, arml |
| AttackLw4 | [10,14) | armr, arml |
| AttackAirHi | [4,10) | head |
| SpecialN, SpecialAirN | [3,20) | arml |
| SpecialHi | [18,24) | armr |
| SpecialAirHi | [9,38) | armr, arml |

Full-charge Punch uses whole-body armor, not inherited partial Punch arm
intangibility: the Max scripts never issue that HIT_NODE. The grounded spin
script issues HIT_NODE for armr only. Untouched receiving bones remain
vulnerable. These fields are carried by `dkSourceMove` or the aerial spin's
direct declaration and require the shared receiving consumer and posed regions.

[UFD DK](https://ultimateframedata.com/donkey_kong) supplies the selected gameplay
windows. Most ordinary raw commands match their integer ages, but the three
forward-tilt scripts also change motion rate: neutral .9 and angled .91 from
motion 1 until reset at 10. Their integer HIT_NODE/ATTACK events are not proof
of an exact gameplay-to-animation sample map. SpecialAirHi is a retained source-clock
conflict: its raw script marks arm nodes at motion 12 and resets them after
four motion frames, with a motion-rate change, while UFD lists gameplay 10–38.
The implementation explicitly selects the UFD 10–38 window. No exact primary
motion-to-gameplay derivation is claimed for that window. [SmashWiki up special](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special)
is a separately inspected technical source.

Recovery attack protection comes from the primary motion list: DownAttackU/D
xlu_start 1 / xlu_end 25 means [0,24); SlipAttack 1 / 8 means [0,7).
CliffAttack selects UFD's 1–25 => [0,25). Recovery attacks use region `*`,
which the shared selector must apply to every posed receiving region.

`dkSourceHits` carries native `THRU` for smashes and all Punch variants,
`OFF` for grounded/aerial Hand Slap, and `ON` otherwise. `THRU` and `OFF`
are distinct: no rebound is not transcendent priority. Down tilt retains
native trip 0.4; downward forward tilt retains 0.15; aerial Hand Slap retains
0.2. All damage, launch records,
source masks and ID priority retain the previous exhaustive source comparison.

Headbutt uses the native bury attribute on SpecialS regions 0/1 and SpecialAirS
region 0. The other region remains normal. A bury-tagged hit buries only a
grounded target; an airborne target retains the ordinary source launch. The
attribute is supplied by the pinned scripts; the complete status algorithm is
secondary technical evidence from [Buried](https://www.ssbwiki.com/Buried).
That page describes percent/rank/weight-100 knockback duration, stick/button
mashing, the 90-knockback escape boundary, stored weaker launch and 12-frame
escape endlag. The shared runtime specialist owns implementation and evidence;
the leaf attribute alone does not close this action's required gap.

`buriedState.ts` now provides the pure clock/mash/weak-hit/escape consumer for
shared integration. The published stock-rank equation and its listed r values
are selected explicitly: r=1.5/1.8 imply 22.5/27 frames' reduction, while that
same page's prose says 18/22. This inconsistency is a rank-fidelity limitation;
equal-stock duration is unambiguous. Latest weak launch replaces the prior
stored launch in the beta status adapter. Actual native status field/priority
parity remains unmeasured. The helper's tests do not establish the Character
hook, rendering, opposing contacts or match-stock propagation.

[Headbutt's technical parameters](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Side_special)
give entry horizontal velocity ×0.5 grounded / ×0.67 airborne, vertical
velocity ×0 grounded / ×0.5 airborne and gravity ×0.5. These are declared as
move-owned entry/gravity fields, replacing the old guessed two-step 1.5px dash.
The published parameter numbers are secondary source evidence; the project
physics integration, wall contact and cleanup need separate measurements.

[Spinning Kong parameters](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special)
give grounded acceleration 0.034, friction 0.015, maximum speed 1.1 and
post-final-hit friction 0.04 native units. At the established five pixels per
unit the declarations are 0.17 / 0.075 / 5.5 / 0.2; post-hit begins after
native contact 62. The shared runtime owns the move profile's live algorithm.
The same technical page says airborne landing before helplessness transitions
to grounded motion frame 63: this is a required branch, not generic landing lag.
Existing aerial lift/drift is retained as its prior explicitly measured beta
calibration; source total and special-fall clock are still separate limits.

[UFD ledge stats](https://ultimateframedata.com/stats#ledge)
select climb 34 / protection 33, roll 45 / protection 28, attack 55 /
protection 25, jump 14 / protection 12. The captured old motion list has
roll cancel 50 and xlu_end 31; those are retained as raw-clock/version conflict
and do not override the selected UFD gameplay fields. The same primary list
provides common down stand 29 / protection 22, stand-forward/up 35 / 19,
stand-back/up 35 / 24, stand-forward/down 35 / 14, stand-back/down 35 / 24,
neutral tech 26 / 20, and forward/back tech rolls 40 / 20. Status clocks and
runtime routes must consume these, rather than merely displaying this table.

[Forward tilt's technical page](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_tilt)
lists angled FAF 36 versus neutral 35, corroborated by the captured motion
list. UFD's shared entry supplies 34 total for all angles. The current selected
UFD timing stays 34, with the extra angled frame retained as a fidelity conflict.
Changing that source priority silently would invalidate the prior comparison.

Ordinary grabs now opt into the existing Ultimate capture rules already
qualified for Pikachu; the old 90-frame literal is only the legacy fallback.
Native forward throw enters cargo at frame 16 with zero release damage and
WHOLE_HIT_INVINCIBLE during entry. Its source invincibility field is declared,
and the cargo-start consumer must carry it. Native Catch-kind ABS records are
not release damage. Cargo movement/attachment remains a beta adaptation until
the posed hand/shoulder consumer and observed match verify the branch.

[Ultimate DK's technical overview](https://www.ssbwiki.com/Donkey_Kong_(SSBU))
gives cargo duration `((90+1.7p)*11/6)-g`, where p is carry-entry percent and g
includes ordinary capture time already spent, including mashing. The new
`donkeykongCargoRules.ts` helper retains the fractional source budget and
accepted subsequent mash reduction, rather than the old unsourced flat240.
The same source limits cargo to one ground jump and its four attack-plus-stick
throws; walking offstage grants no double jump. The helper supplies fresh-edge
throw selection and explicit ordinary attack/defense/item restrictions. Native
carry motion parameters, air-down-throw boost and exact attachment still need
separate source/consumer review. The helper must be carried through the live
snapshot/factory state by the runtime owner before any row promotion.

The explicit cargo `airThrows` branch shares the four native carry-throw
motions and their release/recovery clocks; the motion list contains no separate
aerial carry-throw scripts. Air down throw carries native frame-17
`SET_SPEED_EX(0,1.5,MAIN)` as a -7.5px vertical boost. Applying that boost only
to the latched aerial branch is the project kinetic adapter; the source command
itself is unguarded. Grounded kinetic parity remains a visible limit.
[Forward throw's technical record](https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_throw)
lists carry break release damage 4%, matching ThrowF's native CATCH ABS 4.
This damage applies to actual cargo escape, not entry or arbitrary capture
release. Normal back throw and cargo back throw reverse actor facing at release
(native frames 15/16); launch direction is evaluated before that reversal.
The seven damaging throws preserve native zero ABS hitlag. These nested fields
are covered by the save/reload roundtrip check, pending its next approved run.

Hand Slap must retain unbounded legal mash repetition. The old eight-repeat
limit was an authored schema restriction without source support. Its native
shield setoff ×0.58 is a defender push multiplier, not a shieldstun multiplier.
Both consumers are shared-runtime work; the source script command is
`ATK_SET_SHIELD_SETOFF_MUL_arg5` in SpecialLwLoop at both slap groups.

`shieldPushback.ts` provides a pure ordinary-block baseline and traction decay.
The current [Shield technical table](https://www.ssbwiki.com/Shield#Shield_pushback)
selects defender `min(1.3,(unroundedShieldstun+1)*0.09)` and attacker
`damage*0.04+0.025`; remote projectiles have no attacker recoil. Defender
traction decays speed; attacker traction is multiplied by 1.1. Five pixels per
source unit is the established project conversion. The captured independent
[calculator formulas](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js)
agree on attacker recoil but omit the defender +1. The current Wiki equation
is selected explicitly. Applying the move factor after the capped baseline is
an explicit beta ordering; native cap-order parity is unmeasured. Parry,
shield break, frozen-step displacement and ledge restraint are shared consumer
responsibilities. Opting in for the sourced Hand Slap field preserves previously
qualified fighters until a broader shield-baseline review is authorized.
The captured DK stats and [Ultimate traction table](https://www.ssbwiki.com/Traction#Super_Smash_Bros._Ultimate)
give DK traction 0.123 native, hence 0.615px/frame², and attacker recoil decay
0.6765px/frame². The 0.085 DK value is gravity and must not become traction.
Receiving fighters use their own published traction or an explicit authored
profile calibration; movement acceleration is a different quantity. The same
table supplies Pikachu .132, Link .113, Kirby .116, Wolf .11, Jigglypuff .087,
Pyra .08 and Mythra .121 native. A character's identity/form mapping must be
validated before adopting that source value; authored fantasy fighters have
no asserted native traction.

`native-pilot-schedule.json` retains jab1/jab2/down-tilt archive hashes, resource
extents and selected gameplay phases. Those rate-1 scripts map zero-based age
to native animation sample age+1; no gameplay rate commands occur. Resource
final indices 34/47/31 do not extend cancellable action totals 24/31/24.
Body identity, legal floor contact and receiving/attack overlays require
independent visual and match acceptance of the actual rendered sequence.

Giant Punch now opts into `charge.inputBehavior:'press-wind-fire'` for both
ground and air. `donkeykongPunchControls.ts` supplies start, automatic winding,
fresh second-press fire, cancel/bank, resume and full-bank transitions; the
shared Character hook consumes it. Releasing the initial button keeps winding.
Full charge banks automatically and a later press fires. The inspected
[Giant Punch](https://www.ssbwiki.com/Giant_Punch) and
[charge storage canceling](https://www.ssbwiki.com/Charge_storage_canceling)
contracts, native cancel fields, source priorities and adapter limits are in
`giant-punch-input-contract.json`. Selected clocks are seven-frame entry,
111-frame full wind, four-frame ordinary cancel/full-bank end, and five-frame
air-jump cancel. Native old parameter 110 and partial release cancel-frame 63
(62-frame release duration) conflict with selected UFD 111 and total 55 after
entry. UFD explicitly lists partial startup `19(+7)`, active `26–27 (19–20
after starting charge)`, total 62 and endlag 35; those imply entry seven plus
release 55. SmashWiki instead lists interruptible `70 (63 from release)`.
The seven-frame disagreement is retained, rather than hidden by frame
conventions. Full UFD duration 47 agrees with native cancel-frame 48.
Simultaneous-input priority,
entry input buffering, exhausted air-resource handling and landing during
cancel remain explicit beta adapters until native status traces qualify them.
The helper's first entry sample is phase age 0; ages 0..6 precede loop age 0.
The corrected real-Matter partial-fire test requires a fresh second press.
The coordinator observed six primary cases through actual normal browser
keyboard input (18 checks): press/release keeps winding, held first press
auto-banks full, later full press fires, second presses fire partial on ground
and air, and shield bank resumes partial. Ground/air cancel resources also
passed controlled live consumer checks. Full keyboard coverage of every exit,
gamepad feel and paired animation/contact acceptance remain separate gates.

The expanded `DonkeyKong.sourceInteractions.test.ts` is an independent
declaration audit beyond the old 138 attack records/42 motions/29 timing
comparisons. It binds all 42 raw captures to hashes and compares 124 ordinary
ATTACK regions for setoff, rehit, trip, bury/electric attribute and directness,
while pinning part zero, setWeight false, all-part masks and unused native
reflect/absorb/flinchless/disable-hitlag flags. The catch-only pummel is the
125th raw region and remains a held-victim event. Ground Hand Slap's eight
regions are indirect (`direct:false`); this affects parry freeze, independently
of projectile ownership. The source audit additionally checks active region
IDs and empty gaps at every age of the 25 rate-one canonical scripts. Five
rate-changing scripts stay explicitly excluded from that clock equivalence:
the three forward tilts, aerial spin (.6 from motion 7 until 68), and ground
Hand Slap (.75 from motion 1 until 5, plus its seven-frame entry). Their
selected UFD clocks remain subject to the separate pose/status ledger.
The coordinator's unloaded-GPU checkpoint passed 134 cases across eight files,
including these expanded signatures, controls and real-Matter partial-fire
scenario. Its typecheck and guarded build also passed, bound in
`fourth-checkpoint-contract.json` to `index-DjVr_CC1.js`, SHA256
`4665c42499671321a3444403bd0f932e7d369718bd277ffc7f720f3b10abf2b0`.
On that exact build, 64 live consumer checks, 18 primary DK keyboard checks
and six Pikachu charge regression cases passed. Controlled combat-resolver
fixtures establish status/consumer transport, not independent attack-sensor
contact coverage. The baseline receiving body has no anatomical region names,
so protection/contact qualification requires the paired accepted pose/capsule
installation. Full visual and contextual match acceptance remain pending.
The historical 91-case receipt predates these mutations.

Required acceptance after integration: actual opposing contacts on protected
bone and vulnerable torso at both boundaries/facings; armor distinguishes
damage-without-launch from intangible misses; real keyboard charge/bank/fire,
Headbutt ground/air entry and bury/mash/strong/weak follow-up; ground spin
steering/friction/wall/pause/hitlag and airborne landing tail; save/reload of
new nested fields; source region collision after art/evaluator attachment.

The later context ledger contains 90 proposals alongside 81 combat proposals
for the coordinator's 171-row inventory. `context-row-source-proposals.json`
preserves the coordinator's full nested YAML flags/extra parsing and the
ground/air recipient `step_pose` bindings. This count includes the 19 added
light-item pickup/throw/drop variants; it does not establish full native item
parity. Proposed additional applicability is separate from the canonical
inventory until the coordinator reconciles it.

`donkeykongGroundMovement.ts` implements the published run acceleration
equation and constant ground braking with independently pinned DK scalars.
`movement-source-research.json` distinguishes that experimental equation from
the unavailable native common controller update. Walking acceleration remains
unresolved: the original research explicitly omits its complex calculation.
`donkeykongTurnBrake.ts` retains cancel-derived dash-turn21 and braking19,
and a separately authored33-step run-turn exit from DK's native clip extent.
The native dash-turn flag3, dash-to-run transition18 and run-turn stop15 are
distinct markers. Facing, gait selection and dash reversal still have explicit
adapter limits in `turn-brake-contract.json`; they are not Pikachu constants
relabeled as DK. The native reverse-dash rule adds dash speed to residual
velocity, so the currently authored approach-to-target reversal cannot claim
native kinetic parity.

`donkeykongAirMovement.ts` is a subsequent separate leaf, held unconsumed at
checkpoint5's source freeze. Native air coefficients .05 multiplier/.01 add
produce full-stick.3 and half-stick.175; neutral braking .015×5 subtracts
.075 per step rather than DK's prior .95 velocity multiplier. The selected
speed limit is6.04. `air-movement-contract.json` records eligibility,
energy-composition/excess-speed limits and pending shared integration/tests.

DK now installs its own `DONKEYKONG_TAUNTS`: six directional/facing native
motions use cancel50 =>49 committed steps. The authenticated resource extents
remain separate presentation lifetimes80/70/60. Root's 16-case source/leaf
checkpoint (items10, movement5, taunt1) is retained with source hashes and log
in `source-item-movement-taunt-checkpoint.json`; it does not qualify later
Character/Scene hooks or artwork.

`item-context-contract.json` pins all16 ground/air ordinary/strong directional
throws, dash/drop and standing/walking pickup. Native callbacks commit pickup2,
forward10, back reverse11/release14, up15, down8, dash6 at rate.92, and ground
drop7. The published throw vectors use DK speed multiplier1.09 at5world/native;
they do not multiply the prior authored item vectors. Source ground6/air8
flick windows are separate from the project stick thresholds. Native offset
arguments remain exact source records; their common coordinate consumer is
unrecovered, and reviewed posed hand release is a target geometry adaptation.

`item-catch-contract.json` and `donkeykongItemCatch.ts` distinguish stationary
air catch, aerial/dodge startup catch and ground dash/tilt catch from the
ground pickup callback2. They preserve the underlying body/action. Original
experimental research's aerial1–4 window is selected with SmashWiki's generic
five-frame disagreement retained. Directional aerial rethrow waits7 steps
after the completed action, Z-drop follow-up waits1 step, and recatching the
same Z-dropped item requires sampled separation rather than elapsed time.
Five catch and four turn helper tests passed in root's focused run; its shared
item runtime failures and subsequent type corrections remain separate gates.

`item-additional-context-proposals.json`, reproduced by
`tools/dk-item-applicability-audit.py`, proposes five contextual catches,
19 current six-item ground-slot/airborne-use actions, seven additional native
weapon branches and18 missing heavy-item states. The six spawned types are
Bat, custom Sword, custom Hammer, custom Spear, RayGun and synthetic Bomb.
Existing authored item attacks and physics are preserved explicitly;
primary Bomb use detonates in hand, while grab/shield+attack tosses. Earlier
user-required airborne item use remains an authored project input branch.
Native battering items replace neutral/forward tilt/dash/forward smash;
generic project tilt/smash slots need separately documented axis adaptation.
Held weapons' current primary-input jab priority must not hide distinct
declared ground slot routes. Empty-gun native resources alone do not prove an
applicable blank-fire action: Ultimate's documented status rule tosses empty
shooting items, while this project's RayGun breaks after its last authored use.
DK's heavy-item jump/fall/armor trait is applicable but currently has no heavy
item framework or spawned heavy type. These omissions remain missing coverage,
not non-applicability or completion inferred from motion filenames.

Heavy-item source work continued on 2026-10-09. The new
[heavy runtime contract](heavy-item-runtime-contract.json) pins nine native
pickup/throw command captures and six super-lift command captures, the original
heavy throw table, native movement parameters and the nine status-owned carry
resources. The owned pure helper and eight meaningful tests are authored; shared
Character/Scene consumption, a real heavy spawn and live acceptance remain
pending. No tests were executed by this specialist while the root checkpoint
was active.

Pickup reserves the candidate and commits at native5. All eight heavy throws
retain their sourced release, direction, strength, offset and cancel fields.
Heavy back releases before reversing at native20, unlike the light-item back
sequence. DK's sourced heavy walking maximum is1.3246 native /6.623 world.
The acceleration/status formula, carry jump/landing/turn exits, speed-linked
motion rates and heavy-item armor threshold remain explicit source gaps. Native
cancel0 does not mean an immediate exit. Unit-rate carry drawing is an authored
adapter. Six existing authored weapon types retain their declared behavior;
heavy equipment requires an explicit trait.

The 18 existing heavy source proposals now link this contract. The other121
context proposals and canonical inventory were preserved. This evidence update
does not promote implementation, visual or running-match acceptance.
