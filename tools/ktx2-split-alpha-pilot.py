#!/usr/bin/env python3
"""Bounded Link-idle diagnostic: opaque premultiplied RGB UASTC + exact R8 alpha.

No production assets or renderer files are modified. `run` takes the shared
heavy-job lock without waiting, encodes idle only, and retains failed evidence.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import PIL
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QUALITY_PATH = ROOT / "tools/ktx2-quality.py"
spec = importlib.util.spec_from_file_location("ktx2_quality", QUALITY_PATH)
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def recombine(rgb, alpha):
    if rgb.shape[:2] != alpha.shape or rgb.shape[2] < 3:
        raise ValueError("RGB and alpha orientation/dimensions must match")
    return np.concatenate((rgb[:, :, :3], alpha[:, :, None]), axis=2)


def self_test():
    alpha = np.full((8, 8), 255, dtype=np.uint8)
    alpha[:, :2] = 0
    rgb = np.full((8, 8, 3), 80, dtype=np.uint8)
    rgb[:, :2] = 0
    source = recombine(rgb, alpha)
    assert np.array_equal(recombine(source, alpha), source)
    assert quality.metrics(source, recombine(rgb, alpha))["passed"]
    wrong_rgb = rgb.copy()
    wrong_rgb[:, 2:] += 8
    assert not quality.metrics(source, recombine(wrong_rgb, alpha))["checks"]["rgbPsnr"]
    wrong_alpha = alpha.copy()
    wrong_alpha[:, 2:] -= 2
    assert not quality.metrics(source, recombine(rgb, wrong_alpha))["checks"]["alphaPsnr"]
    assert not quality.metrics(source, recombine(rgb, alpha[::-1, ::-1]))["passed"]
    leaking_rgb = rgb.copy()
    leaking_rgb[:, :2] = 10
    leaking = recombine(leaking_rgb, alpha)
    assert quality.metrics(source, leaking)["checks"]["halo"]
    assert np.any(leaking[:, :, :3][alpha == 0])
    try:
        recombine(rgb, alpha[:, :4])
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched alpha dimensions accepted")
    print("7 split-alpha oracles PASS (identity, exact gate, RGB failure, alpha failure, orientation, transparent RGB caveat, dimensions)")
    return 0


def run(args):
    started = time.monotonic()
    encoder = args.ktx_dir.resolve() / "bin/ktx"
    env = quality.ktx_env(encoder)
    commands = []

    def command(arguments):
        commands.append([str(encoder), *map(str, arguments)])
        result = subprocess.run(commands[-1], env=env, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr or result.stdout or str(commands[-1]))
        return result.stdout

    version = command(["--version"]).strip()
    if version != "ktx version: v4.4.2":
        raise ValueError(f"Expected pinned KTX 4.4.2, got {version}")
    frames_path = ROOT / "assets/characters/link/frames.json"
    layout = json.loads(frames_path.read_text())["animations"]["idle"]
    source_root = ROOT / "assets/characters/link"
    source_path = (source_root / layout["strip"]).resolve()
    if not source_path.is_relative_to(source_root.resolve()):
        raise ValueError("Source must stay in the installed Link bank")
    source_hash = sha(source_path.read_bytes())
    if layout.get("sha256") and source_hash != layout["sha256"]:
        raise ValueError("Installed idle source/layout hashes do not agree")
    with Image.open(source_path) as image:
        source = quality.premultiply(image)
    height, width = source.shape[:2]
    recipe = {
        "diagnostic": "Link idle only; opaque premultiplied RGB + exact R8 alpha",
        "encoderVersion": version, "encoderSha256": sha(encoder.read_bytes()),
        "scriptSha256": sha(Path(__file__).read_bytes()),
        "qualityToolSha256": sha(QUALITY_PATH.read_bytes()),
        "Pillow": PIL.__version__, "numpy": np.__version__, "threads": args.threads,
        "rgbFormat": "R8G8B8_UNORM", "rgbCodec": "uastc", "uastcQuality": 4,
        "uastcRdo": False, "alphaFormat": "R8_UNORM", "alphaCodec": "uncompressed R8",
        "zstd": 18, "levels": 1, "mipmaps": False, "transfer": "linear",
        "primaries": "none", "orientation": "top-left",
        "rgbPreparation": "(RGB*sourceAlpha+127)//255; alpha absent/constant255",
        "alphaPreparation": "source alpha bytes without conversion",
        "alphaAssociation": "Independent R8 scalar coverage plane; no premultiplied-alpha DFD flag",
        "thresholds": quality.THRESHOLDS,
    }
    cache_key = sha(json.dumps({"sourceSha256": source_hash, "layout": layout,
                              "recipe": recipe}, sort_keys=True).encode())
    out = args.out_root.resolve() / cache_key[:20]
    out.mkdir(parents=True, exist_ok=True)
    quality.write_json(out / "layout.json", layout)
    rgb_input = out / "source-premultiplied-rgb-opaque.png"
    Image.fromarray(source[:, :, :3]).save(rgb_input)
    alpha_input = out / "source-alpha-r8.bin"
    alpha_input.write_bytes(source[:, :, 3].tobytes())
    rgb_ktx = out / "idle-rgb.ktx2"
    alpha_ktx = out / "idle-alpha.ktx2"
    common = ["--assign-tf", "linear", "--assign-primaries", "none",
              "--assign-texcoord-origin", "top-left", "--levels", "1", "--zstd", "18"]
    command(["create", "--format", "R8G8B8_UNORM", *common, "--encode", "uastc",
             "--uastc-quality", "4", "--threads", str(args.threads), str(rgb_input), str(rgb_ktx)])
    command(["create", "--format", "R8_UNORM", *common, "--raw", "--width", str(width),
             "--height", str(height), str(alpha_input), str(alpha_ktx)])
    for name, path in [("rgb", rgb_ktx), ("alpha", alpha_ktx)]:
        command(["validate", str(path)])
        quality.write_json(out / f"{name}-ktx-info.json", json.loads(command(["info", "--format", "json", str(path)])))
    alpha_decoded = out / "extracted-alpha-r8.bin"
    command(["extract", "--raw", str(alpha_ktx), str(alpha_decoded)])
    alpha_bytes = alpha_decoded.read_bytes()
    if alpha_bytes != alpha_input.read_bytes():
        raise ValueError("R8 create/extract changed alpha bytes")
    alpha = np.frombuffer(alpha_bytes, dtype=np.uint8).reshape(height, width)
    targets = {}
    bc7_block_bytes = None
    for target in ("rgba8", "bc7"):
        raw_path = out / f"transcoded-rgb-{target}.bin"
        command(["extract", "--transcode", target, "--raw", str(rgb_ktx), str(raw_path)])
        raw = raw_path.read_bytes()
        if target == "rgba8":
            if len(raw) != width * height * 4:
                raise ValueError("Unexpected RGBA8 dimensions")
            decoded = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4)
        else:
            bc7_block_bytes = len(raw)
            if bc7_block_bytes != ((width + 3) // 4) * ((height + 3) // 4) * 16:
                raise ValueError("Unexpected BC7 block footprint")
            decoded = np.array(Image.frombytes("RGBA", (width, height), raw, "bcn", (7, "BC7")))
        reconstructed = recombine(decoded, alpha)
        Image.fromarray(reconstructed).save(out / f"reconstructed-{target}-premultiplied.png")
        samples = layout.get("nativeSampleIndices", [])
        drawings = [{"drawing": i, "nativeSample": samples[i] if i < len(samples) else None,
                     **quality.metrics(quality.cell(source, layout, i),
                     quality.cell(reconstructed, layout, i))} for i in range(layout["frameCount"])]
        atlas = quality.metrics(source, reconstructed)
        transparent = source[:, :, 3] == 0
        targets[target] = {
            "atlas": atlas, "drawings": drawings,
            "contactDrawings": quality.contact_sheets(source, reconstructed, layout, out, target),
            "transparentRgbNonzeroPixels": int(np.count_nonzero(transparent & np.any(reconstructed[:, :, :3] != 0, axis=2))),
            "transparentRgbMax": int(np.max(reconstructed[:, :, :3][transparent])) if np.any(transparent) else 0,
            "passed": atlas["passed"] and all(row["passed"] for row in drawings),
        }
    if source_hash != sha(source_path.read_bytes()) or layout != json.loads(frames_path.read_text())["animations"]["idle"]:
        raise ValueError("Source/layout changed during the diagnostic; discard result")
    report = {
        "clip": "idle", "cacheKey": cache_key, "source": str(source_path),
        "sourceSha256": source_hash, "recipe": recipe, "width": width, "height": height,
        "alphaExact": True, "alphaSha256": sha(alpha_bytes), "targets": targets,
        "passed": all(row["passed"] for row in targets.values()),
        "bytes": {"sourceRgba": width * height * 4, "rgbBc7Blocks": bc7_block_bytes,
                  "alphaR8": len(alpha_bytes), "combinedBc7PlusR8": bc7_block_bytes + len(alpha_bytes),
                  "rgbKtx2Delivery": rgb_ktx.stat().st_size, "alphaKtx2Delivery": alpha_ktx.stat().st_size,
                  "combinedKtx2Delivery": rgb_ktx.stat().st_size + alpha_ktx.stat().st_size},
        "gpuResidencyMeasured": False, "browserShaderPathImplemented": False,
        "scope": "Stored reconstructed texel diagnostic only; no filtered GPU/ASTC/runtime/fallback acceptance",
        "renderingCaveats": [
            "The unchanged alpha-only halo metric misses nonzero premultiplied RGB at source alpha0.",
            "Premultiplied blending can add that RGB to the background even when reconstructed alpha is zero.",
            "Numeric acceptance cannot qualify rendering; inspect composited light/dark contacts and actual filtered GPU edges.",
            "No RGB clamping, second alpha multiplication or threshold relaxation was applied.",
        ],
        "elapsedSeconds": time.monotonic() - started, "commands": commands,
        "outputs": {p.name: sha(p.read_bytes()) for p in (rgb_ktx, alpha_ktx)},
    }
    quality.write_json(out / "quality.json", report)
    print(json.dumps({"out": str(out), "passed": report["passed"], "bytes": report["bytes"],
                      "targets": {name: {"atlas": row["atlas"], "failedDrawings": [d["drawing"] for d in row["drawings"] if not d["passed"]]}
                                  for name, row in targets.items()}}))
    return 0 if report["passed"] else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("self-test", "run"))
    parser.add_argument("--ktx-dir", type=Path, default=Path.home() / ".local/opt/ktx-4.4.2")
    parser.add_argument("--out-root", type=Path, default=ROOT / "assets/generated/ktx2/link-split-alpha/idle")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    if args.command == "self-test":
        return self_test()
    if args.threads < 1:
        parser.error("--threads must be positive")
    lock_path = ROOT / ".tmp/dk-heavy.lock"
    lock_path.parent.mkdir(exist_ok=True)
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Shared heavy-job lock is busy; no encoding started")
        return run(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
