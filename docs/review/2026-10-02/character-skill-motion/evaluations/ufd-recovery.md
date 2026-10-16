# Custom gorilla: aerial Spinning Kong recovery handoff

## Task and source selection

- **Scope:** only `custom_gorilla.up_special` airborne variant and its recovery/exit dependencies; prepare behavior, implementation and acceptance instructions. Grounded Spinning Kong and the rest of the kit are outside this audit.
- **Pipeline/fidelity:** UFD-based, Ultimate Donkey Kong, recognizably the donor's mechanics performed by a custom gorilla. Keep the custom form; no reference image, body metrics or approved pose adaptation was supplied. Art generation remains deferred (local ComfyUI preference is not authorization to generate).
- **Source/version:** supplied captures inspected on 2026-10-02; their game patch, capture date, upstream revision and vanilla/mod status are unknown. Live [DK UFD](https://ultimateframedata.com/donkey_kong), [stats](https://ultimateframedata.com/stats) and [legend](https://ultimateframedata.com/smash) checked on that date. UFD exposes no patch label here. Hashes identify the supplied files, not their game version.
- **Unit/frame contract:** 60 Hz proposed fixed-step timeline; UFD inclusive gameplay frames `[s,e]` become elapsed `[s-1,e)`. ACMD markers are a separate motion clock. Native bone axes are y-up/z-forward; propose target x-forward/y-down, with a single facing mirror. Native-to-world scale `K`, runtime velocity units and target root/body/canvas dimensions require confirmation; no numeric conversion is established.
- **Restrictions observed:** no completed DK recovery record or actual project DK implementation inspected; no canonical code/skill edits, generated assets or runtime tests performed.

## Coverage ledger

| Action/parameter | Evidence / intended behavior | Provenance | Implementation | Visuals | Runtime | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- |
| Airborne entry | Init resets kinetic energies, initializes gravity speed from a move parameter, restores captured summed horizontal speed into control | Sourced mechanism; numeric values missing | Prototype partial | Planned; uninspected | Not run | Typed reconstruction, parameter dump, legal input/resource rules |
| Powered recovery physics | Move-specific gravity setup and control acceleration/stable/limit speed | Sourced mechanism; numeric values/boundaries missing | Defining overrides missing from prototype | Planned | Not run | Phase update helper, caps, steering/neutral/reversal/fastfall rules |
| Initial/repeated/final contact | UFD damage 5/1/2; separate gameplay windows below; script has corresponding records | Sourced records; cross-clock correspondence unresolved | Prototype only declares a generic active envelope | Planned | Not run | Explicit contacts, native launch algorithms, target geometry and clock reconciliation |
| Gravity restoration | Script sets `YACL_DEFAULT` at motion 68 | Flag event sourced; effect and gameplay boundary missing | Missing | Planned | Not run | Consumer of flag and mapping; cannot use final hit as cutoff |
| Motion end / helpless fall | Main loop changes air state to `FALL_SPECIAL` when motion ends | Sourced mechanism; motion end number missing | Missing from provided prototype specification | Planned | Not run | Motion metadata, common special-fall behavior and allowed exits |
| Landing / ledge / cancellations | UFD landing lag 38; cliff check and cancel-enabled checks in main loop | Sourced checks; conditions incomplete | Missing/unverified | Planned | Not run | Situation-change helper, cliff flag consumer, cancel-enable timing, landing/reset rules |

The prototype has startup 3, active 40, recovery 20, rise impulse -6 and drift impulse 3.5, then ordinary character physics. These are **local prototype values**, with no source parity established. The impulse-only model omits defining recovery behavior; the guessed 20 recovery frames cannot become the motion end or first actionable time.

## Per-action specification

**Action:** `custom_gorilla.up_special.air`, aerial variant of up special. Source contact parts are body/root for the opening and left/right arms for repeated hits and the finisher. No weapon or detached damaging object appears in the supplied action; hand/grip/weapon anchors are not applicable. Map source torso/arms to target torso/arms and author body-fit hurtboxes separately from the stage movement collider. Source numeric bone offsets are retained evidence, not usable target offsets without posed transforms and target proportions.

**Legal entry/input:** plan an airborne up-special command through the existing match special dispatcher, only from a legal actionable state after hitstun. Exact analog/diagonal selection, edge/hold/buffer rules, B-reverse/facing behavior and recovery resource rules are missing from these captures; inspect input/status/common primary evidence before finalizing. Do not consume a normal jump or add mashing-based lift merely because this is a recovery.

**Duration/exit:** last UFD contact is gameplay 43; total is `--` (unknown). Contact end, powered physics end, gravity restoration, animation end, first actionable condition and special-fall duration are independent. Main-loop evidence establishes an aerial motion-end transition to special fall; it does not give an end frame. Special fall should be event-ended under the researched landing/ledge/interruption rules, with no invented fixed airborne recovery timeout.

| Phase / clock | Vertical motion | Horizontal motion/control | Exit, resources and cleanup | Evidence / intended consumer |
| --- | --- | --- | --- | --- |
| Entry, status event | Replace gravity-energy vertical speed with parameter-derived start speed; do not simply add lift to retained launch velocity | Capture summed main `vx` before kinetic reset; assign it to control after reset; no sourced fixed forward drift impulse | Resolve prior launch/jump buffers and legal resources; one entry initialization | `SpecialHi_init`: group `0x1086bc4a93` (hash matches `param_special_hi`); start-y key `0x95c50e8ad`; live up-special state + shared physics coordinator |
| Powered air motion, source boundaries unresolved | Reset/enable gravity energy, set acceleration using `air_accel_y` (`0xba18057d9`) and special key `0x90c41c7e4`; reconstruct arithmetic before naming a formula; terminal/ascent caps and fastfall unknown | FALL_ADJUST control reset; acceleration multiplier from `0x90e584afd`; stable/limit speed from `0xd8d488877`; additive acceleration explicitly zero at init; input-response/neutral braking/facing still require energy/common logic | Attack windows advance independently. Landing/situation change calls `FUN_7100013690`; continued updates call `FUN_7100014540`, neither supplied | Mechanism sourced; all loaded numeric values missing. Special state must own overrides and avoid ordinary rise/fall shaping stacking |
| Default-y-acceleration event | `YACL_DEFAULT` on at raw motion 68; proposed phase transition only after inspecting its consumer | Preserve sourced control until its own exit; do not assume this event restores horizontal physics | Attack clear and motion-rate restoration occur here; no evidence this is animation end or action availability | Flag/event sourced; its effect and gameplay boundary missing; explicit state transition in shared physics |
| Motion end -> special fall | Gravity and terminal speed from researched special-fall/common rules; cleanup obsolete powered overrides exactly once | Special-fall drift rules require source evidence; ordinary drift cannot be assumed | Main loop: air -> `FALL_SPECIAL`; ground -> `WAIT`. Landing/ledge/hit/KO exits need common status evidence and resource resets | Motion-end mechanism sourced; metadata/end frame and fall behavior missing; dedicated committed fall state |

**Attempted other inputs:** steering is distinct from cancelling. Main loop checks common transitions only when `CancelModule` enables cancellation; supplied evidence gives no enable window. Gate voluntary actions on researched windows; test attack, jump, dodge and repeated special presses as ignored/buffered/allowed according to that contract. Do not grant arbitrary buttons permission to terminate spin or helplessness. Hit/capture, ceiling/wall contact, landing, ledge and KO need explicit destination/momentum/cleanup rules; these are unresolved source rules, not verified current behavior. UFD's 38 landing frames do not by themselves establish whether an early powered landing switches motion, enters special landing immediately or follows another branch.

## Contacts, vulnerability and motion mapping

- **UFD gameplay windows:** `4–6 / 10–12 / 13–14 / 15–17 / 18–19 / 20–21 / 22–24 / 25–26 / 27–29 / 30–31 / 32–33 / 34–36 / 37–38 / 39–43`. Runtime intervals: `[3,6) / [9,12) / [12,14) / [14,17) / [17,19) / [19,21) / [21,24) / [24,26) / [26,29) / [29,31) / [31,33) / [33,36) / [36,38) / [38,43)`. No contacts on gameplay 1–3 or 7–9; none after 43 in this UFD record. The middle windows are contiguous but retain strike boundaries; never create a fresh strike every integration substep.
- **Raw ACMD clock:** initial attacks `[4,7)`, rate 0.6 at 7, arm XLU at 12, twelve recreated attack sets `[12+4n,16+4n)` for `n=0..11`, arm status normal and finisher at 60, clear plus `YACL_DEFAULT` plus rate 1 at 68. `GROUND_MOT_FRAME` starts enabled; `CLIFF_CHECK` is set at 16,20,…,60. These motion events cannot be relabeled as UFD gameplay frames.
- **Native contact records:** initial two `top` regions: 5 damage, angle 85, KBG 10/FKB 0/BKB 50, radius 7.7 at `(0,12,-7)` and `(0,12,4)`. Repeated/final four arm regions: radius 5 at `(6,0,0)` and radius 3.7 at `(-4,0,0)` on each arm; repeated 1 damage, angle 367, KBG 20/FKB 0/BKB 55; final 2 damage, angle 361, KBG 80/FKB 0/BKB 72. All use ground/air masks. Preserve regional priority and attack clear/recreate identity; source 361/367 are native launch algorithms, not literal degree values.
- **Vulnerability:** the normalized supplied entry and live UFD state arm intangibility on gameplay 10–38. Script establishes XLU on raw motion `[12,60)`. Preserve both records until clocks/version agree; this is arm intangibility, not whole-body invincibility or armour. Target hurtboxes must follow posed arms and respect their resolved vulnerability intervals.
- **Clock conflict:** if initial motion rate were 1 and there were no external changes/hitlag, rate 0.6 would imply `t(m)=7+(m-7)/0.6`: motion 12 ≈15.33, 60 ≈95.33, 68 ≈108.67 elapsed frames. This conditional inference disagrees with UFD's later contact windows; it is not an accepted mapping or a proposed duration. Obtain main/substatus logic, motion rates/metadata and matching revision, then verify gameplay timing independently.
- **Visual reference:** actual linked asset is [DonkeyKongSpinningKongA.gif](https://ultimateframedata.com/hitboxes/donkey_kong/DonkeyKongSpinningKongA.gif). The browser exposed its URL but could not display the GIF. No download, extraction, source index/gameplay mapping, overlay interpretation or pose inspection was completed. Legend colors alone cannot identify this asset's overlays.

## Implementation and remaining research

Implement a phase-owned aerial recovery state with parameterized entry velocity, special gravity and steerable control, distinct contact identities and an explicit special-fall destination. Inspect schema/dispatch/pre-post physics hooks before selecting fields; retain the prototype only as documented incomplete data. Proposed consumers from the skill's integration map, **not inspected runtime capabilities**, are `Character.ts`, special/move schemas, `stepCharacterPhysics.ts`, `attackHitWindows.ts`, collision shapes/damage delivery, pose driver, serializer/factory/Lab and match construction. Snapshot phase/clocks/overrides for deterministic resume; freeze correctly during pause/hitlag; clear each override on every researched exit. No unsnapshotted persistent gravity flag or new parallel engine.

Required research before a final implementation specification:

1. Pin game patch/upstream revision and reconstruct missing decompiler operators; capture actual `param_special_hi` values and relevant kinetic/common special-fall parameters. UFD ordinary gravity 0.085, air speed 1.208 and air acceleration 0.01+0.05 describe ordinary movement, **not** substitutes for special parameters.
2. Acquire `FUN_7100014540`, `FUN_7100013690`, main/substatus/end logic and common landing/cliff/cancel/resource consumers. Establish gravity-default effect, motion end, ground-change behavior, fastfall/steering/facing/cancel windows and override cleanup. The two attempted pinned upstream script/motion-list pages were unavailable through browsing; local captures remain the evidence inspected.
3. Obtain matching motion metadata and independently measured source gameplay trajectory/control; reconcile rate and UFD contacts, including hitlag and integer frame scheduling. Do not infer animation length from raw final script command or final contact.
4. For the deferred visual handoff, download/composite/extract and inspect the linked GIF, map startup/opening/repeated strikes/finisher/recovery/special-fall/landing branches, then author source-to-target pose/contact guides. Body/root scale, canvas, limb lengths, anchors and ordered pose holds remain missing; no explicitly chosen authored choreography replaces source inspection.

## Acceptance scope and reconciliation

Record independently sourced expected frame/position/velocity/resource/state versus measured local values, source conversion and tolerances justified by source measurement/integration. A trajectory that merely matches chosen calibration constants proves local execution, not Ultimate parity.

| Acceptance group | Required observations | Current result |
| --- | --- | --- |
| Useful recovery | Neutral air, real descending fall, used normal jumps, and a real attack launch after hitstun; full rise/travel/velocity samples through powered end and special fall, not only entry impulse | Not run |
| Control / clocks | Neutral, held and reversed direction, analog magnitudes and both facings; samples before/at/after each gravity/control/attack/end boundary; attempted fastfall/mashing; pause/hitlag including connecting-hit release and supported subdivided integration | Not run; source expectations partly missing |
| Contacts / anatomy | Each first/last window, gap and regional priority; one hit per intended strike and real multihit connection/miss; extended-arm hurtbox delivery outside movement collider, vacated-space misses, intangibility edges and both facings | Not run; target geometry/art deferred |
| Exits / resources | Powered landing and special-fall landing separately; cliff eligibility, blocked/allowed cancels at window edges, hit/capture/ceiling/wall/KO/reset; no leaked overrides, spurious jump consumption or resource refunds | Not run; rules pending research |
| Runtime delivery | Meaningful focused behavior/schema/serialization checks; direct Lab save/load and saved fighter in a match; production build and browser against that exact build; real keyboard/gamepad event path and overlapping direction/jump bindings | Not run; physical controller feel untested |

**Delivery claim:** the bounded evidence brief is delivered. The implementation/acceptance handoff is **partial**, because essential numerical physics, phase boundaries, exit/input/resource rules and clock reconciliation remain unresolved. Deferred source/pose/anchor preparation is also partial; art generation, installed visuals and match acceptance remain deferred/unrun. There is no full-fighter or exact-parity claim.

## Supplied artifact identity (SHA-256)

- `ufd-entry.json`: `C197F6B2B56E5AA899842CF26B839651FF2E99071722BBFD65E239456D8B9588`
- `prototype.json`: `417EA7C095D3C21F598A4FA67A2E044099E78243F37F7F2534479C0DBA45F24D`
- `dk-SpecialHi-init.c`: `FEC684480BE3861E411C60E44E6AAAC26271AA0E2EF35621037AB8B3BB4AE047`
- `dk-SpecialHi-main-loop.c`: `B43D33D0E69AFD746C6671EB110BF60A4A8380BC469E1D324154737F67247896`
- `dk-SpecialAirHi.txt`: `A6F1267150ADD578D200EAB170523F1C1D60B8F551B0DF07CC702780B68BE62E`
