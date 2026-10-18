"""Part set rig-parts/1 for DK from hand cuts: the rig v2 jab parts of the skeleton exploration
(explore/skeleton/prototype/build_rig2.py) plus an idle body and head cut from idle/0.
All PNGs share one 460x320 canvas with the character root at (200, 290)."""
import json, shutil, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
HERE = sys.argv[1]; V2 = sys.argv[2]; OUT = sys.argv[3]
PKG = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong/'
CW, CH = 460, 320; ROOT = (200, 290)
p = json.load(open(PKG + 'character.json'))
def canvas(k):
  dr = p['drawings'][k]; pg = Image.open(PKG + p['pages'][dr['page']]['file']).convert('RGBA'); x, y, w, h = dr['rect']
  c = Image.new('RGBA', (CW, CH)); c.paste(pg.crop((x, y, x + w, y + h)), (ROOT[0] - round(dr['anchor'][0]), ROOT[1] - round(dr['anchor'][1])))
  return np.asarray(c).astype(np.float32) / 255
def poly(pts, blur=0.8):
  m = Image.new('L', (CW, CH)); ImageDraw.Draw(m).polygon(pts, fill=255)
  return np.asarray(m.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255
def save(name, rgba): Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA').save(f'{OUT}/{name}.png')
# rig v2 parts, renamed: one base part per bone, variants after it
for src, dst in [('body', 'body'), ('far_fist', 'fist_far'), ('head_closed', 'head'), ('head_open', 'head_open'),
                 ('arm_guard', 'arm'), ('arm_ext', 'arm_ext'), ('arm_cross', 'arm_cross')]:
  shutil.copy(f'{V2}/{src}.png', f'{OUT}/{dst}.png')
# idle: head cut out of idle/0, the hole behind it painted with the median fur colour, outside the body hull cleared
idle = canvas('idle/0')
head = poly([(224,96),(236,78),(258,66),(278,62),(294,68),(300,82),(302,110),(306,140),(308,170),(302,182),(280,186),(255,182),(240,175),(228,160),(222,135),(221,112)])
save('head_idle', np.concatenate([idle[..., :3], (idle[..., 3] * head)[..., None]], -1))
hull = poly([(115,262),(118,160),(140,100),(180,86),(222,88),(250,104),(276,124),(294,152),(304,192),(312,230),(312,288),(115,288)], 0) > 0.5
a = idle[..., 3] * (1 - head)
fur = (a > 0.95) & (idle[..., :3].max(-1) > 0.3) & (idle[..., :3].max(-1) < 0.6) & (idle[..., 0] - idle[..., 2] > 0.15) & (idle[..., 1] > 0.15) & (idle[..., 0] - idle[..., 1] < 0.28)
fill = hull & (head > 0.02)
body = np.concatenate([idle[..., :3], a[..., None]], -1)
body[fill, :3] = np.median(idle[fur][:, :3], 0); body[fill, 3] = 1
save('body_idle', body)
NECK, SHOULDER = (226, 176), (278, 150)
parts = {
  'body': {'file': 'body.png', 'pivot': list(ROOT), 'z': 0},
  'body_idle': {'file': 'body_idle.png', 'pivot': list(ROOT), 'variantOf': 'body'},
  'fist_far': {'file': 'fist_far.png', 'pivot': [154, 143], 'parent': 'body', 'joint': [154, 143], 'z': 1},
  'head': {'file': 'head.png', 'pivot': list(NECK), 'parent': 'body', 'joint': list(NECK), 'z': 3},
  'head_open': {'file': 'head_open.png', 'pivot': list(NECK), 'variantOf': 'head'},
  'head_idle': {'file': 'head_idle.png', 'pivot': list(NECK), 'variantOf': 'head'},
  'arm': {'file': 'arm.png', 'pivot': list(SHOULDER), 'parent': 'body', 'joint': list(SHOULDER), 'z': 4},
  'arm_ext': {'file': 'arm_ext.png', 'pivot': list(SHOULDER), 'variantOf': 'arm'},
  'arm_cross': {'file': 'arm_cross.png', 'pivot': list(SHOULDER), 'variantOf': 'arm'},
}
json.dump({'schema': 'rig-parts/1', 'scale': 0.4666667, 'root': 'body', 'rootAt': list(ROOT), 'parts': parts,
           'sockets': {'item': {'part': 'arm', 'at': [330, 190], 'angle': 90}}}, open(f'{OUT}/parts.json', 'w'), indent=1)
print('ok')
