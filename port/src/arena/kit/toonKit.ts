import * as THREE from 'three';

/**
 * Shared building blocks for the code-built toon scenery: seeded randomness,
 * canvas textures, toon materials with inverted-hull outlines, and the
 * procedural slab / rock / column shapes both arena themes use.
 *
 * Randomness here only decorates the render; it never touches the
 * simulation, so it uses its own seeded generator instead of MatchRng.
 */

export type Rand = () => number;

/** Mulberry32, seeded, so an arena looks the same on every load. */
export function seededRand(seed: number): Rand {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rangeOf = (rand: Rand) => (a: number, b: number): number => a + rand() * (b - a);

/** Position hash used to roughen shapes so shared vertices stay welded. */
export function hash3(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** White branching cracks on clear, for additive glowing fissures (tint via the material). */
export function crackTexture(rand: Rand, w: number, h: number, n: number): THREE.CanvasTexture {
  const range = rangeOf(rand);
  return canvasTexture(w, h, (x) => {
    x.strokeStyle = '#fff';
    x.lineCap = 'round';
    x.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      let px = range(0, w), py = range(0, h * 0.3);
      x.lineWidth = range(1.5, 3.5);
      x.beginPath();
      x.moveTo(px, py);
      for (let s = 0; s < 6; s++) { px += range(-24, 24); py += range(6, 18); x.lineTo(px, py); }
      x.stroke();
    }
  });
}

/** Radial white-to-clear blob, for glows, puffs and soft shadows. */
export function softTexture(inner: number, mid = 0.4, midStop = 0.45): THREE.CanvasTexture {
  return canvasTexture(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(255,255,255,${inner})`);
    g.addColorStop(midStop, `rgba(255,255,255,${mid})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

/** Toon material factory over a three-band gradient (dark, mid, lit). */
export function toonPalette(bands: [number, number, number], outlineColor: number) {
  const gradientMap = new THREE.DataTexture(
    new Uint8Array(bands.flatMap((v) => [v, v, v, 255])), 3, 1);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  const outline = new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide });

  const toon = (color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial =>
    new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

  /** Mesh plus a slightly larger back-face copy: the clean cartoon line. */
  const outlined = (geo: THREE.BufferGeometry, mat: THREE.Material, thickness = 0.35): THREE.Mesh => {
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    const mesh = new THREE.Mesh(geo, mat);
    const hull = new THREE.Mesh(geo, outline);
    hull.scale.set(
      1 + (2 * thickness) / Math.max(size.x, 0.01),
      1 + (2 * thickness) / Math.max(size.y, 0.01),
      1 + (2 * thickness) / Math.max(size.z, 0.01));
    mesh.add(hull);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };

  return { toon, outlined };
}

/** Rounded slab, top face at y = h/2, centred. */
export function slabGeo(w: number, d: number, h: number, r: number, bevel: number, smooth = 2): THREE.BufferGeometry {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, h - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: smooth, curveSegments: smooth * 3,
  });
  g.rotateX(-Math.PI / 2);
  g.center();
  return g;
}

/** Downward faceted rock: a cone with every vertex nudged by a position hash. */
export function rockGeo(radius: number, height: number, depthScale: number, salt: number, rough = 0.2): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, 11, 6);
  g.rotateX(Math.PI);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > height / 2 - 0.01) continue;
    const kx = Math.round(x * 100), ky = Math.round(y * 100), kz = Math.round(z * 100);
    const f = 1 + (hash3(kx + salt, ky, kz) - 0.5) * rough * 2;
    p.setXYZ(i, x * f, y + (hash3(kz, salt, kx) - 0.5) * height * 0.1, z * f);
  }
  g.scale(1, 1, depthScale);
  g.computeVertexNormals();
  return g;
}

/** Jagged frustum (spires, volcano cone). */
export function jaggedGeo(rTop: number, rBottom: number, height: number, salt: number, rough = 0.2, radial = 9): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 100), ky = Math.round(y * 100), kz = Math.round(z * 100);
    const f = 1 + (hash3(kx + salt, ky, kz) - 0.5) * rough * 2;
    p.setXYZ(i, x * f, y + (hash3(kz, salt, kx) - 0.5) * height * 0.05, z * f);
  }
  g.computeVertexNormals();
  return g;
}

/** Additive glow sprite. */
export function glowSprite(map: THREE.Texture, color: number, sx: number, sy = sx, fog = true): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog,
  }));
  s.scale.set(sx, sy, 1);
  return s;
}

/** A pool of additive points the caller animates through `pos`. */
export function pointCloud(count: number, size: number, color: number, map: THREE.Texture) {
  const pos = new Float32Array(count * 3).fill(-9999);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size, map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  // Positions are rewritten every frame; the initial bounds are meaningless.
  points.frustumCulled = false;
  return {
    points, pos, mat,
    vel: new Float32Array(count * 3),
    life: new Float32Array(count),
    commit: () => { (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; },
  };
}
export type PointCloud = ReturnType<typeof pointCloud>;

/**
 * The approved demos were tuned on three r149 with legacy lighting and no
 * colour management. The port keeps that look: raw colours (see
 * `createRenderer`) and light intensities scaled by π, which is what the
 * legacy "artist-friendly" units did internally.
 */
export const LEGACY_LIGHT = Math.PI;
