"""Contact sheet of a part set: every part at 2x on light and dark tiles, pivot (red) and child joints (blue),
plus the assembled rest pose. usage: python contact.py PARTS_DIR OUT.png [TITLE]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).parent))
import rig

MAG = 2


def tile(im, bg):
    t = Image.new('RGBA', im.size, bg); t.alpha_composite(im); return t


def main():
    spec, imgs = rig.load(sys.argv[1])
    title = sys.argv[3] if len(sys.argv) > 3 else sys.argv[1]
    order = sorted(spec['parts'], key=lambda n: (spec['parts'][n]['parent'] is not None, n))
    cells = []
    for n in order:
        p = spec['parts'][n]
        im = imgs[n].resize((imgs[n].width * MAG, imgs[n].height * MAG), Image.Resampling.NEAREST)
        a, b = tile(im, (236, 238, 242, 255)), tile(im, (34, 38, 52, 255))
        c = Image.new('RGBA', (im.width * 2 + 6, im.height + 16), (255, 255, 255, 255))
        c.paste(a, (0, 16)); c.paste(b, (im.width + 6, 16))
        d = ImageDraw.Draw(c)
        d.text((0, 2), f"{n} {p['size'][0]}x{p['size'][1]}", fill=(0, 0, 0))
        for off in (0, im.width + 6):
            x, y = p['pivot']; d.ellipse((off + x * MAG - 3, 16 + y * MAG - 3, off + x * MAG + 3, 16 + y * MAG + 3), fill=(255, 0, 0))
            for k, (x, y) in p['joints'].items():
                d.ellipse((off + x * MAG - 3, 16 + y * MAG - 3, off + x * MAG + 3, 16 + y * MAG + 3), fill=(0, 120, 255))
        cells.append(c)
    rest = rig.render(spec, imgs, {}, MAG, (420 * MAG // 2 * 2, 300 * MAG), (190 * MAG, 280 * MAG))
    restc = Image.new('RGBA', (rest.width, rest.height + 16), (255, 255, 255, 255))
    restc.paste(tile(rest, (236, 238, 242, 255)), (0, 16)); ImageDraw.Draw(restc).text((0, 2), 'assembled rest pose (2x)', fill=(0, 0, 0))
    W = 1700
    x = y = 0; rowh = 0; pos = []
    for c in cells:
        if x + c.width > W:
            x, y, rowh = 0, y + rowh + 12, 0
        pos.append((x, y)); x += c.width + 12; rowh = max(rowh, c.height)
    H = y + rowh + 12
    sheet = Image.new('RGB', (W, 24 + max(H, restc.height) if False else 24 + H + restc.height + 12), (255, 255, 255))
    ImageDraw.Draw(sheet).text((4, 4), title + '   (2x; red = pivot, blue = child joints)', fill=(0, 0, 0))
    for c, (x, y) in zip(cells, pos):
        sheet.paste(c, (x, 24 + y))
    sheet.paste(restc, (0, 24 + H))
    sheet.save(sys.argv[2])
    print(sys.argv[2], sheet.size)


if __name__ == '__main__':
    main()
