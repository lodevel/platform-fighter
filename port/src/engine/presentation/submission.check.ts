import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { geometryPreparationHost, ManagedGeometry, presentationTarget } from './submission';
import { SpriteLayer } from '../sprites/spriteLayer';
import type { SheetTexture, TextureStore } from '../sprites/textureStore';

const sheet: SheetTexture = { texture: new THREE.Texture(), width: 8, height: 8, frameWidth: 8, frameHeight: 8, margin: 0, spacing: 0, columns: 1, frameCount: 1 };
function fixture() {
  const layer = new SpriteLayer({ get: () => sheet } as unknown as TextureStore);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  return { layer, mesh, target: presentationTarget(layer), geometry: new ManagedGeometry(mesh) };
}

describe('mixed ordered Three presentation host', () => {
  it('interleaves real transparent mesh geometry between sprites by stable depth and submission order', () => {
    const { layer, mesh, target, geometry } = fixture();
    target.sprite({ key: 'front', x: 0, y: 0, depth: 2 });
    target.sprite({ key: 'back', x: 0, y: 0, depth: 0 });
    target.geometry(geometry, 1);
    target.sprite({ key: 'same-depth-after', x: 0, y: 0, depth: 1 });
    layer.flush();
    const quads = layer.scene.children.filter(child => child !== mesh) as THREE.Mesh[];
    expect(mesh.parent).toBe(layer.scene);
    expect(mesh.renderOrder).toBe(2);
    expect(quads.map(quad => quad.renderOrder)).toEqual([1, 3, 4]);
    expect(layer.submittedDraws().map(draw => draw.key)).toEqual(['back', 'same-depth-after', 'front']);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthTest).toBe(false);
    expect(mesh.material.depthWrite).toBe(false);
    geometry.dispose(); layer.dispose();
  });
  it('detaches absent geometry between frames and never destroys borrowed instance or shared texture resources', () => {
    const { layer, mesh, target, geometry } = fixture();
    const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose'), disposeMaterial = vi.spyOn(mesh.material, 'dispose');
    const disposeTexture = vi.spyOn(sheet.texture, 'dispose');
    target.geometry(geometry, 0); layer.flush();
    layer.flush();
    expect(mesh.parent).toBeNull();
    expect(disposeGeometry).not.toHaveBeenCalled();
    target.geometry(geometry, 0); layer.flush();
    layer.dispose();
    expect(mesh.parent).toBeNull();
    expect(disposeMaterial).not.toHaveBeenCalled();
    geometry.dispose(); geometry.dispose();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeTexture).not.toHaveBeenCalled();
  });
  it('moves a managed node between world and screen passes without the old pass detaching its new owner', () => {
    const { layer: world, mesh, geometry } = fixture();
    const screen = new SpriteLayer(world.textures);
    screen.drawGeometry(geometry); screen.flush();
    expect(mesh.parent).toBe(screen.scene);
    world.drawGeometry(geometry); world.flush();
    screen.flush();
    expect(mesh.parent).toBe(world.scene);
    screen.drawGeometry(geometry); screen.flush();
    world.dispose();
    expect(mesh.parent).toBe(screen.scene);
    geometry.dispose(); screen.dispose();
  });

  it('does not attach a disposed pending submission', () => {
    const { layer, mesh, target, geometry } = fixture();
    target.geometry(geometry, 0);
    geometry.dispose(); layer.flush();
    expect(mesh.parent).toBeNull();
    layer.dispose();
  });
  it('keeps a newer hidden preparation attached when an earlier preparation is cancelled', async () => {
    vi.useFakeTimers();
    const { layer, mesh, geometry } = fixture();
    layer.scene.add(mesh);
    let complete = false;
    const renderer = { compile: vi.fn(), domElement: new EventTarget(), info: { programs: [{ program: {}, getUniforms: vi.fn() }] },
      getContext: () => ({ LINK_STATUS: 1, isContextLost: () => false, getExtension: () => ({ COMPLETION_STATUS_KHR: 2 }),
        getProgramParameter: (_program: unknown, parameter: number) => parameter === 1 || complete }) } as unknown as THREE.WebGLRenderer;
    const host = geometryPreparationHost(renderer, layer.scene, new THREE.Camera());
    const abort = new AbortController(), first = host.prepareGeometry(geometry, abort.signal);
    const rejected = expect(first).rejects.toThrow('cancelled');
    abort.abort();
    const second = host.prepareGeometry(geometry, new AbortController().signal);
    await rejected;
    expect(mesh.parent).toBe(layer.scene);
    expect(mesh.visible).toBe(false);
    complete = true;
    await vi.advanceTimersByTimeAsync(10);
    await second;
    expect(mesh.parent).toBe(layer.scene);
    expect(mesh.visible).toBe(true);
    geometry.dispose(); layer.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

});
