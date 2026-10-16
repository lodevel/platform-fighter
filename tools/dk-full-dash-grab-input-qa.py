"""Bounded actual-input QA views; no generation, fitting or shipping changes."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
from PIL import Image,ImageDraw,ImageOps

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--preparation',type=Path,required=True);parser.add_argument('--expected-preparation-sha256',required=True);parser.add_argument('--input-qa-slot-released',action='store_true');args=parser.parse_args()
    if not args.input_qa_slot_released:raise ValueError('Input QA raster requires coordinator CPU grant')
    prep_path=args.preparation.resolve()
    if sha(prep_path)!=args.expected_preparation_sha256:raise ValueError('Own preparation pin changed')
    prep=json.loads(prep_path.read_text());prefix=prep['jobFamily']
    if not prefix.startswith('dk-fullgrab-dash-') or any(r['clip']!='dash_grab' for r in prep['records']):raise ValueError('Own dash preparation only')
    output=ART/(prefix+'-actual-input-qa-01.json')
    if output.exists():raise ValueError('Preserve previous input QA')
    
    recipe_path=ROOT/prep['featureRecipe']['path']
    recipe=json.loads(recipe_path.read_text())
    assert sha(recipe_path)==prep['featureRecipe']['sha256']
    for p in prep['inputs'].values():assert sha(ROOT/p['path'])==p['sha256']
    seed=np.asarray(Image.open(ROOT/prep['inputs']['seed']['path']).convert('RGB'))
    mask=np.asarray(Image.open(ROOT/prep['inputs']['render-mask']['path']).convert('L'))
    guide=np.asarray(Image.open(ROOT/prep['inputs']['guide']['path']).convert('L'))
    assert np.all(mask[:512,:768]==0) and np.all(mask[512:,768:]==0)
    assert np.all(guide[:512,:768]==0) and np.all(guide[512:,768:]==0)
    assert np.all(seed[512:,768:]==[204,73,140])
    reference=Image.open(ROOT/prep['reference']['path']).convert('RGBA')
    refcell=Image.new('RGBA',(768,512),(204,73,140,255))
    refcell.alpha_composite(reference.resize((768,512),Image.Resampling.LANCZOS))
    assert np.array_equal(seed[:512,:768],np.asarray(refcell.convert('RGB')))
    poses=[]
    for rec in prep['records']:
        n=rec['nativeSample'];r=next(r for r in recipe['poses'] if r['nativeSample']==n)
        rgb=Image.open(ROOT/rec['authoredSeed']['path']).convert('RGB')
        alpha=Image.open(ROOT/rec['authoredAlpha']['path']).convert('L')
        a=np.asarray(alpha);color=np.asarray(rgb)
        y,x=np.where(a>=32);last=int(y.max())
        assert last==830
        assert rec['floorTransform']['inputLastPixelY']==r['sourceSupport']['lastPixelY']
        checks=0
        for repair in r.get('reviewedMaterialAlphaRepairs', []):
            xx,yy=repair['pixel']
            if yy<760:
                assert a[yy,xx]==255
                assert not np.array_equal(color[yy,xx],[204,73,140])
                checks+=1
        rgba=rgb.convert('RGBA');rgba.putalpha(alpha)
        quarter=rgba.resize((384,256),Image.Resampling.LANCZOS)
        qa=np.asarray(quarter)[:,:,3];qy,qx=np.where(qa>=32)
        quarter_floor=(float(qy.max())+.5-208)*5/6.5
        assert abs(quarter_floor)<=.55
        paths=[]
        for theme,bg in [('dark',(28,32,41)),('light',(245,244,236))]:
            im=Image.new('RGBA',rgba.size,bg+(255,));im.alpha_composite(rgba)
            p=ART/f'{prefix}-native{n}-authored-{theme}-input-qa.png'
            im.convert('RGB').save(p);paths.append(pin(p))
        view=Image.new('RGB',(1080,500),(28,32,41))
        for row,bg in enumerate([(28,32,41),(245,244,236)]):
            for col,(im,label,mirrored) in enumerate([(reference,'accepted reference',False),(rgba,f'dash_grab native{n}',False),(rgba,f'dash_grab native{n} mirrored',True)]):
                cell=Image.new('RGBA',(360,250),bg+(255,))
                scale=5/26;world=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
                rootx=512*scale;rooty=832*scale
                if mirrored:world=ImageOps.mirror(world);rootx=world.width-rootx
                ox=round(130-rootx);oy=round(185-rooty)
                cell.alpha_composite(world,(ox,oy))
                d=ImageDraw.Draw(cell);textcolor=(230,230,230) if row==0 else (35,35,35)
                d.line([(0,185),(359,185)],fill=(115,125,135));d.ellipse((128,183,132,187),fill=(40,220,130));d.text((8,8),label,fill=textcolor)
                view.paste(cell.convert('RGB'),(col*360,row*250))
        p=ART/f'{prefix}-native{n}-reference-bothface-light-dark-world-input-qa.png'
        view.save(p);paths.append(pin(p))
        # Quarter is an input-preview derivative, never delivered sprite art.
        qp=ART/f'{prefix}-native{n}-quarter-authored-input-qa.png';quarter.save(qp);paths.append(pin(qp))
        poses.append({'nativeSample':n,'gameplayAge':n-1,'fullAlpha32Bounds':[int(x.min()),int(y.min()),int(x.max()),last],
                      'quarterAlpha32Bounds':[int(qx.min()),int(qy.min()),int(qx.max()),int(qy.max())],
                      'quarterFloorPixelCentreDeltaWorld':quarter_floor,'repairedInteriorNonMagentaChecks':checks,
                      'measuredFloorTransform':rec['floorTransform'],'views':paths,
                      'actualVisualInspection':'pending; diagnostic source-conditioned input, not generated target acceptance'})
    result={'state':'numeric input QA passed; actual visual inspection pending','preparation':pin(prep_path),'recipe':pin(recipe_path),
            'inputPins':prep['inputs'],'referenceCellZeroNoiseAndExactSeed':True,'emptyCellZeroNoiseAndMagenta':True,
            'guideReferenceAndEmptyCellsZero':True,'repairedAlphaBeforeRGBClampNonMagenta':True,'poses':poses,
            'qaTool':pin(Path(__file__)),'GPUUsed':False,'fitExecuted':False,'shippingChanged':False}
    output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(pin(output)))

if __name__=='__main__':main()
