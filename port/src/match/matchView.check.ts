import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StagePresenter } from '../arena/presenter';
import { SpriteLayer } from '../engine/sprites/spriteLayer';
import type { TextureStore } from '../engine/sprites/textureStore';
import { MatchView } from './matchView';

vi.mock('./cameraRig', () => ({ CameraRig: class {} }));
afterEach(() => { vi.useRealTimers(); });

function fixture() {
  const state = { complete: false };
  const getUniforms = vi.fn(), compile = vi.fn();
  const sprites = new SpriteLayer({} as TextureStore), camera = new THREE.Camera();
  const renderer = { compile, domElement: new EventTarget(), info: { programs: [{ program: {}, getUniforms }] },
    getContext: () => ({ LINK_STATUS: 35714, isContextLost: () => false,
      getExtension: () => ({ COMPLETION_STATUS_KHR: 37297 }),
      getProgramParameter: (_program: unknown, parameter: number) => parameter === 35714 || state.complete }) };
  const presenter = { sprites, camera, renderer, runtime: { layout: {} } } as unknown as StagePresenter;
  const view = new MatchView(presenter);
  const meshes = () => {
    const result: Array<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>> = [];
    sprites.scene.traverse(object => { if (object instanceof THREE.Mesh) result.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>); });
    return result;
  };
  return { view, presenter, sprites, camera, compile, getUniforms, state, meshes };
}

describe('match shader preparation lifecycle', () => {
  it('waits for both hidden effect materials in the actual gameplay scene', async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = f.view.prepareShaders();
    expect(f.view.prepareShaders()).toBe(pending);
    const meshes = f.meshes();
    expect(meshes).toHaveLength(2);
    expect(meshes.every(mesh => !mesh.visible)).toBe(true);
    expect(meshes.map(mesh => mesh.material.blendDst).sort()).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor].sort());
    let ready = false;
    void pending.then(() => { ready = true; });
    expect(f.compile).toHaveBeenCalledTimes(1);
    expect(f.compile).toHaveBeenCalledWith(f.sprites.scene, f.camera);
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(f.getUniforms).not.toHaveBeenCalled();
    f.state.complete = true;
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(ready).toBe(true);
    expect(f.getUniforms).toHaveBeenCalledTimes(1);
    f.view.dispose();
    f.sprites.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels polling on leave before disposing prepared materials', async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = f.view.prepareShaders();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    const meshes = f.meshes();
    const materials = meshes.map(mesh => vi.spyOn(mesh.material, 'dispose'));
    const geometries = meshes.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    f.view.dispose();
    f.view.dispose();
    await rejected;
    expect(f.sprites.scene.children).toEqual([]);
    expect(materials.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(geometries.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.getUniforms).not.toHaveBeenCalled();
    f.sprites.dispose();
  });

  it('acquires replacement shader references before releasing the old view and preserves its callbacks', async () => {
    const f = fixture();
    f.state.complete = true;
    let references = 0;
    f.compile.mockImplementation((scene: THREE.Scene) => scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material;
      if (material.userData.compiled) return;
      material.userData.compiled = true;
      references++;
      material.addEventListener('dispose', () => { references--; });
    }));
    await f.view.prepareShaders();
    expect(references).toBe(2);
    const replacement = new MatchView(f.presenter);
    const prepared = replacement.prepareShaders();
    expect(references).toBe(4);
    const source = f.presenter.spriteSource, screenSource = f.presenter.screenSpriteSource;
    f.view.dispose();
    expect(references).toBe(2);
    expect(f.presenter.spriteSource).toBe(source);
    expect(f.presenter.screenSpriteSource).toBe(screenSource);
    await prepared;
    replacement.dispose();
    expect(references).toBe(0);
    expect(f.presenter.spriteSource).toBeNull();
    expect(f.presenter.screenSpriteSource).toBeNull();
    f.sprites.dispose();
  });

  it('cancels pending preparation on a host fault without disposing the visible scene', async () => {
    vi.useFakeTimers();
    const f = fixture(), pending = f.view.prepareShaders();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    const meshes = f.meshes();
    f.view.cancelShaderPreparation();
    await rejected;
    expect(f.meshes()).toEqual(meshes);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.getUniforms).not.toHaveBeenCalled();
    f.view.dispose();
    f.sprites.dispose();
  });
});
