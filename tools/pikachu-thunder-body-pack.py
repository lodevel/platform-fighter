"""Pack visually accepted Thunder body outputs with sourced branch-local clocks."""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
E = ROOT / 'docs/review/2026-10-06/pikachu-character'
B = E / 'art'
OUT = ROOT / 'assets/characters/pikachu'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
ROUTES = {
    'thunder-ground': ('down_special', [0, 4, 12, 16, 24, 32, 46], 86),
    'thunder-air': ('down_special_air', [0, 4, 12, 16, 24, 32, 46], 86),
    'thunder-self-ground': ('down_special_hit', [0, 1, 3, 6, 15, 24, 35], 41),
    'thunder-self-air': ('down_special_air_hit', [0, 1, 3, 6, 15, 24], 35),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=ROUTES)
    args = parser.parse_args()
    sheet, samples, total = ROUTES[args.action]
    clock = E / 'sources/special-runtime-clock-contract.json'
    if not clock.exists():
        raise ValueError('Durable sourced branch-local clock contract required')
    clockdata = json.loads(clock.read_text())
    for file in clockdata['files']:
        if sha(ROOT / file['path']) != file['sha256']:
            raise ValueError('Changed special clock source ' + file['path'])
    branch = 'ground_hit' if args.action == 'thunder-self-ground' else 'air_hit' if args.action == 'thunder-self-air' else 'no_hit'
    mapping = clockdata['thunder_body'][branch]
    if mapping['native_rate'] != 1 or mapping['action_zero_based'] != [0, total] or mapping['art_samples_in_action'] != samples:
        raise ValueError('Packing timeline disagrees with sourced branch contract')
    ledger = json.loads((B / 'thunder-generation-ledger.json').read_text())
    prep = json.loads((B / 'thunder-pilot-preparation.json').read_text())
    cells, sources = [], []
    for sample in samples:
        source_action = args.action.replace('thunder-self-', 'thunder-self-contact-')
        key = f'{source_action}-sample{sample}-source{sample}'
        original = next(r for r in prep['records'] if r['key'] == key)
        entry = next(r for r in ledger if r['pose_key'] == key and r['state'] == 'accepted')
        review = B / (entry.get('visual_review') or entry['review_file'])
        accepted = json.loads(review.read_text())
        output = B / entry['outputs']['cutout']['file']
        if accepted['state'] not in ['accepted_for_rough_preview', 'accepted_for_rough_body_batch_expansion'] or accepted['cutoutSha256'] != sha(output):
            raise ValueError('Unreviewed/stale Thunder body output')
        if sha(ROOT / original['native_reference_metadata']) != original['native_reference_metadata_sha256']:
            raise ValueError('Changed native body reference')
        im = Image.open(output).convert('RGBA')
        if im.size != (2048, 2048):
            raise ValueError('Wrong Thunder root canvas')
        cells.append(im.resize((512, 512), Image.Resampling.LANCZOS))
        sources.append({'sourceKey': key, 'nativeSample': sample, 'file': str(output.relative_to(ROOT)),
                        'sha256': sha(output), 'review': str(review.relative_to(ROOT)), 'reviewSha256': sha(review),
                        'translation': [0, 0], 'scale': .25, 'crop': None})
    strip = Image.new('RGBA', (512 * len(cells), 512))
    for i, cell in enumerate(cells):
        strip.paste(cell, (512 * i, 0))
    target = OUT / 'animations' / (sheet + '.png')
    strip.save(target)
    gallerydir = E / 'thunder-body/packed-preparation'
    gallerydir.mkdir(parents=True, exist_ok=True)
    galleries = {}
    for start in range(0, len(cells), 4):
        group = cells[start:start + 4]
        gallery = Image.new('RGB', (1024, 548 * len(group)), '#17253a')
        draw = ImageDraw.Draw(gallery)
        for i, cell in enumerate(group):
            draw.text((8, i * 548 + 6), f'{sheet} / actual cell{start+i} / native/local{samples[start+i]}', fill='white')
            for side, color in enumerate(['#f7f5ef', '#17253a']):
                bg = Image.new('RGBA', (512, 512), color)
                bg.alpha_composite(cell)
                gallery.paste(bg.convert('RGB'), (side * 512, i * 548 + 30))
        path = gallerydir / f'{sheet}-cells-{start//4+1}.png'
        gallery.save(path)
        galleries[str(path.relative_to(ROOT))] = sha(path)
    record = {
        'state': 'packed_output_visual_and_runtime_review_required',
        'scope': 'Accepted rough Thunder body only; electrical effects and running-match verification separate',
        'coordinateContract': {'canonicalCanvas': [2048, 2048], 'canonicalRoot': [1024, 1664],
                               'frameWidth': 512, 'frameHeight': 512, 'root': [256, 416],
                               'scaleToWorld': 4 * 70 / 600, 'bodyCentreFromRoot': [0, -25]},
        'clockContract': str(clock.relative_to(ROOT)), 'clockContractSha256': sha(clock),
        'animations': {sheet: {'strip': str(target.relative_to(OUT)), 'frameCount': len(cells), 'sha256': sha(target),
                               'frameWindows': [{'startFrame': n, 'endFrame': samples[i+1] if i+1<len(samples) else total,
                                                 'artFrameIndex': i} for i, n in enumerate(samples)]}},
        'sources': sources, 'galleries': galleries,
        'discardedPostActionNativeSamples': [r['native_sample_index'] for r in prep['records']
                                            if r['action'] == args.action.replace('thunder-self-', 'thunder-self-contact-') and r['native_sample_index'] >= total],
    }
    path = OUT / 'pose-batches' / (args.action + '.json')
    path.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'sheet': sheet, 'cells': len(cells), 'review': 'actual packed-cell review required'}))


if __name__ == '__main__':
    main()
