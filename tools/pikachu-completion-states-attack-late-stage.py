"""Stage only inspected late attack floor cells and their paired receiving.

Source cell guards allow unrelated cells in an atlas to have been corrected
since preparation. No live assets are written by this tool.
"""
from pathlib import Path
import argparse, copy, hashlib, json, re
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
B = ROOT/'docs/review/2026-10-06/pikachu-character/art/completion-states-attack-late-floor'
A = ROOT/'assets/characters/pikachu'
parser = argparse.ArgumentParser()
parser.add_argument('--keys', nargs='+', required=True)
parser.add_argument('--stage-name', default='staged')
args = parser.parse_args()
assert re.fullmatch(r'staged(?:-[a-z0-9]+)*', args.stage_name)
D = B/args.stage_name
for p in [D, D/'animations', D/'pose-batches', D/'originals']: p.mkdir(exist_ok=True)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
checkpoints = {}
def read(p):
    data = p.read_bytes(); checkpoints[p] = hashlib.sha256(data).hexdigest(); return data
prep = json.loads((B/'full-pilot-preparation.json').read_text())['records']
assert len(args.keys) == len(set(args.keys)) and set(args.keys) <= {r['key'] for r in prep}
prep = [r for r in prep if r['key'] in args.keys]
ledger = json.loads((B/'full-generation-ledger.json').read_text())
framesPath = A/'frames.json'; frameText = read(framesPath).decode(); frames = json.loads(frameText)
sheets, leaves, metas, changes, files = {}, {}, {}, [], []
symbols = {'jab': 'PIKACHU_JAB_AUTHORED_HURTBOX_POSES',
           'dtilt': 'PIKACHU_VERTICAL_TILT_AUTHORED_HURTBOX_POSES',
           'dsmash': 'PIKACHU_SMASH_AUTHORED_HURTBOX_POSES'}
actions = {'jab': 'jab', 'dtilt': 'down-tilt', 'dsmash': 'down-smash'}
for job in prep:
    out = next(r for r in reversed(ledger) if r['pose_key'] == job['key'] and r['state'] == 'accepted')
    assert out.get('actual_visual_review'), 'Actual image inspection required'
    atlas = B/out['outputs']['cutout']['file']; assert sha(atlas) == out['outputs']['cutout']['sha256']
    generated = Image.open(atlas).convert('RGBA')
    for entry in job['cells']:
        sheet, i = entry['sheet'], entry['artFrameIndex']; clip = frames['animations'][sheet]
        assert clip['root'] == entry['root'] == [256, 288]
        source = ROOT/entry['source']; leaf = ROOT/entry['receivingLeaf']
        if sheet not in sheets:
            read(source); original = Image.open(source).convert('RGBA')
            sheets[sheet] = {'source': source, 'original': original, 'image': original.copy(), 'indices': set()}
        if leaf not in leaves:
            text = read(leaf).decode(); m = re.search(r'(export const '+symbols[sheet]+r'\s*=\s*)(\[.*?\])(\s*as const;)', text, re.S)
            assert m
            rows = json.loads(re.sub(r',\s*([\]}])', r'\1', m[2]))
            leaves[leaf] = {'text': text, 'match': m, 'rows': rows, 'originalRows': copy.deepcopy(rows)}
        metaPath = ROOT/clip['packingMetadata']
        if metaPath not in metas: metas[metaPath] = json.loads(read(metaPath))
        data = sheets[sheet]; col, row = clip['sourceCells'][i]; w, h = clip['frameWidth'], clip['frameHeight']
        pos = (col*w, row*h); old = data['original'].crop((*pos, pos[0]+w, pos[1]+h))
        assert hashlib.sha256(old.tobytes()).hexdigest() == entry['sourceCellRgbaSha256'], 'Affected cell changed'
        x, y = entry['offset']; panel = generated.crop((x, y, x+1024, y+1280)).resize((512, 640), Image.Resampling.LANCZOS)
        assert not panel.crop((0, h, 512, 640)).getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox()
        new = panel.crop((0, 0, w, h)); first, last = entry['adaptation']['originalArtBand']; targetFirst, targetLast = entry['adaptation']['targetArtBand']
        region = np.asarray(old.getchannel('A')) > 0; region[:first] = False
        allowed = np.asarray(Image.fromarray(region.astype('uint8')*255).filter(ImageFilter.MaxFilter(7))) > 0
        allowed[:first] = False
        packed = Image.fromarray(np.where(allowed[:,:,None], np.asarray(new), np.asarray(old)).astype('uint8'))
        assert np.array_equal(np.asarray(packed)[~allowed], np.asarray(old)[~allowed])
        bounds = packed.getchannel('A').point(lambda a:255 if a>=32 else 0).getbbox(); assert bounds[3]-1 <= clip['root'][1]
        assert i not in data['indices']; data['indices'].add(i); data['image'].paste(packed, pos)
        receiving = [r for r in leaves[leaf]['rows'] if r['action'] == actions[sheet]][i]
        assert receiving == entry['sourceReceiving'], 'Affected receiving pose changed'
        prior = copy.deepcopy(receiving); changed = []
        for n, hb in enumerate(receiving['hurtboxes']):
            before = copy.deepcopy(hb)
            for name in ['start', 'end']:
                p = hb['capsule'][name]; artY = clip['root'][1]+(p['y']-25)/clip['scaleToWorld']
                if artY >= first:
                    p['y'] = 25+(targetFirst+(artY-first)*(targetLast-targetFirst)/(last-first)-clip['root'][1])*clip['scaleToWorld']
            if hb != before:
                c = hb['capsule']; a, b = c['start'], c['end']; radius = c['radius']
                hb.update(offsetX=(a['x']+b['x'])/2, offsetY=(a['y']+b['y'])/2,
                          width=abs(a['x']-b['x'])+2*radius, height=abs(a['y']-b['y'])+2*radius)
                changed.append(n)
            assert hb['capsule']['radius'] == before['capsule']['radius']
        rows = [r for r in metas[metaPath]['sources'] if r['action'] == actions[sheet]]
        rows[i]['authoredGeometryAdaptation'] = {'kind': entry['adaptation'], 'job':job['key'],
            'output':str(atlas.relative_to(ROOT)), 'outputSha256':sha(atlas), 'affectedArtFrame':i,
            'receivingChangedIndices':changed, 'sourceRadiusChanges':0, 'protectedPixelChanges':0,
            'sourceParity':'Authored beta underside flex; root, clock and attack geometry preserved.'}
        changes.append({'sheet':sheet,'artFrameIndex':i,'nativeSample':entry['nativeSample'],
            'oldCellPixelSha256':hashlib.sha256(old.tobytes()).hexdigest(), 'newCellPixelSha256':hashlib.sha256(packed.tobytes()).hexdigest(),
            'protectedPixelChanges':0,'authorizedPixelChanges':int(np.count_nonzero(np.any(np.asarray(old)!=np.asarray(packed),axis=2))),
            'alpha32Bounds':bounds,'alpha32BelowRootWorldPx':(bounds[3]-.5-clip['root'][1])*clip['scaleToWorld'],
            'changedCapsuleIndices':changed,'adaptation':entry['adaptation'],'priorPose':prior,'candidatePose':receiving,'job':job['key']})
        gallery = Image.new('RGBA',(2048,440),'#17253a')
        for n,(body,bg,label) in enumerate([(old,'#f7f5ef','previous'),(packed,'#f7f5ef','candidate receiving'),(old,'#17253a','previous'),(packed,'#17253a','candidate receiving')]):
            canvas=Image.new('RGBA',body.size,bg);canvas.alpha_composite(body);draw=ImageDraw.Draw(canvas);draw.line((0,288,512,288),fill='red')
            if n in [1,3]:
                for hb in receiving['hurtboxes']:
                    c=hb['capsule']; points=[(256+p['x']/clip['scaleToWorld'],288+(p['y']-25)/clip['scaleToWorld']) for p in [c['start'],c['end']]]; radius=c['radius']/clip['scaleToWorld'];draw.line(points,fill='#b1a7ff')
                    for px,py in points:draw.ellipse((px-radius,py-radius,px+radius,py+radius),outline='#b1a7ff')
            gallery.alpha_composite(canvas,(n*512,40));ImageDraw.Draw(gallery).text((n*512+8,8),f'{sheet}/{i} native{entry["nativeSample"]} {label}',fill='white')
        gallery.save(D/f'{sheet}-{i}-body-caps-review.png')
def save(live,candidate):
    backup=D/'originals'/(checkpoints[live]+'-'+live.name)
    if not backup.exists(): backup.write_bytes(live.read_bytes())
    files.append({'live':str(live.relative_to(ROOT)),'priorSha256':checkpoints[live],'priorBackup':str(backup.relative_to(ROOT)),
                  'candidate':str(candidate.relative_to(ROOT)),'candidateSha256':sha(candidate)})
for sheet,data in sheets.items():
    clip=frames['animations'][sheet];w,h=clip['frameWidth'],clip['frameHeight']
    for i,(col,row) in enumerate(clip['sourceCells']):
        if i in data['indices']:continue
        box=(col*w,row*h,(col+1)*w,(row+1)*h);assert data['image'].crop(box).tobytes()==data['original'].crop(box).tobytes()
    png=D/'animations'/(sheet+'.png');data['image'].save(png);save(data['source'],png)
    metas[ROOT/clip['packingMetadata']]['animations'][sheet]['sha256']=sha(png)
    frameText=frameText.replace(clip['sha256'],sha(png),1)
for live,meta in metas.items():
    candidate=D/'pose-batches'/live.name;candidate.write_text(json.dumps(meta,indent=2)+'\n');save(live,candidate);frameText=frameText.replace(checkpoints[live],sha(candidate))
for live,data in leaves.items():
    m=data['match'];text=data['text'][:m.start(2)]+json.dumps(data['rows'],indent=2)+data['text'][m.end(2):]
    candidate=D/live.name;candidate.write_text(text);save(live,candidate)
candidate=D/'frames.json';candidate.write_text(frameText);save(framesPath,candidate)
assert all(sha(p)==h for p,h in checkpoints.items()),'Concurrent live mutation during stage'
(D/'candidate.json').write_text(json.dumps({'state':'actual_saved_late_body_and_receiving_review_pending','changes':changes,'installFiles':files,
    'limits':['Protected identity and other cells exact. Source capsule radii, root, clocks and attack geometry retained.','New body and receiving are a bounded authored beta calibration, not native parity.','Actual saved image inspection and exact production match qualification required.']},indent=2)+'\n')
print(json.dumps({'files':len(files),'cells':len(changes),'directory':str(D)}))
