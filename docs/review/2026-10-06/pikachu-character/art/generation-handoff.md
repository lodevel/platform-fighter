# Pikachu generation lessons and handoff

This records experience from the existing local ComfyUI runs. These are observed
results for this recipe, not a claim that its settings are globally optimal.
The art agent owns further generation, actual image review, and packing.

## Tested tool scope

These generation findings apply to local **ComfyUI**, model
`z_image_turbo_int8_convrot.safetensors`, encoder
`qwen_3_4b_fp8_mixed.safetensors` with loader type`lumina2`, VAE`ae.safetensors`,
and patch`Z-Image-Turbo-Fun-Controlnet-Union.safetensors` through
`ZImageFunControlnet`. The tested stack uses **no LoRA**, colored pose seeds,
latent noise masks and `ImageCompositeMasked`; cutout uses magenta keycc498c,
tolerance28 and no despill. These filenames are observed graph selections, not
proof of model hashes or undocumented version equivalence. See
[the tested profile](generation-tool-profile.json) for graph hashes and unknowns.

Changing provider, model, LoRA or conditioning makes affected prompt/correction
techniques unqualified on the new stack until a representative pilot passes.
Preserve these historical results; adapt instructions to the new tool's actual
capabilities. Fixed world roots and actual inspection remain delivery requirements,
while exact sampling settings, masks and cutout method are tool-specific.

## Conditioning and prompts

- Exact native pose seeds and ControlNet guides carry the motion. Describe the
  visible pose and preserve its silhouette, part positions, occlusion, scale and
  root; do not ask the model to invent the animation from the attack name.
- Keep the accepted outlined cartoon identity and seed palette. Specify one
  attached lightning tail, black ear tips, short mouse limbs, and face markings
  only on the visible face. A back view must not acquire visible eyes.
- Describe the actual striking part. Tail sweep and head-first lunge prompts
  explicitly rule out an invented arm strike or kick.
- Body drawings exclude cloud, bolt, electrical burst, labels, collision circles,
  ground shadows and weapons. Special effects belong to separate runtime layers.
- The working graph uses 8 Euler/simple steps, CFG1, denoise0.65, ControlNet
  strength1, seed2026100601 and no LoRA. Preserve it as the qualified baseline;
  changing settings or using tiled generation requires a reviewed pilot.

## Corrections that actually worked

- Dash-attack attempts changed red cheeks to brown despite plausible anatomy.
  Attempt2 protected the inspected red seed pixels by excluding them from the
  render/composite mask, with an explicit red-versus-brown prompt. Those outputs
  passed actual review. Prompt wording alone is not a reliable color lock.
- Down-air landing and back-air roll produced an eye-like oval nose with a white
  highlight. A bounded nose-only seed/guide/mask correction plus “small solid
  black triangular nose, no white highlight” resolved the third-eye appearance.
  Existing eyes and all pixels outside the patch remained unchanged.
- Preserve rejected outputs and create a new numbered attempt. Inspect the
  revised input and actual result; never silently repaint an accepted final.
- Thunder needed extra canvas clearance for its tall tail. Add512px top padding
  to the1536px-high source canvas, producing2048x2048 with root1024,1664. Body
  scale and world root stay unchanged. Do not shrink or recenter to fit.

## Review and packing

- Compare the actual generated cutout with its reviewed seed/guide on both light
  and dark backgrounds. Inspect eyes/nose/cheeks, occluded limbs/ears, attached
  tail, clipping, alpha fringe and source pose fidelity.
- Mechanical checks complement inspection: canvas/root, bounds, unchanged
  pixels outside the mask, protected cheek pixels and connected components.
  Render success and a passing script do not constitute visual acceptance.
- Keep each strip's root and uniform scale. Normal512x384/root256,288 and
  Thunder512x512/root256,416 need distinct metadata. Other already reviewed
  strips also have distinct canvases; never infer origin from a universal size.
- Rough body-art approval is separate from collision, timing, FX and actual
  production-match approval. Record visible limitations rather than hiding them.
- A proposed four-pose tile workflow is experimental until every actual pilot
  cell is inspected for identity, preserved pose/root, detail and cross-cell
  contamination. Reduced submission count alone does not qualify the workflow.

## Queue operation

- One GPU submission at a time. Do not clear an occupied queue. The renderer
  persists workflow hashes, prompt IDs, history and output hashes.
- Resume observing an existing prompt after interruption. An ambiguous submit or
  timeout requires queue/history reconciliation before another submission.
- Concurrent ledger rewrites caused a partial-JSON read in the Thunder waiter.
  Its bounded retry now waits without counting a prerequisite or submitting a
  duplicate. Avoid competing ledger writers; preserve review states on refresh.

## Evidence

- `normal-pilot-preparation.json`: exact prompts, conditioning and corrections.
- `normal-generation-ledger.json`: rejected dash-attack originals and accepted
  protected-cheek attempts; back-air nose correction attempts.
- `normal-down-air-landing-turn-source12-attempt1.review.json` and
  `normal-down-air-landing-turn-source12-attempt2.review.json`: nose failure,
  bounded correction, unchanged-pixel checks and actual acceptance limits.
- `thunder-pilot-preparation.json` and `thunder-body-pilot-output-review.json`:
  padded registration and inspected pilot with unchanged protected cheek pixels.
- `tools/pikachu-art-render.mjs` and `tools/pikachu-thunder-pilot-render.mjs`:
  durable submission/observation, hashes, serial queue and partial-read handling.
