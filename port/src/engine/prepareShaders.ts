import type * as THREE from 'three';

/** Three r170's compileAsync cannot cancel its internal polling on a lost
 * context. Own the readiness polling so leaving/faulting cannot strand it.
 * Exposed program.getUniforms() also performs first-use shader diagnostics
 * while loading, rather than deferring getProgramInfoLog to the first effect.
 * Without KHR, that public first-use call synchronizes during loading. */
export function prepareSceneShaders(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const canvas = renderer.domElement;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(poll);
      clearTimeout(timeout);
      canvas.removeEventListener('webglcontextlost', contextLost);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const contextLost = () => finish(new Error('Graphics context lost while preparing match shaders'));
    const aborted = () => finish(new Error('Match shader preparation cancelled'));
    canvas.addEventListener('webglcontextlost', contextLost);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    timeout = setTimeout(() => finish(new Error('Match shader preparation timed out')), 10000);
    try {
      const gl = renderer.getContext();
      if (gl.isContextLost()) { contextLost(); return; }
      renderer.compile(scene, camera);
      const programs = new Set(renderer.info.programs ?? []);
      const parallel = gl.getExtension('KHR_parallel_shader_compile');
      const check = () => {
        if (settled) return;
        try {
          if (gl.isContextLost()) { contextLost(); return; }
          for (const program of programs) {
            if (parallel && gl.getProgramParameter(program.program, parallel.COMPLETION_STATUS_KHR) !== true) continue;
            if (gl.isContextLost()) { contextLost(); return; }
            program.getUniforms();
            if (gl.isContextLost()) { contextLost(); return; }
            if (gl.getProgramParameter(program.program, gl.LINK_STATUS) !== true) throw new Error('Match shader program failed to link');
            programs.delete(program);
          }
          if (programs.size === 0) finish();
          else poll = setTimeout(check, 10);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      };
      check();
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
