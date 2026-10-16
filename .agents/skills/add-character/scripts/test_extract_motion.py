"""Offline tests using real GIF patches, transparency and disposal controls."""

import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from extract_motion import ExtractionError, extract_motion, main


PALETTE = [0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0] + [0] * (768 - 15)
RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)
GREEN = (0, 255, 0, 255)
YELLOW = (255, 255, 0, 255)


def gif_patch(size, color, left, top, duration, disposal):
    """Use Pillow's encoder for a patch, then position its image descriptor."""
    image = Image.new("P", size, color)
    image.putpalette(PALETTE)
    stream = io.BytesIO()
    image.save(stream, format="GIF", optimize=False, transparency=0,
               duration=duration, disposal=disposal)
    encoded = stream.getvalue()
    gce_start = encoded.index(b"\x21\xf9\x04", 13 + 768)
    block = bytearray(encoded[gce_start:-1])
    # GCE occupies eight bytes; next byte is the image separator.
    assert block[8] == 0x2C
    block[9:13] = struct.pack("<HH", left, top)
    return bytes(block)


def gif_bytes(patches, size=(4, 4)):
    return (b"GIF89a" + struct.pack("<HHBBB", *size, 0x87, 0, 0)
            + bytes(PALETTE) + b"".join(patches) + b"\x3b")


class ExtractMotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "motion.gif"
        self.output = self.root / "extracted"

    def extract(self):
        return extract_motion(self.source, "https://example.test/inspected-motion.gif",
                              self.output, "link", "utilt")

    def frame(self, index):
        with Image.open(self.output / f"source-{index:05d}.png") as image:
            return image.convert("RGBA")

    def write_disposal_fixture(self):
        self.source.write_bytes(gif_bytes([
            gif_patch((4, 4), 1, 0, 0, 20, 1),
            gif_patch((2, 2), 2, 0, 0, 30, 2),
            gif_patch((1, 1), 3, 3, 3, 40, 3),
            gif_patch((1, 1), 4, 1, 1, 50, 1),
        ]))

    def test_composited_pixels_delays_disposal_and_unresolved_mapping(self):
        self.write_disposal_fixture()
        manifest = self.extract()
        frames = manifest["frames"]
        self.assertEqual(len(frames), 4)
        self.assertEqual([f["duration_ms"] for f in frames], [20, 30, 40, 50])
        self.assertEqual([f["disposal_method"] for f in frames], [1, 2, 3, 1])
        self.assertEqual([f["source_index"] for f in frames], [0, 1, 2, 3])
        self.assertEqual(frames[1]["source_rectangle"], [0, 0, 2, 2])
        self.assertEqual(manifest["source"]["sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(manifest["source"]["url"], "https://example.test/inspected-motion.gif")
        for frame in frames:
            self.assertIsNone(frame["gameplay_frame_mapping"])
            self.assertIsNone(frame["displayed_frame_label"])
            self.assertIsNone(frame["target_pose_key"])
            self.assertEqual((frame["width"], frame["height"], frame["mode"]), (4, 4, "RGBA"))
        with self.frame(1) as image:
            self.assertEqual(image.getpixel((0, 0)), BLUE)
            self.assertEqual(image.getpixel((3, 0)), RED)  # previous frame is retained
        with self.frame(2) as image:
            self.assertEqual(image.getpixel((0, 0))[3], 0)  # disposal 2 clears the patch
            self.assertEqual(image.getpixel((3, 3)), GREEN)
            self.assertEqual(image.getpixel((3, 0)), RED)
        with self.frame(3) as image:
            self.assertEqual(image.getpixel((3, 3)), RED)  # disposal 3 restores prior canvas
            self.assertEqual(image.getpixel((1, 1)), YELLOW)
            self.assertEqual(image.getpixel((0, 0))[3], 0)
        saved = json.loads((self.output / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(saved, manifest)

    def test_missing_control_and_explicit_zero_metadata_are_not_inherited(self):
        first = gif_patch((4, 4), 1, 0, 0, 70, 2)
        second = gif_patch((1, 1), 2, 0, 0, 0, 0)
        third = gif_patch((1, 1), 3, 1, 1, 20, 1)[8:]  # omit its GCE
        self.source.write_bytes(gif_bytes([first, second, third]))
        frames = self.extract()["frames"]
        self.assertEqual([f["duration_ms"] for f in frames], [70, 0, None])
        self.assertEqual([f["disposal_method"] for f in frames], [2, 0, None])
        self.assertFalse(frames[2]["has_graphic_control_extension"])

    def test_existing_output_is_rejected_without_changing_its_contents(self):
        self.output.mkdir()
        sentinel = self.output / "keep.bin"
        sentinel.write_bytes(b"existing work\x00")
        # Output refusal happens even before inspecting the nonexistent source.
        with self.assertRaisesRegex(ExtractionError, "already exists"):
            self.extract()
        self.assertEqual(list(self.output.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_bytes(), b"existing work\x00")

    def test_existing_output_file_is_preserved(self):
        self.output.write_bytes(b"keep file")
        with self.assertRaisesRegex(ExtractionError, "already exists"):
            self.extract()
        self.assertEqual(self.output.read_bytes(), b"keep file")

    def test_malformed_and_truncated_inputs_do_not_create_output(self):
        for content in (b"not a gif at all", b"GIF89a\x04", gif_bytes([])):
            with self.subTest(content=content):
                self.source.write_bytes(content)
                with self.assertRaises(ExtractionError):
                    self.extract()
                self.assertFalse(self.output.exists())

    def test_failed_write_cleans_only_new_output(self):
        self.write_disposal_fixture()
        sentinel = self.root / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        original_save = Image.Image.save

        def fail_on_second(image, path, *args, **kwargs):
            if Path(path).name == "source-00001.png":
                raise OSError("simulated disk failure")
            return original_save(image, path, *args, **kwargs)

        with patch.object(Image.Image, "save", fail_on_second):
            with self.assertRaisesRegex(OSError, "simulated disk failure"):
                self.extract()
        self.assertFalse(self.output.exists())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertTrue(self.source.exists())

    def test_contact_sheets_paginate_and_stay_bounded(self):
        self.source.write_bytes(gif_bytes([
            gif_patch((4, 4), i % 4 + 1, 0, 0, 20, 1) for i in range(17)
        ]))
        manifest = self.extract()
        pages = manifest["contact_sheets"]
        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[0]["source_indices"], list(range(16)))
        self.assertEqual(pages[1]["source_indices"], [16])
        for page in pages:
            with Image.open(self.output / page["file"]) as image:
                self.assertLessEqual(image.width, 1024)
                self.assertLessEqual(image.height, 896)
                self.assertEqual(image.size, (page["width"], page["height"]))
        self.assertEqual(len(manifest["frames"]), 17)

    def test_cli_reports_invalid_input_without_output(self):
        self.source.write_bytes(b"invalid")
        with patch("sys.stderr", new_callable=io.StringIO) as errors:
            status = main(["--input", str(self.source), "--source-url", "https://example.test/m.gif",
                           "--output", str(self.output), "--character", "link", "--move", "utilt"])
        self.assertEqual(status, 1)
        self.assertIn("extract_motion:", errors.getvalue())
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
