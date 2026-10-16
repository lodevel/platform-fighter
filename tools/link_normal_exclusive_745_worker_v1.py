"""Private selected-normal gear derivatives; exact anatomy reuse, no fit/game checks.

Each worker owns one shard ledger. Immutable original banks stay untouched.
"""
from pathlib import Path
import sys, os, json, hashlib, tempfile, time, fcntl, subprocess
sys.path[:0] = ['/tmp/pikachu-source-libs', 'tools']
import numpy as np
from PIL import Image, ImageDraw
from link_immutable_input_stage_v1 import ImmutableInputs, atomic_json, publish_cell
from link_normal_equipment_guide_v1 import render
from link_part_owned_equipment_v3 import apply
from link_physical_context_projection_v3_equipment import project

A = Path('docs/review/2026-10-12/link-character/rework/art')
D = A / 'normal-exclusive-equipment-745-bank-v1'
PLAN = D / 'plan.json'
RECIPE = A / 'full-motion-authored-cranium-four-v2/cranial-recipe.json'
SHARP_RECEIPT = A / 'packed-first133-two-times-proposal-v1/packing-receipt.json'
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
shard = int(sys.argv[1]); workers = 8
pilot = '--pilot' in sys.argv
continuation = '--continue' in sys.argv
viewport = '--viewport-v2' in sys.argv
plan = json.load(open(PLAN)); started = time.monotonic()
assert len(plan['rows']) == 745 and plan['noGameChecks'] is True
selected = plan['rows'][shard::workers]
if pilot:
    selected = [next(r for r in selected if r['needsSelectedGearDerivative'])]
prior = D/f'worker-{shard:02}/index.json'
if continuation:
    committed = json.load(open(prior))['rows']
    finished = {(r['resource'],r['nativeSample']) for r in committed}
    selected = [r for r in selected if (r['resource'],r['nativeSample']) not in finished]
if viewport: selected = [r for r in plan['rows'][shard::workers] if r['resource']=='c05attackairb']
folder = D / (f'viewport-v2-worker-{shard:02}' if viewport else f'pilot-{shard:02}' if pilot else f'continuation-{shard:02}' if continuation else f'worker-{shard:02}')
folder.mkdir(parents=True, exist_ok=True)
linux = Path(tempfile.mkdtemp(prefix=f'link-exclusive745-{shard:02}-'))
expected = dict(plan['inputHashes'])
for p in [PLAN, RECIPE, SHARP_RECEIPT, Path(__file__)]: expected[str(p)] = sha(p)
face_references = {}
retained_prefixes = {}
for r in selected:
    if not r['needsSelectedGearDerivative']: continue
    face = Path(r['originalPhysicalProjectionPrefix']+'-physical-face-source.png')
    if not face.exists():
        head_journal = A/'full-motion-authored-cranium-complete392-v4/cells'/(r['resource']+'-raw'+str(r['nativeSample'])+'.json')
        head = json.load(open(head_journal)); projection = Path(head['knownFaceEarProjection'])
        assert head['sourceRecord'] == r['sourceRecord'] and head['sourceRecordSha256'] == r['sourceRecordSha256']
        assert sha(projection) == head['knownFaceEarProjectionSha256']
        metadata = json.load(open(projection))['anatomicalHeadProjection']
        assert metadata['targetWholeBodySourceRecordSha256'] == r['sourceRecordSha256']
        assert metadata['bodyAuthoringGuideSha256'] == plan['inputHashes']['tools/link-authored-guide.py']
        face = Path(str(projection).replace('.json','-source.png'))
        for p in [head_journal, projection, face]: expected[str(p)] = sha(p)
    face_references[(r['resource'], r['nativeSample'])] = str(face)
    if viewport:
        key = r['resource']+'-raw'+str(r['nativeSample'])
        for previous in [D/f'continuation-{shard:02}/run.json', D/f'worker-{shard:02}/run.json']:
            if not previous.exists(): continue
            prefix = Path(json.load(open(previous))['linuxDirectory'])/key
            suffixes = ['.json','-final.png','-final.json','-final-authoring.json', '-physical.json',
                        '-physical-physical-region-provenance.json','-physical-physical-face-source.png']
            suffixes += [f'-physical-physical-region-{rr}.png' for rr in range(1,15)]
            if all(Path(str(prefix)+s).exists() for s in suffixes):
                retained_prefixes[(r['resource'],r['nativeSample'])] = prefix
                for s in suffixes: expected[str(prefix)+s] = sha(str(prefix)+s)
                break
memo = ImmutableInputs(expected, expected); memo.install()
recipe = json.load(open(RECIPE)); assert sha(RECIPE) == '452b752ff08725428af55f56989be3ad413697b7b7054809517a18b048d7baff'
theta, phi = np.meshgrid(np.linspace(0, 2*np.pi, 161), np.linspace(0, np.pi, 81))
unit = np.stack([np.cos(phi), np.sin(phi)*np.cos(theta), np.sin(phi)*np.sin(theta)], -1).reshape(-1, 3)
cranial = unit*np.asarray(recipe['radii']) + np.asarray(recipe['centre'])
sharp = json.load(open(SHARP_RECEIPT))
packed = {r['cell']: r for v in sharp['resources'].values() for p in v['pages'] for r in p['cells']}
ledger = {'state': 'AUTHORING_SELECTED_NORMAL_EQUIPMENT_ONLY', 'pid': os.getpid(), 'shard': shard,
          'linuxDirectory': str(linux), 'planSha256': sha(PLAN), 'rows': [], 'gameChecksRun': False,
          'frozenInputCount': len(memo.rows), 'workerOperatorSha256': sha(__file__)}
atomic_json(folder/'run.json', {k:v for k,v in ledger.items() if k != 'rows'})
atomic_json(folder/'frozen-inputs.json', {'rows': memo.rows})

def same_pose(before, after):
    for k in ['nativeFrameIndex', 'sourceRigAnchors', 'capturedTrans', 'artRoot', 'artCanvas',
              'artPixelsPerNativeUnit', 'scenePixelsPerNativeUnit', 'motion']:
        assert before[k] == after[k], ('SOURCE_POSE_CHANGED', k)
    def dome(m):
        world = (np.c_[cranial, np.ones(len(cranial))] @ np.asarray(m['sourceRigAnchors']['Head']).T)[:, :3] - np.asarray(m['capturedTrans'])
        return np.c_[m['artRoot'][0]/2 + world[:,2]*m['artPixelsPerNativeUnit']/2,
                     m['artRoot'][1]/2 - world[:,1]*m['artPixelsPerNativeUnit']/2]
    assert np.array_equal(dome(before), dome(after)), 'CRANIAL_DOME_POINTS_CHANGED'

try:
    for r in selected:
        key = r['resource']+'-raw'+str(r['nativeSample'])
        atomic_json(folder/'current.json', {'pid': os.getpid(), 'key': key, 'phase': 'input-guards'})
        assert sha(r['sourceRecord']) == r['sourceRecordSha256'], ('ORIGINAL_SOURCE_CHANGED', key)
        assert sha(r['previousCell']) == r['previousCellSha256'], ('ORIGINAL_CELL_CHANGED', key)
        old = json.load(open(r['sourceRecord']))
        row = {k: v for k, v in r.items() if k != 'unchangedGeometry'}
        row['unchangedGeometry'] = r['unchangedGeometry']
        if not r['needsSelectedGearDerivative']:
            row.update(cell=r['previousCell'], cellSha256=r['previousCellSha256'],
                       reuse='EXACT_ORIGINAL_PIXEL_BYTES_GEOMETRY_ROOT_CLOCK_UNCHANGED')
        else:
            retained = retained_prefixes.get((r['resource'],r['nativeSample']))
            prefix = linux/key
            retained_publication = publish_cell(retained,prefix) if retained else None
            final = Path(str(prefix)+'-final.png')
            atomic_json(folder/'current.json', {'pid': os.getpid(), 'key': key, 'phase': 'selected-equipment-render'})
            with open('/mnt/c/workspace/platform-fighter/.tmp/dk-heavy.lock', 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_SH)
                if retained:
                    new = json.load(open(str(prefix)+'.json')); revised = np.array(Image.open(final).convert('RGBA'))
                    assert sha(final)==json.load(open(str(prefix)+'-final-authoring.json'))['targetSHA']
                    assert sha(final)==json.load(open(str(prefix)+'-final.json'))['outputSha256']
                    assert new['equipmentOverride']['equipmentContext']==plan['equipmentContext']
                else:
                    new = render(r['sourceRecord'], prefix)
                    subprocess.run(['python3', str('tools/link-cel-style.py'), str(prefix), str(final)],
                                   check=True, stdout=subprocess.DEVNULL)
                    rgba = np.array(Image.open(final).convert('RGBA'))
                    revised = apply(rgba, np.array(Image.open(str(prefix)+'-object-ids.png')),
                                    np.array(Image.open(str(prefix)+'-semantic-ids.png')), new)
                    assert np.array_equal(rgba[:,:,3], revised[:,:,3]), 'RGB_ADAPTER_ALPHA_CHANGED'
                    Image.fromarray(revised).save(final)
                    for suffix, field in [('-final-authoring.json','targetSHA'), ('-final.json','outputSha256')]:
                        path = Path(str(prefix)+suffix); record = json.load(open(path)); record[field] = sha(final)
                        record['selectedNormalEquipmentRGBOperator'] = {'path':'tools/link_part_owned_equipment_v3.py', 'sha256':sha('tools/link_part_owned_equipment_v3.py')}
                        atomic_json(path, record)
                same_pose(old, new)
                physical = Path(str(prefix)+'-physical')
                atomic_json(folder/'current.json', {'pid': os.getpid(), 'key': key, 'phase': 'exact-physical-equality'})
                proof = json.load(open(str(physical)+'-physical-region-provenance.json')) if retained else project(str(prefix)+'.json', physical)
                assert proof['sourceRecordSha256'] == sha(str(prefix)+'.json')
                for rr in range(1,15):
                    before = np.array(Image.open(r['originalPhysicalProjectionPrefix']+f'-physical-region-{rr}.png'))
                    after = np.array(Image.open(str(physical)+f'-physical-region-{rr}.png'))
                    assert np.array_equal(before, after), ('PHYSICAL_MASK_CHANGED', key, rr)
                known_face = face_references[(r['resource'], r['nativeSample'])]
                before = np.array(Image.open(known_face).convert('RGBA'))
                after = np.array(Image.open(str(physical)+'-physical-face-source.png').convert('RGBA'))
                assert np.array_equal(before, after), ('KNOWN_FACE_RGBA_CHANGED', key)
                fcntl.flock(lock, fcntl.LOCK_UN)
            crop = packed[r['previousCell']]['newCropRect'] if r['previousCell'] in packed else r['crop']
            original_crop = list(crop)
            sharp_image = Image.fromarray(revised).resize((revised.shape[1]//2, revised.shape[0]//2), Image.Resampling.LANCZOS)
            if viewport:
                alpha=np.array(sharp_image)[:,:,3];ys,xs=np.where(alpha>0)
                crop=[min(crop[0],max(0,int(xs.min())-2)), min(crop[1],max(0,int(ys.min())-2)),
                      max(crop[2],min(sharp_image.width,int(xs.max())+3)), max(crop[3],min(sharp_image.height,int(ys.max())+3))]
            outside = np.array(sharp_image)[:,:,3].copy(); outside[crop[1]:crop[3], crop[0]:crop[2]] = 0
            assert not (outside>0).any(), ('ORIGINAL_PACKING_CROP_CLIPS_REVEALED_PIXELS', key, int((outside>0).sum()))
            cropped = sharp_image.crop(crop)
            dimensions=[max(r['cellDimensions'][0],cropped.width),max(r['cellDimensions'][1],cropped.height)] if viewport else r['cellDimensions']
            assert cropped.width <= dimensions[0] and cropped.height <= dimensions[1]
            cell = Image.new('RGBA', tuple(dimensions)); cell.alpha_composite(cropped)
            cell_path = Path(str(prefix)+'-sharp.png'); cell.save(cell_path)
            old_cell = Image.open(r['previousCell']).convert('RGBA')
            offset=np.array(original_crop[:2])-np.array(crop[:2])
            registered_root=packed[r['previousCell']]['new2xRegisteredRootAfterExactCrop'] if viewport else None
            if viewport:
                padded=Image.new('RGBA',(max(cell.width,old_cell.width+int(offset[0])),max(cell.height,old_cell.height+int(offset[1]))));padded.alpha_composite(old_cell,tuple(map(int,offset)));old_cell=padded
            else: assert cell.size == old_cell.size, ('CELL_DIMENSIONS_CHANGED', key)
            panel = Image.new('RGBA', (cell.width*2, cell.height+24), '#182738')
            panel.alpha_composite(old_cell, (0,24)); panel.alpha_composite(cell, (cell.width,24))
            ImageDraw.Draw(panel).text((5,5), key+' original | exclusive normal Sword+Shield', fill='white')
            panel.save(str(prefix)+'-comparison.png')
            output_prefix = folder/key
            publication = publish_cell(prefix, output_prefix)
            atomic_json(Path(str(output_prefix)+'-publication.json'), publication)
            physical_publication = []
            for p in physical.parent.glob(physical.name+'*'):
                dest = folder/p.name; dest.write_bytes(p.read_bytes()); assert sha(dest)==sha(p)
                physical_publication.append({'file':str(dest),'sha256':sha(dest)})
            row.update(cell=str(output_prefix)+'-sharp.png', cellSha256=sha(str(output_prefix)+'-sharp.png'),
                       derivativeSourceRecord=str(output_prefix)+'.json', derivativeSourceRecordSha256=sha(str(output_prefix)+'.json'),
                       comparison=str(output_prefix)+'-comparison.png', comparisonSha256=sha(str(output_prefix)+'-comparison.png'),
                       actualPackingCrop=crop, sameOriginalCellDimensionsAndRootRegistration=not viewport,
                       sourceRawFinalReused=bool(retained), viewportOnlyExpansion=viewport,
                       originalPackingCrop=original_crop, cellDimensions=dimensions,
                       registeredRootPixel=None if registered_root is None else (np.array(registered_root)+offset).tolist(),
                       rootPixelOffsetEqualsNegativeCropOffset=offset.tolist(),
                       all14PhysicalMasksChangedPixels=0, knownFaceRGBAChangedPixels=0,
                       retainedKnownFaceReference=known_face, retainedKnownFaceReferenceSha256=sha(known_face),
                       cranialDomePointsExact=True, cranialRecipeSha256=sha(RECIPE),
                       same38StrictAnchorsHeadTransformSourceClockCanvasRootScale=True,
                       unchangedReceivingAndHeadContactGeometry=True, physicalProjectionPublication=physical_publication,
                       geometryReuse='EXACT_PER_CELL_PHYSICAL_INPUT_EQUALITY_NO_COMPLETED_FIT_RERUN',
                       visualReview='PENDING_ALL_CURRENT_PIXELS')
        ledger['rows'].append(row)
        atomic_json(folder/'index.json', ledger)
        atomic_json(folder/'progress.json', {'pid':os.getpid(),'completed':len(ledger['rows']),'requested':len(selected),'last':key,'seconds':time.monotonic()-started})
        print(key, 'changed' if r['needsSelectedGearDerivative'] else 'reuse', len(ledger['rows']), flush=True)
    memo.verify()
    ledger['state'] = 'ALL_SHARD_PIXELS_COMMITTED_EXACT_ANATOMY_REUSE_VISUAL_REVIEW_PENDING'
    atomic_json(folder/'index.json', ledger)
    atomic_json(folder/'terminal.json', {'state':ledger['state'],'pid':os.getpid(),'shard':shard,'drawingCount':len(ledger['rows']),
                'changedDrawings':sum(r['needsSelectedGearDerivative'] for r in ledger['rows']),'frozenInputsUnchanged':True,'seconds':time.monotonic()-started})
except Exception as exc:
    atomic_json(folder/'failure.json', {'pid':os.getpid(),'key':key if 'key' in globals() else None,'error':repr(exc),'partialArtifactsPreserved':True})
    raise
