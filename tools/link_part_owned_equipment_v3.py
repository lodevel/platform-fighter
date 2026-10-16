"""Reviewed RGB-only gear/Sword derivative of fixed source-owned target pixels.

No texture/input/mesh/pose/root/alpha mutation; actual owners resolve by exact
mesh+material identity. Existing unchanged frozen source banks are inputs.
"""
import numpy as np
from link_part_owned_equipment_v2 import apply as gear_v2

def apply(old, owners, semantic, metadata):
    result = gear_v2(old, owners, semantic, metadata)
    rgb = result[:, :, :3].astype(float)
    luminance = rgb @ np.array([.2126, .7152, .0722])
    sword_ids = [int(k) for k,v in metadata['objectIds'].items()
                 if v['mesh'] == 'link_ken_VIS_O_OBJShape' and v['material'] == 'metal_link_001']
    feather_ids = [int(k) for k,v in metadata['objectIds'].items()
                   if v['mesh'] == 'body_c00_highShape' and v['subindex'] == 0
                   and v['material'] == 'alp_link_001_punch']
    if len(sword_ids)>1 or len(feather_ids)!=1:
        raise ValueError('Ambiguous exact equipment ownership')
    sword = np.isin(owners,sword_ids) & (old[:,:,3]>0)
    feather=(owners==feather_ids[0])&(semantic==101)&(old[:,:,3]>0)
    engraving=sword&(rgb[:,:,1]>rgb[:,:,0]*1.06)&(rgb[:,:,1]>rgb[:,:,2]*.95)&(rgb[:,:,0]<150)&(luminance>38)
    result[engraving,:3]=[137,159,172]
    purple=sword&(rgb[:,:,2]>rgb[:,:,0]*1.12)&(rgb[:,:,2]>rgb[:,:,1]*1.18)&(luminance>30)&(rgb[:,:,0]<155)
    result[purple,:3]=[57,48,102]
    lattice=engraving&(rgb[:,:,0]<60)&(rgb[:,:,2]<95)
    result[lattice,:3]=[87,79,126]
    result[feather&(luminance<90),:3]=[119,93,59]
    result[feather&(luminance>=90),:3]=[227,211,174]
    if not np.array_equal(result[:,:,3],old[:,:,3]):
        raise ValueError('RGB derivative changed alpha')
    return result
