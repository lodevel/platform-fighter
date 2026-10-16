# Move behavior: motion, control and state exits

Read before choosing schemas or implementing a move that changes movement,
control, resources or recovery state. Use for both pipelines: UFD work researches
the source behavior; original work authors it explicitly. Apply only relevant
actions and checks for a targeted task.

## Establish a movement and state contract

Every applicable action/ground-air variant links to a contract in the character
evidence record. Simple actions can reference a reviewed shared profile such as
ordinary aerial drift. State why that profile applies. Omitted fields do not mean
ordinary physics, zero acceleration, no cancellation or infinite duration.

For actions with their own behavior, record:

| Concern | Required information |
| --- | --- |
| Entry | Legal state/input; initial velocity per axis: set, add, carry or clamp; treatment of pre-existing jump/launch momentum and jump buffers |
| Phases and clocks | Each powered, stalled, traveling, attacking, recovery or helpless phase that exists; gameplay or animation clock, motion-rate mapping, entry and exit condition |
| Vertical motion | Gravity magnitude/multiplier, terminal fall speed, ascent cap if any, fastfall permission, and exactly when each override starts/stops |
| Horizontal motion | Input accepted during each phase; acceleration/speed target or cap, friction, neutral momentum, reversal and whether steering changes facing |
| Timeline ownership | Independent attack windows, pose intervals, movement duration, animation end, action lockout, landing lag and first actionable condition |
| Voluntary cancels | Permitted button/state/resource/window, next state and velocity/resource consequences; unsupported or unknown inputs and buffer behavior |
| External interruptions | Applicable hit/capture, landing, ceiling/wall, ledge and KO/respawn rules; next state, retained momentum and override cleanup |
| Resources | Jump/recovery use, charge/ammunition consumption, refunds and reset conditions; recovery is not automatically another regular jump |
| Provenance and support | Evidence separately for mechanism, each numeric parameter and each phase boundary; conversion; runtime consumers or missing capability |

Do not use a move name or an existing fighter's schema as its specification.
Inspect the chosen source's characteristic behavior first, then reuse or extend
the runtime shape needed to represent it. A recovery that has lift and air
control cannot be completed by registering a damaging attack with a guessed
impulse. A stationary move must explicitly identify its motion/control policy.

## Research sourced behavior

1. Inspect UFD's entry, notes, stats and linked animation. Separate combat data
   and ordinary character movement from the move's specific overrides.
2. Inspect the selected game's SmashWiki technical move page: timing/parameter
   tables and notes may supply per-phase movement, landing/ledge rules, protection
   windows and interaction conditions absent from the UFD summary. Use the
   [joint source procedure](ufd-smashwiki.md); record published values as wiki
   evidence, with phase/clock and units, rather than guessing an ordinary-physics
   fallback. A parameter value does not alone establish its update algorithm.
3. For remaining rules or disagreements, inspect appropriate pinned primary evidence: attack/event
   scripts, status/state logic, motion metadata and parameter records, or
   reproducible source-game footage/measurements. An attack script may expose a
   flag while state code supplies its effect; neither alone necessarily supplies
   the numeric parameter or its gameplay-frame boundary. Record game/version,
   exact file/revision and the relevant evidence.
4. Give mechanism, numbers and phase boundaries separate provenance. A status
   script using a gravity parameter establishes an algorithm, not the parameter's
   value. Secondary numerical evidence must be labeled and its uncertainty kept;
   do not describe it as supplied by UFD or a captured vanilla parameter dump.
5. Reconcile clocks before using an event's frame. Do not equate raw motion
   frames, GIF image indices/delays and 60 Hz gameplay steps. A verified
   piecewise motion-rate mapping or independent gameplay measurement is needed
   for a sourced boundary. Follow [source coverage](source-coverage.md) and
   [UFD frame mapping](ufd-motion.md#establish-the-motion-to-gameplay-mapping).
6. Leave missing values/conditions explicit. Research them or use a calibration
   only within the task's established authorization and fidelity target. Record
   its rationale, affected phase and unresolved comparison. Do not call defining
   behavior absent from the implementation a small numerical approximation.

A UFD `--` total does not mean zero or "spin until landing." A last hit does not
establish movement end, gravity restoration, animation end or action availability.
Powered recovery may have finite motion followed by an event-ended helpless fall.
Document both states and their transition; do not conflate the fall's duration
with the attack/spin duration. Equally, do not make a sourced hold/loop finite
merely because the schema requires a total. Extend the event/hold behavior.

"Do something to stop it" must resolve to an explicit cancel or interruption
rule. Steering, voluntary cancel, buffered action, landing and damage are
different outcomes. Check which inputs actually cancel, in which phase, and what
state follows. Do not allow arbitrary attack/jump/dodge inputs to cancel a
recovery or terminate helplessness without evidence or an authored adaptation.

A GIF without stable world/camera references or recorded input cannot establish
exact world travel, gravity or steerability from pose changes. Preserve it as
qualitative pose/contact evidence. GIF partial image rectangles are compression;
composite them before inspection, rather than treating them as proof that motion
measurement is impossible. See [UFD extraction](ufd-motion.md).

## Integrate the contract

Assign each phase's motion/control to an actual runtime consumer. Keep ordinary
gravity, per-fighter rise/fall shaping, special gravity and retained launch
velocity distinct; stacking them can erase the intended lift. Use the same
fixed-step physics coordinator as matches (`stepCharacterPhysics.ts`). Inspect
input processing, move dispatch, pre/post-integration hooks and hitlag release.

Keep overrides owned by live move/state data, represented in snapshots as
needed for deterministic replay. Clear or transition them on every applicable
exit; do not leave a persistent unsnapshotted gravity flag behind. Check both
normal and subdivided integration when the shared engine supports accelerated
reference launches. Preserve the contract through serialization, factory/Lab
overrides and actual match construction. Other fighters retain their existing
behavior unless a shared fix requires an intentional change.

## Verify the behavior

Select the scenarios applicable to the contract; do not fabricate irrelevant
branches. Full creation accounts for each relevant scenario. A scoped task checks
its affected behavior and shared dependencies.

- **Entry and useful recovery:** start from neutral air and a real descending
  fall; for recovery, also spend normal jumps and recover after a real sourced
  launch/hitstun. Measure rise, horizontal travel and velocity over time, beyond
  the first upward impulse. Verify regular jump/recovery resources are retained
  or consumed as specified.
- **Movement phases:** sample immediately before/at/after each evidenced
  gravity/control boundary, powered-motion end and first actionable condition.
  Compare pose/contact phases as well as movement. Report unresolved boundaries
  as unresolved even if the chosen local timing works.
- **Live control:** test neutral, held and reversed direction, both facings,
  ground/air variants, and fastfall or mashing where supported. Verify whether
  control changes travel, facing, duration or hit sequence. Unsupported mashing
  is not a default recovery feature.
- **Freeze and resume:** hitlag/pause must preserve the required clocks and
  motion. Connecting-hit release must not add ordinary rise/fall shaping on
  top of special gravity or duplicate an impulse. Check supported shared-physics
  subdivisions and that the move receives the intended dose per gameplay step.
- **Exits and attempted cancels:** exercise supported landing/ledge, damage/
  capture and KO/reset paths, plus contact interruptions where applicable.
  Check allowed cancels at both window edges and representative prohibited
  button presses; record ignored/buffered inputs. Distinguish powered-move end
  from continued helplessness. Check cleanup, landing lag and resource resets.
- **Actual input and saved data:** use the real keyboard/gamepad route for input
  claims, including overlapping direction/jump bindings. Verify new nested motion
  fields survive save/load and affect the fighter used in a match.

For UFD work, write the expected source observation/parameter, provenance,
conversion, justified tolerance and measured local result before claiming parity.
A check against the same move constant, a formula based only on chosen constants,
or successful lift in our engine proves a local behavior, not a source match.
If source-game measurement is unavailable, report local behavior as verified and
the source comparison as pending; do not upgrade an approximation because tests
or a production probe pass. For original work, compare with the authored contract.

Evidence records should include trajectories or selected frame samples and the
exact build used. Reference code paths and calibrated constants may change;
recheck them instead of copying numbers from a prior fighter or this procedure.
