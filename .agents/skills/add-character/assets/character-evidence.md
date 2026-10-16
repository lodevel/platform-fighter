# Character implementation evidence

Copy into the character's review directory. Replace bracketed fields with real
values, explicit non-applicability or a named unresolved task. For a focused
change include only affected rows and link the existing full inventory. For a
new fighter expand every applicable action/variant; grouped sample rows below
are instructions, not a completed inventory.

## Task and source selection

- Character ID/name: [runtime ID and display name]
- Requested scope: [full implementation / scoped fix / audit / handoff]
- Final Smash (Ultimate full kit): [included; named move, shared activation
  dependency and variants; or explicit user exclusion with its instruction]
- Pipeline: [UFD-based / original]
- UFD source fighter, game/version and page: [selection, or not applicable]
- SmashWiki fighter/technical pages: [selected game; checked actions; revision
  permalinks/captures; missing pages or sections and alternative sources]
- Appearance/style and inspected identity references: [choice and files]
- Reference form (custom UFD): [keep original / adapt selected proportions toward donor;
  selected attributes, target metrics/ratios and protected identity traits]
- Reference lineage: [original file/hash -> derivative/version and changed metrics;
  final selected reference, inspection status or deferred transformation brief]
- Fidelity: [custom UFD body with retargeted geometry / source replica / original;
  retained source mechanics; authored target dimensions; reach/vulnerability changes]
- Art schedule/provider: [generate now / deferred / existing only; preferred
  local ComfyUI or explicit alternative; provider selection does not end deferral]
- Sources checked: [URLs, dates, capture hashes/revisions]
- Unit/frame contract: [native-to-world conversion, canvas/root/body size,
  facing axes, 60 Hz step, source one-based versus runtime intervals]
- Shared gameplay systems affecting this kit: [reviewed profiles/consumers for
  hitlag, launch/hitstun, DI/SDI, input buffer, movement/landing and defense;
  selected-game evidence/formula revisions; existing verified support or gaps;
  separate presentation inspection and human-feel status]

## Coverage ledger

Use separate fields for provenance, implementation, art and runtime evidence.
Allowed provenance: `sourced`, `authored`, `approximate`, `missing`.
Implementation: `missing`, `partial`, `implemented`.
Visuals: `missing`, `planned`, `generated`, `inspected`, `runtime-accepted`, or
`not applicable` with a reason. Runtime: `not run`, `failed`, `passed` with a
linked observation. A passed check does not change approximate provenance.
Use a separate explicit exclusion with reason for a genuinely inapplicable row.
`sourced` identifies published evidence; also record its actual source and
whether it is independently corroborated. Wiki-sourced does not mean approximate,
native-data verified or runtime verified. Preserve unresolved disagreements.

| Field/action/variant | UFD observation | SmashWiki observation + revision | Primary/measurement evidence, when needed | Selected value, units and clock/condition | Agreement/conflict and disposition |
| --- | --- | --- | --- | --- | --- |
| [affected technical field; expand per-region where different] | [value or unavailable] | [value or unavailable] | [capture/observation or not checked] | [value + runtime conversion, or unresolved] | [corroborated / single source / explained clock difference / unresolved conflict; rationale] |

| Action/variant or parameter ID | Source/native value or authored target | Conversion/adaptation | Provenance | Code/route | Implementation | Visuals/clip | Runtime expected vs measured/evidence | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [one actual action/variant/parameter] | [value + URL or design rationale] | [formula/choice] | [status] | [consumer] | [status] | [status + clip] | [status + result/artifact] | [specific task or none] |

Reconcile the ledger against: ground/air movement; jumps/landing; defense and
ledge/getup options; actual jab structure; tilts/smashes/dash; five aerials and
their branches; specials and resources; grabs/pummel/throws; spawned entities;
character-specific command/transform/stance mechanics; applicable existing
pickup interactions. Record source entries that require engine support as
missing, not inapplicable. Include applicable actions absent from the UFD page
using other researched evidence or mark them unresolved.

## Anatomy and equipment

UFD pipeline: transcribe the selected source fighter's equipment and behavior
from its data/animations; do not treat these as user design choices. Original
pipeline: record authored decisions. Custom UFD bodies use target anatomy and
adapted collision volumes by default; preserve source equipment behavior and
move/vulnerability timing. Record geometry adaptations and any separately
requested behavior changes; missing source facts remain research gaps.

Anatomy/contact parts: [target body plan, dimensions and attacking/vulnerable parts]
Source-to-target mapping: [source part/region -> target part; absent/new parts and roles]
Target geometry: [pose/frame -> part anchors, supported shapes, dimensions,
margin, vulnerability status; separate source records and authored target data]
Geometry differences: [source vs target body/reach envelopes; changed spacing,
contact offsets and vulnerability coverage; measured consequences or pending]
Movement collider: [target size/ground offset; separate from animated hurtboxes]
Intrinsic equipment: [actual objects or explicitly none]

| Object ID and category | Dimensions and attachment/grip/hand | States and transition events | Rendering owner/layer | Attack/vulnerability/defense/cosmetic role | Source/design and runtime evidence |
| --- | --- | --- | --- | --- | --- |
| [real object; no dummy entry for an unarmed fighter] | [values or not applicable] | [held/stowed/swapped/released/etc.] | [body drawing / attachment / entity per state] | [independent roles and active conditions] | [evidence] |

Use weapon/grip fields only for present equipment. Track temporary pickups and
released objects separately from the intrinsic kit. Body parts are anatomy, not
automatically detachable weapons. Visibility alone assigns no collision role.

## Pickup weapon and item compatibility

Use [weapon/item coverage](../references/weapon-compatibility.md) for full
creation/completion; for a scoped fix, include only affected contexts and link
the existing inventory. Derive items from the current catalog and requested
scope. Expand rows per item and applicable action/context; shared clips/profile
evidence can be linked without duplicating the source record.

Catalog/spec checkpoint: [paths/revisions; supported items, requested pending
items and explicit shared engine gaps; active roster/item-switch scope]
Fighter item profile: [pickup/release/back-turn frames, catch/toss parameters,
source/design and runtime consumers; missing or unqualified fallback fields]
Parameter-to-code review: [native key/value/capture -> conversion -> selected
constant/consumer; missing data vs missing native algorithm; rationale for
remaining adapters/calibrations and coordinator review]
Independent attachment coverage: [fighter/clip/pose, inspected native/art anchor,
root/scale/facing transform and measured result; missing samples/fallback rows]

| Item / action / context | Input, facing and state contract | Clip/clock and body/grip/join/muzzle registration | Source/design and implementation/visual status | Exact-build expected vs measured match evidence | Remaining gap or justified non-applicability |
| --- | --- | --- | --- | --- | --- |
| [actual item and ground/air/moving/variant action] | [classification, entry direction vs session aim, resources/cancels] | [pose-specific anchors, transforms and release event] | [independent provenance and acceptance] | [turn/fire, moving composition, charge status, contact, ownership/exit checks as applicable] | [concrete task or none] |

## Per-action specification

Repeat this block for each action/variant, or link equally explicit existing
data. These are authoring fields; they are not automatically runtime schema.

Action ID and parent/variant: [stable identifier]
Source recognition cues (UFD): [distinctive motion/rhythm/strike sequence/behavior;
source frames and target poses; comparison result, differences or unverified]
Source record/version or authored design: [URL/record/rationale]
Optional gameplay footage, when used (otherwise omit): [URL + inspected
timestamps/capture indices; actual move/variant/branch observations;
version/camera/editing limits; presentation evidence versus qualified mechanics]
Legal entry: [ground/air/held/ledge/etc.; action state; resource requirement]
Contact and equipment state: [actual attacking limb/object; each relevant object's
held/stowed/absent/etc. state; hand occupancy; renderer and release/catch events]
Input: [attack/special/grab/etc.; edge/hold/release; axes; flick/history;
facing and diagonal rule; buffer eligibility and expiry]
Duration/exit: [separate attack/contact end, powered-motion end, animation end,
action lockout/first actionable condition, helpless fall exit and landing lag;
finite frame or explicit event for each, clock and source; unknown stays unknown]
Transitions: [charge point/release; follow-up window and input; landing,
autocancel, hit/rebound, resource changes; state on each exit]

Movement/state contract: [link or the phase table below; simple actions may cite
a reviewed shared ordinary-physics profile and why it applies; explicit non-
applicability replaces omission. Use the skill's move-behavior procedure]
Entry velocity: [per-axis set/add/carry/clamp; treatment of jump/launch momentum
and buffered jump/jumpsquat; source/design, conversion and runtime consumer]

| Phase/clock and entry condition | Vertical motion | Horizontal motion/control | Exit or cancel/interrupt -> next state | Resources and override cleanup | Mechanism, numeric and boundary provenance / consumer |
| --- | --- | --- | --- | --- | --- |
| [actual phase; gameplay/animation/event clock and supported mapping] | [gravity, fall/ascent cap, fastfall rule and interval] | [input, acceleration, speed target/cap, friction/neutral momentum, facing rule] | [independent motion/attack exits; allowed cancel and external interrupt conditions; resulting velocity/state] | [consume/refund/reset and restoration of ordinary physics] | [separate evidence/unknowns/calibration for each; live code path or missing support] |

Attempted other inputs: [allowed cancel window; steering-only/ignored/buffered
actions and buffer expiry; unknown rules; never assume any button stops the move]
Distinctive behavior gaps: [missing required motion/control/exit mechanism,
separate from small numerical approximations and deliberately authored changes]

| Active inclusive source/game frames | Runtime interval | Region IDs/priority and shape | Damage/launch/masks | Strike group/re-hit | Provenance |
| --- | --- | --- | --- | --- | --- |
| [s-e or explicit event] | [consumer convention] | [numeric record + transform] | [values/source] | [identity/rule] | [sourced/approximate/authored] |

Source overlay interpretation (UFD): [asset/indices; visualization mode or unknown;
legend URL; art/effects vs attack vs hurtbox identification and supporting
evidence; documented/visually inferred/unresolved; occluded boundaries and
observed art-to-collision offsets; original and cleaned-guide paths, or not applicable]
Empty active gaps: [ranges; no collision in these intervals]
Hurtboxes/intangibility/invincibility: [target body part/shape/size per pose/frame,
source-to-target mapping, vulnerability status/interval, transform,
candidate-contact coverage and provenance; do not conflate these concepts]
Protection/interaction contract: [whole body versus named parts; separate
intangibility, invincibility and armor intervals/conditions; armor threshold if
applicable; damage/hitlag/launch outcome; normal restoration; runtime consumer
and boundary checks. Also record applicable jostle, ledge-grab, reflection,
absorption, re-hit and ground/air mask rules, or explicit unresolved support]
Spawned events: [frame/event, entity, attachment/release anchor, cleanup]

| Pose key | Inclusive gameplay hold or event | Source capture/index and observed frame label | Drawing/body/weapon guide | Contact/gap/branch | Clip/cell and consumer |
| --- | --- | --- | --- | --- | --- |
| [key] | [range/event] | [inspected mapping or authored] | [guide file + anchors] | [group/condition] | [actual route or pending task] |

Mapping ambiguities: [missing/duplicate source frames, timing conflicts, actions]
Runtime support required: [specific schema/selection/serialization/Lab task]
Acceptance scenarios: [input before/at/after openings; active edges/gaps; both
facings; contact/miss; charge/landing/resource branches as applicable; for motion,
full trajectory from fall/used jumps/real launch, steering, phase boundaries,
freeze/resume, legal and blocked cancels, interruptions and exit/reset cleanup]

## Art production and integration

Identity reference and motion reference roles: [separate files/URLs]
Source capture/extraction manifest and frame mapping: [paths]
Shared root/body/weapon metrics and guide files: [paths/values]
Deferred handoff, if requested: [brief; complete vs pending source inspections]
Generation record: [actual provider, graph/model versions, reference hashes,
settings/seeds, job IDs, output locations, attempts, inspection results]
LoRA decision: [undecided/deferred / none with evidence / style / target identity / both; author/source,
file/hash, compatible base variant, loader, trigger words, supported strengths,
application order and pilot result; availability is not visual acceptance]
Packing: [actual input dimensions/alpha; uniform scale, roots, cell size/order]
Packed-art quality: [clean-art direction; accepted roster comparator; visible
body bounds and pixels/world unit; actual final idle/contact/detail inspection
at 1:1 and intended display scale on light/dark backgrounds; source, packed and
in-game acceptance recorded separately; unresolved defects]
Runtime registration: [manifest, clip routes, pose selector, render metrics,
save/load consumers, spawned visuals]
Installed assets: [shipping paths, or none; distinguish generated from accepted]
Failures: [actual service/quality/integration error, affected rows, next action]

## Specialist handoff and lessons

For delegated work, record owners, shared-file/queue boundaries and the evidence
brief each specialist received. Link the existing learning log, if any.

| Problem and evidence | Change / actual result and evidence | Applicability and tested tool profile | Lesson state / skill change |
| --- | --- | --- | --- |
| [demonstrated failure or useful observation] | [specific correction; measured or actually inspected outcome] | [fighter/game/subsystem; provider/tool/model/version/hash; LoRA stack or none; graph/processing profile link; unknowns; qualification for current profile] | [observed / pilot-validated / promoted / superseded; relevant skill file or no promotion] |

Keep this separate from move completion. Record failed experiments and promote
only evidence-backed guidance through the coordinator's review.
Retain old-profile evidence when tools change. Tool-specific acceptance does not
transfer to a new provider/model/LoRA without checking affected behavior there.

## Verification

| Layer | Command or scenario | Expected vs measured / result | Artifact and affected rows |
| --- | --- | --- | --- |
| Types/schema/behavior | [command] | [outcome] | [log/rows] |
| Real physics/collision | [scenario] | [measurement] | [report/rows] |
| Pose/collision inspection | [frames and facings] | [agreement/deviation] | [images/rows] |
| Lab/save-load/match | [scenario] | [outcome] | [report] |
| Production build | [command] | [outcome/build ID] | [asset] |
| Browser/input/visuals | [scenario] | [outcome/page errors] | [report/images] |

Build loaded by browser: [identity and how checked]
Tolerances: [quantity, tolerance and integrator/source rationale]
Input evidence: [keyboard / physical gamepad / simulated gamepad / injected probe]
Human controller feel: [tested findings or not tested]
Motion comparison: [independent source/design expectation and provenance,
conversion/tolerance, measured local trajectory and control/exits; keep local
execution verified separately from pending source-parity measurement]

## Final reconciliation

Applicable inventory count: [number]
Implemented / accepted visual / runtime-verified counts: [separate counts]
Excluded rows and reasons: [explicit]
Approximations: [scope and explanation; not an exact-parity claim]
Missing or unverified rows: [specific remaining work]
Delivery claim: [complete for requested scope / partial / handoff complete]

For a full fighter, any missing required implementation, accepted visual or
runtime observation makes delivery partial. Completion of preparation does
not mean completion of generated art or gameplay verification.
