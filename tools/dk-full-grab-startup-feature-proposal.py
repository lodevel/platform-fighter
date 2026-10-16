"""Local source-feature/opacity proposal only; never assembles generator inputs."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_fill_holes,distance_transform_edt

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pin(p):return {'path':str(p.relative_to(ROOT)),'sha256':sha(p)}

DOMAINS={
 1:{'head-fur':[(571,350),(588,306),(657,298),(711,332),(742,373),(740,400),(714,392),(688,374),(670,389),(646,423),(646,467),(622,460),(601,430),(592,396)],
    'rear-arm-fur':[(378,286),(420,263),(505,270),(533,312),(546,376),(493,393),(434,375),(377,381)],
    'torso-fur':[(388,397),(462,380),(543,385),(580,469),(580,526),(534,570),(489,601),(417,590),(358,561),(358,497)],
    'front-arm-fur':[(342,549),(397,552),(471,590),(521,636),(516,726),(570,757),(575,778),(498,775),(442,759),(371,716),(337,657)],
    'lower-hip-fur':[(326,686),(389,690),(445,726),(481,761),(485,779),(452,798),(365,780),(301,759)]},
 4:{'head-fur':[(594,349),(612,310),(685,296),(736,328),(766,367),(767,401),(745,392),(716,375),(688,388),(675,424),(674,465),(651,455),(626,425),(611,391)],
    'rear-arm-fur':[(340,270),(386,255),(439,268),(467,300),(462,329),(487,346),(529,339),(570,359),(539,387),(474,373),(414,406),(377,399),(346,346)],
    'torso-fur':[(400,412),(469,385),(540,401),(594,458),(600,520),(546,563),(496,589),(433,582),(372,548),(370,488)],
    'front-arm-fur':[(365,553),(422,538),(472,572),(498,610),(490,696),(510,732),(578,747),(576,774),(508,775),(443,753),(380,711),(350,644)],
    'lower-hip-fur':[(342,680),(393,684),(450,718),(504,741),(531,763),(529,789),(458,797),(380,776),(315,756)]}
}
FEATURES={
 1:{'paintDomains':[
    {'name':'replace-native-cream-arch-and-noisy-eye-cavity','polygon':[(645,379),(686,375),(722,394),(750,423),(750,473),(699,481),(658,454)],'RGB':[190,22,5]},
    {'name':'attached-target-white-brow','polygon':[(671,432),(688,423),(709,435),(739,446),(746,443),(746,454),(733,456),(705,447),(687,436),(675,444)],'RGB':[253,250,238]},
    {'name':'exposed-upper-tie','polygon':[(615,589),(629,593),(641,627),(633,639),(624,619)],'RGB':[233,16,1]},
    {'name':'exposed-side-tie','polygon':[(652,661),(658,695),(654,744),(642,773),(623,772),(631,759),(646,746)],'RGB':[233,16,1]}],
    'eyes':[{'scleraBox':[689,440,716,477],'pupilBox':[704,446,715,473]},{'scleraBox':[730,447,744,471],'pupilBox':[737,451,743,469]}],
    'retainedRealGapBoxes':[[591,565,625,605]],'handInspectionBoxes':{'rear-hand':[486,244,605,305],'front-fist':[511,602,668,765]}},
 4:{'paintDomains':[
    {'name':'replace-native-cream-arch-and-noisy-eye-cavity','polygon':[(666,376),(705,378),(743,400),(773,430),(771,472),(709,481),(672,451)],'RGB':[190,22,5]},
    {'name':'attached-target-white-brow','polygon':[(691,428),(709,417),(729,429),(759,441),(769,437),(768,450),(755,452),(726,440),(708,431),(695,440)],'RGB':[253,250,238]},
    {'name':'exposed-upper-tie','polygon':[(644,578),(655,586),(665,625),(653,628)],'RGB':[233,16,1]},
    {'name':'exposed-side-tie','polygon':[(656,627),(671,633),(680,687),(680,732),(671,750),(660,724),(658,672)],'RGB':[233,16,1]}],
    'eyes':[{'scleraBox':[710,437,738,474],'pupilBox':[725,443,736,470]},{'scleraBox':[753,441,766,467],'pupilBox':[759,446,765,465]}],
    'retainedRealGapBoxes':[[605,558,653,615]],'handInspectionBoxes':{'rear-spread-hand':[322,95,547,290],'front-fist':[485,576,640,746]}}
}

def main():
    recipepath=ART/'full-grab-startup-reviewed-features-02.json'
    if recipepath.exists():raise ValueError('Preserve prior feature proposals')
    contract=ART/'full-grab-startup-generation-contract-01.json'
    rows=[]
    for n in [1,4]:
        prefix=ART/f'fullgrab01-grab-native{n}'
        metadata=Path(str(prefix)+'.json')
        a=np.asarray(Image.open(str(prefix)+'-mask.png').convert('L'))
        source=Image.open(str(prefix)+'-palette-seed.png').convert('RGB')
        rgb=np.asarray(source);on=a>=32;envelope=binary_fill_holes(on)
        depth=distance_transform_edt(envelope)
        selected=np.zeros(on.shape,bool);domains=[]
        for name,poly in DOMAINS[n].items():
            mask=Image.new('L',source.size);ImageDraw.Draw(mask).polygon(poly,fill=255)
            selection=np.asarray(mask)>0;selected|=selection
            domains.append({'name':name,'polygon':poly,'alphaRepairCandidatePixels':int((selection&envelope&(depth>3)&(a<255)).sum())})
        f=FEATURES[n]
        face_poly=f['paintDomains'][0]['polygon']
        face_mask=Image.new('L',source.size);ImageDraw.Draw(face_mask).polygon(face_poly,fill=255)
        face_selection=np.asarray(face_mask)>0;selected|=face_selection
        domains.append({'name':'inspected-solid-face-brow-material','polygon':face_poly,'alphaRepairCandidatePixels':int((face_selection&envelope&(depth>3)&(a<255)).sum())})
        excluded=np.zeros(on.shape,bool)
        for x0,y0,x1,y1 in f['retainedRealGapBoxes']:excluded[y0:y1,x0:x1]=True
        change=selected&envelope&(depth>3)&(a<255)&~excluded
        repairs=[]
        for y,x in np.argwhere(change):
            cream=on[y,x] and rgb[y,x,0]>240 and rgb[y,x,1]>150
            repairs.append({'pixel':[int(x),int(y)],'beforeAlpha':int(a[y,x]),'afterAlpha':255,'RGB':[255,211,145] if cream else [190,22,5]})
        diagnostic=a.copy();diagnostic[change]=255
        # Exterior/enclosed-space checks compare alpha32; no original files modified.
        assert np.array_equal(binary_fill_holes(diagnostic>=32),envelope)
        assert np.array_equal(a[excluded],diagnostic[excluded])
        overlay=source.copy();draw=ImageDraw.Draw(overlay)
        for d in domains:draw.line(d['polygon']+[d['polygon'][0]],fill=(40,215,240),width=3)
        for box in f['retainedRealGapBoxes']:draw.rectangle(box,outline=(250,220,50),width=3)
        for name,box in f['handInspectionBoxes'].items():draw.rectangle(box,outline=(80,245,100),width=3);draw.text((box[0],box[1]-16),name,fill=(80,245,100))
        for d in f['paintDomains']:draw.line(d['polygon']+[d['polygon'][0]],fill=(250,250,250),width=2)
        for eye in f['eyes']:draw.rectangle(eye['scleraBox'],outline=(50,210,255),width=2)
        opath=ART/f'fullgrab01-grab-native{n}-feature-domain-proposal02.png';overlay.save(opath)
        face=source.copy();fd=ImageDraw.Draw(face)
        for d in f['paintDomains']:
            if 'tie' not in d['name']:fd.polygon(d['polygon'],fill=tuple(d['RGB']))
        for eye in f['eyes']:fd.ellipse(eye['scleraBox'],fill=(253,250,238));fd.ellipse(eye['pupilBox'],fill=(20,12,7))
        box=(565,330,805,530);view=Image.new('RGB',(960,400),(30,34,42));view.paste(source.crop(box).resize((480,400)),(0,0));view.paste(face.crop(box).resize((480,400)),(480,0))
        fpath=ART/f'fullgrab01-grab-native{n}-face-feature-proposal02.png';view.save(fpath)
        last=int(np.where(on)[0].max())
        rows.append({'nativeSample':n,'gameplayAge':n-1,'sourceGuideMetadataSha256':sha(metadata),**f,'opacityRepairDomains':domains,'reviewedMaterialAlphaRepairs':repairs,'materialRepairDiagnostics':{'exactPixelCount':len(repairs),'alphaZeroMaterialPixels':int((change&(a==0)).sum()),'existingPartialMaterialPixels':int((change&(a>0)).sum()),'exteriorAlpha32EnvelopeIdentical':True,'retainedRealGapAlphaIdentical':True,'enclosedAlpha0Before':int((envelope&~on).sum()),'enclosedAlpha0AfterProposed':int((envelope&~(diagnostic>=32)).sum()),'beyondReviewedDomainsUntouched':True},'sourceSupport':{'lastPixelY':last,'inputBandStartPixelY':760,'targetLastPixelY':830,'inclusiveRowsRatio':71/(last-760+1),'rootPixelY':832},'proposalViews':[pin(opath),pin(fpath)],'hands':'source silhouette/skin/finger contours retained; no contact native8 hand shape reused','rootReviewStatus':'pending','actualFeatureImageReview':'pending'})
    recipe={'state':'actual source/feature authoring proposal; root review pending; no atlas input assembly','contractSha256':sha(contract),'featureProposalTool':pin(Path(__file__)),'actualSourceGuideAndFeatureDomainsReviewed':False,'sourceRasterReceipt':pin(ART/'full-grab-grab-startup-source-guide-preparation.json'),'poses':rows,'sourceFilesUnchanged':True,'GPUUsed':False,'atlasInputAssemblyExecuted':False,'limits':['Material alpha repairs local to actually inspected anatomical domains, exact per-pixel RGB required before clamp.','Genuine under-muzzle/arm gaps excluded; no all-hole blanket fill.','Source facial material is approximate; proposed attached target eye/brow planes authored for selected identity, output requires independent actual inspection.']}
    recipepath.write_text(json.dumps(recipe,indent=2)+'\n')
    print(json.dumps({'recipe':pin(recipepath),'poses':[{'nativeSample':r['nativeSample'],'materialDiagnostics':r['materialRepairDiagnostics'],'sourceSupport':r['sourceSupport']} for r in rows]},indent=2))

if __name__=='__main__':main()
