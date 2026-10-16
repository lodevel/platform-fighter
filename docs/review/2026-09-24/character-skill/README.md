# Character skill verification

Updated the canonical [add-character skill](../../../../.agents/skills/add-character/SKILL.md)
on 2026-09-24. This change concerns the authoring workflow and a reference-image
extraction helper; it does not implement or certify a new playable fighter.

## Delivered behavior

- Explicit UFD-based source-fighter selection and a separate original/mixed-kit
  pipeline; custom appearance remains separate from source gameplay identity.
- Complete applicable action/variant inventory, input conditions, motion-frame
  mapping, shared pose/collision coordinates and evidence templates.
- Preferred local ComfyUI workflow with identity bootstrap, real reference
  conditioning, model/node capability checks, recoverable jobs and bounded
  quality corrections. Existing generation deferrals remain effective.
- Lossless composited GIF extraction, source provenance and paginated contact
  sheets. Source indices/delays are preserved without inferred gameplay timing.
- Runtime consumer, actual contact, direct Lab/save-load and exact production
  build acceptance requirements, with distinct partial/handoff/full delivery.

## Checks performed

The installed skill passed the skill-creator `quick_validate.py` format check.
All 26 local Markdown links resolved. The existing legacy skill entry still
points to the canonical skill. All 12 installed package files were compared by
hash with the reviewed staged files before final verification.

```powershell
python -B -m unittest discover -s .agents/skills/add-character/scripts -p 'test_*.py' -v
```

All eight tests passed. They exercise real synthetic GIF patches, compositing,
disposal-to-background and restore-previous behavior, stored and absent delays,
null gameplay mappings, pagination, existing-output preservation, malformed
inputs, cleanup of newly created failed output and CLI error reporting.

The installed extractor also successfully processed two downloaded UFD assets
in temporary directories, removed after the check:

| Source | Canvas | Extracted images | Contact sheets | SHA-256 |
| --- | --- | --- | --- | --- |
| [Link up tilt](https://ultimateframedata.com/hitboxes/link/LinkUTilt.gif) | 845 x 702 | 35 | 3 | `0742b2fa44ea66123f2e68db8426384b8129d3a3e73d2feec95b2b7ab9f82964` |
| [Link forward air](https://ultimateframedata.com/hitboxes/link/LinkFAir.gif) | 705 x 549 | 50 | 4 | `228dc86564f5b5778983ed89bfe02ad8a52f21d0eec4212a2a5fcea98c46cdb3` |

Each emitted PNG was accounted for and every gameplay-frame mapping remained
null. This verifies extraction, not pose interpretation or native-frame parity.
The test environment used Python 3.10 and Pillow 12.0.0. The format validator
ran in WSL because the Windows interpreter lacks PyYAML.

## Independent scenario execution

Two fresh agents followed the staged skill in read-only scenarios. They received
the requests and available evidence without expected answers. Together they
covered:

| Request/situation | Observed decision |
| --- | --- |
| New UFD-based armored fox with no selected donor | Ask for the source fighter; do not infer Fox from appearance or choose Link by convenience. |
| Original gravity-glove fighter, generation deferred | Author the full mechanics/animation brief without assigning a donor or invoking generation. |
| Audit only Link forward-air artwork | Remain scoped; distinguish existing repeated art from the two collision windows; do not claim fresh match verification. |
| Custom robot using Link, 50 GIF images versus 51 move frames | Preserve source dimensions and deferral; keep frame mapping unresolved and preparation partial until inspected. |
| ComfyUI client timeout with an existing prompt ID | Reconcile the existing job; do not blindly resubmit or claim successful assets. |
| Tests pass but throws lack sprites and extended-limb contact is untested | Report partial delivery and enumerate missing visual/runtime evidence. |

The source-dimension constraint in these historical cases was superseded by the
custom-body clarification below. It is no longer the default for custom fighters.

The review exposed ambiguity about custom proportions, new-identity reference
bootstrap, deferred pilot execution and handoff completion. These were corrected.
The agents re-read the installed package and found no remaining blocker in the
affected scenarios.

## Limits

No generator or ComfyUI server was invoked. A complete fighter has not yet been
produced using this revised workflow, and its installed model compatibility and
end-to-end art quality remain to be demonstrated during character work. These
checks improve reliability; they do not establish that a skill or future model
execution is flawless. Application tests/builds were not rerun for this skill-only
change; the executable extraction helper received its own meaningful tests.

## LoRA workflow clarification

The same-day follow-up added explicit selection of style/target-identity LoRAs
or a documented no-LoRA workflow. It requires model-family/variant and loader
compatibility, actual graph application, controlled pilot checks, and recorded
weights/hashes/triggers/strengths/order. A validated target-identity LoRA may
supply identity control without a runtime reference-image adapter; inspected
identity references and pose guides still remain necessary. Deferred decisions
can be recorded as undecided without triggering generation.

An independent read-only review exercised incompatible SDXL weights for the
current Z-Image graph, a Link identity LoRA offered for a custom robot, and a
compatible target-identity LoRA with a successful pilot. All three followed the
intended selection rules. The review's ambiguous "no adapter" wording was
corrected to "no LoRA". The three installed documentation files were hash-checked;
local links were rechecked. No model availability, actual LoRA loading or render
quality was claimed, and no server/model installation/generation was performed.

## Optional equipment and anatomy clarification

Added an explicit anatomy/equipment inventory and per-action contact, equipment
state, rendering-owner and collision-role contract. Weapon-specific fields are
conditional; natural attack anatomy does not require dummy weapon assets.
Held/stowed objects remain tracked during body attacks. Release/catch handoffs
must avoid accidental duplicate rendering and preserve actual entity rules.

Independent read-only review covered an unarmed claw/body fighter, a sword
owner's kick with the sword stowed, a thrown/returning object, and an otherwise
unarmed fighter carrying a temporary pickup. A broad "weapon fields are not
applicable during an unarmed move" statement was narrowed to weapon attack
anchors; carried/stowed equipment still needs attachment and visibility data.
All six installed documentation files matched staged hashes; all 28 local
Markdown links resolved and the skill frontmatter was unchanged. No gameplay
or sprite-generation claim is made by these documentation checks.

The subsequent source-inheritance clarification makes equipment inventory,
per-move use, state transitions and collision roles facts to extract from the
selected fighter in UFD mode. They are authored choices only in the original
pipeline, or explicit user-requested adaptations. A read-only review identified
two phrases that could invite unsolicited redesign; both were corrected.
Rendering representation remains an implementation choice preserving source
behavior. Five installed files matched staged hashes; all 28 local links resolved.

## UFD overlay interpretation clarification

Added a required per-asset overlay identification before collision tracing or
pose-guide preparation. The procedure distinguishes artwork/effects, attack
regions and body-following hurtbox displays; records visualization mode and
interpretation evidence; and preserves unresolved or obscured boundaries.
Observed alignment guides shared pose/collision coordinates without implying
pixel-exact silhouette geometry. Cleanup must not carry debug volumes into art.

Rechecked the [UFD Smash legend](https://ultimateframedata.com/smash) and extracted
the currently linked Link up-tilt GIF. Inspected source indices 0-15 on the first
contact sheet and index 7 at full size: pale rounded body overlays persist while
red sword-swing regions appear and extend beyond the blade. These are source
indices, not a newly verified gameplay-frame mapping. The legend does not
explicitly define normal white hurtboxes; the skill requires recording the basis
for that interpretation instead of imposing a universal color rule.

An independent agent reviewed the four documentation diffs and found no concrete
unsupported claim or contradiction. The skill format validator passed, all 30
local Markdown links resolved (including new section anchors), and installed
files matched reviewed hashes. Temporary extraction/staging files were removed.
No collision code, sprites or generation setup changed; no gameplay verification
is claimed by this documentation correction.

## Custom body proportions and animated hurtboxes

The user clarified that a custom fighter borrowing a UFD kit must use collision
volumes fitted to its own body, even when its proportions differ from the donor.
Removed the previous default source-dimension lock across eight skill files.
UFD still supplies move rules/timing, damage/launch, movement parameters,
equipment behavior and vulnerability states; custom target anatomy supplies
posed hurtbox volumes and retargeted contact geometry. Record changed reach,
body coverage and spacing consequences without claiming identical balance.
Source proportions remain the target for a replica/source-size reskin.

The shared procedure now records target body metrics, source-to-target part
mapping, per-pose hurtboxes, separately retargeted attacks, and source-versus-target
geometry. It distinguishes consistent target design from generator drift, keeps
stage movement collision separate, and requires actual limb-contact/retraction,
both-facing, vulnerability-boundary and save/load acceptance. This requested
geometry adaptation requires no additional design approval.

An independent read-only review exercised a stocky short-armed Link-derived
fighter, an exact Link replica, and a long-limbed custom fighter. It identified
one remaining broad "explicit deviation" rule; that was narrowed to equipment
behavior changes. The staged format validator passed and 33 local Markdown links
resolved. All eight installed files matched reviewed hashes. No character code,
artwork, generator or match behavior was changed or newly verified by this update.

## Recognizable borrowed moveset

The user's "copied homework" comparison now defines the custom UFD fidelity
target: the donor remains recognizable through its actions and execution on
the target body. Added per-action motion/rhythm/strike-sequence cues to source
review, pose instructions, generation pilot and runtime comparison. Recognition
requires reviewed evidence; matching names/timing alone is insufficient, and
different target proportions remain expected. An independent read-only criteria
review supported this distinction. The format validator passed, 34 local links
resolved, and six installed documentation files matched staged hashes. No art or
runtime behavior changed.

## Optional reference-form adaptation

Added a custom-UFD appearance choice: keep the original form by default, or
adapt selected reference proportions toward the donor before locking the pack.
The transformation brief identifies permitted metric changes and protected
identity traits. Originals remain intact; the selected derivative/version drives
identity conditioning, pose guides and collision. Later reference changes mark
affected art/geometry/acceptance stale. An initial identity can incorporate the
chosen form directly; generation deferral still applies.

An independent review covered the default, selective fitting, deferral, a change
after the pilot, and bootstrap without an existing image. Its ambiguous
"If none exists" finding was corrected to name the missing identity reference.
The staged validator passed, 37 local links resolved, and seven installed files
matched staged hashes. This adds a workflow option; no reference image or gameplay
was changed.
