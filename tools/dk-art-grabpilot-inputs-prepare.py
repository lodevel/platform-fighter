"""Source-derived target pilot inputs only. Never queues or writes game assets."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from scipy.ndimage import binary_fill_holes,distance_transform_edt

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/review/2026-09-25/donkeykong-character/audit-2026-10-08/art'
SRC=ART/'grab-first-five-native-guides-01'
BG=(204,73,140)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
RECIPES={
 'grab-native8':{'cover':[(682,410),(731,416),(778,438),(799,470),(788,520),(729,531),(695,497)],'eyes':[(734,475,759,519),(771,481,783,511)],'brow':[(719,466),(735,457),(758,470),(780,484),(777,493),(755,479),(736,468),(723,475)],'palm':[(851,632),(882,606),(931,619),(954,666),(940,719),(875,714)],'material':[(621,381),(656,357),(708,367),(763,407),(790,456),(785,500),(728,531),(675,496)]},
 'dash_grab-native11':{'cover':[(710,414),(752,422),(790,444),(815,482),(803,526),(743,540),(712,501)],'eyes':[(754,478,778,521),(790,484,804,513)],'brow':[(739,466),(755,458),(777,472),(803,488),(799,497),(775,481),(756,471),(742,477)],'palm':[(900,630),(932,599),(982,617),(997,672),(975,720),(919,715)],'material':[(650,380),(688,364),(747,382),(791,421),(814,466),(799,505),(743,540),(699,501)]},
 'pivot_grab-native12':{'cover':[(713,411),(756,391),(804,398),(828,430),(818,483),(774,534),(720,525),(702,479)],'eyes':[(722,476,746,522),(755,482,767,511)],'brow':[(707,481),(729,463),(749,463),(773,477),(769,487),(749,473),(732,473),(714,491)],'palm':[(398,596),(451,590),(488,631),(491,691),(456,726),(395,695)],'material':[(739,375),(783,365),(823,398),(834,449),(811,493),(774,534),(720,525),(697,486)]},
 'grab_pull-native1':{'cover':[(697,383),(745,382),(789,405),(820,446),(810,478),(751,485),(713,456)],'eyes':[(754,435,779,475),(792,441,808,469)],'brow':[(739,425),(756,415),(779,429),(808,440),(804,450),(776,438),(757,427),(744,434)],'material':[(655,344),(694,321),(738,330),(784,367),(815,419),(810,478),(751,485),(696,456)]},
 'grab_hold-native1':{'cover':[(620,361),(676,357),(718,379),(748,417),(741,461),(684,470),(642,430)],'eyes':[(682,416,708,458),(722,421,738,451)],'brow':[(667,406),(685,396),(708,410),(739,424),(735,434),(706,420),(686,408),(672,415)],'material':[(577,326),(611,304),(656,317),(704,351),(742,406),(741,461),(684,470),(631,429)]}
}

def main(batch):
    setup=json.loads((ART/'grab-first-five-target-pilot-setup-01.json').read_text())
    job=setup['jobs'][batch-1];family=job['jobFamily'];prep=ART/(family+'-preparation.json')
    if prep.exists():raise ValueError('Refusing to overwrite prepared pilot; retain and create versioned derivative')
    cw,ch=job['cell'];gw,gh=job['canvas'];canvas=Image.new('RGB',(gw,gh),BG);guide=Image.new('L',(gw,gh));noise=Image.new('L',(gw,gh))
    sourcew=2048 if batch==2 else 1536;sourceh=1024;rootx=1024 if batch==2 else 512
    ref=ROOT/setup['reference']['path'];fullref=Image.new('RGBA',(sourcew,sourceh),(0,0,0,0));fullref.alpha_composite(Image.open(ref).convert('RGBA'),(512 if batch==2 else 0,0))
    refhalf=fullref.resize((cw,ch),Image.Resampling.LANCZOS);refcell=Image.new('RGBA',(cw,ch),BG+(255,));refcell.alpha_composite(refhalf);canvas.paste(refcell.convert('RGB'),(0,0))
    records=[]
    for cell,key in enumerate(job['poses'],1):
        meta=json.loads((SRC/(key+'.json')).read_text());r=RECIPES[key]
        # Reviewed native cream brow remnants must not form a second crest
        # above the authored eye plane in the pull/hold guide.
        covers={'grab_pull-native1':[(690,377),(745,365),(795,392),(826,432),(824,478),(750,488),(700,449)],'grab_hold-native1':[(609,362),(664,351),(715,357),(753,390),(748,450),(711,478),(656,482),(620,440)]}
        if key in covers:r={**r,'cover':covers[key]}
        source=SRC/(key+'-palette-seed.png');mask=SRC/(key+'-mask.png');rawmask=np.asarray(Image.open(mask).convert('L'));visible=rawmask>=32;last=int(np.where(visible)[0].max())
        rgb=np.asarray(Image.open(source).convert('RGB').filter(ImageFilter.MedianFilter(21))).copy()
        palette=np.asarray([[190,22,5],[233,16,1],[255,211,145],[252,250,238],[24,15,10]],dtype=np.int16)
        difference=rgb.astype(np.int16)[:,:,None,:]-palette[None,None,:,:];dist=(difference.astype(np.float32)**2).sum(3)
        rgb[visible]=palette[dist.argmin(2)][visible];rgb[~visible]=BG;rgb[visible&(rgb[:,:,0]<60)]=[164,17,4]
        # Source red/pink cloth hue inside actually viewed necktie area supplies
        # an authored target garment guide; letters/native shading are omitted.
        native=np.asarray(Image.open(SRC/(key+'-reference.png')).convert('RGBA'))
        nr,ng,nb=native[:,:,:3].astype(float).transpose(2,0,1)
        tieboxes={'grab-native8':(570,365,700,826),'dash_grab-native11':(590,365,748,836),'pivot_grab-native12':(816,402,997,806),'grab_pull-native1':(586,409,711,844),'grab_hold-native1':(532,386,654,831)}
        x0,y0,x1,y1=tieboxes[key];roi=np.zeros(visible.shape,bool);roi[y0:y1,x0:x1]=True
        cloth=roi&visible&(nr>110)&(nr>ng*1.6)&(nb>ng*.7)
        rgb[cloth]=[232,13,0]
        # Remove the inspected source skin shadow mapped to a red palm speck.
        palmboxes={'grab-native8':(846,650,886,706),'dash_grab-native11':(893,650,938,706),'pivot_grab-native12':(445,650,516,706)}
        if key in palmboxes:
            x0,y0,x1,y1=palmboxes[key];region=np.zeros(visible.shape,bool);region[y0:y1,x0:x1]=True
            red=region&visible&(rgb[:,:,0]>130)&(rgb[:,:,1]<100)&(rgb[:,:,2]<80)
            rgb[red]=[255,211,145]
        colored=Image.fromarray(rgb);d=ImageDraw.Draw(colored);d.polygon(r['cover'],fill=(190,22,5))
        tiecovers={'grab-native8':[(608,658),(641,654),(662,699),(675,742),(653,782),(621,811),(600,780),(584,749),(591,706)],'dash_grab-native11':[(639,662),(674,675),(704,712),(731,759),(730,803),(693,829),(660,807),(631,761),(634,708)],'pivot_grab-native12':[(860,691),(904,676),(940,681),(958,708),(946,749),(912,779),(873,784),(842,760),(817,737),(832,711)],'grab_pull-native1':[(621,659),(647,661),(661,710),(669,763),(648,813),(619,840),(600,822),(587,783),(590,741),(604,694)],'grab_hold-native1':[(576,645),(606,657),(624,707),(632,752),(612,799),(588,822),(560,812),(547,780),(548,734),(561,688)]}
        if key in tiecovers:
            r={**r,'tieCover':tiecovers[key]}
            d.polygon(r['tieCover'],fill=(232,13,0))
        for x0,y0,x1,y1 in r['eyes']:
            w=x1-x0;h=y1-y0;d.ellipse((x0,y0,x1,y1),fill=(253,250,238))
            # Pivot source head faces left, all other source heads right.
            lo,hi=(.08,.43) if batch==2 else (.55,.94)
            d.ellipse((x0+w*lo,y0+h*.14,x0+w*hi,y0+h*.86),fill=(20,12,7))
        d.polygon(r['brow'],fill=(253,250,238))
        if 'palm' in r:d.polygon(r['palm'],fill=(255,211,145))
        crease={'grab-native8':[[(345,505),(383,514),(417,497)],[(346,530),(384,541),(418,524)],[(354,557),(391,566),(425,548)]], 'dash_grab-native11':[[(380,433),(421,438),(453,430)],[(377,461),(417,469),(451,456)],[(379,485),(417,492),(450,482)]], 'pivot_grab-native12':[[(1041,417),(1081,425),(1132,422)],[(1052,447),(1095,454),(1141,447)],[(1065,474),(1107,482),(1143,474)]], 'grab_pull-native1':[[(951,510),(982,495),(1015,514)],[(943,545),(975,533),(1018,551)],[(945,578),(978,569),(1016,589)]], 'grab_hold-native1':[[(797,559),(833,550),(863,567)],[(789,587),(828,579),(860,597)],[(790,616),(827,611),(858,627)]]}
        r={**r,'fingerCreaseGuides':crease[key],'tieHueGuideBox':tieboxes[key],'palmRedPatchBox':palmboxes.get(key)}
        for line in r['fingerCreaseGuides']:d.line(line,fill=(184,118,62),width=3,joint='curve')
        def warp(im):
            out=Image.new(im.mode,(sourcew,sourceh),0 if im.mode=='L' else BG);out.paste(im.crop((0,0,sourcew,760)),(0,0));out.paste(im.crop((0,760,sourcew,last+1)).resize((sourcew,71),Image.Resampling.NEAREST if im.mode=='L' else Image.Resampling.BICUBIC),(0,760));return out
        target=warp(colored);alpha=np.asarray(warp(Image.fromarray(rawmask))).copy();on=alpha>=32;envelope=binary_fill_holes(on);distance=distance_transform_edt(envelope)
        selected=Image.new('L',(sourcew,sourceh));ImageDraw.Draw(selected).polygon(r['material'],fill=255)
        holes=(np.asarray(selected)>0)&envelope&~on&(distance>3);partial=on&(distance>3)&(alpha<255);alpha[holes|partial]=255
        assert np.array_equal(~envelope,~binary_fill_holes(alpha>=32))
        arr=np.asarray(target).copy();arr[holes]=[190,22,5];arr[alpha<32]=BG;target=Image.fromarray(arr)
        seedfile=ART/(family+'-'+key+'-authored-seed.png');alphafile=ART/(family+'-'+key+'-authored-alpha.png');target.save(seedfile);Image.fromarray(alpha).save(alphafile)
        half=target.resize((cw,ch),Image.Resampling.LANCZOS);a=np.asarray(half).astype(int);edges=np.zeros((ch,cw),bool)
        for axis in [0,1]:edges|=np.max(np.abs(a-np.roll(a,1,axis)),axis=2)>35
        gx=cell*cw if batch==2 else cell%2*cw;gy=0 if batch==2 else cell//2*ch
        canvas.paste(half,(gx,gy));guide.paste(Image.fromarray((edges*255).astype(np.uint8)),(gx,gy));noise.paste(Image.fromarray(alpha).resize((cw,ch),Image.Resampling.LANCZOS).filter(ImageFilter.MaxFilter(11)),(gx,gy))
        sheet,sample=key.split('-native');records.append({'clip':sheet,'nativeSample':int(sample),'gameplayAge':int(sample)-1,'prefix':key,'cell':cell,'cellPosition':[gx,gy],'sourceGuideMetadata':str((SRC/(key+'.json')).relative_to(ROOT)),'sourceGuideMetadataSha256':sha(SRC/(key+'.json')),'sourceSeedSha256':sha(source),'sourceMaskSha256':sha(mask),'authoredFullSeed':seedfile.name,'authoredFullSeedSha256':sha(seedfile),'authoredPoseAlpha':alphafile.name,'authoredPoseAlphaSha256':sha(alphafile),'fullCanvas':[sourcew,sourceh],'fullRoot':[rootx,832],'sourceScaleToWorld':5/26,'packedCell':[sourcew//4,256],'packedRoot':[rootx//4,208],'packedScaleToWorld':5/6.5,'featureAuthoring':r,'floorTransform':{'inputBandStartPixelY':760,'inputLastPixelY':last,'targetLastPixelY':830,'rootPixelY':832,'pixelsPerNativeUnit':26},'materialAlphaRepair':{'closedMaterialHolePixels':int(holes.sum()),'partialExistingInteriorPixels':int(partial.sum()),'externalConnectedBackgroundIdentical':True},'authoredVictimAttachment':None,'wholeActionClockQualified':False,'actualInputReview':'pending'})
    for kind,im in [('seed',canvas),('guide',guide),('render-mask',noise)]:im.save(ART/(family+'-'+kind+'.png'))
    graph=json.loads((ROOT/setup['acceptedTemplate']['path']).read_text())
    layout='One horizontal row, left reference UNCHANGED, right one backwards-reaching pivot grab with open leftward handR, opposite fist high behind and source rearward stance.' if batch==2 else ('Two by two atlas: top-left accepted reference UNCHANGED; top-right standing grab, bottom-left dash grab; both extend open handL rightward with individually separated fingers, rear handR fist and distinct source leg/torso lean. Bottom-right EMPTY magenta.' if batch==1 else 'Two by two atlas: top-left accepted reference UNCHANGED; top-right pull closes forward handL into upright grip extended beyond muzzle; bottom-left hold keeps curled forward handL nearer chest/muzzle. Bottom-right EMPTY magenta.')
    graph['4']['inputs']['text']='SAME accepted red cartoon Donkey Kong identity as reference. '+layout+' Exact supplied source-conditioned body/hand/head/finger/foot shapes and shared scale/root. Thick attached WHITE eyebrow and WHITE sclera with small BLACK oval pupils following actual head plane, cream muzzle/chest/hands/feet, RED folded necktie when anatomically visible. Smooth clean cel shading, thin dark outline, opaque skin/fur, no native fur ink or face/palm speckles. Empty grip, no object or victim baked into sprite. One gorilla only per pose. Preserve actual hand/muzzle/torso negative spaces and individual fingers. No shadow/floor/text; uniform magenta background.'
    graph['7']['inputs'].update(seed=2026100930+batch,denoise=.5)
    for n,k in [('10','guide'),('13','seed'),('16','render-mask')]:graph[n]['inputs']['image']='pf-'+family+'-'+k+'.png'
    for n,k in [('9','final'),('20','raw')]:graph[n]['inputs']['filename_prefix']='pf-'+family+'-attempt1-'+k
    workflow=ART/(family+'-attempt1.workflow.json');workflow.write_text(json.dumps(graph,indent=2)+'\n')
    receipt={'state':'prepared_actual_input_review_pending','jobFamily':family,'attempt':1,'records':records,'canvas':[gw,gh],'cells':[cw,ch],'layoutColumns':2,'sourceFullRoot':[rootx,832],'root':job['root'],'scaleToWorld':5/13,'bodyCentreFromRootY':-42,'workflow':workflow.name,'workflow_sha256':sha(workflow),'pilotLiveAcceptanceReceipt':setup['pilotLiveAcceptanceReceipt'],'pilotLiveAcceptanceSha256':setup['pilotLiveAcceptanceSha256'],'identityReference':setup['reference'],'identity_mechanism':setup['identityAndGuideMechanism'],'setupReceipt':'grab-first-five-target-pilot-setup-01.json','setupReceiptSha256':sha(ART/'grab-first-five-target-pilot-setup-01.json'),'inputs':{k:{'file':family+'-'+k+'.png','sha256':sha(ART/(family+'-'+k+'.png')),'graphNode':n} for n,k in [('10','guide'),('13','seed'),('16','render-mask')]},'outputNodes':{'9':'final','20':'raw'},'actualInputInspection':'pending; no GPU submitted','deliveredAssetsChanged':False}
    prep.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'preparation':prep.name,'sha256':sha(prep),'cells':len(records),'GPU':'not submitted'}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('batch',type=int,choices=[1,2,3]);main(p.parse_args().batch)
