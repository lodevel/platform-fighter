"""Strips at match size. Rig and today rows are lab-capture.mjs frames (drawn by the lab itself at zoom 1.4);
the Ultimate row, when given, is the target as tools/rig-pose-fit.py registered it (--images sheets: target
on the left half of a page-pixel canvas given by --canvas), scaled to match size the same way.
  python strips.py ACTION TICKS OUT.png --row "rig, generated parts=CAPTURE_DIR:rig" --row "today=CAPTURE_DIR:today"
         [--fit-images DIR --canvas 460,320,200,290] [--mag 2] [--cell 210,168,92,152]"""
import argparse, os
from PIL import Image, ImageDraw
MATCH = 0.4666667 * 1.4  # screen px per page px at match zoom
BG = (20, 24, 38, 255)
ap = argparse.ArgumentParser(); ap.add_argument('action'); ap.add_argument('ticks'); ap.add_argument('out')
ap.add_argument('--row', action='append', default=[], help='LABEL=CAPTURE_DIR:SUFFIX (frames <action>-<tick>-<suffix>.png)')
ap.add_argument('--fit-images'); ap.add_argument('--canvas', default='460,320,200,290'); ap.add_argument('--mag', type=float, default=1)
ap.add_argument('--cell', default='210,168,92,152', help='cell width, height and root x, y at mag 1')
a = ap.parse_args()
ticks = [int(t) for t in a.ticks.split(',')] if ',' in a.ticks else list(range(int(a.ticks.split('-')[0]), int(a.ticks.split('-')[1]) + 1))
CW, CH, RX, RY = (int(v) for v in a.canvas.split(',')); c = [int(v) for v in a.cell.split(',')]
m = a.mag; cw, ch, root = round(c[0] * m), round(c[1] * m), (c[2] * m, c[3] * m)


def lab_cell(path):
    if not os.path.exists(path): return None
    im = Image.open(path).convert('RGBA'); rx, ry = im.width // 2 * m, round(im.height * 0.8) * m
    if m != 1: im = im.resize((round(im.width * m), round(im.height * m)), Image.LANCZOS)
    x, y = round(rx - root[0]), round(ry - root[1])
    return im.crop((x, y, x + cw, y + ch))


def ult_cell(tick):
    path = os.path.join(a.fit_images, f'{a.action}-{tick:03d}.png')
    if not os.path.exists(path): return None
    s = MATCH * m; im = Image.open(path).convert('RGBA').crop((0, 0, CW, CH)).resize((round(CW * s), round(CH * s)), Image.LANCZOS)
    cell = Image.new('RGBA', (cw, ch), BG); cell.alpha_composite(im, (round(root[0] - RX * s), round(root[1] - RY * s))); return cell


rows = [('Ultimate (UFD)', ult_cell)] if a.fit_images else []
for spec in a.row:
    label, where = spec.split('=', 1); folder, suffix = where.rsplit(':', 1)
    rows.append((label, lambda t, folder=folder, suffix=suffix: lab_cell(os.path.join(folder, f'{a.action}-{t:03d}-{suffix}.png'))))
pad, label_w = 3, 130
sheet = Image.new('RGB', (label_w + len(ticks) * (cw + pad), 18 + len(rows) * (ch + pad)), (248, 248, 248)); d = ImageDraw.Draw(sheet)
for j, t in enumerate(ticks): d.text((label_w + j * (cw + pad) + 3, 3), f'tick {t}', fill=(0, 0, 0))
for i, (name, make) in enumerate(rows):
    d.multiline_text((4, 18 + i * (ch + pad) + ch // 2 - 12), name.replace(', ', ',\n'), fill=(0, 0, 0))
    for j, t in enumerate(ticks):
        cell = make(t)
        if cell is not None: sheet.paste(cell.convert('RGB'), (label_w + j * (cw + pad), 18 + i * (ch + pad)))
sheet.save(a.out); print(a.out, sheet.size)
