import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ShapeLayer } from './shapeLayer';

type ShapeMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

describe('loading-time shape shader reservation', () => {
  for (const additive of [false, true]) it(`reuses its hidden ${additive ? 'additive' : 'normal'} slot for every first effect`, () => {
    const layer = new ShapeLayer(2000, additive);
    layer.prepare();
    layer.prepare();
    expect(layer.group.children).toHaveLength(1);
    const mesh = layer.group.children[0] as ShapeMesh;
    const material = mesh.material;
    expect(mesh.visible).toBe(false);
    expect(material.blendDst).toBe(additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor);
    const scene = new THREE.Scene();
    scene.add(layer.group);
    const compiled: THREE.Object3D[] = [], rendered: THREE.Object3D[] = [];
    scene.traverse(object => { if (object instanceof THREE.Mesh) compiled.push(object); });
    scene.traverseVisible(object => { if (object instanceof THREE.Mesh) rendered.push(object); });
    expect(compiled).toEqual([mesh]);
    expect(rendered).toEqual([]);
    layer.flush();

    const draws = [
      () => layer.circle({ x: 100, y: 200, radius: 12, fill: 0xff0000 }),
      () => layer.star({ x: 100, y: 200, width: 24, height: 18, phase: .5 }),
      () => layer.flame({ x: 100, y: 200, width: 24, height: 18, phase: .5, facing: -1 }),
    ];
    for (const [index, draw] of draws.entries()) {
      draw();
      expect(layer.group.children).toEqual([mesh]);
      expect(mesh.material).toBe(material);
      expect(mesh.visible).toBe(true);
      expect(mesh.renderOrder).toBe(2000);
      expect(material.uniforms.shape!.value).toBe([0, 2, 3][index]);
      layer.flush();
      expect(mesh.visible).toBe(true);
      layer.flush();
      expect(mesh.visible).toBe(false);
    }
    const materialDisposed = vi.spyOn(material, 'dispose'), geometryDisposed = vi.spyOn(mesh.geometry, 'dispose');
    layer.dispose();
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(layer.group.parent).toBeNull();
    expect(layer.group.children).toEqual([]);
  });
});
