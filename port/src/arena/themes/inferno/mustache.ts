import * as THREE from 'three';
import type { PlatformSpec } from '../../contract';
import type { Toon } from '../../kit/props';
import { canvasTexture, type Rand } from '../../kit/toonKit';
import { PHILTRUM } from './head';

/**
 * The Inferno's centre platform drawn as a toothbrush mustache. Collision is
 * unchanged: the top edge is the platform top. Its height follows the
 * nose-to-lip strip of the head picture, so behind it, seen from the player's
 * view, it covers exactly that strip (see GiantHead.alignPhiltrum).
 */
const DEPTH = 6;

export function mustachePlatform(t: Toon, spec: PlatformSpec, rand: Rand): THREE.Object3D {
  const w = spec.width;
  const h = (w * (PHILTRUM.vTop - PHILTRUM.vBottom)) / PHILTRUM.width;
  const hairTex = canvasTexture(256, 64, (x, cw, ch) => {
    x.fillStyle = '#1a110d';
    x.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 900; i++) {
      const px = rand() * cw, len = 6 + rand() * 18;
      x.strokeStyle = rand() < 0.5 ? '#2b1c15' : '#0c0806';
      x.lineWidth = 1 + rand() * 1.5;
      x.beginPath();
      x.moveTo(px, rand() * ch * 0.3);
      x.lineTo(px + (rand() - 0.5) * 4, Math.min(ch, rand() * ch * 0.3 + len * 2));
      x.stroke();
    }
  });
  hairTex.repeat.set(w / 6, 1);
  const hair = t.toon(0xffffff, { map: hairTex });

  // A block slightly narrower at the top, softly rounded, like a trimmed mustache.
  const shape = new THREE.Shape();
  const r = Math.min(0.8, h * 0.25), topInset = w * 0.04;
  shape.moveTo(-w / 2 + topInset + r, 0);
  shape.lineTo(w / 2 - topInset - r, 0);
  shape.quadraticCurveTo(w / 2 - topInset, 0, w / 2 - topInset + 0.1, -r);
  shape.lineTo(w / 2, -h + r);
  shape.quadraticCurveTo(w / 2, -h, w / 2 - r, -h);
  shape.lineTo(-w / 2 + r, -h);
  shape.quadraticCurveTo(-w / 2, -h, -w / 2, -h + r);
  shape.lineTo(-w / 2 + topInset - 0.1, -r);
  shape.quadraticCurveTo(-w / 2 + topInset, 0, -w / 2 + topInset + r, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -DEPTH - 0.3);
  const g = new THREE.Group();
  g.add(t.outlined(geo, hair, 0.25));

  // Bristles along the bottom edge.
  const bristleGeo = new THREE.ConeGeometry(0.16, 1.2, 4);
  bristleGeo.rotateX(Math.PI);
  const count = Math.round(w * 4);
  const bristles = new THREE.InstancedMesh(bristleGeo, t.toon(0x0f0a08), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.set(-w / 2 + 0.4 + rand() * (w - 0.8), -h - 0.3, -rand() * DEPTH);
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.6));
    const k = 0.6 + rand() * 0.8;
    sc.set(k, k, k);
    m.compose(p, q, sc);
    bristles.setMatrixAt(i, m);
  }
  g.add(bristles);
  return g;
}
