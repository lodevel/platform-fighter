"""Run with the packer's Python environment (Pillow, NumPy, SciPy)."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('packer', Path(__file__).with_name('fighter-pack.py'))
packer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packer)


class AnatomicalFloorContact(unittest.TestCase):
    def setUp(self):
        self.alpha = np.zeros((12, 12), dtype=np.uint8)
        self.alpha[4:6, 2:5] = 255  # hand support
        self.alpha[11, 9] = 255  # hanging tie

    def test_region_excludes_clothing_without_changing_legacy_default(self):
        self.assertEqual(packer.floor_contact_bbox(self.alpha)[3], 12)
        self.assertEqual(packer.floor_contact_bbox(self.alpha, [1, 3, 5, 4])[3], 6)

    def test_invalid_or_empty_regions_never_fall_back_to_clothing(self):
        for region in ([0, 0, 0, 1], [-1, 0, 1, 1], [0, 0, 13, 1], [0, 0, 1, 1], [1.5, 0, 1, 1]):
            with self.subTest(region=region), self.assertRaises(ValueError):
                packer.floor_contact_bbox(self.alpha, region)

    def test_visible_antialiased_support_is_kept(self):
        self.alpha[6, 3] = 32
        self.alpha[7, 3] = 31
        self.assertEqual(packer.floor_contact_bbox(self.alpha, [1, 3, 5, 5])[3], 7)


if __name__ == '__main__':
    unittest.main()
