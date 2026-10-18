"""Test poses beside today's drawings at match size (0.4666667 design px x zoom 1.4 per source px) and at 2x that.

usage: python compare.py POSES.json OUT_PREFIX label=PARTS_DIR [label=PARTS_DIR ...]
Rows: test poses; columns: today's drawing (placed by its root anchor), then each part set.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).parent))
import rig

PKG = Path('/home/lombet/Workspace/platform-fighter/.tmp/character-packages/donkeykong')
TODAY = {'punch_straight': 'jab/1', 'guard': 'jab/4', 'punch': 'jab/1', 'crouch': 'crouch/0', 'idle': 'idle/0', 'crouch_hand': 'crouch/0', 'punch_hand': 'jab/1'}
MATCH = 0.4666667 * 1.4
BG = (34, 38, 52, 255)


def today(did):
    p = json.loads((PKG / 'character.json').read_text())
    d = p['drawings'][did]
    page = Image.open(PKG / p['pages'][d['page']]['file']).convert('RGBA')
    x, y, w, h = d['rect']
    return page.crop((x, y, x + w, y + h)), d['anchor']


def main():
    poses = json.loads(Path(sys.argv[1]).read_text())
    out = sys.argv[2]
    sets = [(a.split('=', 1)[0], rig.load(a.split('=', 1)[1])) for a in sys.argv[3:]]
    cols = ['today'] + [s[0] for s in sets]
    for mag, suffix in ((MATCH, 'match'), (2 * MATCH, 'x2')):
        cw, ch = int(400 * mag), int(300 * mag)
        root = (int(150 * mag), int(270 * mag))
        sheet = Image.new('RGBA', (90 + cw * len(cols), 18 + ch * len(poses)), (250, 250, 250, 255))
        dr = ImageDraw.Draw(sheet)
        for c, label in enumerate(cols):
            dr.text((90 + c * cw + 4, 3), label, fill=(0, 0, 0))
        for r, (name, pose) in enumerate(poses.items()):
            dr.text((4, 18 + r * ch + 4), f"{name}\n{pose['source']}\nvs {TODAY.get(name, '-')}", fill=(0, 0, 0))
            cells = []
            img, anchor = today(TODAY[name])
            cell = Image.new('RGBA', (cw, ch), BG)
            im = img.resize((round(img.width * mag), round(img.height * mag)), Image.Resampling.LANCZOS)
            cell.alpha_composite(im, (round(root[0] - anchor[0] * mag), round(root[1] - anchor[1] * mag)))
            cells.append(cell)
            for _, (spec, imgs) in sets:
                cell = Image.new('RGBA', (cw, ch), BG)
                cell.alpha_composite(rig.render(spec, imgs, pose, mag, (cw, ch), root))
                cells.append(cell)
            for c, cell in enumerate(cells):
                sheet.paste(cell, (90 + c * cw, 18 + r * ch))
        sheet.convert('RGB').save(f'{out}-{suffix}.png')
        print(f'{out}-{suffix}.png', sheet.size)


if __name__ == '__main__':
    main()
