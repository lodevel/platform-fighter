# Character asset system: proposal

2026-10-16. Requested outcome: coherent character creation and loading without
multi-gigabyte memory costs per fighter. This document proposes the contract and
migration; its numerical limits are **pilot targets, not implemented policy**.
The accompanying audit measures installed assets. No drawings, resolution,
timing, collision or runtime loading behavior were changed for this proposal.

The [Character System Overhaul roadmap](CHARACTER-SYSTEM-ROADMAP.md) defines the
separate future workstream: a portable package and standalone lab, with the
current illustrated appearance as its reference. This document remains the
memory baseline and candidate budget proposal; its migration sequence is input
to that roadmap, not a commitment to a sprite-only or 3D architecture. Its agreed
direction makes reuse an explicit authoring step and lets character packages
choose and gradually replace visual representations behind a shared interface.

## What costs memory today

The installed PNGs are decoded into images, and textures upload as they are used.
For our current RGBA8 textures with mipmaps disabled:

```text
page payload = actual PNG width × actual PNG height × 4 bytes
fighter payload = sum of its unique physical page payloads
```

PNG compression saves download/disk space; it does not reduce this texture
payload. The general Three.js example includes a mipmap allowance, which does
not apply to our current sprite configuration. See the
[Three.js texture memory explanation](https://threejs.org/manual/pages/textures.html#memory-usage).

The [installed baseline](review/2026-10-16/character-memory-system/baseline.json)
uses actual PNG headers and current runtime manifest keys:

| Fighter | Action sheets | Drawing slots | PNG file size | RGBA8 page payload |
| --- | ---: | ---: | ---: | ---: |
| Donkey Kong | 216 | 1,720 | 80.76 MiB | 681.95 MiB |
| Pikachu | 202 | 1,308 | 21.79 MiB | 194.65 MiB |
| Link | 227 | 1,754 | 48.12 MiB | 275.41 MiB |

MiB means 1,048,576 bytes. Drawing slots count URL/crop identities, not
pixel-proven unique artwork. These banks have one runtime key per sheet URL.
Logical frame canvases include trimmed-away space; multiplying those dimensions
by drawing counts would overstate the installed payload, especially for Pikachu.

Together the three banks contain 1,152.01 MiB of RGBA8 pages. The runtime retains
decoded `ImageBitmap` sources; full GPU upload can add another logical copy.
Budgeting both gives approximately 2.25 GiB for these three banks combined,
before other assets and overhead. This is a planning allowance, **not a measured
physical allocation or evidence that every fighter uses 2 GiB**. Integrated GPU
sharing, browser storage and driver behavior require separate measurement.

The runtime findings are in
[TextureStore](../port/src/engine/sprites/textureStore.ts),
[match preload](../port/src/match/preloadMatchArt.ts),
[match screen](../port/src/ui/screens/match.ts) and
[menu snapshots](../port/src/engine/sprites/spriteSnapshot.ts):

- All selected fighters' sheets are decoded before the match. The 64 MiB GPU
  warming allowance covers selected startup sheets; it is not a residency cap.
- Other sheets upload on first draw. Current diagnostics count loaded-image
  payload and loading preparation; they do not measure actual total GPU memory.
- Returning to menus leaves the fighter banks retained until another match's
  preload evicts them. Menu snapshots also have a separate persistent store.
- Players choosing the same fighter share its bank. Current palette recoloring
  and facing changes do not require new copies of its drawings.

## Drawing count is an authoring parameter

Simulation duration, drawing count and playback cadence are separate. A 60-tick
action can select a small set of drawings with deliberate holds while movement,
hitboxes, damage and release events continue on their exact gameplay timelines.
The budget counts **distinct stored drawings**, not the number of rendered frames.

For equal-size drawings, halving their count roughly halves their pixel cost.
Halving both image dimensions roughly quarters it. For example, 1,200 uncompressed
drawings occupying 256 × 256 pixels each cost 300 MiB; at 128 × 128 they cost
75 MiB, before page padding. This arithmetic is not a recommendation to halve
existing art: screen-size quality must establish the export resolution.

Most current actions are already sparse: the median sheet contains 6 drawings
for DK, 5 for Pikachu and 6 for Link. A blanket count reduction would harm many
ordinary actions while missing much of the cost:

| Concentration | Drawings per sheet | RGBA8 payload | Share of fighter |
| --- | ---: | ---: | ---: |
| DK's six main Final performer sheets | 32–74 | 285.98 MiB | 41.9% |
| Pikachu's seven main Final performer sheets | 7–42 | 82.62 MiB | 42.4% |
| Link's two Final performer sheets | 57–72 | 23.65 MiB | 8.6% |

DK's largest sheet alone is 4096 × 5080 pixels, or 79.38 MiB. Link's 72-drawing
Final sheet is 12.71 MiB: similar counts can have very different costs. Crop
rectangles already occupy about 82–90% of total atlas area across these banks,
so tighter packing alone cannot deliver the required reduction.

For new authoring, use these **starting ranges for review**, never a universal
hard cap or a rule to retrofit existing actions automatically:

| Action family | Initial drawing allocation | What determines extra drawings |
| --- | --- | --- |
| Idle, walk or run loop | 4–8 per cycle | Gait contacts, silhouette changes and loop seam |
| Short simple attack | 4–8 | Anticipation, contact, follow-through and recovery |
| Large attack or throw | 6–12 | Arc readability, release and recovery |
| Special | 6–16 per meaningful phase | Distinct hits, travel, branching and spawned objects |
| Long Final or cinematic | Allocate per phase and total bytes | Motion landmarks, duration, actual framing and approved visual cadence |

Each action records its desired count, protected sample times, chosen drawings,
hold durations, estimated cropped area, projected bytes and final packed cost.
Long motion should be divided into meaningful authored phases for planning;
that division does not itself save memory or make streaming safe.

Protect active-window boundaries, each distinct contact, catch/release, equipment
state change, branch and recovery/loop landmarks. Add intermediate poses where
motion needs them. Reuse a drawing only when its pose is appropriate at both
times; events and collision remain independently timed. A budget conflict is
reported for review rather than silently deleting protected samples.

The existing [key-pose planner](../tools/key-pose-plan.py) can drop active-window
ends to fit its historical cap of 12. Replace that behavior before using it as
the general policy. Preserve prior accepted motion when evaluating changes;
Link's denser Final work must not be undone just to satisfy a default count.

## One package from authoring through runtime

Maintain one versioned character specification. Extend the current action
inventory and metadata rather than introducing a second competing move list.
The package connects these layers:

| Layer | Authoritative information |
| --- | --- |
| Gameplay | Action identity, conditions, timings, movement, collisions and events |
| Motion schedule | Native sample/time, drawing identity, holds, loops and protected landmarks |
| Logical drawing | Source provenance, logical canvas, root, equipment sockets and collision references |
| Shipping resources | Page identity/hash, pixel rectangle, format, dimensions, mip policy and bytes |
| Dependencies | Required fighter, opponent/item/rules context, and menu/entry/match/results lifetime |
| Evidence | Source coverage, implementation, visual acceptance, runtime checks and budget report |

Keep high-resolution masters outside the shipped runtime bank. Establish export
density from the fighter's visible body height at the supported viewport,
maximum gameplay zoom and effective device pixel ratio. The renderer currently
caps DPR at 2; candidate art must be reviewed at the supported extremes. An
extended weapon or stretched pose can increase canvas extent without changing
body scale. Roots, sockets and collision transforms must remain coherent.

Use stable drawing identifiers independent of packed page coordinates. The
compiler should trim, share verified identical resources and produce deterministic
pages, runtime mappings and reports. Prefer pages at most 2048 × 2048 pixels
(16 MiB RGBA8), with appropriate gutters for the selected filtering. Packing
across actions should group compatible lifetimes; otherwise one tiny dependency
can keep an unrelated large page resident. Smaller pages bound individual loads
but do not reduce a bank's total bytes by themselves.

Cost reports show both action-attributed bytes and exact unique physical-page
totals. Shared pages and padding must reconcile without double counting. A
repeated reference is free only if the runtime actually shares the underlying
resource in that renderer/context. Separate WebGL contexts need separate GPU
allocations even when their source URLs match.

## Proposed desktop envelope to validate

| Scope | Proposed allocation |
| --- | --- |
| Complete playable bank, one unique fighter | 64 MiB RGBA8 target; 128 MiB ceiling |
| Retained decoded fighter sources | Up to the same 128 MiB modeled payload |
| Four different fighters | At most 512 MiB texture payload plus 512 MiB retained decoded payload |
| Shared stage, items, effects and UI | Separate 128 MiB allocation per pool |
| Decodes in flight | 32 MiB admitted output-payload allowance, alongside a worker limit |
| One action | Review above 8 MiB; any exception must fit the bank ceiling |

With retained PNG sources, a ceiling-size fighter budgets approximately 256 MiB
across the two pools. Four such fighters plus shared assets budget 1.25 GiB
combined payload, before transient allocations, render targets, browser, audio,
simulation and driver overhead. The 32 MiB decode allowance bounds known output
sizes, not native codec scratch or physical process memory. Measure those peaks
on the reference PC/Edge setup before assigning a total physical-memory gate.

These values are a proposed starting envelope. Getting DK under 128 MiB requires
over 5× reduction from today's bank. Even removing all six large Final sheets
would leave roughly 396 MiB. A representative density/motion pilot must show
whether the envelope and desired appearance can coexist before the numerical
policy is adopted or a full conversion begins.

The uncompressed fallback must fit. GPU compression can provide additional
savings after its quality and device-support gates pass. The
[Link compression pilots](review/2026-10-15/user-bugs/link/ktx2-pilot/RECOMMENDATION.md)
failed the existing quality criteria; no production compressed bank or loader
currently establishes those savings. Changing PNG compression settings cannot
solve decoded/GPU residency.

## Loading and ownership contract

1. Menus use small dedicated portraits with a bounded cache. Charge menu canvases,
   source images and any extra WebGL context to the shared allowance.
2. Before a match, resolve unique fighter resources plus stage, enabled items,
   opponent-dependent victim poses and effects. Unknown dependencies remain
   included until their exclusion is proven. Check both the resource union and
   transition peak against the budget; four identical fighters share one bank.
3. Decode and prepare all immediately reachable gameplay art before `READY`,
   using byte-based admission and cancellation. This full preparation follows
   bank reduction and validation; uploading today's huge banks all at once
   would worsen the existing peak.
4. Pin reachable gameplay resources for the match. Loading a new action on its
   first button press is not the default: it risks a missing pose or a stall.
   Stream a later phase only with a guaranteed preload deadline and measured
   worst-case completion; a rare Final is not automatically safe to stream.
5. Entry-only art may be released after entry only when it cannot recur on
   respawn or another branch. Results-only art loads at the transition. A resource
   spanning lifetimes stays alive until every owner releases it.
6. On menu exit from a match, release match ownership, dispose unused textures,
   close unused bitmaps and invalidate outstanding loads. A rematch cache must
   fit an explicit allocation; it cannot accumulate old banks between rosters.
7. Context restoration uses a reload/preparation barrier. Closing CPU bitmaps
   after successful upload is a possible later optimization, once restoration
   can recreate sources; simply closing them in the current design is unsafe.

GPU texture disposal and `ImageBitmap.close()` are separate responsibilities in
[Three.js](https://threejs.org/manual/pages/how-to-dispose-of-objects.html).
Use explicit byte accounting and bounded lifetimes; WebGL offers no portable
query for an application's available VRAM budget.
[MDN's WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
supports this distinction between estimated budgets and physical memory.

## Creation gates and implementation order

1. **Inventory and baseline:** record every applicable action, count, dimensions
   and physical cost before full-pack generation. The new read-only audit can be
   rerun with `node node_modules/tsx/dist/cli.mjs tools/character-memory-audit.ts
   --fighters donkeykong,pikachu,link --out .tmp/character-memory-system/current.json`.
2. **Visual pilot:** compare current art with candidate density and sample
   schedules for idle/run, quick attack, a wide attack, a multi-hit special,
   throw/item use and a costly DK Final phase. Review motion and stills at actual
   match size, maximum zoom and supported DPR, on light/dark backgrounds.
   Preserve master assets and current accepted art for comparison.
3. **Choose the profile:** establish the acceptable density and cadence, then
   reconcile the full action inventory with the proposed package/match budgets.
   Record actual projected savings, quality acceptance and any unresolved gap.
   If it cannot fit, evaluate a separate skeletal/model rendering pilot before
   committing to a full roster; that architecture is not implemented today.
4. **Compiler and budget checks:** produce canonical schedules and bounded pages,
   fail candidate validation on missing actions/landmarks or excess bytes, and
   report the largest contributors. Over-budget content must not silently ship
   at degraded quality. Wire the chosen profile into the add-character workflow
   after adoption; this proposal does not silently replace its existing rules.
5. **Runtime ownership:** implement dependency resolution, shared resources,
   menu portraits, byte admission, upload readiness, release and context recovery.
   Track loaded-source bytes, known uploaded payload, pending bytes and high-water
   marks separately; distinguish estimates from measured process/GPU usage.
6. **Migrate and verify:** convert one complete fighter first, then others.
   Check action/pose coverage, roots, sockets, collision alignment and unchanged
   gameplay timing. In the running game, exercise ordinary actions, Finals,
   captures, items and respawns; repeat menu/match/roster transitions, cancellation
   and context recovery. Require no missing poses, first-use upload stalls or
   retained-bank growth. Test four-player unique-resource combinations as the
   roster grows, including the uncompressed fallback.

Current delivery comprises this proposal, the audit tool and measured baseline.
Runtime changes, candidate art, visual approval and enforced limits remain the
implementation work described above.
