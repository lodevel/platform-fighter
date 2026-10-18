import type * as THREE from 'three';

/**
 * Resolves once the GPU has executed every command issued so far (texture uploads included),
 * polling a WebGL2 fence without blocking. A loading screen awaits it so the first frame of
 * play does not wait for the uploads instead. Resolves at once without WebGL2 fences.
 */
export async function gpuFinished(renderer: Pick<THREE.WebGLRenderer, 'getContext'>, signal?: AbortSignal): Promise<void> {
  const gl = renderer.getContext() as Partial<WebGL2RenderingContext>;
  if (!gl.fenceSync || !gl.clientWaitSync || !gl.deleteSync) return;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE!, 0);
  if (!sync) return;
  gl.flush?.();
  try {
    while (!signal?.aborted && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise(resolve => setTimeout(resolve, 4));
  } finally { gl.deleteSync(sync); }
}
