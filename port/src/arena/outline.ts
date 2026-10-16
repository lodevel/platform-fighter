import * as THREE from 'three';

/**
 * Collision-overlay rectangle (debug / acceptance). Its origin is the top
 * centre of the rectangle, on the gameplay plane, drawn over everything.
 */
export function outlineRect(width: number, height: number, colour: number): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geo = new THREE.BufferGeometry().setFromPoints(
    [[0, 0], [width, 0], [width, -height], [0, -height], [0, 0]].map(([x, y]) => new THREE.Vector3(x! - width / 2, y!, 0)));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }));
  line.renderOrder = 10;
  return line;
}
