import numpy as np
from PIL import Image
DS=0.4666667; CELL=4
def premult(im):
  a=np.asarray(im.convert('RGBA')).astype(np.float32)/255; a[...,:3]*=a[...,3:4]; return a
def cells(a):
  H,W=a.shape[:2]; c=CELL/DS; h,w=int(H/c),int(W/c)
  out=np.zeros((h,w,4),np.float32)
  for y in range(h):
    for x in range(w):
      out[y,x]=a[int(y*c):int((y+1)*c),int(x*c):int((x+1)*c)].mean((0,1))
  return out
def sigdiff(A,B):
  a,b=cells(premult(A)),cells(premult(B))
  m=(a[...,3]>=0.02)|(b[...,3]>=0.02)
  return float(np.abs(a-b)[m].mean())
def iou(A,B):
  a=np.asarray(A.convert('RGBA'))[...,3]>127; b=np.asarray(B.convert('RGBA'))[...,3]>127
  return float((a&b).sum()/max(1,(a|b).sum()))
