#!/usr/bin/env python3
"""
Extract per-move horizontal-strip PNGs for the M1 fighters (cat + wolf)
into ``assets/sprites/characters/<character>/animations/<move>.png``.

This satisfies AC 10001 / Sub-AC 1 of the M1.5 content pipeline:

    Source and place CC0/CC-BY sprite assets for the 2 M1 characters
    under assets/sprites/characters/ (idle, walk, jump, attack frames
    for jab/tilt/smash/aerial, shield, dodge).

Source art:
  * cat  ← OpenGameArt "Cat Fighter Sprite Sheet" by dogchicken
          (CC-BY 3.0)  — assets/characters/cat/cat_source_sheet.png
          10×10 grid, 50×50 cells, only top 6 rows hold sprite data.
  * wolf ← OpenGameArt "Dog Fighter (Cat Fighter Remix Base + Add-on
          One)" by IsometricRobot (CC-BY 3.0)
          — assets/characters/wolf/wolf_source_sheet.png
          16×16 grid, 64×64 cells; mixed sprite content across most
          rows (it's the "remix + add-on" sheet).

Mapping rationale (idle/walk/jump match the existing
``assets/characters/<id>/frames.json`` extraction so combat code that
already loads idle/walk/jump frames keeps working):

  Move      Cat (10×10 / 50px)       Wolf (16×16 / 64px)
  --------- ------------------------ -------------------------
  idle      r0  c0..3   (4 frames)   r0  c0..3   (4 frames)
  walk      r2  c0..9   (10 frames)  r1  c0..7   (8 frames)
  jump      r3  c5..9   (5 frames)   r3  c3..7   (5 frames)
  jab       r4  c0..3   (4 frames)   r4  c3..6   (4 frames)
  tilt      r4  c4..7   (4 frames)   r5  c0..3   (4 frames)
  smash     r5  c0..7   (8 frames)   r14 c0..7   (8 frames)
  aerial    r4  c4..9   (6 frames)   r10 c4..9   (6 frames)
  shield    r1  c0..3   (4 frames)   r6  c0..3   (4 frames)
  dodge     r3  c0..3   (4 frames)   r2  c0..3   (4 frames)

The strips are self-contained — each PNG is a single horizontal row
of N frames at the source cell size, ready to be loaded with
``this.load.spritesheet(key, path, { frameWidth, frameHeight })`` in
Phaser. The source sheet (and ATTRIBUTION.md entry) are the upstream
license root — strips are derivative works under the same CC-BY 3.0
licence.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image

# Repo root resolved relative to this script
REPO_ROOT = Path(__file__).resolve().parent.parent

CharSpec = Dict[str, object]

CAT_SPEC: CharSpec = {
    "id": "cat",
    "source_sheet": REPO_ROOT / "assets/characters/cat/cat_source_sheet.png",
    "cell_w": 50,
    "cell_h": 50,
    "sheet_cols": 10,
    "sheet_rows": 10,
    # Cat sheet ships with pre-keyed transparency, no chroma-key needed.
    "chroma_key_white": False,
    "license": "CC-BY 3.0",
    "attribution": (
        "Cat Fighter Sprite Sheet — dogchicken, "
        "https://opengameart.org/content/cat-fighter-sprite-sheet"
    ),
    # Each entry: move name -> list of (col, row)
    "moves": {
        "idle":   [(c, 0) for c in range(0, 4)],
        "walk":   [(c, 2) for c in range(0, 10)],
        "jump":   [(c, 3) for c in range(5, 10)],
        "jab":    [(c, 4) for c in range(0, 4)],
        "tilt":   [(c, 4) for c in range(4, 8)],
        "smash":  [(c, 5) for c in range(0, 8)],
        "aerial": [(c, 4) for c in range(4, 10)],
        "shield": [(c, 1) for c in range(0, 4)],
        "dodge":  [(c, 3) for c in range(0, 4)],
    },
}

WOLF_SPEC: CharSpec = {
    "id": "wolf",
    "source_sheet": REPO_ROOT / "assets/characters/wolf/wolf_source_sheet.png",
    "cell_w": 64,
    "cell_h": 64,
    "sheet_cols": 16,
    "sheet_rows": 16,
    # Wolf source PNG has alpha=255 everywhere with a pure-white
    # backdrop; chroma-key any pixel with RGB ≥ 250 to alpha=0 so the
    # extracted strips render correctly over a stage background.
    "chroma_key_white": True,
    "license": "CC-BY 3.0",
    "attribution": (
        "Dog Fighter (Cat Fighter remix base + add on one) — "
        "IsometricRobot, "
        "https://opengameart.org/content/dog-fighter-cat-fighter-remix-base-add-on-one"
    ),
    "moves": {
        "idle":   [(c, 0)  for c in range(0, 4)],
        "walk":   [(c, 1)  for c in range(0, 8)],
        "jump":   [(c, 3)  for c in range(3, 8)],
        "jab":    [(c, 4)  for c in range(3, 7)],
        "tilt":   [(c, 5)  for c in range(0, 4)],
        "smash":  [(c, 14) for c in range(0, 8)],
        "aerial": [(c, 10) for c in range(4, 10)],
        "shield": [(c, 6)  for c in range(0, 4)],
        "dodge":  [(c, 2)  for c in range(0, 4)],
    },
}


def chroma_key_white(img: Image.Image, threshold: int = 250) -> Image.Image:
    """Return a copy of ``img`` with near-white pixels (R, G, B ≥
    ``threshold``) forced to ``alpha = 0``.  Used for source sheets
    that ship with a flat white backdrop instead of true transparency.
    """
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                px[x, y] = (r, g, b, 0)
    return img


def extract_strip(
    sheet: Image.Image,
    cells: List[Tuple[int, int]],
    cell_w: int,
    cell_h: int,
) -> Image.Image:
    """Return a new RGBA image that is the horizontal concatenation of
    the listed (col, row) cells at native cell size."""
    if not cells:
        raise ValueError("cells must be non-empty")
    out = Image.new("RGBA", (cell_w * len(cells), cell_h), (0, 0, 0, 0))
    for i, (c, r) in enumerate(cells):
        box = (c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h)
        cell = sheet.crop(box).convert("RGBA")
        out.paste(cell, (i * cell_w, 0))
    return out


def build_frames_json(spec: CharSpec) -> dict:
    out_animations: Dict[str, dict] = {}
    for move, cells in spec["moves"].items():  # type: ignore[index]
        out_animations[move] = {
            "strip": f"animations/{move}.png",
            "frameCount": len(cells),
            "frameWidth": spec["cell_w"],
            "frameHeight": spec["cell_h"],
            "sourceCells": [list(cell) for cell in cells],
        }
    rel_source = os.path.relpath(
        spec["source_sheet"],
        REPO_ROOT / "assets/sprites/characters" / spec["id"],
    ).replace(os.sep, "/")
    return {
        "meta": {
            "source": rel_source,
            "cellWidth": spec["cell_w"],
            "cellHeight": spec["cell_h"],
            "sheetCols": spec["sheet_cols"],
            "sheetRows": spec["sheet_rows"],
            "license": spec["license"],
            "attribution": spec["attribution"],
        },
        "animations": out_animations,
    }


def emit(spec: CharSpec) -> None:
    char_id = spec["id"]
    out_dir = REPO_ROOT / "assets/sprites/characters" / str(char_id)
    anim_dir = out_dir / "animations"
    anim_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(spec["source_sheet"]).convert("RGBA")
    print(f"\n[{char_id}] source: {spec['source_sheet'].relative_to(REPO_ROOT)}")
    print(f"[{char_id}] sheet:  {sheet.size} mode={sheet.mode}")
    if spec.get("chroma_key_white"):
        sheet = chroma_key_white(sheet)
        print(f"[{char_id}] chroma-keyed white background → transparent")

    for move, cells in spec["moves"].items():  # type: ignore[index]
        strip = extract_strip(sheet, cells, spec["cell_w"], spec["cell_h"])  # type: ignore[arg-type]
        out_path = anim_dir / f"{move}.png"
        strip.save(out_path, optimize=True)
        size_bytes = out_path.stat().st_size
        print(
            f"[{char_id}] {move:6s} → {out_path.relative_to(REPO_ROOT)} "
            f"  {len(cells)} frames, {strip.size[0]}×{strip.size[1]}px, "
            f"{size_bytes} B"
        )

    frames_json = build_frames_json(spec)
    frames_path = out_dir / "frames.json"
    with frames_path.open("w") as fh:
        json.dump(frames_json, fh, indent=2)
        fh.write("\n")
    print(f"[{char_id}] frames.json → {frames_path.relative_to(REPO_ROOT)}")


def main() -> None:
    for spec in (CAT_SPEC, WOLF_SPEC):
        emit(spec)


if __name__ == "__main__":
    main()
