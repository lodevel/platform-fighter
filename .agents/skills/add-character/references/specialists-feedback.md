# Specialists and evidence-based feedback

Read for delegated character work or when retaining a demonstrated lesson from
this workflow. The coordinator keeps the full task context and stays available
to the user; it need not personally generate or inspect every drawing.

## Choose ownership around the actual work

Use available agent slots and task complexity, rather than a fixed team size.
Useful assignments are:

| Specialty | Owns | Produces |
| --- | --- | --- |
| Source and mechanics | Technical contracts, conditions, exact fields and discrepancies | Pinned evidence, chosen clocks/units and unresolved boundaries |
| Art and motion | Pose inputs, generation queue, corrections, actual image inspection and packing | Reviewed inputs/outputs, registration metadata and per-action visual evidence |
| Runtime and integration | Live consumers, identity/factory, schemas, saved data, Lab and production match | Implemented routes and measured gameplay/input evidence |

Combine specialties for small tasks; split complex mechanics from integration
when independent ownership makes progress easier. Share existing reviewed source
contracts instead of having each agent repeat the research. A specialist can
perform its own actual visual inspection; use a separate reviewer for a disputed
result or consequential workflow change when useful, rather than requiring all
routine inspection to pass through the coordinator.

Assign exclusive owners to shared runtime files and to the GPU queue/job ledger.
Other agents send concrete patches or dependency requests to the owner. Separate
leaf files can proceed in parallel. Coordinate schema, serialization and runtime
consumer changes together; an agent's private fixture is not an integrated kit.
Honor session delegation limits. If agents are unavailable, apply the same
ownership and evidence distinctions sequentially without blocking the task.

## Brief agents with useful experience

Before assigning work, find the current character record and relevant earlier
lessons. A full-history fork does not replace a concise, explicit handoff. Send:

- Scope, current user choices, fidelity target and applicable inventory rows.
- Owned files/resources, shared dependencies and who resolves conflicts.
- Evidence paths, accepted assets, active job/build identities and known gaps.
- Proven techniques and failed approaches, with the actual supporting records.
- Required deliverables and acceptance checks; identify experimental techniques.

Pass relevant experience, not every historical log. Art agents need inspected
reference/pose conditioning, masks, root/scale, cutout and correction findings.
Mechanics agents need game/version, source conflicts and clock conventions.
Integration agents need real consumers, per-clip render metrics and saved-data
contracts. Preserve task-specific settings in the character record; do not turn
one successful fighter recipe into universal model or engine defaults.

The coordinator reads the returned artifacts, checks claims against scope and
dependencies, and resolves missing evidence. It does not upgrade acceptance from
an agent's summary alone. It can ask the specialist to inspect a missing actual
image or run a missing production scenario while continuing coordination.
For sourced numerical changes, review the affected
[parameter-to-consumer mapping](source-coverage.md#parameter-to-consumer-gate-before-calibration)
before accepting an authored replacement or a claim that values are unavailable.
For attachment acceptance, require independent grip/root evidence per affected
fighter/clip; matching two consumers of the same fallback is insufficient.

When a live progress view consumes the character record, update its explicit
per-action milestones and required-gap fields at each qualified checkpoint.
Keep source fidelity limitations separate from missing implementation or failed
acceptance. Derive counters from those fields rather than parsing status prose or
treating generated art counts as completed actions. An action-count percentage
does not estimate remaining time; preserve build-specific evidence underneath it.

## Record experience during the task

At natural batch/checkpoint boundaries, specialists report a short lesson when
something changes how the next work should proceed. Append it to the existing
character record or linked learning log; avoid a competing coverage inventory.

Each useful record contains:

- Observed problem and affected action/workflow, with an artifact or measurement.
- Change made, including relevant controlled comparison or unchanged conditions.
- Actual result and evidence, including remaining limitations.
- Applicability: fighter, model/graph, source game, runtime subsystem or general
  workflow; distinguish a measured fact from a plausible explanation.
- Tool scope: provider/backend, tool/node versions, model/checkpoint and encoders,
  LoRA/adapter stack (or explicit `none`), conditioning and relevant processing
  settings. Link a reproducible profile instead of repeating it; mark unknown
  versions/hashes unknown. For non-art lessons record the relevant tool/runtime.
- State: `observed`, `pilot-validated`, `promoted`, or `superseded`.

Rendering successfully is not validation. Record unsuccessful corrections too.
Unknown causes stay unknown. A time-saving method needs quality/behavior evidence
as well as throughput before it replaces the existing procedure.

## Select lessons for the current tools

Classify guidance as a workflow/acceptance requirement, a technique tested on a
named tool profile, or a portability hypothesis. Root registration and actual
inspection remain requirements across providers; exact prompts, LoRA strengths,
node graphs, sampler recipes and cutout parameters depend on their tested stack.
A technique observed with no LoRA is not evidence for a newly added LoRA.

Before reusing tool-specific instructions, compare their recorded profile with
the current backend/model/LoRA/conditioning/postprocessing. A provider switch,
model replacement, LoRA addition/removal/strength change, or material graph change
makes the affected technique unqualified for the new profile. Keep its original
evidence valid for its original scope; do not erase history or automatically mark
it superseded merely because another tool is now selected.

Brief the agent with matching lessons and identify unmatched lessons as candidate
experiments. Inspect current capabilities and qualify a representative pilot
within the existing task budget before expanding a batch. Do not issue ComfyUI
node/API instructions to another provider or assume it supports masked composite
conditioning. Record the new outcome under its own profile, including regressions.
Qualification for one profile does not certify another. Recheck only affected
guidance; a tool change does not require repeating unrelated source research.

## Improve the local skill without accumulating guesses

Use this feedback loop during authorized character work: record experience
automatically, then have the coordinator review evidence before reusing or
promoting it. Apply narrow, demonstrated improvements to this local skill's
relevant guidance when they are within the user's scope. If skill files cannot
be edited, retain the proposed change and evidence in the handoff.

Promote only a lesson that changes a useful decision, has an observed successful
outcome or reliably demonstrated failure, and states where and on which tools it
applies. Preserve that scope beside the instruction when promoting it. Rewrite
or replace stale guidance rather than adding another universal rule for each
incident. Put conditional detail in the existing relevant reference; keep
character-specific prompts/settings in character evidence. Experimental ideas
stay there until their pilot is inspected/measured. Do not advertise an optimum
without comparison, or infer generality from one fighter or model.

For a promoted lesson, retain its evidence link and scope in the character log,
record the skill files changed, and brief affected agents before they reuse it.
Validate frontmatter and local links for skill-only changes; run meaningful
checks if a helper changes. If later evidence contradicts a lesson, mark it
superseded, revise the guidance and notify agents using it.

This loop does not relax completion gates, change provenance or retry budgets,
authorize unrelated engine changes, install models, or alter other skills or
session policies. Continue the fighter work while capturing lessons; producing
a better skill is not completion of the character. Report material improvements
and their practical limits to the user.
