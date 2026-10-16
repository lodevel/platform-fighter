"""Author distinct ROOT-fixed Jungle Rush recipient phase recipes.

Accepted body drawings seed identity. New squash/rotation/impact recipes are
explicit 2D choreography adapters, not recovered native Final victim dispatch.
The identical similarity operator poses art, receiving and Hip capture anchor.
"""
from pathlib import Path
import hashlib,importlib.util,json,math,sys
sys.path[:0]=[str(Path(__file__).resolve().parent),str(Path(__file__).resolve().parents[1]/'.tmp/pikachu-final-libs')]
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
_spec=importlib.util.spec_from_file_location('pikachu_final_victims',Path(__file__).with_name('pikachu-final-victims.py'))
_base=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_base)
load_cell,source_geometry,link_declarations=_base.load_cell,_base.source_geometry,_base.link_declarations
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/review/2026-10-15/donkeykong-final/victim-art-staging'
SIZE=(512,512);ORIGIN=np.array([256.,384.]);SCALE=7/15
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def authored_cell(cell,clip,pivot,angle,scale,pulse):
 r=angle*math.pi/180;rot=np.array([[math.cos(r),-math.sin(r)],[math.sin(r),math.cos(r)]])*scale;shift=pivot-rot@pivot
 matrix=rot*(clip['scaleToWorld']/SCALE);offset=ORIGIN+shift/SCALE-matrix@np.array(clip['root']);inverse=np.linalg.inv(matrix);translation=-inverse@offset
 picture=cell.transform(SIZE,Image.Transform.AFFINE,(*inverse[0],translation[0],*inverse[1],translation[1]),resample=Image.Resampling.BICUBIC)
 bounds=picture.getbbox();assert bounds
 # A short warm rim and four impact dashes mark the authored punch reaction.
 # Decorative light remains outside body receiving geometry.
 pixels=np.asarray(picture).copy();solid=pixels[:,:,3]>0
 amount=.07*pulse;pixels[solid,:3]=(pixels[solid,:3]*(1-amount)+np.array([255,222,156])*amount).astype(np.uint8)
 picture=Image.fromarray(pixels);mask=Image.fromarray(pixels[:,:,3]);outer=mask.filter(ImageFilter.MaxFilter(5));rim=np.maximum(0,np.asarray(outer).astype(int)-np.asarray(mask).astype(int)).astype(np.uint8)
 layer=Image.new('RGBA',SIZE,(255,205,91,0));layer.putalpha(Image.fromarray((rim*.45).astype(np.uint8)));layer.alpha_composite(picture)
 d=ImageDraw.Draw(layer);x0,y0,x1,y1=bounds
 for n in range(4):
  side=-1 if n%2 else 1;cx=x0-8 if side<0 else x1+8;cy=y0+(y1-y0)*(n+1)/5
  d.line([(cx+side*5,cy-6),(cx+side*14,cy-14)],fill=(255,214,120,210),width=4)
 assert layer.getbbox()[0]>1 and layer.getbbox()[1]>1 and layer.getbbox()[2]<511 and layer.getbbox()[3]<511,'Authored recipient clipped'
 return layer,rot,shift,bounds

def main():
 OUT.mkdir(parents=True,exist_ok=True);rows=[]
 declarations={'pikachu':json.loads((ROOT/'docs/review/2026-10-06/pikachu-character/sources/native-hurtbox-capsules.json').read_text())['capsules'],
 'donkeykong':json.loads((ROOT/'docs/review/2026-09-25/donkeykong-character/sources/authored-anatomical-capsules.json').read_text())['regions'],'link':link_declarations()}
 phases={'entry':[(0,12,.98,1),(1,24,.96,2),(2,18,.97,1)],
 'stagger_a':[(1,-12,.96,2),(2,-20,.94,3),(1,-9,.97,1)],
 'stagger_b':[(2,15,.96,2),(1,23,.94,3),(2,11,.97,1)],
 'uppercut_pre':[(1,-8,.95,1),(0,-17,.92,2),(0,-23,.90,3)]}
 for actor,centre in [('pikachu',-25),('donkeykong',-42),('link',-36)]:
  directory=OUT/actor;(directory/'animations').mkdir(parents=True,exist_ok=True);bank=json.loads((ROOT/'assets/characters'/actor/'frames.json').read_text())
  key='f00damagen1'if actor=='link'else'hurt';clip=bank['animations'][key];motion={'pikachu':'f00damagen1','donkeykong':'f00damagen2','link':'f00damagen1'}[actor]
  profiles={};animations={};geometry_cache={}
  for phase,jobs in phases.items():
   sheet='final_victim_jungle_'+phase;page=Image.new('RGBA',(512*len(jobs),512));gallery=Image.new('RGB',(300*len(jobs),340),'#23334a');drawings=[];samples=[]
   for index,(source_index,angle,scale,pulse)in enumerate(jobs):
    native=clip['nativeSampleIndices'][source_index]-(0 if actor=='pikachu'else 1)
    if source_index not in geometry_cache:geometry_cache[source_index]=source_geometry(actor,motion,native,declarations[actor])
    receiving,hip,provenance=geometry_cache[source_index]
    picture,rot,shift,bounds=authored_cell(load_cell(actor,clip,source_index),clip,np.array([0.,float(centre)]),angle,scale,pulse);page.alpha_composite(picture,(index*512,0))
    posed=[]
    for c in receiving:
     ends=[rot@c[k]+shift for k in ['start','end']];posed.append({'id':actor+'.'+sheet+'.'+c['id'],'region':c['region'],'start':dict(zip(('x','y'),ends[0].tolist())),'end':dict(zip(('x','y'),ends[1].tolist())),'radius':c['radius']*scale})
    anchor=rot@hip+shift;duration=3
    drawings.append({'startAge':index*duration,'endAgeExclusive':(index+1)*duration,'frameIndex':index,'nativeSample':None,'authoredSampleIndex':index,
      'receiving':posed,'attachments':[{'role':'capture-anchor','point':dict(zip(('x','y'),anchor.tolist()))}],'originX':.5,'originY':.75,'captureSupport':None})
    samples.append({'authoredSampleIndex':index,'sourceSheet':key,'sourceArtFrameIndex':source_index,'baseNativeMotion':motion,'baseNativeRawSample':native,
      'angleDegrees':angle,'uniformScale':scale,'pivotWorld':[0,centre],'warmImpactPulse':pulse,'baseMotionProvenance':provenance,'bodyBoundsBeforeDecorativeImpact':bounds})
    check=picture.copy();d=ImageDraw.Draw(check)
    for c in posed:
     points=[tuple(ORIGIN+np.array([c[k]['x'],c[k]['y']])/SCALE)for k in ['start','end']];radius=c['radius']/SCALE;d.line(points,fill='#b79aff',width=2)
     for x,y in points:d.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#b79aff',width=2)
    check=check.crop(check.getbbox());check.thumbnail((290,300));gallery.paste(check,(index*300+(300-check.width)//2,35),check);ImageDraw.Draw(gallery).text((index*300+6,6),f'{actor} {phase} recipe{index}',fill='white')
   recipe={'schema':'authored-jungle-recipient-recipe/1','actor':actor,'phase':phase,'sourceArtwork':str((ROOT/'assets/characters'/actor/clip['strip']).relative_to(ROOT)),
    'sourceArtworkSha256':sha(ROOT/'assets/characters'/actor/clip['strip']),'sourceMetadataClip':clip,'operatorSha256':sha(__file__),'samples':samples,
    'precision':'New authored cinematic recipient from accepted identity art and explicit similarity/impact recipe; independently posed native or authored-skin receiving receives the identical transform. Not a native Final victim dispatcher. ROOT fixed, capture owns displacement, no floor snap, decorative impact marks are not receiving.'}
   recipe_path=directory/(sheet+'-recipe.json');recipe_path.write_text(json.dumps(recipe,indent=2)+'\n');dest=directory/'animations'/(sheet+'.png');page.save(dest,optimize=True)
   profiles[sheet]={'coordinateOrigin':'actorSourceRoot','sourceSampleBasis':'authored-final-victim-recipe-index','authoredSourceIdentity':{'kind':'AUTHORED_FINAL_CINEMATIC_RECIPIENT','recipeId':actor+'.jungle.'+phase+'.authored-v1','sha256':sha(recipe_path)},
    'sheet':sheet,'frameWidth':512,'frameHeight':512,'scaleToWorld':SCALE,'bodyCentreFromRootY':centre,'endAgeExclusive':9,'terminalHold':True,'rootDelta':[{'x':0,'y':0}],'drawings':drawings}
   animations[sheet]={'strip':'animations/'+sheet+'.png','sha256':sha(dest),'frameCount':len(jobs),'frameWidth':512,'frameHeight':512,'columns':len(jobs),'rows':1,'root':ORIGIN.tolist(),'scaleToWorld':SCALE,'bodyCentreFromRootY':centre}
   panel=directory/(sheet+'-all-drawings.png');gallery.save(panel);rows.append({'actor':actor,'sheet':sheet,'drawings':len(jobs),'panel':str(panel.relative_to(ROOT)),'panelSha256':sha(panel),'recipe':str(recipe_path.relative_to(ROOT)),'recipeSha256':sha(recipe_path)})
  (directory/'metadata-proposal.json').write_text(json.dumps({'animations':animations,'runtimeFinalVictimProfiles':{'schema':'authored-final-victim-profiles/1','targetFighter':actor,'profiles':profiles}},indent=2)+'\n')
 (OUT/'index.json').write_text(json.dumps({'schema':'authored-jungle-recipient-stage/1','rows':rows,'drawings':sum(r['drawings']for r in rows),'runtimeVerified':False},indent=2)+'\n');print(json.dumps({'profiles':len(rows),'drawings':sum(r['drawings']for r in rows),'stage':str(OUT.relative_to(ROOT))}))
if __name__=='__main__':main()
