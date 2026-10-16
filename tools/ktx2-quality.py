#!/usr/bin/env python3
"""Prepare premultiplied texels and measure a Link KTX2 pilot against its PNG.

RGBA8 round-trip and decoded BC7 blocks are distinct measurements. Neither is
native-game equivalence or hardware/ASTC acceptance. Requires Pillow and NumPy.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import PIL
from PIL import Image, ImageDraw

THRESHOLDS = {"rgbPsnrMinDb": 42, "alphaPsnrMinDb": 45,
              "flatMaxFractionOver6": 0.005, "inkMaxFractionOver24": 0.01,
              "haloMaxFractionAlphaOver8": 0.001}


def premultiply(image):
    source = np.array(image.convert("RGBA"), dtype=np.uint8)
    result = source.copy()
    result[:, :, :3] = ((source[:, :, :3].astype(np.uint16)
                        * source[:, :, 3:4].astype(np.uint16) + 127) // 255).astype(np.uint8)
    return result


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def psnr(error, mask):
    if not np.any(mask):
        return None
    values = error[mask].astype(np.float64)
    mse = float(np.mean(values * values))
    return None if mse == 0 else 10 * math.log10(255 * 255 / mse)


def metrics(source, decoded):
    if source.shape != decoded.shape:
        raise ValueError(f"Mismatched image shapes: {source.shape} / {decoded.shape}")
    error = decoded.astype(np.int16) - source.astype(np.int16)
    occupied = source[:, :, 3] > 0
    transparent = ~occupied
    flat = occupied.copy()
    # A flat pixel has the same RGBA value as all eight neighbours. Atlas/cell
    # borders have no complete 3x3 neighbourhood and are excluded.
    flat[[0, -1], :] = False
    flat[:, [0, -1]] = False
    if source.shape[0] > 2 and source.shape[1] > 2:
        centre = source[1:-1, 1:-1]
        for dy in range(3):
            for dx in range(3):
                flat[1:-1, 1:-1] &= np.all(centre == source[dy:dy + centre.shape[0], dx:dx + centre.shape[1]], axis=2)
    luminance = source[:, :, 0] * 0.2126 + source[:, :, 1] * 0.7152 + source[:, :, 2] * 0.0722
    ink = (luminance < 51) & (source[:, :, 3] >= 200)
    maximum = np.max(np.abs(error), axis=2)
    maximum_rgb = np.max(np.abs(error[:, :, :3]), axis=2)
    fraction = lambda failed, mask: float(np.count_nonzero(failed & mask) / np.count_nonzero(mask)) if np.any(mask) else 0.0
    rgb = psnr(error[:, :, :3], occupied)
    alpha = psnr(error[:, :, 3], occupied)
    values = {"rgbPsnrDb": rgb, "alphaPsnrDb": alpha,
              "flatFractionOver6": fraction(maximum > 6, flat),
              "inkFractionOver24": fraction(maximum_rgb > 24, ink),
              "haloFractionAlphaOver8": fraction(decoded[:, :, 3] > 8, transparent),
              "occupiedPixels": int(np.count_nonzero(occupied)), "flatPixels": int(np.count_nonzero(flat)),
              "inkPixels": int(np.count_nonzero(ink)), "transparentPixels": int(np.count_nonzero(transparent)),
              "maxRgbaError": int(np.max(maximum)), "exactRgba": bool(np.array_equal(source, decoded))}
    checks = {"rgbPsnr": rgb is None or rgb >= THRESHOLDS["rgbPsnrMinDb"],
              "alphaPsnr": alpha is None or alpha >= THRESHOLDS["alphaPsnrMinDb"],
              "flat": values["flatFractionOver6"] <= THRESHOLDS["flatMaxFractionOver6"],
              "ink": values["inkFractionOver24"] <= THRESHOLDS["inkMaxFractionOver24"],
              "halo": values["haloFractionAlphaOver8"] <= THRESHOLDS["haloMaxFractionAlphaOver8"]}
    return {**values, "checks": checks, "passed": all(checks.values())}


def cell(atlas, layout, index):
    width, height = layout["frameWidth"], layout["frameHeight"]
    if "trims" not in layout:
        margin, spacing = layout.get("margin", 0), layout.get("spacing", 0)
        columns = layout.get("columns", (atlas.shape[1] - 2 * margin + spacing) // (width + spacing))
        x, y = margin + index % columns * (width + spacing), margin + index // columns * (height + spacing)
        return atlas[y:y + height, x:x + width]
    x, y, w, h, dx, dy = layout["trims"][index]
    if min(x, y, dx, dy) < 0 or x + w > atlas.shape[1] or y + h > atlas.shape[0] or dx + w > width or dy + h > height:
        raise ValueError(f"Drawing {index} has an invalid trim rectangle")
    result = np.zeros((height, width, 4), dtype=np.uint8)
    result[dy:dy + h, dx:dx + w] = atlas[y:y + h, x:x + w]
    return result


def display_rgba(premultiplied, light=False):
    # Premultiplied pixels must be composited once; passing them to Pillow's
    # straight-alpha compositor would multiply the edge colours twice.
    h, w = premultiplied.shape[:2]
    yy, xx = np.indices((h, w))
    shade = np.where(((xx // 12 + yy // 12) % 2) != 0, 225 if light else 45, 250 if light else 24)
    alpha = premultiplied[:, :, 3:4].astype(np.float32) / 255
    rgb = premultiplied[:, :, :3].astype(np.float32) + shade[:, :, None] * (1 - alpha)
    return Image.fromarray(np.clip(np.rint(rgb), 0, 255).astype(np.uint8))


def contact_sheets(source, decoded, layout, out, target):
    count = layout["frameCount"]
    selected = sorted(set(round(i * (count - 1) / max(1, min(count, 6) - 1)) for i in range(min(count, 6))))
    width, height = layout["frameWidth"], layout["frameHeight"]
    label, gap = 25, 10
    canvas = Image.new("RGB", (width * 3 + gap * 4, (height + label) * len(selected) + label), (18, 18, 24))
    draw = ImageDraw.Draw(canvas)
    for column, title in enumerate(["PNG source (premultiplied)", f"KTX2 -> {target}", "RGBA error x8"]):
        draw.text((gap + column * (width + gap), 5), title, fill="white")
    for row, index in enumerate(selected):
        a, b = cell(source, layout, index), cell(decoded, layout, index)
        delta = np.clip(np.abs(a.astype(np.int16) - b.astype(np.int16)) * 8, 0, 255).astype(np.uint8)
        # Include alpha error in the diff even when RGB is unchanged.
        difference = np.maximum(delta[:, :, :3], delta[:, :, 3:4])
        y = label + row * (height + label)
        native = layout.get("nativeSampleIndices", [])
        caption = f"drawing {index}" + (f" / native {native[index]}" if index < len(native) else " / authored drawing")
        draw.text((gap, y), caption, fill="white")
        for column, image in enumerate([display_rgba(a, row % 2 == 0), display_rgba(b, row % 2 == 0), Image.fromarray(difference)]):
            canvas.paste(image, (gap + column * (width + gap), y + label))
    for scale in (1, 3):
        image = canvas if scale == 1 else canvas.resize((canvas.width * 3, canvas.height * 3), Image.Resampling.NEAREST)
        image.save(out / f"contact-{target}-{scale}x.png")
    return selected


def ktx_env(binary):
    result = os.environ.copy()
    lib = str(binary.parent.parent / "lib")
    result["LD_LIBRARY_PATH"] = lib + (":" + result["LD_LIBRARY_PATH"] if result.get("LD_LIBRARY_PATH") else "")
    return result


def check(args):
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    layout = json.loads(args.layout.read_text())
    with Image.open(args.source) as image:
        source = premultiply(image)
    report = {"clip": args.clip, "source": str(args.source), "sourceSha256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
              "ktx2": str(args.ktx2), "layout": str(args.layout), "thresholds": THRESHOLDS,
              "definitions": {"psnr": "RGB and alpha over source-alpha>0; null means no error/infinite PSNR (or empty mask)",
                              "flat": "max RGBA error over6 on occupied pixels whose complete3x3 RGBA neighbourhood is uniform",
                              "ink": "max RGB error over24 where premultiplied Rec709 luminance<0.2 and source alpha>=200",
                              "halo": "decoded alpha>8 divided by source-alpha0 pixels"},
              "scope": "PNG compression quality only; not native-game equivalence or actual GPU/hardware acceptance",
              "measurementTools": {"Pillow": PIL.__version__, "numpy": np.__version__}, "targets": {}}
    for target in args.targets.split(","):
        decoded_path = out / f"decoded-{target}-premultiplied.png"
        command = [str(args.ktx), "extract", "--transcode", target]
        if target == "rgba8":
            raw_path = out / "transcoded-rgba8.bin"
            command.extend(["--raw", str(args.ktx2), str(raw_path)])
            subprocess.run(command, check=True, env=ktx_env(args.ktx), capture_output=True, text=True)
            height, width = source.shape[:2]
            pixels = raw_path.read_bytes()
            if len(pixels) != width * height * 4:
                raise ValueError("RGBA8 transcode dimensions changed")
            image = Image.frombytes("RGBA", (width, height), pixels)
            image.save(decoded_path)
            decoded = np.array(image, dtype=np.uint8)
        elif target == "bc7":
            raw_path = out / "transcoded-bc7.bin"
            command.extend(["--raw", str(args.ktx2), str(raw_path)])
            subprocess.run(command, check=True, env=ktx_env(args.ktx), capture_output=True, text=True)
            blocks = raw_path.read_bytes()
            height, width = source.shape[:2]
            expected = ((width + 3) // 4) * ((height + 3) // 4) * 16
            if len(blocks) != expected:
                raise ValueError(f"BC7 block bytes {len(blocks)} != {expected}")
            decoded_image = Image.frombytes("RGBA", (width, height), blocks, "bcn", (7, "BC7"))
            decoded_image.save(decoded_path)
            decoded = np.array(decoded_image, dtype=np.uint8)
        else:
            raise ValueError(f"Unsupported measured target {target}; do not label unmeasured formats accepted")
        drawings = [{"drawing": i, "nativeSample": layout.get("nativeSampleIndices", [])[i] if i < len(layout.get("nativeSampleIndices", [])) else None,
                     **metrics(cell(source, layout, i), cell(decoded, layout, i))} for i in range(layout["frameCount"])]
        atlas = metrics(source, decoded)
        selected = contact_sheets(source, decoded, layout, out, target)
        report["targets"][target] = {"atlas": atlas, "drawings": drawings, "contactDrawings": selected,
                                      "passed": atlas["passed"] and all(row["passed"] for row in drawings)}
    report["passed"] = all(target["passed"] for target in report["targets"].values())
    write_json(out / "quality.json", report)
    print(json.dumps({"clip": args.clip, "passed": report["passed"], "targets": {key: {"passed": row["passed"], "failedDrawings": [drawing["drawing"] for drawing in row["drawings"] if not drawing["passed"]], "atlas": row["atlas"]} for key, row in report["targets"].items()}}))
    return 0 if report["passed"] else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("self-test", help="Check analytical PSNR, premultiplication, halo failure and trim reconstruction oracles")
    prepare = commands.add_parser("prepare", help="Write rounded premultiplied RGBA, preserving dimensions and PNG source")
    prepare.add_argument("source", type=Path)
    prepare.add_argument("output", type=Path)
    measure = commands.add_parser("check", help="Decode UASTC RGBA8 and BC7 and compare every drawing")
    for name in ("source", "ktx2", "layout", "out", "ktx"):
        measure.add_argument("--" + name, type=Path, required=True)
    measure.add_argument("--clip", required=True)
    measure.add_argument("--targets", default="rgba8,bc7")
    args = parser.parse_args()
    if args.command == "self-test":
        pixels = np.array([[[255, 100, 1, 128], [255, 255, 255, 0], [1, 2, 3, 255]]], dtype=np.uint8)
        assert premultiply(Image.fromarray(pixels)).tolist() == [[[128, 50, 1, 128], [0, 0, 0, 0], [1, 2, 3, 255]]]
        source = np.full((8, 8, 4), 255, dtype=np.uint8)
        shifted = source.copy(); shifted[:, :, :3] -= 1
        assert abs(metrics(source, shifted)["rgbPsnrDb"] - 48.1308036086791) < 1e-9
        shifted = source.copy(); shifted[:, :, 3] -= 2
        assert not metrics(source, shifted)["checks"]["alphaPsnr"]
        transparent = np.zeros((1, 1000, 4), dtype=np.uint8)
        halo = transparent.copy(); halo[0, 0, 3] = 9
        assert metrics(transparent, halo)["checks"]["halo"]
        halo[0, 1, 3] = 9
        assert not metrics(transparent, halo)["checks"]["halo"]
        atlas = np.zeros((5, 4, 4), dtype=np.uint8); atlas[1:3, 2] = [10, 20, 30, 255]
        rebuilt = cell(atlas, {"frameWidth": 8, "frameHeight": 9, "trims": [[2, 1, 1, 2, 4, 5]]}, 0)
        assert rebuilt[5:7, 4].tolist() == [[10, 20, 30, 255]] * 2 and np.count_nonzero(rebuilt[:, :, 3]) == 2
        assert metrics(source, source)["passed"]
        print("6 quality oracles PASS (premultiply, PSNR, alpha failure, halo threshold, trim root, identity)")
        return 0
    if args.command == "prepare":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(args.source) as image:
            Image.fromarray(premultiply(image)).save(args.output)
        return 0
    return check(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        print(error.stderr or str(error), file=sys.stderr)
        sys.exit(1)
