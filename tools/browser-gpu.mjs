import assert from 'node:assert/strict';

/** Process-local test configuration only; never changes game or driver settings. */
export function browserGPUConfiguration(mode='software') {
  assert.ok(mode==='hardware'||mode==='software','--gpu must be hardware or software');
  const environment=mode==='hardware'?{GALLIUM_DRIVER:'d3d12',MESA_D3D12_DEFAULT_ADAPTER_NAME:'NVIDIA'}:{};
  const args=mode==='hardware'
    ?['--enable-gpu','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist']
    :['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  return{evidence:{mode,headless:true,args,environment},launch:{headless:true,args,env:{...process.env,...environment}}};
}

/** Inspect the actual game's existing context, not a separate capability canvas. */
export async function inspectMatchGPU(page,mode) {
  const gpu=await page.evaluate(()=>{
    const canvas=document.querySelector('canvas'),gl=canvas?.getContext('webgl2');
    if(!gl)throw new Error('Actual game WebGL2 context is unavailable');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return{unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
      unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,
      renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),
      version:gl.getParameter(gl.VERSION),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),contextLost:gl.isContextLost()};
  });
  assert.equal(gpu.contextLost,false);
  if(mode==='hardware'){
    assert.match(gpu.unmaskedRenderer??'',/D3D12/i,'hardware qualification requires actual D3D12 context');
    assert.match(gpu.unmaskedRenderer??'',/NVIDIA/i,'hardware qualification requires actual NVIDIA context');
    assert.doesNotMatch(gpu.unmaskedRenderer??'',/SwiftShader|llvmpipe|softpipe|lavapipe|Software/i);
  }
  return gpu;
}
