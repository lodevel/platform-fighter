"""Shared loading for the keyframe+changes exploration (read-only on packages)."""
import json, os
import numpy as np
from PIL import Image

PKG_ROOT = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages'
FIGHTERS = {'donkeykong': 'donkeykong~holds-0.12', 'link': 'link~holds-0.12', 'pikachu': 'pikachu~holds-0.12'}
FINALS = {'donkeykong': {'final_start', 'final_attack', 'final_end', 'final_air_start', 'final_air_attack', 'final_air_end'},
          'pikachu': {'final', 'final2', 'final_air', 'final_air2', 'final_dash', 'final_dash_end', 'final_air_dash_end'},
          'link': {'d04final', 'd04finalair'}}

class Package:
    def __init__(self, fighter):
        self.fighter = fighter
        self.dir = os.path.join(PKG_ROOT, FIGHTERS[fighter])
        self.pkg = json.load(open(os.path.join(self.dir, 'character.json')))
        self._pages = {}

    def page(self, pid):
        if pid not in self._pages:
            self._pages[pid] = np.asarray(Image.open(os.path.join(self.dir, self.pkg['pages'][pid]['file'])).convert('RGBA'))
        return self._pages[pid]

    def drawing(self, did):
        """Premultiplied float32 RGBA (0..1) of the drawing rect, plus its anchor (ax, ay) and scale."""
        d = self.pkg['drawings'][did]
        x, y, w, h = d['rect']
        a = self.page(d['page'])[y:y + h, x:x + w].astype(np.float32) / 255
        a[..., :3] *= a[..., 3:4]
        return a, tuple(d['anchor']), d['scale']

    def action_drawings(self, aid):
        seen = []
        for w in self.pkg['actions'][aid]['drawings']['windows']:
            if w['drawing'] not in seen: seen.append(w['drawing'])
        return seen

def place(img, anchor, T, pad=0):
    """Put a drawing on a canvas whose origin is a multiple of T relative to the root,
    with `pad` extra pixels each side. Returns canvas and the root position in it."""
    h, w = img.shape[:2]; ax, ay = anchor
    x0 = -ax - pad; y0 = -ay - pad
    gx0 = int(np.floor(x0 / T)) * T; gy0 = int(np.floor(y0 / T)) * T
    gx1 = int(np.ceil((w - ax + pad) / T)) * T; gy1 = int(np.ceil((h - ay + pad) / T)) * T
    C = np.zeros((gy1 - gy0, gx1 - gx0, 4), np.float32)
    C[-ay - gy0:-ay - gy0 + h, -ax - gx0:-ax - gx0 + w] = img
    return C, (-gx0, -gy0)

def tile_view(C, T):
    H, W = C.shape[:2]
    return C.reshape(H // T, T, W // T, T, C.shape[2]).transpose(0, 2, 1, 3, 4)

def nonempty(C, T, eps=1/255):
    return tile_view(C[..., 3:4], T).max(axis=(2, 3, 4)) > eps
