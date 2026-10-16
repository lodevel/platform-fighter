#!/usr/bin/env python3
"""Install ONLY the three exact-age reviewed contact samples.
Consumes a static receiving acceptance receipt authored after actual image
review. Canonical clips and all other ages remain unchanged. No GPU use.
"""
from pathlib import Path
import argparse,hashlib,json,math,shutil
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
DEST=ROOT/'assets/characters/donkeykong'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def numeric(box):
    for key in ['offsetX','offsetY','width','height']:
        if not isinstance(box.get(key),(float,int)) or not math.isfinite(box[key]):raise ValueError(f'Invalid receiving {key}')
    if box['width']<=0 or box['height']<=0:raise ValueError('Non-positive receiving dimensions')
    if box.get('capsule'):
        c=box['capsule']
        if not math.isfinite(c['radius']) or c['radius']<=0:raise ValueError('Invalid receiving radius')
        for k in ['start','end']:
            if not all(math.isfinite(c[k][xy]) for xy in ['x','y']):raise ValueError('Invalid receiving endpoint')
def stage(receipt_path):
    receipt=json.loads(receipt_path.read_text())
    rows=receipt['records']
    accepted={r['key']:r for r in rows if r.get('staticReceivingAccepted') is True}
    required=['jab1-native5','jab2-native4','dtilt-native6']
    if set(accepted)!=set(required):raise ValueError('Requires actual static receiving acceptance for exactly three pilot samples')
    images=json.loads((ART/'firstcontact-clean3-static-acceptance.json').read_text())['samples']
    draft=json.loads((ART/'firstcontact-review-only-metadata-draft.json').read_text())['animations']
    prepared=[]
    for key,sample in zip(required,images):
        row=accepted[key];packetpath=ART/row['candidate'];packet=json.loads(packetpath.read_text())
        if sha(packetpath)!=row['candidateSha256']:raise ValueError('Receiving candidate changed after review')
        if packet['targetImageSha256']!=sample['sha256']:raise ValueError('Receiving target differs from accepted static image')
        if packet['nativeSample']!=sample['nativeSample'] or packet['bodyCentreFromRootY']!=-42:raise ValueError('Receiving pose/root clock differs')
        target=ART/sample['image']
        if sha(target)!=sample['sha256']:raise ValueError('Final art changed after static review')
        image=Image.open(target)
        if image.mode!='RGBA' or image.size!=(1536,1024):raise ValueError('Invalid RGBA cell')
        poses=packet['hurtboxPoses']
        if len(poses)!=1 or poses[0]['artFrameIndex']!=0 or poses[0]['nativeSample']!=sample['nativeSample']:raise ValueError('Receiving art-frame pairing differs')
        boxes=poses[0]['hurtboxes'];ids=[b['id'] for b in boxes]
        if not boxes or len(ids)!=len(set(ids)):raise ValueError('Missing/duplicate receiving primitives')
        for box in boxes:
            numeric(box)
            if not box.get('region'):raise ValueError('Missing protection region')
        pilot=sample['pilotKey'];clip=dict(draft[pilot]);clip.pop('pending');clip['hurtboxPoses']=poses;clip['sourceCells']=[[0,0]]
        clip['staticReceivingAcceptanceReceipt']=str(receipt_path.relative_to(ROOT));clip['staticReceivingAcceptanceSha256']=sha(receipt_path)
        clip['artStatus']='Review-only exact first-contact sample accepted statically; actual match pending; full action incomplete'
        prepared.append((pilot,target,clip,packetpath))
    # All validation precedes shipping mutations. Historical bytes kept once.
    frames=DEST/'frames.json';prior=frames.read_bytes();metadata=json.loads(prior)
    history=ART/'historical-shipping-before-contact-pilot';history.mkdir(exist_ok=True)
    historical=history/'frames.json'
    if not historical.exists():historical.write_bytes(prior)
    records=[]
    for pilot,target,clip,packetpath in prepared:
        dest=DEST/clip['strip'];dest.parent.mkdir(exist_ok=True)
        if dest.exists() and sha(dest)!=sha(target):
            (history/f'{pilot}-{sha(dest)[:12]}.png').write_bytes(dest.read_bytes())
        shutil.copyfile(target,dest);metadata['animations'][pilot]=clip
        records.append({'pilotKey':pilot,'image':str(dest.relative_to(ROOT)),'imageSha256':sha(dest),'receivingPacket':str(packetpath.relative_to(ROOT)),'receivingPacketSha256':sha(packetpath),'frameWindows':clip['frameWindows']})
    frames.write_text(json.dumps(metadata,indent=2)+'\n')
    result={'state':'three_exact_age_review_only_pilot_assets_installed_actual_match_pending','preservedHistoricalFramesSha256':sha(historical),'framesSha256':sha(frames),'records':records,'canonicalClipsReplaced':False,'scope':'Only jab age4, jab2 age3, dtilt age5. Other ages retain unaccepted baseline. Root owns manifest/build/browser qualification. No action row or full pack promoted.'}
    (ART/'firstcontact-review-only-staging.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('receiving_acceptance_receipt',type=Path);args=ap.parse_args();stage(args.receiving_acceptance_receipt.resolve())
