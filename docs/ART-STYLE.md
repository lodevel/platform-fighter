# Art Style Guide

**Locked direction (decided with the project owner): Brawlhalla-style clean 2D
cartoon — heroic athletic proportions, vibrant saturated palette. NOT pixel
art.** Every asset in the game (characters, stages, items, UI) follows this so
nothing looks like a collage.

## The look
- Clean, polished 2D cartoon / vector — like **Brawlhalla**: smooth bold shapes,
  strong dark outlines, dynamic athletic characters, comic-book energy.
- **Cel shading** + a subtle gradient for form (not heavy rendering, not flat-boring).
- **Strong silhouettes** — readability in fast play is the priority.
- **Vibrant, saturated, high-contrast** color.

## Characters
- **Heroic / athletic proportions, ~4–5 heads tall**, dynamic action poses.
- Consistent **bold dark outline** weight across the whole cast.
- Cel shading + a subtle gradient.
- Per-fighter **primary + accent color identity** — drives the 8-palette swap
  ladder (palette index 0 = the canonical colors).
- **Side view** (platform fighter), readable at gameplay distance.
- Transparent background, consistent scale + ground line across all frames of a clip.

## Backgrounds / stages
- Painterly-but-clean **vibrant environments with depth** — parallax layers
  (sky / midground / foreground), Brawlhalla-like.
- Slightly more atmospheric / lower-contrast than characters so the fighters pop,
  but still vibrant. Never compete with the action.

## Items / props / UI
- Same outline weight + saturation as characters. Bold, clean, readable. UI
  matches the cartoon energy (bold, saturated).

---

## Tooling — IMPORTANT pivot
Brawlhalla is **not pixel art**, so:
- **The pixel-art LoRA is set aside** (don't load it; PixelArt-Detector not
  needed). It stays installed for possible future use, but it's OFF for this style.
- Use the **Z-Image-Turbo base model** + strong cartoon/vector **style prompting**.
- If base prompting isn't clean/consistent enough, add a **cartoon / vector /
  cel-shading / comic LoRA** (SDXL has many; Z-Image's is growing).
- **Frame consistency** (the real hard part): fixed **seed** + **img2img** from a
  character reference, and optionally a per-character LoRA later.

## Canonical ComfyUI recipe
**Models:** `z_image_turbo_bf16` + `qwen_3_4b` + `ae.safetensors`.
**Settings:** steps **8**, CFG **~4.5**, **1024×1024**. **No pixel LoRA.**

**Character positive prefix** (prepend to every character prompt):
```
clean 2D cartoon game art, Brawlhalla style, bold dark outline, cel shading with
subtle gradient, vibrant saturated colors, dynamic heroic athletic proportions,
strong silhouette, full body, side view, transparent background, <SUBJECT + POSE>
```
**Background positive prefix:**
```
clean 2D cartoon game background, Brawlhalla style, vibrant painterly environment,
depth and atmosphere, parallax layer: <sky|midground|foreground>, <SCENE>, no characters
```
**Negative (all):**
```
pixel art, pixelated, photorealistic, 3d render, photo, blurry, soft focus,
sketch, lineart only, watermark, text, signature, extra limbs, deformed,
low contrast, muddy colors
```

## Workflow
- This is LOCKED for the whole game. The first test renders just tune the style
  prefix; once it looks right, reuse it everywhere unchanged.
- Per-asset order (cheapest, highest-impact win first): **stage backgrounds →
  item sprites → character portraits → character animation clips** (see
  `docs/SPRITE-PLAN.md` for the full clip list + the grab-interaction model).
- Per-fighter, generate the canonical (palette-0) colors first; the 8 swaps are
  recolors of the same art.
