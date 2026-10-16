#!/usr/bin/env python3
"""Extract a local reference GIF; requires Pillow (no network or generation).

PNG files are full-canvas RGBA snapshots after GIF compositing, not raw GIF
patches. Source timing is evidence only: gameplay-frame mappings remain null.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import sys
from typing import Any

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


CELL_WIDTH = 256
CELL_HEIGHT = 224
SHEET_COLUMNS = 4
SHEET_ROWS = 4
FRAMES_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS


class ExtractionError(ValueError):
    """Invalid source or destination; no usable extraction was produced."""


def _gif_records(data: bytes) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Read image descriptors/GCEs without confusing decoder state with metadata.

    Pillow does the actual LZW decoding and compositing. GIF delays/disposal are
    read here because a missing GCE or disposal zero must not inherit a previous
    frame's metadata in our evidence manifest.
    """
    position = 0

    def take(count: int) -> bytes:
        nonlocal position
        if position + count > len(data):
            raise ExtractionError("Truncated GIF block")
        value = data[position:position + count]
        position += count
        return value

    def subblocks() -> None:
        while True:
            count = take(1)[0]
            if count == 0:
                return
            take(count)

    signature = take(6)
    if signature not in (b"GIF87a", b"GIF89a"):
        raise ExtractionError("Input must be a GIF file")
    width, height, packed, background, aspect = struct.unpack("<HHBBB", take(7))
    if width == 0 or height == 0:
        raise ExtractionError("GIF logical canvas must have positive dimensions")
    if packed & 0x80:
        take(3 * (2 ** ((packed & 7) + 1)))

    records: list[dict[str, Any]] = []
    control: dict[str, Any] | None = None
    while True:
        marker = take(1)[0]
        if marker == 0x3B:
            break
        if marker == 0x21:
            label = take(1)[0]
            if label == 0xF9:
                if take(1)[0] != 4:
                    raise ExtractionError("Invalid GIF graphic control extension")
                flags, delay, transparent_index = struct.unpack("<BHB", take(4))
                if take(1) != b"\x00":
                    raise ExtractionError("Invalid GIF graphic control terminator")
                disposal = (flags >> 2) & 7
                if disposal > 3:
                    raise ExtractionError("Reserved GIF disposal method is unsupported")
                control = {
                    "duration_centiseconds": delay,
                    "duration_ms": delay * 10,
                    "disposal_method": disposal,
                    "transparency_index": transparent_index if flags & 1 else None,
                    "user_input_flag": bool(flags & 2),
                }
            elif label == 0x01:
                # A GIF plain-text graphic can consume a GCE and alter the canvas;
                # Pillow's image compositor does not render that graphic.
                raise ExtractionError("GIF plain-text graphics are unsupported")
            else:
                subblocks()
            continue
        if marker != 0x2C:
            raise ExtractionError(f"Unexpected GIF block marker 0x{marker:02x}")
        left, top, frame_width, frame_height, flags = struct.unpack("<HHHHB", take(9))
        if (not frame_width or not frame_height
                or left + frame_width > width or top + frame_height > height):
            raise ExtractionError("GIF image rectangle is outside its logical canvas")
        if flags & 0x80:
            take(3 * (2 ** ((flags & 7) + 1)))
        take(1)  # LZW minimum code size; Pillow validates the compressed pixels.
        subblocks()
        records.append({
            "source_index": len(records),
            "source_rectangle": [left, top, frame_width, frame_height],
            "disposal_extent": [left, top, left + frame_width, top + frame_height],
            "interlaced": bool(flags & 0x40),
            "has_graphic_control_extension": control is not None,
            "duration_centiseconds": None,
            "duration_ms": None,
            "disposal_method": None,
            "transparency_index": None,
            "user_input_flag": None,
            **(control or {}),
        })
        control = None
    if not records:
        raise ExtractionError("GIF contains no image frames")
    return {
        "gif_version": signature.decode("ascii"),
        "width": width,
        "height": height,
        "background_palette_index": background,
        "pixel_aspect_ratio_byte": aspect,
    }, records


def _contact_sheet(output: Path, page: int,
                   thumbnails: list[tuple[dict[str, Any], Image.Image]]) -> dict[str, Any]:
    columns = min(SHEET_COLUMNS, len(thumbnails))
    rows = (len(thumbnails) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * CELL_WIDTH, rows * CELL_HEIGHT), "#eeeeee")
    draw = ImageDraw.Draw(sheet)
    for cell, (record, thumbnail) in enumerate(thumbnails):
        left = (cell % columns) * CELL_WIDTH
        top = (cell // columns) * CELL_HEIGHT
        # Only the review sheet is resized/labeled; source PNGs stay untouched.
        x = left + (CELL_WIDTH - thumbnail.width) // 2
        y = top + 8 + (176 - thumbnail.height) // 2
        sheet.paste(thumbnail, (x, y), thumbnail)
        duration = record["duration_ms"]
        disposal = record["disposal_method"]
        draw.text((left + 8, top + 188), f"source {record['source_index']:05d}", fill="black")
        draw.text((left + 8, top + 202),
                  f"delay {duration if duration is not None else 'absent'} ms | "
                  f"disposal {disposal if disposal is not None else 'absent'}", fill="black")
    filename = f"contact-sheet-{page:03d}.png"
    sheet.save(output / filename, format="PNG")
    result = {"file": filename, "width": sheet.width, "height": sheet.height,
              "source_indices": [record["source_index"] for record, _ in thumbnails]}
    sheet.close()
    return result


def _remove_owned_output(output: Path, identity: tuple[int, int]) -> None:
    """Delete only the exact new output directory this invocation created."""
    current = output.lstat()
    if (not stat.S_ISDIR(current.st_mode) or output.is_symlink()
            or output.resolve() != output
            or (current.st_dev, current.st_ino) != identity):
        raise ExtractionError(f"Refusing cleanup: output directory changed: {output}")
    shutil.rmtree(output)


def extract_motion(input_path: Path | str, source_url: str, output_path: Path | str,
                   character: str, move: str) -> dict[str, Any]:
    requested_output = Path(output_path).expanduser().absolute()
    # lexists also rejects a dangling symlink; do not follow or replace it.
    if os.path.lexists(requested_output):
        raise ExtractionError(f"Output already exists; choose a new directory: {requested_output}")
    if not requested_output.parent.is_dir():
        raise ExtractionError("Output parent directory must already exist")
    output = requested_output.parent.resolve() / requested_output.name
    if not source_url.strip() or not character.strip() or not move.strip():
        raise ExtractionError("Source URL, character and move must be nonempty")
    source = Path(input_path).expanduser().resolve(strict=True)
    data = source.read_bytes()
    gif_metadata, records = _gif_records(data)

    with Image.open(io.BytesIO(data)) as gif:
        if gif.format != "GIF" or gif.n_frames != len(records):
            raise ExtractionError("GIF decoder and source image count disagree")
        source_metadata = {
            "path": str(source), "url": source_url,
            "sha256": hashlib.sha256(data).hexdigest(), "byte_length": len(data),
            "format": "GIF", **gif_metadata, "initial_mode": gif.mode,
            "image_count": len(records), "loop_count": gif.info.get("loop"),
            "comment_hex": gif.info.get("comment", b"").hex(),
        }
        manifest: dict[str, Any] = {
            "schema_version": 1, "character": character, "move": move,
            "extracted_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "extractor": {"name": "extract_motion.py", "pillow_version": PILLOW_VERSION},
            "source": source_metadata,
            "frame_semantics": {
                "source_index": "zero-based GIF image index",
                "png": "lossless full logical-canvas RGBA after GIF compositing",
                "delay": "stored GIF delay, not inferred gameplay duration",
                "gameplay_mapping": "unresolved; map against source labels and move evidence manually",
            },
            "frames": [], "contact_sheets": [],
        }
        # Only this operation creates the destination, without creating parents.
        # A racing creation fails here without entering the cleanup scope.
        output.mkdir()
        created = output.stat()
        identity = (created.st_dev, created.st_ino)
        thumbnails: list[tuple[dict[str, Any], Image.Image]] = []
        try:
            for source_record in records:
                index = source_record["source_index"]
                gif.seek(index)
                frame = gif.convert("RGBA")
                if frame.size != (gif_metadata["width"], gif_metadata["height"]):
                    raise ExtractionError("Decoded frame does not match the GIF logical canvas")
                filename = f"source-{index:05d}.png"
                frame.save(output / filename, format="PNG")
                record = {
                    **source_record, "file": filename,
                    "png_sha256": hashlib.sha256((output / filename).read_bytes()).hexdigest(),
                    "width": frame.width, "height": frame.height, "mode": frame.mode,
                    "displayed_frame_label": None, "gameplay_frame_mapping": None,
                    "target_pose_key": None,
                }
                manifest["frames"].append(record)
                frame.thumbnail((240, 176), Image.Resampling.LANCZOS)
                thumbnails.append((record, frame))
                if len(thumbnails) == FRAMES_PER_SHEET or index == len(records) - 1:
                    manifest["contact_sheets"].append(
                        _contact_sheet(output, len(manifest["contact_sheets"]) + 1, thumbnails))
                    for _, thumbnail in thumbnails:
                        thumbnail.close()
                    thumbnails.clear()
            (output / "manifest.json").write_text(
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        except BaseException:
            for _, thumbnail in thumbnails:
                thumbnail.close()
            _remove_owned_output(output, identity)
            raise
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Existing local GIF")
    parser.add_argument("--source-url", required=True, help="Inspected source asset URL (metadata only)")
    parser.add_argument("--output", required=True, type=Path, help="New directory; its parent must exist")
    parser.add_argument("--character", required=True)
    parser.add_argument("--move", required=True)
    args = parser.parse_args(argv)
    try:
        manifest = extract_motion(args.input, args.source_url, args.output, args.character, args.move)
    except Exception as error:
        print(f"extract_motion: {error}", file=sys.stderr)
        return 1
    print(f"Extracted {len(manifest['frames'])} source images and "
          f"{len(manifest['contact_sheets'])} contact sheets to {args.output}")
    print("Gameplay-frame mappings remain unresolved (null).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
