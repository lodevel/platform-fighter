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

DOMAINS={7: {'head-fur': [(621, 353), (659, 317), (733, 304), (787, 332), (812, 383), (811, 424), (777, 439), (748, 470), (680, 478), (641, 439)], 'back-and-upper-arm-fur': [(317, 412), (359, 374), (460, 357), (563, 369), (600, 432), (566, 531), (470, 558), (357, 550)], 'front-forearm-fur': [(703, 565), (762, 553), (814, 586), (844, 631), (817, 704), (757, 718), (699, 685)], 'hip-fur': [(320, 615), (425, 624), (497, 658), (530, 732), (502, 776), (364, 773), (296, 739)], 'lower-leg-fur': [(503, 703), (576, 685), (620, 750), (620, 782), (537, 778)], 'exposed-chest-skin': [(508, 549), (551, 530), (589, 563), (605, 635), (566, 684), (525, 653)]}, 9: {'head-fur': [(606, 371), (635, 339), (706, 326), (756, 347), (779, 390), (783, 438), (750, 471), (717, 505), (651, 510), (619, 466)], 'back-and-upper-arm-fur': [(290, 401), (349, 363), (446, 337), (552, 363), (580, 430), (542, 511), (441, 530), (330, 513)], 'front-forearm-fur': [(681, 588), (744, 573), (790, 600), (811, 656), (785, 727), (728, 740), (679, 687)], 'hip-fur': [(337, 582), (431, 601), (492, 656), (531, 728), (505, 770), (365, 774), (308, 733)], 'lower-leg-fur': [(505, 699), (571, 690), (620, 751), (620, 780), (539, 777)], 'exposed-chest-skin': [(460, 526), (504, 518), (551, 552), (565, 620), (527, 680), (484, 653)]}}
FEATURES={7: {'paintDomains': [{'name': 'source-eye-cavity-cover', 'polygon': [(692, 400), (741, 406), (788, 428), (809, 460), (798, 510), (739, 521), (705, 487)], 'RGB': [190, 22, 5]}, {'name': 'attached-white-brow', 'polygon': [(729, 456), (745, 447), (768, 460), (790, 474), (787, 483), (765, 469), (746, 458), (733, 465)], 'RGB': [253, 250, 238]}, {'name': 'exposed-source-tie', 'polygon': [(587, 370), (613, 382), (639, 518), (635, 560), (667, 647), (689, 749), (661, 801), (630, 809), (601, 746), (616, 674), (615, 592), (590, 504)], 'RGB': [233, 16, 1]}, {'name': 'palm-source-shadow-clean-cream', 'polygon': [(855, 632), (878, 611), (906, 630), (909, 675), (884, 692), (867, 675)], 'RGB': [255, 211, 145]}], 'eyes': [{'scleraBox': [744, 465, 769, 509], 'pupilBox': [758, 471, 768, 503]}, {'scleraBox': [781, 471, 793, 501], 'pupilBox': [788, 476, 792, 496]}], 'retainedRealGapBoxes': [[690, 677, 752, 750]], 'handInspectionBoxes': {'rear-folded-fist': [333, 494, 505, 650], 'open-front-five-projections': [807, 479, 1020, 729]}, 'fingerCreaseGuides': [[[383, 549], [415, 537], [435, 545]], [[398, 580], [432, 562], [450, 576]], [[418, 608], [451, 586], [462, 598]]]}, 9: {'paintDomains': [{'name': 'source-eye-cavity-cover', 'polygon': [(670, 410), (719, 416), (766, 438), (787, 470), (776, 520), (717, 531), (683, 497)], 'RGB': [190, 22, 5]}, {'name': 'attached-white-brow', 'polygon': [(707, 466), (723, 457), (746, 470), (768, 484), (765, 493), (743, 479), (724, 468), (711, 475)], 'RGB': [253, 250, 238]}, {'name': 'exposed-source-tie', 'polygon': [(574, 389), (596, 404), (615, 535), (615, 584), (656, 669), (670, 751), (648, 804), (617, 822), (582, 767), (582, 698), (575, 621), (563, 508)], 'RGB': [233, 16, 1]}, {'name': 'palm-source-shadow-clean-cream', 'polygon': [(814, 666), (839, 650), (858, 669), (857, 701), (829, 714)], 'RGB': [255, 211, 145]}], 'eyes': [{'scleraBox': [722, 475, 747, 519], 'pupilBox': [736, 481, 746, 513]}, {'scleraBox': [759, 481, 771, 511], 'pupilBox': [766, 486, 770, 506]}], 'retainedRealGapBoxes': [[673, 627, 770, 744]], 'handInspectionBoxes': {'rear-folded-fist': [283, 432, 445, 594], 'curled-front-digits': [773, 565, 946, 779]}, 'fingerCreaseGuides': [[[330, 493], [362, 484], [395, 477], [407, 496]], [[347, 523], [380, 509], [416, 522]], [[367, 550], [399, 531], [429, 542]]]}}

def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--source-feature-proposal-slot-released',action='store_true');args=parser.parse_args()
    if not args.source_feature_proposal_slot_released:raise ValueError('Root source-feature proposal slot required')
    recipepath=ART/'full-grab-reach-reviewed-features-01.json'
    if recipepath.exists():raise ValueError('Preserve prior feature proposals')
    contract=ART/'full-grab-reach-generation-contract-01.json'
    rows=[]
    for n in [7,9]:
        prefix=ART/f'fullgrab01-grab-native{n}'
        metadata=Path(str(prefix)+'.json')
        a=np.asarray(Image.open(str(prefix)+'-mask.png').convert('L'))
        source=Image.open(str(prefix)+'-palette-seed.png').convert('RGB')
        rgb=np.asarray(source);on=a>=32;envelope=binary_fill_holes(on)
        depth=distance_transform_edt(envelope)
        selected=np.zeros(on.shape,bool);skin_selection=np.zeros(on.shape,bool);domains=[]
        for name,poly in DOMAINS[n].items():
            mask=Image.new('L',source.size);ImageDraw.Draw(mask).polygon(poly,fill=255)
            selection=np.asarray(mask)>0;selected|=selection
            if name=='exposed-chest-skin':skin_selection|=selection
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
            cream=(on[y,x] and rgb[y,x,0]>240 and rgb[y,x,1]>150) or skin_selection[y,x]
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
        for line in f['fingerCreaseGuides']:draw.line(line,fill=(80,245,100),width=4)
        for eye in f['eyes']:draw.rectangle(eye['scleraBox'],outline=(50,210,255),width=2)
        opath=ART/f'fullgrab01-grab-native{n}-feature-domain-reach-proposal01.png';overlay.save(opath)
        face=source.copy();fd=ImageDraw.Draw(face)
        for d in f['paintDomains']:
            if 'tie' not in d['name']:fd.polygon(d['polygon'],fill=tuple(d['RGB']))
        for eye in f['eyes']:fd.ellipse(eye['scleraBox'],fill=(253,250,238));fd.ellipse(eye['pupilBox'],fill=(20,12,7))
        box=(595,365,830,555);view=Image.new('RGB',(960,400),(30,34,42));view.paste(source.crop(box).resize((480,400)),(0,0));view.paste(face.crop(box).resize((480,400)),(480,0))
        fpath=ART/f'fullgrab01-grab-native{n}-face-feature-reach-proposal01.png';view.save(fpath)
        last=int(np.where(on)[0].max())
        rows.append({'nativeSample':n,'gameplayAge':n-1,'sourceGuideMetadataSha256':sha(metadata),**f,'opacityRepairDomains':domains,'reviewedMaterialAlphaRepairs':repairs,'materialRepairDiagnostics':{'exactPixelCount':len(repairs),'alphaZeroMaterialPixels':int((change&(a==0)).sum()),'existingPartialMaterialPixels':int((change&(a>0)).sum()),'exteriorAlpha32EnvelopeIdentical':True,'retainedRealGapAlphaIdentical':True,'enclosedAlpha0Before':int((envelope&~on).sum()),'enclosedAlpha0AfterProposed':int((envelope&~(diagnostic>=32)).sum()),'beyondReviewedDomainsUntouched':True},'sourceSupport':{'lastPixelY':last,'inputBandStartPixelY':760,'targetLastPixelY':830,'inclusiveRowsRatio':71/(last-760+1),'rootPixelY':832},'proposalViews':[pin(opath),pin(fpath)],'hands':'source silhouette/skin/finger contours retained; no contact native8 hand shape reused','rootReviewStatus':'pending','actualFeatureImageReview':'pending'})
    recipe={'state':'actual source/feature authoring proposal; root review pending; no atlas input assembly','contractSha256':sha(contract),'featureProposalTool':pin(Path(__file__)),'actualSourceGuideAndFeatureDomainsReviewed':False,'sourceRasterReceipt':pin(ART/'full-grab-grab-02-source-guide-preparation.json'),'poses':rows,'sourceFilesUnchanged':True,'GPUUsed':False,'atlasInputAssemblyExecuted':False,'limits':['Material alpha repairs local to actually inspected anatomical domains, exact per-pixel RGB required before clamp.','Genuine under-muzzle/arm gaps excluded; no all-hole blanket fill.','Source facial material is approximate; proposed attached target eye/brow planes authored for selected identity, output requires independent actual inspection.']}
    recipepath.write_text(json.dumps(recipe,indent=2)+'\n')
    print(json.dumps({'recipe':pin(recipepath),'poses':[{'nativeSample':r['nativeSample'],'materialDiagnostics':r['materialRepairDiagnostics'],'sourceSupport':r['sourceSupport']} for r in rows]},indent=2))

if __name__=='__main__':main()
