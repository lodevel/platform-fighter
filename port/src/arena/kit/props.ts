import * as THREE from 'three';
import { rockGeo, slabGeo, type Rand, type toonPalette } from './toonKit';

/** Reusable toon props shared by arenas: islands, trees, grass. */
export type Toon = ReturnType<typeof toonPalette>;

/** Instanced grass tufts along the front edge and sides of a slab. */
export function grassTufts(mat: THREE.Material, w: number, d: number, count: number, y: number, rand: Rand): THREE.InstancedMesh {
  const range = (a: number, b: number) => a + rand() * (b - a);
  const geo = new THREE.ConeGeometry(0.75, 1.9, 5);
  geo.rotateX(Math.PI);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const front = i < count * 0.75;
    p.set(front ? range(-w / 2, w / 2) : (rand() < 0.5 ? -1 : 1) * (w / 2 + 0.6), y, front ? d / 2 + 0.7 : range(-d / 2, d / 2));
    const k = range(0.6, 1.4);
    s.set(k, k * range(0.8, 1.5), k);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}

export interface IslandMaterials {
  readonly top: THREE.Material;
  readonly band: THREE.Material;
  readonly rock: THREE.Material;
  readonly tuft?: THREE.Material;
}

/**
 * Floating island: a capped slab whose band is `height` thick (the authored
 * collision thickness) over a hanging faceted rock. Top surface at y = 0.
 */
export function floatingIsland(t: Toon, mats: IslandMaterials, w: number, d: number, height: number, rockH: number, salt: number, rand: Rand) {
  const g = new THREE.Group();
  const cap = t.outlined(slabGeo(w + 1.6, d + 1.6, 1.4, 2.2, 0.35), mats.top);
  cap.position.y = -0.7;
  g.add(cap);
  const bandH = Math.max(1, height - 1.4);
  const band = t.outlined(new THREE.BoxGeometry(w, bandH, d), mats.band);
  band.position.y = -1.4 - bandH / 2;
  g.add(band);
  const rock = t.outlined(rockGeo(w * 0.5, rockH, (d / w) * 1.1, salt), mats.rock, 0.45);
  rock.position.y = -1.4 - bandH - rockH / 2 + 0.3;
  g.add(rock);
  if (mats.tuft) g.add(grassTufts(mats.tuft, w, d, Math.round(w * 0.6), -1.5, rand));
  return { group: g, rockTop: -1.4 - bandH };
}

/** Low-poly tree: trunk plus four leaf clumps. Base at y = 0. */
export function toonTree(t: Toon, trunk: THREE.Material, leaves: readonly THREE.Material[], scale: number, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const stem = t.outlined(new THREE.CylinderGeometry(0.6, 1.0, 7, 6), trunk, 0.25);
  stem.position.y = 3.5;
  g.add(stem);
  ([[0, 9, 4.2], [-2.4, 7.4, 3], [2.5, 7.8, 3.2], [0.6, 11.6, 2.8]] as const).forEach(([x, y, r], i) => {
    const leaf = t.outlined(new THREE.IcosahedronGeometry(r, 0), leaves[i % leaves.length]!, 0.3);
    leaf.position.set(x, y, (rand() - 0.5) * 1.6);
    leaf.rotation.set(rand() * 3, rand() * 3, 0);
    g.add(leaf);
  });
  g.scale.setScalar(scale);
  return g;
}

/** A horizontal-stripe canvas texture (strata, planks, friezes). */
export function stripeTexture(colours: readonly string[], rows: number, jitter: Rand): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  let y = 0;
  while (y < c.height) {
    const h = (c.height / rows) * (0.6 + jitter() * 0.8);
    x.fillStyle = colours[Math.floor(jitter() * colours.length)]!;
    x.fillRect(0, y, c.width, h + 1);
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Plank deck on two beams; top surface at y = 0, centred, `depth` deep. */
export function plankDeck(t: Toon, light: THREE.Material, dark: THREE.Material, width: number, thickness: number, depth: number, rand: Rand): THREE.Group {
  const g = new THREE.Group();
  const planks = Math.max(4, Math.round(width / 2.6));
  const w = width / planks;
  for (let i = 0; i < planks; i++) {
    const plank = t.outlined(new THREE.BoxGeometry(w * 0.92, thickness, depth), i % 3 ? light : dark, 0.18);
    plank.position.set(-width / 2 + w * (i + 0.5), -thickness / 2 + (rand() - 0.5) * 0.1, 0);
    g.add(plank);
  }
  [-1, 1].forEach((side) => {
    const beam = t.outlined(new THREE.BoxGeometry(width + 2, 0.9, 1.2), dark, 0.15);
    beam.position.set(0, -thickness - 0.45, side * depth * 0.33);
    g.add(beam);
  });
  return g;
}
