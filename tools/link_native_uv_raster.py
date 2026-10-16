"""Authoring-only UV correspondence on the same CPU native geometry raster.
No shader or native game renderer parity claim.
"""
import numpy as np
def rasterize_uv(vertices, indices, uvs, texture, pixels, depth, facial_pixels, facial, eye_decal=None, uv_transform=None, *, art_root, ppu, view_side, uv_buffer=None, texture_regions=None, texture_id=0):
    width, height = pixels.shape[1], pixels.shape[0]
    screen = np.column_stack((art_root[0] + vertices[:, 2]*ppu,
                              art_root[1] - vertices[:, 1]*ppu))
    for triangle in indices.reshape((-1, 3)):
        p = screen[triangle]
        minimum = np.maximum(np.floor(p.min(axis=0)).astype(int), [0, 0])
        maximum = np.minimum(np.ceil(p.max(axis=0)).astype(int), [width-1, height-1])
        if np.any(minimum > maximum):
            continue
        a, b, c = p
        den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den) < 1e-8:
            continue
        xx, yy = np.meshgrid(np.arange(minimum[0], maximum[0]+1)+.5,
                             np.arange(minimum[1], maximum[1]+1)+.5)
        w0 = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1])) / den
        w1 = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1])) / den
        w2 = 1-w0-w1
        weights = np.stack((w0, w1, w2), axis=-1)
        xdepth = (weights @ vertices[triangle, 0]) * (1 if view_side == 'negative' else -1)
        uv = weights @ uvs[triangle, :2]
        # Captured diffuse Sampler0 uses Repeat on both axes. Native UVs include
        # negative u on mirrored anatomy; clamping silently destroys markings.
        # DirectX-style v and decoded PNG rows both grow downward.
        tx = np.floor(np.mod(uv[:,:,0],1)*texture.shape[1]).astype(int)
        ty = np.floor(np.mod(uv[:,:,1],1)*texture.shape[0]).astype(int)
        colors = texture[ty,tx]
        if eye_decal is not None:
            sx,sy,du,dv=uv_transform
            # Primary ssbh_wgpu model.wgsl UV transform, captured native material track sample.
            pupil_uv=np.stack((sx*(uv[:,:,0]-du),1-sy*(1-uv[:,:,1]-dv)),axis=2)
            px=np.floor(np.mod(pupil_uv[:,:,0],1)*eye_decal.shape[1]).astype(int)
            py=np.floor(np.mod(pupil_uv[:,:,1],1)*eye_decal.shape[0]).astype(int)
            decal=eye_decal[py,px];alpha=decal[:,:,3:4].astype(float)/255
            composed=colors.copy();composed[:,:,:3]=np.rint(colors[:,:,:3]*(1-alpha)+decal[:,:,:3]*alpha).astype(np.uint8)
            colors=composed
        section = np.s_[minimum[1]:maximum[1]+1, minimum[0]:maximum[0]+1]
        covered = (w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(xdepth<depth[section])&(colors[:,:,3]>127)
        pixels[section][covered] = colors[covered]
        depth[section][covered] = xdepth[covered]
        facial_pixels[section][covered] = facial
        if uv_buffer is not None:
            uv_buffer[section][covered] = uv[covered]
            texture_regions[section][covered] = texture_id

