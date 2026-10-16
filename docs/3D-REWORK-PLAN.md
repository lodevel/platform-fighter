# 3D Rework Plan

Updated: 2026-09-09
Branch: `rework/3d-link`

Status: **Deferred by the user on 2026-09-09.** Finish the existing mechanics
rework first on `rework/gameplay`; see [Project Roadmap](PROJECT-ROADMAP.md).
The proposal below is retained for a later renderer experiment. No 3D setup or
generation should begin as part of the current gameplay work.

## Direction

Use real 3D characters and environments with movement on a 2D fighting plane.
Keep deterministic simulation timing and reuse the existing combat rules where
feasible. Renderer selection is open until a small integration experiment
establishes how much of the Phaser/Matter scene coupling must change.

The user's current visual reference is Link's latest runtime art. Preserve its
readable silhouette, saturated colors, dimensional shading, and character detail
while improving consistency and motion. The reference is not a finished target.

Source assets inspected:

- `assets/characters/link/animations/idle.png`
- `assets/characters/link/animations/jab.png`
- `assets/characters/link/frames.json`
- `assets/gen/link-clips-hd.json`

These are rendered sprite strips and a generation specification. No existing
rigged 3D Link asset was found in the project. The old Wolf reference and the
earlier 4-5-head cartoon proportion rule do not define this branch's target.

## Local Asset Workflow

Avoid a required Meshy account or other paid generation service. Start with
Blender for model preparation, equipment, rigging, animation, and export. Script
repeatable operations so the user does not need to perform routine modeling
steps. Detailed character cleanup and convincing combat animation remain work
to evaluate; neither image generation nor a static mesh completes a fighter.

The first local image-to-3D candidate is
[TripoSR](https://github.com/VAST-AI-Research/TripoSR). Its official repository
documents MIT code and weights, about 6 GB VRAM at default single-image settings,
and optional baked textures. Its
[inference script](https://github.com/VAST-AI-Research/TripoSR/blob/main/run.py)
supports GLB export and a chunk-size control for memory use. This makes it a
reasonable compatibility experiment, not a guarantee of the required art quality.

If that mesh is unsuitable, use scripted Blender construction or evaluate a
different local model against the same reference. Do not lower the visual target
to accept the first generated result. TripoSG is a possible later geometry
experiment, but its [model card](https://huggingface.co/VAST-AI/TripoSG) calls for
more than 8 GB VRAM; it is not the default for this laptop.

Local operation avoids generation-service charges. Setup, storage, GPU time,
and asset preparation still have a cost in time and resources.

## Verified Environment

Checked on 2026-09-09:

- GPU: NVIDIA GeForce RTX 4070 Laptop GPU, 8,188 MiB VRAM.
- NVIDIA driver: 581.83.
- Ubuntu WSL2 is installed and running.
- Windows Python: `C:/Python310/python.exe`.
- Blender was not found on PATH or in the checked standard Windows installation
  folders; a WSL or nonstandard installation has not been ruled out.
- No local 3D generation environment has been installed or validated for this
  branch. CUDA/PyTorch compatibility and actual peak VRAM remain to be tested.
- Historical references to a 5070 Ti must not guide this machine's setup.

## First Deliverable

One Link-reference fighter, one simple 3D platform, and a small playable test.

1. Prepare a neutral full-body reference with visible, separated limbs. Use
   current art for appearance, not an attack pose as the reconstruction input.
   Separate sword and shield from the body; resolve cape construction explicitly
   so equipment and cloth do not become fused limb geometry.
2. Set up Blender and an isolated local generation environment. Run one low
   memory reconstruction and record command, model revision, runtime, peak VRAM,
   source image, and output paths.
3. Inspect front, side, and back views. Check face, hands, silhouette, equipment,
   mesh defects, and whether textures contain unwanted baked highlights.
4. Prepare the mesh for a skeleton, attach equipment to named sockets, and
   validate shoulder, elbow, hip, and knee deformation before making many clips.
5. Author idle, run, jump, and one attack. Use controlled cape motion initially;
   defer cloth simulation until animation and gameplay alignment are proven.
6. Display the rigged model on a simple lit 3D platform. Evaluate a 3D renderer
   alongside the existing simulation before selecting a migration architecture.
7. Drive the displayed pose from simulation action and frame. Keep hitbox and
   collision authority in gameplay data; animation must not silently alter move
   timing or damage. Check foot placement, facing, weapon reach, and camera fit.
8. Review the animated result at gameplay distance against the existing Link
   reference. Expand the roster and stage work only after that test is convincing.

## Verification And Handoff

- Preserve the uncommitted combat/editor baseline carried onto this branch.
- Finish the Slice D full-suite, build, browser, and replay/AI checks recorded in
  `PROJECT-ROADMAP.md` before treating the gameplay baseline as validated.
- Model-only work needs asset inspection and an import/animation smoke test.
  Runtime changes additionally need typecheck, relevant tests, build, browser
  checks, and deterministic replay checks where gameplay timing is affected.
- Inspect desktop and narrow viewport behavior before promoting the prototype.
- Keep source model files and export recipes reproducible. Record downloaded
  model versions and terms; keep large model weights outside Git.
- Update this document after each experiment with actual results. Distinguish
  planned capabilities from successful local runs.

Current state: proposal recorded and deferred. Active work moved to
`rework/gameplay`, preserving local edits. No tool installations, 3D generation,
or runtime migration have been performed for this proposal.
