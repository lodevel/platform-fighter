import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSceneShaders } from './prepareShaders';

afterEach(() => { vi.useRealTimers(); });

function fixture(parallel = true) {
  const state = { complete: false, lost: false, linked: true };
  const canvas = new EventTarget(), abort = new AbortController();
  const getUniforms = vi.fn(), compile = vi.fn();
  const nativeProgram = {};
  const gl = { LINK_STATUS: 35714, isContextLost: () => state.lost,
    getExtension: vi.fn(() => parallel ? { COMPLETION_STATUS_KHR: 37297 } : null),
    getProgramParameter: vi.fn((_program: unknown, parameter: number) => parameter === 35714 ? state.linked : state.complete) };
  const renderer = { compile, domElement: canvas, getContext: () => gl,
    info: { programs: [{ program: nativeProgram, getUniforms }] } } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const start = () => prepareSceneShaders(renderer, scene, camera, abort.signal);
  return { start, abort, canvas, state, gl, compile, getUniforms, nativeProgram, scene, camera };
}

describe('bounded public shader preparation', () => {
  it('waits for KHR completion before running first-use diagnostics and clears polling', async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = f.start();
    expect(f.compile).toHaveBeenCalledWith(f.scene, f.camera);
    expect(f.gl.getProgramParameter).toHaveBeenCalledWith(f.nativeProgram, 37297);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.getUniforms).not.toHaveBeenCalled();
    f.state.complete = true;
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(f.getUniforms).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('performs first-use validation during loading when KHR is unavailable', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    await f.start();
    expect(f.getUniforms).toHaveBeenCalledTimes(1);
    expect(f.gl.getProgramParameter).toHaveBeenCalledTimes(1);
    expect(f.gl.getProgramParameter).toHaveBeenCalledWith(f.nativeProgram, 35714);
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const reason of ['context-loss', 'abort', 'timeout'] as const) it(`rejects and cancels all polling after ${reason}`, async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = f.start();
    const rejected = expect(pending).rejects.toThrow(reason === 'context-loss' ? 'context lost' : reason === 'abort' ? 'cancelled' : 'timed out');
    if (reason === 'context-loss') {
      f.state.lost = true;
      f.canvas.dispatchEvent(new Event('webglcontextlost'));
    } else if (reason === 'abort') f.abort.abort();
    else await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    const queries = f.gl.getProgramParameter.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.gl.getProgramParameter).toHaveBeenCalledTimes(queries);
    expect(f.getUniforms).not.toHaveBeenCalled();
  });

  it('rejects thrown compile errors through the same preparation promise', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.compile.mockImplementation(() => { throw new Error('compile failed'); });
    await expect(f.start()).rejects.toThrow('compile failed');
    expect(f.getUniforms).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a failed link even when Three diagnostics return without throwing', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.state.complete = true;
    f.state.linked = false;
    await expect(f.start()).rejects.toThrow('failed to link');
    expect(f.getUniforms).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
