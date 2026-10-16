#!/usr/bin/env python3
"""Validate and install the separate display bank without touching authority."""
from pathlib import Path
import argparse, hashlib, json, shutil
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--staged',default='.tmp/pikachu-final-visual');args=parser.parse_args()
    staged=ROOT/args.staged;dest=ROOT/'assets/characters/pikachu';m=json.loads((staged/'final-visual-frames.json').read_text());old=json.loads((dest/'frames.json').read_text())['animations']
    assert digest(dest/'frames.json')==m['authoritativeFramesSha256']
    assert m['decodedBytes']<=m['decodedBudgetBytes']
    pages={};decoded=0;retained=0;total=0
    for key,page in m['pages'].items():
        path=staged/page['strip'];assert digest(path)==page['sha256'];image=Image.open(path).convert('RGBA');pages[key]=image
        assert list(image.size)==page['atlas'] and max(image.size)<=m['pageLimit'];decoded+=image.width*image.height*4
        for x,y,w,h,dx,dy in page['trims']:
            assert min(x,y,w,h)>=0 and w>0 and h>0 and x+w<=image.width and y+h<=image.height
            assert min(dx,dy)>=0 and dx+w<=page['frameWidth'] and dy+h<=page['frameHeight']
    assert decoded==m['decodedBytes']
    for sheet,clip in m['clips'].items():
        source=old[sheet];atlas=Image.open(dest/source['strip']).convert('RGBA')
        assert clip['root']==source['root'] and clip['scaleToWorld']==source['scaleToWorld'] and clip['bodyCentreFromRootY']==source['bodyCentreFromRootY']
        assert [r['nativeSample'] for r in clip['frames']]==list(range(clip['nativeEnd']+1))
        for row in clip['frames']:
            page=m['pages'][row['page']];trim=page['trims'][row['frame']];x,y,w,h,dx,dy=trim;crop=pages[row['page']].crop((x,y,x+w,y+h))
            if row['acceptedOriginal']:
                i=source['nativeSampleIndices'].index(row['nativeSample']);sx,sy,sw,sh,sdx,sdy=source['trims'][i]
                assert [w,h,dx,dy]==[sw,sh,sdx,sdy] and crop.tobytes()==atlas.crop((sx,sy,sx+sw,sy+sh)).tobytes();retained+=1
            total+=1
    assert total==423 and retained==187
    for page in m['pages'].values():shutil.copy2(staged/page['strip'],dest/page['strip'])
    shutil.copy2(staged/'final-visual-frames.json',dest/'final-visual-frames.json')
    receipt={'result':'PASS','semanticSamples':total,'acceptedOriginalDrawingsByteExact':retained,'pages':len(pages),'decodedBytes':decoded,'authoritativeFramesSha256':m['authoritativeFramesSha256'],'bankSha256':digest(dest/'final-visual-frames.json'),'generatorSha256':digest(ROOT/'tools/render-pikachu-final-visual.py'),'installerSha256':digest(Path(__file__))}
    out=ROOT/'docs/review/2026-10-16/pikachu-final-density';out.mkdir(parents=True,exist_ok=True);(out/'installation.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':main()
