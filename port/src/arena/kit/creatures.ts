import * as THREE from 'three';
import type { Toon } from './props';

/** Creature parts shared by arenas: bones, bat wings, tapered horns and tails. */
const UP = new THREE.Vector3(0, 1, 0);

/** A tapered cylinder from `a` to `b` (wing fingers, spines). */
export function boneBetween(t: Toon, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, segments = 6): THREE.Mesh {
  const m = t.outlined(new THREE.CylinderGeometry(r * 0.7, r, a.distanceTo(b), segments), mat, 0.12);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return m;
}

/**
 * A bat wing on a pivot at its shoulder: arm bone, finger bones and a
 * membrane fanned between them. Spans about 16 units before `scale`.
 */
export function batWing(t: Toon, membrane: THREE.Material, bone: THREE.Material, side: 1 | -1, scale = 1): THREE.Group {
  const pivot = new THREE.Group();
  const P = (x: number, y: number, z: number) => new THREE.Vector3(side * x * scale, y * scale, z * scale);
  const shoulder = P(0, 0, 0), elbow = P(6.5, 0.8, 1.2), tip = P(16, 1.2, -0.5);
  const edge = [tip, P(13, 0, -5), P(8.5, 0, -7), P(3.5, 0, -6.5), P(0, 0, -4)];
  const pts = [elbow, ...edge];
  const verts: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) verts.push(...shoulder.toArray(), ...pts[i]!.toArray(), ...pts[i + 1]!.toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  const skin = new THREE.Mesh(g, membrane);
  skin.castShadow = true;
  pivot.add(skin, boneBetween(t, shoulder, elbow, 0.45 * scale, bone), boneBetween(t, elbow, tip, 0.35 * scale, bone));
  edge.slice(1, 4).forEach((p) => pivot.add(boneBetween(t, elbow, p, 0.2 * scale, bone)));
  return pivot;
}

/**
 * A horn or tail: tapered segments along a curve from `start` (radius r0)
 * to the end (radius r1). Returns the group and its end point.
 */
export function taperedCurve(t: Toon, mat: THREE.Material, points: readonly THREE.Vector3[], r0: number, r1: number, segments = 8) {
  const curve = new THREE.CatmullRomCurve3([...points]);
  const g = new THREE.Group();
  for (let i = 0; i < segments; i++) {
    const a = curve.getPoint(i / segments), b = curve.getPoint((i + 1) / segments);
    const r = r0 + (r1 - r0) * ((i + 0.5) / segments);
    g.add(boneBetween(t, a, b, Math.max(0.02, r), mat, 10));
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.02, r * 0.85), 10, 8), mat);
    knuckle.position.copy(b);
    g.add(knuckle);
  }
  return { group: g, end: curve.getPoint(1) };
}
