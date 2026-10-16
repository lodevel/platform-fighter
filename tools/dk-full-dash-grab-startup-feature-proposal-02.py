"""Own dash feature proposal. Preflight is stdlib-only; raster requires a slot.

Source polygons constrain material candidates. They are not accepted target
anatomy, digit receiving regions, or permission to fill real negative spaces.
"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
PLAN = ART / 'full-dash-grab-startup-own-feature-authoring-plan-02.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pin(path):
    return {'path': str(path.relative_to(ROOT)), 'sha256': sha(path)}


def verify(ref):
    path = ROOT / ref['path']
    if sha(path) != ref['sha256']:
        raise ValueError(f'Changed own input: {path}')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-plan-sha256', required=True)
    parser.add_argument('--source-feature-proposal-slot-released', action='store_true')
    args = parser.parse_args()
    if sha(PLAN) != args.expected_plan_sha256:
        raise ValueError('Own feature plan pin differs')
    plan = json.loads(PLAN.read_text())
    verify(plan['contract'])
    verify(plan['actualGuideReview'])
    for row in plan['poses']:
        metadata = json.loads(verify(row['sourceGuide']).read_text())
        if (row['clip'] != 'dash_grab' or row['nativeSample'] not in [1, 4]
                or metadata['native_sample_index'] != row['nativeSample']
                or metadata['motion'] != plan['sourceMotion']
                or metadata['canvas'] != [1536, 1024]
                or metadata['root'] != [512, 832]):
            raise ValueError('Own native source registration differs')
        for ref in row['sourceImages']:
            verify(ref)
        for domain in row['opacityRepairDomains'] + row['paintDomains']:
            if len(domain['polygon']) < 3 or any(
                    not (0 <= x < 1536 and 0 <= y < 1024)
                    for x, y in domain['polygon']):
                raise ValueError('Feature polygon outside own source canvas')
        for eye in row['eyes']:
            for key in ['scleraBox', 'pupilBox']:
                x0, y0, x1, y1 = eye[key]
                if not (0 <= x0 < x1 < 1536 and 0 <= y0 < y1 < 1024):
                    raise ValueError('Own ocular rectangle invalid')
        if row['sourceSupport']['sourceAlpha32LastPixelY'] != row['sourceSupport']['lastPixelY']:
            raise ValueError('Repair may not move support without a new review')
    if not args.source_feature_proposal_slot_released:
        print(json.dumps({'state': 'OWN_DASH_FEATURE_TOOL_PREFLIGHT_ONLY',
                          'plan': pin(PLAN), 'tool': pin(Path(__file__)),
                          'poses': [r['nativeSample'] for r in plan['poses']],
                          'PillowOrNumpyImported': False, 'rasterExecuted': False}))
        return

    # Delayed imports keep the preparation/preflight path lightweight.
    import numpy as np
    from PIL import Image, ImageDraw
    from scipy.ndimage import binary_fill_holes, distance_transform_edt

    recipe_path = ART / 'full-dash-grab-startup-own-feature-raster-proposal-02.json'
    if recipe_path.exists():
        raise ValueError('Preserve earlier proposal and all trial images')
    rows = []
    for row in plan['poses']:
        n = row['nativeSample']
        prefix = ART / f'fullgrab01-dash_grab-native{n}'
        output_prefix = ART / f'fullgrab01-dash_grab-native{n}-feature-proposal02'
        suffixes = ['-domains.png', '-face-before-after.png', '-alpha-before-after.png', '-proposed-seed.png']
        if any(Path(str(output_prefix) + s).exists() for s in suffixes):
            raise ValueError('Preserve partial own feature trial outputs')
        alpha = np.asarray(Image.open(str(prefix) + '-mask.png').convert('L'))
        source = Image.open(str(prefix) + '-palette-seed.png').convert('RGB')
        rgb = np.asarray(source)
        on = alpha >= 32
        last = int(np.where(on)[0].max())
        if last != row['sourceSupport']['sourceAlpha32LastPixelY']:
            raise ValueError('Own raw alpha support measurement changed')
        envelope = binary_fill_holes(on)
        depth = distance_transform_edt(envelope)
        selection = np.zeros(on.shape, bool)
        domains = []
        for domain in row['opacityRepairDomains']:
            mask = Image.new('L', source.size)
            ImageDraw.Draw(mask).polygon(domain['polygon'], fill=255)
            selected = np.asarray(mask) > 0
            selection |= selected
            domains.append({**domain, 'candidatePartialOrZeroPixels': int(
                (selected & envelope & (depth > 3) & (alpha < 255)).sum())})
        exclusions = np.zeros(on.shape, bool)
        for box in row['retainedRealGapBoxes']:
            x0, y0, x1, y1 = box
            exclusions[y0:y1, x0:x1] = True
        repair_mask = selection & envelope & (depth > 3) & (alpha < 255) & ~exclusions
        repairs = []
        for y, x in np.argwhere(repair_mask):
            existing_cream = on[y, x] and rgb[y, x, 0] > 240 and rgb[y, x, 1] > 150
            repairs.append({'pixel': [int(x), int(y)], 'beforeAlpha': int(alpha[y, x]),
                            'afterAlpha': 255, 'RGB': [255, 211, 145] if existing_cream else [190, 22, 5]})
        repaired = alpha.copy()
        repaired[repair_mask] = 255
        if (not np.array_equal(binary_fill_holes(repaired >= 32), envelope)
                or not np.array_equal(alpha[exclusions], repaired[exclusions])):
            raise ValueError('External silhouette or retained pose gaps changed')
        if int(np.where(repaired >= 32)[0].max()) != last:
            raise ValueError('Local material repair changed the support pixel')

        proposed = source.copy()
        a = np.asarray(proposed).copy()
        for repair in repairs:
            x, y = repair['pixel']
            a[y, x] = repair['RGB']
        proposed = Image.fromarray(a)
        draw = ImageDraw.Draw(proposed)
        for domain in row['paintDomains']:
            draw.polygon(domain['polygon'], fill=tuple(domain['RGB']))
        for eye in row['eyes']:
            draw.ellipse(eye['scleraBox'], fill=(253, 250, 238))
            draw.ellipse(eye['pupilBox'], fill=(20, 12, 7))
        proposed_rgb = np.asarray(proposed).copy()
        proposed_rgb[repaired < 32] = [204, 73, 140]
        proposed = Image.fromarray(proposed_rgb)
        proposed.save(str(output_prefix) + '-proposed-seed.png')
        annotated = source.copy()
        draw = ImageDraw.Draw(annotated)
        for domain in domains:
            draw.line(domain['polygon'] + [domain['polygon'][0]], fill=(30, 220, 230), width=3)
        for domain in row['paintDomains']:
            draw.line(domain['polygon'] + [domain['polygon'][0]], fill=(250, 250, 238), width=2)
        for name, box in row['handInspectionBoxes'].items():
            draw.rectangle(box, outline=(60, 235, 70), width=3)
            draw.text((box[0], box[1] - 14), name, fill=(60, 235, 70))
        for box in row['retainedRealGapBoxes']:
            draw.rectangle(box, outline=(250, 215, 45), width=2)
        annotated.save(str(output_prefix) + '-domains.png')
        crop = tuple(row['faceInspectionBox'])
        face_view = Image.new('RGB', (960, 400), (30, 34, 42))
        face_view.paste(source.crop(crop).resize((480, 400)), (0, 0))
        face_view.paste(proposed.crop(crop).resize((480, 400)), (480, 0))
        face_view.save(str(output_prefix) + '-face-before-after.png')
        alpha_view = Image.new('RGB', (1536, 512))
        alpha_view.paste(Image.fromarray(alpha).resize((768, 512)).convert('RGB'), (0, 0))
        alpha_view.paste(Image.fromarray(repaired).resize((768, 512)).convert('RGB'), (768, 0))
        alpha_view.save(str(output_prefix) + '-alpha-before-after.png')
        rows.append({**row, 'sourceGuideMetadataSha256': row['sourceGuide']['sha256'],
                     'reviewedMaterialAlphaRepairs': repairs,
                     'materialRepairDiagnostics': {'exactPixelCount': len(repairs),
                         'alphaZeroPixels': int((repair_mask & (alpha == 0)).sum()),
                         'externalAlpha32EnvelopeIdentical': True,
                         'excludedRealGapsAllAlphaIdentical': True,
                         'supportUnchanged': True},
                     'actualFeatureTrialImageReview': 'pending',
                     'proposalViews': [pin(Path(str(output_prefix) + s)) for s in suffixes],
                     'targetHandROIs': None})
    recipe = {'state': 'OWN_DASH_EXACT_MATERIAL_RGB_ALPHA_FEATURE_PROPOSAL_ACTUAL_VIEWS_PENDING',
              'contractSha256': plan['contract']['sha256'], 'authoringPlan': pin(PLAN),
              'tool': pin(Path(__file__)), 'actualSourceGuideAndFeatureDomainsReviewed': False,
              'poses': rows, 'sourceFilesUnchanged': True, 'GPUUsed': False,
              'inputAssemblyExecuted': False, 'actualGeneratedArtAccepted': False}
    recipe_path.write_text(json.dumps(recipe, indent=2) + '\n')
    print(json.dumps({'recipe': pin(recipe_path), 'poses': [
        {'nativeSample': r['nativeSample'], 'materialRepairDiagnostics': r['materialRepairDiagnostics']}
        for r in rows]}))


if __name__ == '__main__':
    main()
