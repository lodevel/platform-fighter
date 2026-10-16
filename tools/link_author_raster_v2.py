"""Explicit offline artist implementation; independent of the active v1 worker."""
from pathlib import Path
import ctypes,subprocess
import numpy as np

LIBRARY=Path(__file__).resolve().parents[1]/'.tmp/link-author-raster-v2.so'
SOURCE=LIBRARY.parents[1]/'tools/link_author_raster_v2.cpp'

def build_kernel():
    """Compile the C kernel when the .so is missing or older than its source."""
    if not LIBRARY.exists() or LIBRARY.stat().st_mtime<SOURCE.stat().st_mtime:
        LIBRARY.parent.mkdir(exist_ok=True)
        subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC','-ffp-contract=off','-o',str(LIBRARY),str(SOURCE)],check=True)

build_kernel()
_library=ctypes.CDLL(str(LIBRARY));_kernel=_library.link_author_raster_v2
P=ctypes.c_void_p;I=ctypes.c_int;D=ctypes.c_double;U=ctypes.c_uint16
_kernel.argtypes=[P,I,P,I,P,P,I,I,P,P,P,U,P,I,I,P,D,D,D,D,I,I,P,P,U]
_kernel.restype=None

def rasterize_uv(vertices, indices, uvs, texture, pixels, depth, facial_pixels, facial, eye_decal=None, uv_transform=None, *, art_root, ppu, view_side, uv_buffer=None, texture_regions=None, texture_id=0):
    vertices=np.ascontiguousarray(vertices,dtype=np.float64)
    indices=np.ascontiguousarray(indices,dtype=np.int64).reshape(-1)
    uvs=np.ascontiguousarray(np.asarray(uvs)[:,:2],dtype=np.float64)
    texture=np.ascontiguousarray(texture,dtype=np.uint8)
    eye=np.ascontiguousarray(eye_decal,dtype=np.uint8) if eye_decal is not None else None
    transform=np.ascontiguousarray(uv_transform if uv_transform is not None else [1,1,0,0],dtype=np.float64)
    # Output copies are forbidden; caller owns the same paired pixel/depth maps.
    for array,dtype in [(pixels,np.uint8),(depth,np.float64),(facial_pixels,np.uint16),(uv_buffer,np.float32),(texture_regions,np.uint16)]:
        if array is not None and (array.dtype!=dtype or not array.flags.c_contiguous):
            raise ValueError('Artist raster output must be contiguous with exact dtype')
    def ptr(a):return a.ctypes.data if a is not None else None
    _kernel(ptr(vertices),len(vertices),ptr(indices),len(indices),ptr(uvs),ptr(texture),texture.shape[1],texture.shape[0],ptr(pixels),ptr(depth),ptr(facial_pixels),facial,ptr(eye),eye.shape[1] if eye is not None else 0,eye.shape[0] if eye is not None else 0,ptr(transform),art_root[0],art_root[1],ppu,1 if view_side=='negative' else -1,pixels.shape[1],pixels.shape[0],ptr(uv_buffer),ptr(texture_regions),texture_id)

def install_on_guide(guide):
    guide.rasterize_uv=rasterize_uv
    def semantic(vertices,indices,uvs,texture,pixels,depth,regions,region,eye=None,transform=None):
        return rasterize_uv(vertices,indices,uvs,texture,pixels,depth,regions,region,eye,transform,art_root=guide.ART_ROOT,ppu=guide.PPU,view_side=guide.VIEW)
    guide.raster.rasterize=semantic
