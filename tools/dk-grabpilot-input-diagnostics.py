"""Read prepared grab inputs and produce review diagnostics; never submits GPU."""
from pathlib import Path
import json, hashlib, shutil
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SRC=ART/'grab-first-five-native-guides-01'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    for batch in (1,2,3):
        family=f'dk-grabpilot-batch{batch:02}'
        prep=json.loads((ART/(family+'-preparation.json')).read_text())
        for r in prep['records']:
            key=r['prefix']; prefix=family+'-'+key; w,h=r['fullCanvas']
            last=r['floorTransform']['inputLastPixelY']
            def warp(im):
                out=Image.new(im.mode,(w,h),0 if im.mode=='L' else (204,73,140))
                out.paste(im.crop((0,0,w,760)),(0,0))
                out.paste(im.crop((0,760,w,last+1)).resize((w,71),Image.Resampling.NEAREST if im.mode=='L' else Image.Resampling.BICUBIC),(0,760))
                return out
            seed=Image.open(ART/r['authoredFullSeed']).convert('RGB')
            alpha=Image.open(ART/r['authoredPoseAlpha']).convert('L')
            beforealpha=warp(Image.open(SRC/(key+'-mask.png')).convert('L'))
            beforeRGB=warp(Image.open(SRC/(key+'-palette-seed.png')).convert('RGB'))
            aa=np.asarray(alpha); ba=np.asarray(beforealpha)
            rgb=np.asarray(seed); brgb=np.asarray(beforeRGB)
            rgba=seed.convert('RGBA'); rgba.putalpha(alpha)
            for kind,bg in [('dark',(24,29,36)),('light',(242,238,226))]:
                composite=Image.new('RGBA',(w,h),bg+(255,)); composite.alpha_composite(rgba)
                composite.convert('RGB').save(ART/(prefix+'-authored-'+kind+'.png'))
            panel=Image.new('RGB',(w,h//2),(0,0,0))
            panel.paste(beforealpha.resize((w//2,h//2),Image.Resampling.NEAREST).convert('RGB'),(0,0))
            panel.paste(alpha.resize((w//2,h//2),Image.Resampling.NEAREST).convert('RGB'),(w//2,0))
            panel.save(ART/(prefix+'-alpha-before-after.png'))
            counts={}
            for name,coords in r['featureAuthoring'].items():
                region=Image.new('L',(w,h)); d=ImageDraw.Draw(region)
                if name=='eyes':
                    for box in coords:d.ellipse(box,fill=255)
                elif name=='fingerCreaseGuides':
                    for line in coords:d.line(line,fill=255,width=3,joint='curve')
                elif name.endswith('Box'):
                    if coords:d.rectangle(coords,fill=255)
                else:d.polygon(coords,fill=255)
                mask=np.asarray(warp(region))>0
                counts[name]={'selectedPixels':int(mask.sum()),'RGBChangedAgainstWarpedSourcePalettePixels':int((mask&np.any(rgb!=brgb,axis=2)).sum()),'newOpaqueMaterialPixels':int((mask&(ba<32)&(aa>=32)).sum()),'partialMaterialSaturatedPixels':int((mask&(ba>=32)&(ba<255)&(aa==255)).sum())}
            visible=aa>=32; ys,xs=np.where(visible)
            dst=ART/(prefix+'-input-region-counts.json')
            if dst.exists():
                old=ART/'historical-grabpilot-unreviewed-source-coordinate-counts'; old.mkdir(exist_ok=True)
                previous=old/dst.name
                if not previous.exists():shutil.copy2(dst,previous)
            report={'state':'actual_input_diagnostics_not_generated_target_acceptance','prefix':key,'regionCoordinateBasis':'source recipe polygons mapped by the exact same support warp','sourceMaskSha256':r['sourceMaskSha256'],'sourcePaletteSeedSha256':r['sourceSeedSha256'],'authoredSeedSha256':sha(ART/r['authoredFullSeed']),'authoredAlphaSha256':sha(ART/r['authoredPoseAlpha']),'regions':counts,'materialAlphaRepair':r['materialAlphaRepair'],'actualAlpha32BoundsInclusive':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],'lastPixelCentreFromPhysicalFloorWorld':float((ys.max()+.5-832)*5/26),'targetFloorToleranceWorld':.55,'negativeSpacesRetainedByExternalConnectedBackgroundGuard':True}
            dst.write_text(json.dumps(report,indent=2)+'\n')
            print(prefix,report['actualAlpha32BoundsInclusive'],report['lastPixelCentreFromPhysicalFloorWorld'])

if __name__=='__main__':main()
