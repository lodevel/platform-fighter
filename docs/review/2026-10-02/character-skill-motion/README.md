# Character skill: move physics and state exits

Installed on 2026-10-02 following the user's request to prevent the DK recovery
oversight from recurring. The active entrypoint is
[add-character/SKILL.md](../../../../.agents/skills/add-character/SKILL.md).
Five files changed; the existing appearance, body-retargeting, equipment,
generation and provider workflows remain in the skill.

## Requirements added

- Each relevant action/variant records entry velocity, per-phase gravity and
  steering, clocks and exits, allowed cancels, external interruptions, resources,
  cleanup and runtime consumers. Simple actions may cite a reviewed shared
  motion profile instead of duplicating it.
- Attack/contact end, powered-motion end, animation end, action availability,
  helpless fall and landing lag have separate evidence. Missing UFD values stay
  unknown; the final hit cannot establish a gravity cutoff or total spin time.
- Source mechanism, numeric parameters and phase boundaries have separate
  provenance. Working local calibrations retain their approximate status.
- Relevant acceptance covers useful recovery after jumps and real knockback,
  steering, phase edges, hitlag release, interruptions, allowed/blocked cancels,
  landing/resources and saved data in an actual match.

The detailed procedure is
[references/move-behavior.md](../../../../.agents/skills/add-character/references/move-behavior.md).
The core entrypoint, source-coverage reference, integration/verification reference
and character evidence template require and route to those checks. Intentional
original designs and already authorized approximations remain supported.

## Validation

- The skill-creator `quick_validate.py` passed on the candidate and installed
  skill using the existing WSL Python environment.
- All 45 local Markdown links, including section anchors, resolve.
- The installed five files exactly match the independently evaluated candidate.
- Original line endings were preserved; the five-file patch passed
  `git apply --check` before installation.
- [UFD recovery walkthrough](evaluations/ufd-recovery.md): an independent agent
  received the skill, a one-shot prototype, UFD entry and raw status/attack
  captures. It identified missing defining physics, kept parameter/timing gaps
  unresolved, separated powered motion from helpless fall, and declined an
  unsupported exact-parity/completion claim.
- [Original recovery walkthrough](evaluations/original-recovery.md): a separate
  agent received an authored glide with a Jump-button cancel. It retained that
  cancel without inventing a UFD donor, separated finite glide from helplessness,
  and kept runtime/art acceptance unverified.

These walkthroughs validate the instructions' observed decisions, not flawless
future execution or source parity of any implemented fighter. DK's exact
gravity cutoff and aerial motion total remain explicit research/calibration
gaps in [its recovery record](../donkeykong-recovery/README.md).

Review artifacts: [five-file patch](skill-update.patch) and
[prepared skill snapshot](prepared-skill/SKILL.md). The canonical project skill
was installed successfully after the user confirmed write access; these are
review copies, not alternative active skill installations.
