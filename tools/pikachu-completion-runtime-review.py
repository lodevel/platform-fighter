#!/usr/bin/env python3
"""Make unaltered pixel crops of actual Pikachu browser captures for inspection."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

directory = Path(sys.argv[1])
report = json.loads((directory / "observations.json").read_text())
rows = report["rows"]
width = max(len(row["captures"]) for row in rows)
canvas = Image.new("RGB", (width * 185, len(rows) * 160), "#202633")
draw = ImageDraw.Draw(canvas)
crops = []
for row_index, row in enumerate(rows):
    for index, capture in enumerate(row["captures"]):
        source = Image.open(directory / capture["screenshot"]).convert("RGB")
        pixels = np.asarray(source)
        # Protected throw bodies are olive-tinted in actual Match rendering.
        # Optional diagnostic crop detection includes that darker drawing;
        # pixels themselves are copied unchanged.
        if '--target-orange' in sys.argv:
            yellow = ((pixels[:, :, 0] > 160) & (pixels[:, :, 1] > 40)
                      & (pixels[:, :, 1] < 130) & (pixels[:, :, 2] < 60))
        elif '--target-yellow-pair' in sys.argv:
            red = pixels[:, :, 0].astype('int16'); green = pixels[:, :, 1].astype('int16')
            yellow = ((red > 160) & (green > 145) & (pixels[:, :, 2] < 120)
                      & (red < green * 1.45) & (red > green * .85))
        elif '--include-tint' in sys.argv:
            yellow = (pixels[:, :, 0] > 50) & (pixels[:, :, 1] > 50) & (pixels[:, :, 2] < 45)
        else:
            yellow = (pixels[:, :, 0] > 180) & (pixels[:, :, 1] > 130) & (pixels[:, :, 2] < 100)
        yellow[:70, :] = False
        yellow[590:, :] = False
        ys, xs = np.where(yellow)
        if len(xs):
            if '--target-yellow-pair' in sys.argv:
                # Sparse blended palette1/overlay pixels should not stretch
                # the crop across separated actors. Weight by actual yellow
                # body pixels; keep the image crop itself unmodified.
                cx, cy = round(float(xs.mean())), round(float(ys.mean()))
            else:
                cx = (int(xs.min()) + int(xs.max())) // 2
                cy = (int(ys.min()) + int(ys.max())) // 2
            box = (cx - 65, cy - 55, cx + 65, cy + 55)
            canvas.paste(source.crop(box), (index * 185 + 25, row_index * 160 + 45))
            crops.append({"screenshot": capture["screenshot"], "box": box})
        observation = capture["observation"]
        label = str(row["facing"])
        if "air" in row:
            label += " air" if row["air"] else " ground"
        if "flick" in row:
            label += " flick" if row["flick"] else " ordinary"
        draw.text((index * 185 + 2, row_index * 160 + 2), label, fill="white")
        draw.text((index * 185 + 2, row_index * 160 + 17), observation["texture"].split(".")[-1], fill="white")
        owner = (observation.get('ledgeJump') or observation.get('recovery')
                 or observation.get('reaction') or observation.get('presentation') or {})
        age = capture.get("age", (observation.get("state") or {}).get("frame", owner.get('framesElapsed')))
        draw.text((index * 185 + 2, row_index * 160 + 32), f'cell{observation["textureFrame"]} age{age}', fill="white")
canvas.save(directory / "body-review.png")
(directory / "review-crops.json").write_text(json.dumps(crops, indent=2) + "\n")
