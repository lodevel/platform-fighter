#!/usr/bin/env python3
"""Measure immutable captive drawing alpha against observed real floor transforms."""
import hashlib
import json
import math
import sys
from pathlib import Path
from PIL import Image
import numpy as np

directory = Path(sys.argv[1])
report = json.loads((directory / "grab-match-observations.json").read_text())
build = report["build"]
checkpoint = Path(build["sourceHashes"].replace("-source-hashes.json", ""))
metadata = json.loads(Path(str(checkpoint) + "-pikachu-frames.json").read_text())
clip = metadata["animations"]["captured"]
strip = Path(build["outDir"]) / "characters/pikachu" / clip["strip"]
strip_hash = hashlib.sha256(strip.read_bytes()).hexdigest()
assert strip_hash == clip["sha256"], "Actual immutable strip must match recorded metadata"
atlas = Image.open(strip).convert("RGBA")
rows = []
for contact in report["observations"]["contacts"]:
    if contact["situation"] != "ground":
        continue
    samples = [{"observation": contact["observation"], "screenshot": contact["entryScreenshot"]}]
    samples.extend(contact["holding"])
    for sample in samples:
        observed = sample["observation"]["targetBody"]
        index = observed["textureFrame"]
        column, row = index % clip["columns"], index // clip["columns"]
        cell = atlas.crop((column * clip["frameWidth"], row * clip["frameHeight"],
                           (column + 1) * clip["frameWidth"], (row + 1) * clip["frameHeight"]))
        alpha = np.asarray(cell)[:, :, 3]
        ys, xs = np.where(alpha >= 128)
        dx = (xs + .5 - observed["origin"][0] * clip["frameWidth"]) * observed["scale"][0]
        dy = (ys + .5 - observed["origin"][1] * clip["frameHeight"]) * observed["scale"][1]
        if observed["flipX"]:
            dx *= -1
        if observed["flipY"]:
            dy *= -1
        angle = observed["rotation"]
        world_y = observed["spritePosition"]["y"] + dx * math.sin(angle) + dy * math.cos(angle)
        # Pixel centers are measured explicitly; half a transformed pixel
        # separates the contour edge from the center-only maximum.
        maximum = float(world_y.max())
        overlap = world_y > observed["floorY"] + .5
        receiving_bottom = max(max(region["capsule"]["start"]["y"], region["capsule"]["end"]["y"])
                               + region["capsule"]["radius"] for region in observed["receiving"])
        rows.append({"facing": contact["facing"], "screenshot": sample["screenshot"],
                     "artFrameIndex": index, "captureAge": observed["presentation"]["framesElapsed"],
                     "sprite": observed, "visibleAlphaPixels": len(xs),
                     "visibleAlphaPixelsBelowFloorHalfPixel": int(overlap.sum()),
                     "maxVisibleAlphaCenterWorldY": maximum,
                     "floorGapWorldPixels": observed["floorY"] - maximum,
                     "receivingFloorGapWorldPixels": observed["floorY"] - observed["position"]["y"] - receiving_bottom})
result = {"state": "PASS" if all(row["floorGapWorldPixels"] >= -.5 and
                                  row["receivingFloorGapWorldPixels"] >= -.5 for row in rows) else "FAIL",
          "scope": "Immutable alpha>=128 pixel centers transformed by actual recorded sprite origin/position/scale/rotation/flip, against real ground-catch floor. No source/root/pose repair is performed.",
          "bundle": build["bundle"], "bundleSha256": report["bundleSha256"],
          "strip": str(strip), "stripSha256": strip_hash, "rows": rows}
(directory / "floor-alpha-observations.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"state": result["state"], "samples": len(rows),
                  "maximumIntrusionWorldPixels": max(-row["floorGapWorldPixels"] for row in rows)}))
