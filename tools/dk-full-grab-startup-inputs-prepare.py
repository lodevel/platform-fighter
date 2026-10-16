"""Assemble the first two standing-grab inputs after actual source-guide review.

Does not evaluate native poses, contact Comfy, queue generation or ship art.
Exact authored feature domains must be supplied in a separately reviewed recipe.
"""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
CONTRACT = ART / 'full-grab-startup-generation-contract-01.json'
BG = (204, 73, 140)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def pin(p):
    return {'path': str(p.relative_to(ROOT)), 'sha256': sha(p)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', type=Path, required=True)
    parser.add_argument('--reviewed-input-preparation-slot-released', action='store_true')
    args = parser.parse_args()
    if not args.reviewed_input_preparation_slot_released:
        raise ValueError('Root must release input preparation after actual guide/feature review')
    contract = json.loads(CONTRACT.read_text())
    recipe = json.loads(args.features.read_text())
    if recipe.get('actualSourceGuideAndFeatureDomainsReviewed') is not True:
        raise ValueError('Actual eye/brow/tie/material domains must be reviewed; no guessed coordinates')
    if recipe['contractSha256'] != sha(CONTRACT):
        raise ValueError('Feature recipe refers to another graph contract')
    for p in contract['inputPins']:
        if sha(ROOT / p['path']) != p['sha256']:
            raise ValueError('Changed pinned graph/identity/plan input')
    prefix = contract['jobFamily']
    output = ART / (prefix + '-preparation.json')
    if output.exists() or any(ART.glob(prefix + '-*-authored-*.png')):
        raise ValueError('Preserve prior prepared inputs; create a reviewed versioned derivative')
    canvas = Image.new('RGB', (1536, 1024), BG)
    guides = Image.new('L', canvas.size)
    noise = Image.new('L', canvas.size)
    reference = Image.open(ROOT / contract['reference']['path']).convert('RGBA')
    refcell = Image.new('RGBA', (768, 512), BG + (255,))
    refcell.alpha_composite(reference.resize((768, 512), Image.Resampling.LANCZOS))
    canvas.paste(refcell.convert('RGB'), (0, 0))
    records = []
    for row in contract['poses']:
        feature = next(f for f in recipe['poses'] if f['nativeSample'] == row['nativeSample'])
        source = ART / row['guidePrefix']
        metadata = Path(str(source) + '.json')
        if sha(metadata) != feature['sourceGuideMetadataSha256']:
            raise ValueError('Unreviewed native guide bytes')
        native = json.loads(metadata.read_text())
        if native['root'] != [512, 832] or native['canvas'] != [1536, 1024]:
            raise ValueError('Changed constant registration')
        for filename, digest in native['output_files'].items():
            if sha(ART / filename) != digest:
                raise ValueError('Native guide artifact changed')
        alpha = np.asarray(Image.open(str(source) + '-mask.png').convert('L')).copy()
        original_alpha = alpha.copy()
        for repair in feature.get('reviewedMaterialAlphaRepairs', []):
            x, y = repair['pixel']
            if int(original_alpha[y,x]) != repair['beforeAlpha']:
                raise ValueError('Material repair original alpha differs')
            if repair['afterAlpha'] != 255 or len(repair['RGB']) != 3:
                raise ValueError('Reviewed material repair requires opaque authored RGB')
            alpha[y,x] = repair['afterAlpha']
        visible = alpha >= 32
        last = int(np.where(visible)[0].max())
        if last < 760:
            raise ValueError('Source support band requires separate adapter review')
        seed = np.asarray(Image.open(str(source) + '-palette-seed.png').convert('RGB')
                          .filter(ImageFilter.MedianFilter(21))).copy()
        palette = np.asarray([[190,22,5],[233,16,1],[255,211,145],[252,250,238],[24,15,10]], dtype=np.int16)
        distance = ((seed.astype(np.int16)[:,:,None,:] - palette[None,None,:,:]).astype(np.float32)**2).sum(3)
        seed[visible] = palette[distance.argmin(2)][visible]
        for repair in feature.get('reviewedMaterialAlphaRepairs', []):
            x, y = repair['pixel']
            seed[y,x] = repair['RGB']
        seed[~visible] = BG
        image = Image.fromarray(seed)
        draw = ImageDraw.Draw(image)
        for region in feature['paintDomains']:
            draw.polygon(region['polygon'], fill=tuple(region['RGB']))
        for eye in feature['eyes']:
            draw.ellipse(eye['scleraBox'], fill=(253,250,238))
            draw.ellipse(eye['pupilBox'], fill=(20,12,7))
        # Authored guide RGB changes cannot create a new external source shape.
        before = np.asarray(image).copy()
        before[~visible] = BG
        changed = visible & np.any(before != seed, axis=2)
        def warp(im):
            out = Image.new(im.mode, (1536,1024), 0 if im.mode == 'L' else BG)
            out.paste(im.crop((0,0,1536,760)), (0,0))
            out.paste(im.crop((0,760,1536,last+1)).resize((1536,71),
                      Image.Resampling.NEAREST if im.mode == 'L' else Image.Resampling.BICUBIC), (0,760))
            return out
        rgb = warp(Image.fromarray(before))
        support = warp(Image.fromarray(alpha))
        afile = ART / f'{prefix}-native{row["nativeSample"]}-authored-alpha.png'
        sfile = ART / f'{prefix}-native{row["nativeSample"]}-authored-seed.png'
        rgb.save(sfile)
        support.save(afile)
        half = rgb.resize((768,512), Image.Resampling.LANCZOS)
        a = np.asarray(half).astype(int)
        edges = np.zeros((512,768), bool)
        for axis in [0,1]:
            edges |= np.max(np.abs(a - np.roll(a,1,axis)), axis=2) > 35
        gx, gy = row['cellPosition']
        canvas.paste(half, (gx,gy))
        guides.paste(Image.fromarray((edges*255).astype(np.uint8)), (gx,gy))
        noise.paste(support.resize((768,512), Image.Resampling.LANCZOS)
                    .filter(ImageFilter.MaxFilter(11)), (gx,gy))
        records.append({**row, 'sourceGuide': pin(metadata), 'authoredSeed': pin(sfile),
                        'authoredAlpha': pin(afile), 'changedGuideRGBPixels': int(changed.sum()),
                        'materialAlphaRepairs': feature.get('reviewedMaterialAlphaRepairs', []),
                        'floorTransform': {'inputBandStartPixelY':760, 'inputLastPixelY':last,
                                           'targetLastPixelY':830, 'inclusiveRowsRatio':71/(last-760+1),
                                           'rootPixelY':832, 'pixelsPerNativeUnit':26},
                        'actualAuthoredInputReview':'pending'})
    inputs = {}
    for node, kind, image in [('10','guide',guides),('13','seed',canvas),('16','render-mask',noise)]:
        path = ART / f'{prefix}-{kind}.png'
        if path.exists():
            raise ValueError('Preserve prior atlas input')
        image.save(path)
        inputs[kind] = {**pin(path), 'graphNode':node,
                        'serverFilename':contract['serverInputNames'][kind]}
    graph = ROOT / contract['workflow']['path']
    receipt = {'state':'actual authored inputs pending root review; no prompt submitted',
               'contract':pin(CONTRACT), 'featureRecipe':pin(args.features.resolve()),
               'jobFamily':prefix, 'attempt':1, 'records':records, 'inputs':inputs,
               'workflow':pin(graph), 'canvas':[1536,1024], 'cells':[768,512],
               'root':[256,416], 'scaleToWorld':5/13, 'bodyCentreFromRootY':-42,
               'reference':contract['reference'], 'outputNodes':{'9':'final','20':'raw'},
               'GPUUsed':False, 'shippingChanged':False, 'actualInputInspection':'pending'}
    output.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(pin(output)))


if __name__ == '__main__':
    main()
