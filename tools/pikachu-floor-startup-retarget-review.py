"""CPU-only bounded Bthrow5 head-tilt and16 foot-tilt investigation.

Original source/gameplay/art remain immutable. Rotate local posed subtrees
around their existing joints; no head/body translation or shrink is used.
Mesh guides omit constraints/material animation and cannot grant acceptance.
"""
from pathlib import Path
import sys, importlib.util, json, math
sys.path[:0] = ['/tmp/pikachu-source-libs', str(Path(__file__).parent)]
import numpy as np
from PIL import Image, ImageDraw
from pikachu_native_pose import ROOT, MOTIONS, PikachuNativePose, sha
spec = importlib.util.spec_from_file_location('nativeguide', ROOT / 'tools/pikachu-native-guide.py')
guide = importlib.util.module_from_spec(spec); spec.loader.exec_module(guide)
OUT = ROOT / 'docs/review/2026-10-06/pikachu-character/sources/floor-startup-retarget-pilot'
OUT.mkdir(parents=True, exist_ok=True)
if '--combined-tail' in sys.argv:
    OUT = OUT / 'combined-tail'
    OUT.mkdir(parents=True, exist_ok=True)

def subtree(pose, bone):
    anchor = pose.bones[bone.lower()]
    result = set()
    for index, row in enumerate(pose.skeleton.bones):
        cursor = index
        while cursor is not None:
            if cursor == anchor:
                result.add(row.name.lower()); break
            cursor = pose.skeleton.bones[cursor].parent_index
    return result

def rotation(pivot, degrees):
    angle = math.radians(degrees); m = np.eye(4)
    m[:3, :3] = [[1, 0, 0], [0, math.cos(angle), -math.sin(angle)],
                 [0, math.sin(angle), math.cos(angle)]]
    m[:3, 3] = pivot - m[:3, :3] @ pivot
    return m

class TargetPose(PikachuNativePose):
    headAngle = 0
    footAngle = 0
    tailAngle = 0
    def matrices(self, frame, names, bind_pose=False):
        requested = list(dict.fromkeys([*names, 'Head', 'FootR', 'FootL', 'Tail1']))
        original = super().matrices(frame, requested, bind_pose)
        world = {n: m.copy() for n, m in original.items()}
        if not bind_pose:
            for bone, angle in [('Head', self.headAngle), ('FootR', self.footAngle), ('FootL', self.footAngle), ('Tail1', self.tailAngle)]:
                delta = rotation(original[bone][:3, 3], angle)
                affected = subtree(self, bone)
                for name in names:
                    if name.lower() in affected: world[name] = delta @ original[name]
        return {n: world[n] for n in names}

guide.PikachuNativePose = TargetPose
guide.SIZE = (512, 640); guide.ART_ROOT = (256, 416)
guide.ART_PIXELS_PER_UNIT = 5 / (4 * 70 / 600)
guide.ROOT_REGISTRATION = 'remove-trans-translation'
cases = [(5, angle, 0, 0) for angle in [0, -10, 10, -20, 20, -40, 40]]
cases += [(16, 0, angle, 0) for angle in [0, -10, 10, -20, 20]]
if '--combined-tail' in sys.argv:
    cases = [(5, head, 0, tail) for head in [0, 10, 20] for tail in [10, 20, 30]]
rows = []
for native, head, feet, tail in cases:
    TargetPose.headAngle = head; TargetPose.footAngle = feet; TargetPose.tailAngle = tail
    stem = OUT / f'bthrow-{native}-head{head}-feet{feet}'
    if tail: stem = OUT / (stem.name + f'-tail{tail}')
    if not stem.with_suffix('.json').exists(): guide.render('e01throwb', native, stem)
    path = Path(str(stem) + '-reference.png'); im = Image.open(path).convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a >= 32 else 0).getbbox()
    panel = Image.new('RGBA', im.size, '#17253a'); panel.alpha_composite(im)
    d = ImageDraw.Draw(panel); d.line((0, 416, 512, 416), fill='#ff5968', width=1)
    d.text((8, 8), f'Bthrow{native} head{head} feet{feet} tail{tail} LOCAL rotations', fill='white')
    panel.save(str(stem) + '-review.png')
    rows.append({'nativeSample': native, 'headAngleDegrees': head, 'footAngleDegrees': feet, 'tailAngleDegrees': tail,
                 'reference': str(path.relative_to(ROOT)), 'referenceSha256': sha(path),
                 'reviewPanel': str(Path(str(stem) + '-review.png').relative_to(ROOT)),
                 'alpha32Bounds': box, 'alpha32BelowFootRootWorldPx': (box[3] - 1 - 416) * (4 * 70 / 600)})
for frame in [5, 16]:
    selected = [r for r in rows if r['nativeSample'] == frame]
    if not selected: continue
    gallery = Image.new('RGB', (512 * 4, 640 * math.ceil(len(selected) / 4)), '#17253a')
    for index, row in enumerate(selected):
        gallery.paste(Image.open(ROOT / row['reviewPanel']).convert('RGB'), (index % 4 * 512, index // 4 * 640))
    gallery.save(OUT / f'bthrow-{frame}-local-rotation-gallery.png')
result = {'state': 'CPU source-guide investigation pending actual inspection; no live/generator changes',
          'toolSha256': sha(Path(__file__)), 'sourceMotionSha256': sha(MOTIONS / 'e01throwb.nuanmb'),
          'rules': ['Existing posed joints, lengths, body/root/scale and Trans retained',
                    'Head and ears rotate together about existing Head/Neck attachment; no head translation',
                    'Feet rotate locally about existing FootR/L, unchanged knees and root',
                    'Approximate source-guide only, output/12caps/runtime remain unqualified'], 'cases': rows}
(OUT / 'preparation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'cases': len(rows), 'bounds': [(r['nativeSample'], r['headAngleDegrees'], r['footAngleDegrees'], r['alpha32BelowFootRootWorldPx']) for r in rows]}))
