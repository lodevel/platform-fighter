"""Versioned authored RGB derivative; preserves every source alpha/root pixel.

Reviewed hand pilots extend the Final v3 leather/Slate palette to actual quiver
feather triangles. Mesh IDs are resolved from exact captured object/material
ownership, never from proximity, RGB alone, or a global alpha-part mask.
"""
import numpy as np
from PIL import Image, ImageFilter


def apply(old, owners, semantic, metadata):
    def object_id(subindex, material):
        ids = [int(k) for k, v in metadata['objectIds'].items()
               if v['mesh'] == 'body_c00_highShape' and v['subindex'] == subindex
               and v['material'] == material]
        if len(ids) != 1:
            raise ValueError('Exact quiver mesh/material owner is unavailable')
        return ids[0]
    cloth_id = object_id(1, 'def_link_001')
    feather_id = object_id(0, 'alp_link_001_punch')
    result = old.copy()
    opaque = old[:, :, 3] > 0
    quiver = (semantic == 101) & (owners == cloth_id) & opaque
    slate = (semantic == 102) & (owners == cloth_id) & opaque
    feathers = (semantic == 101) & (owners == feather_id) & opaque
    rgb = old[:, :, :3].astype(float)
    luminance = rgb @ np.array([.2126, .7152, .0722])
    for mask, colors in [(quiver, [[49,30,19], [111,61,24], [165,99,40]]),
                         (feathers, [[49,36,22], [154,134,93], [233,222,185]])]:
        middle, high = (65,160) if mask is quiver else (75,150)
        result[mask & (luminance <= middle), :3] = colors[0]
        result[mask & (luminance > middle) & (luminance <= high), :3] = colors[1]
        result[mask & (luminance > high), :3] = colors[2]
    runes = slate & (rgb[:,:,0] > rgb[:,:,1]*1.15) & (rgb[:,:,0] > rgb[:,:,2]*1.4) & (rgb[:,:,0] > 70)
    result[slate & ~runes & (luminance > 110), :3] = [39,84,105]
    result[slate & ~runes & (luminance <= 110), :3] = [23,47,61]
    result[runes, :3] = [201,154,62]
    for mask in [quiver, slate, feathers]:
        inside = np.asarray(Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 0
        result[mask & ~inside, :3] = [27,22,14]
    allowed = quiver | slate | feathers
    if not np.array_equal(old[:,:,3], result[:,:,3]):
        raise ValueError('Equipment RGB derivative changed alpha')
    if np.any(np.any(old[:,:,:3] != result[:,:,:3], axis=2) & ~allowed):
        raise ValueError('Equipment RGB derivative escaped exact source ownership')
    return result
