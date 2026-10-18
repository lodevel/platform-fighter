"""Ultimate DK jab1 frames -> character cut-outs (scratch only, never in docs except small crops)."""
import numpy as np, glob, json
from PIL import Image
from scipy import ndimage as ndi
D='/home/lombet/Workspace/platform-fighter/assets/gen/dk-ufd/extracted/DonkeyKongJab1'
files=sorted(glob.glob(D+'/source-*.png'))
out=[]
for i,f in enumerate(files):
  im=np.asarray(Image.open(f).convert('RGB')).astype(np.int32)
  mx=im.max(-1); mn=im.min(-1)
  grey=(mx-mn)<10
  r,g,b=im[...,0],im[...,1],im[...,2]
  red=(r>120)&(r-g>60)&(r-b>50)&~((g>150))
  cross=(mn>200)&grey
  ch=~(grey&(mx<140))
  Image.fromarray(((~ndi.binary_dilation(red|cross,iterations=3))*255).astype(np.uint8)).save(f'ult/care_{i:02d}.png')
  ch=ndi.binary_opening(ch,iterations=1); ch=ndi.binary_fill_holes(ch)
  lab,n=ndi.label(ch); sz=ndi.sum(ch,lab,range(1,n+1)); keep=np.isin(lab,1+np.nonzero(sz>200)[0])
  ys,xs=np.nonzero(keep)
  a=np.dstack([im.astype(np.uint8),(keep*255).astype(np.uint8)])
  Image.fromarray(a,'RGBA').save(f'ult/{i:02d}.png')
  out.append(dict(i=i,bbox=[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]))
json.dump(out,open('ult/bbox.json','w'))
print(out[0],out[4],out[12])
