import * as THREE from 'three';
import type { PlatformSpec, StageClock, StageTheme } from '../contract';
import { grassTufts, toonTree } from '../kit/props';
import { cloudField, gradientSky, moteField, toonLights, waterMaterial } from '../kit/skyKit';
import { canvasTexture, glowSprite, rangeOf, rockGeo, seededRand, slabGeo, softTexture, toonPalette } from '../kit/toonKit';

/**
 * Crumbling Temple: a mossy jungle temple at dusk. Floating slabs are cracked
 * stone with hanging vines. The game does not run crumbling yet (nothing
 * builds CrumblingPlatform entities), so the slabs stay whole like the sim's.
 */
export const crumblingTemple: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(27182);
  const range = rangeOf(rand);
  const t = toonPalette([85, 165, 255], 0x0f1c14);
  const { toon, outlined } = t;
  const glowTex = softTexture(1, 0.45, 0.35);
  const puffTex = softTexture(0.95, 0.75, 0.55);
  const centre = (groundLeft + groundRight) / 2;
  const STAGE_D = 30;

  const blockTex = (cracks: number) => canvasTexture(256, 128, (x, w, h) => {
    x.fillStyle = '#8f9a86';
    x.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) {
      for (let bx = -(r % 2) * 32; bx < w; bx += 64) {
        x.fillStyle = '#' + new THREE.Color(0xb7b59a).offsetHSL(range(-0.02, 0.02), range(-0.05, 0.05), range(-0.08, 0.04)).getHexString();
        x.fillRect(bx + 2, r * 32 + 2, 60, 28);
      }
    }
    x.strokeStyle = 'rgba(30,40,30,0.85)';
    x.lineWidth = 2;
    for (let i = 0; i < cracks; i++) {
      let px = range(0, w), py = range(0, h);
      x.beginPath(); x.moveTo(px, py);
      for (let s = 0; s < 5; s++) { px += range(-18, 18); py += range(-14, 14); x.lineTo(px, py); }
      x.stroke();
    }
  });
  const frieze = canvasTexture(512, 64, (x, w, h) => {
    x.fillStyle = '#6f7a63'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#c9c39c'; x.lineWidth = 4;
    for (let i = 0; i < w; i += 32) {
      x.beginPath(); x.moveTo(i + 4, h - 10); x.lineTo(i + 4, 10); x.lineTo(i + 26, 10); x.lineTo(i + 26, h - 26); x.lineTo(i + 12, h - 26); x.lineTo(i + 12, 20); x.stroke();
    }
  });
  const mats = {
    moss: toon(0x4f9a46), mossDark: toon(0x2f6b34), stone: toon(0xb7b59a), stoneDark: toon(0x7b8270),
    trunk: toon(0x5b3d28), leaves: [toon(0x2f7d3a), toon(0x3f9c49), toon(0x24653a)], vine: toon(0x3c8a3f), far: toon(0x41625a),
  };
  const blocks = (w: number, cracks = 0) => {
    const tex = blockTex(cracks);
    tex.repeat.set(Math.max(1, w / 16), 1);
    return toon(0xffffff, { map: tex });
  };

  // ---------- sky and light ----------
  scene.fog = new THREE.Fog(0x6f8f86, 200, 760);
  const sky = gradientSky(scene, { top: 0x1c3550, horizon: 0xf2b880, bottom: 0x8fb3a0, sun: 0xffd29a, sunDir: [-0.45, 0.06, -1], stars: 0.2 });
  toonLights(scene, new THREE.Vector3(centre, groundTop, 0), new THREE.Vector3(-60, 110, 80), 0xcfe8d6, 0x2a3b2a).key.color.setHex(0xffd7a8);
  const clouds = cloudField(scene, rand, puffTex, centre, groundTop, { sea: 120, clusters: 8, seaY: [-90, -60], colour: 0xc9e0d4 });

  // ---------- ziggurat, canopy, waterfall, god rays ----------
  const zig = new THREE.Group();
  zig.position.set(centre - 10, groundTop - 70, -330);
  for (let i = 0; i < 6; i++) {
    const w = 220 - i * 32;
    const step = outlined(new THREE.BoxGeometry(w, 22, w * 0.7), i % 2 ? mats.stone : mats.stoneDark, 0.8);
    step.position.y = 11 + i * 22;
    zig.add(step);
  }
  const shrine = outlined(new THREE.BoxGeometry(46, 34, 40), mats.stoneDark, 0.6);
  shrine.position.y = 6 * 22 + 17;
  zig.add(shrine);
  const door = glowSprite(glowTex, 0x7ff0c0, 40, 46);
  door.position.set(0, 6 * 22 + 14, 21);
  zig.add(door);
  scene.add(zig);
  for (let i = 0; i < 26; i++) {
    const tree = toonTree(t, mats.trunk, mats.leaves, range(3, 6), rand);
    const side = i % 2 ? 1 : -1;
    tree.position.set(centre + side * range(140, 520), groundTop - 80 + range(-10, 20), range(-480, -200));
    scene.add(tree);
  }
  const fallMat = waterMaterial(0xbfe9e0);
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(16, 170), fallMat);
  fall.position.set(centre + 190, groundTop + 10, -260);
  scene.add(fall);
  const cliff = outlined(rockGeo(60, 120, 0.8, 91, 0.2), mats.far, 0.6);
  cliff.rotation.x = Math.PI;
  cliff.position.set(centre + 215, groundTop + 30, -275);
  scene.add(cliff);
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rays = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(range(10, 18), 260), rayMat);
    ray.position.set(centre - 160 + i * 70, groundTop + 60, -220 - i * 10);
    ray.rotation.z = -0.35;
    rays.add(ray);
  }
  scene.add(rays);
  const fireflies = moteField(scene, rand, glowTex, centre, groundTop, 140, 1.1);
  fireflies.mat.color.setHex(0xd8ff7a);

  // ---------- gameplay surfaces ----------
  const vines = (w: number, y: number, z: number, count: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const len = range(2, 7);
      const v = outlined(new THREE.CylinderGeometry(0.18, 0.12, len, 4), mats.vine, 0.08);
      v.position.set(range(-w / 2, w / 2), y - len / 2, z + range(-0.5, 0.5));
      g.add(v);
      const leaf = outlined(new THREE.OctahedronGeometry(0.6, 0), mats.mossDark, 0.08);
      leaf.position.set(v.position.x, y - len, v.position.z);
      g.add(leaf);
    }
    return g;
  };

  const platform = (spec: PlatformSpec): THREE.Object3D => {
    const g = new THREE.Group();
    if (spec.kind === 'ground') {
      const cap = outlined(slabGeo(spec.width + 1.6, STAGE_D + 1.6, 1.4, 1.2, 0.3), mats.moss);
      cap.position.y = -0.7;
      g.add(cap);
      const bandH = Math.max(1, spec.height - 1.4);
      const band = outlined(new THREE.BoxGeometry(spec.width, bandH, STAGE_D), blocks(spec.width, 2));
      band.position.y = -1.4 - bandH / 2;
      g.add(band);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 4, Math.min(2.2, bandH * 0.5)), toon(0xffffff, { map: frieze }));
      (strip.material as THREE.MeshToonMaterial).map!.repeat.set(spec.width / 16, 1);
      strip.position.set(0, -1.4 - bandH / 2, STAGE_D / 2 + 0.05);
      g.add(strip);
      // Stepped temple body widening downward, sinking into the mist.
      for (let i = 0; i < 4; i++) {
        const w = spec.width * (0.96 - i * 0.12), h = 8;
        const step = outlined(new THREE.BoxGeometry(w, h, STAGE_D * (1 - i * 0.08)), blocks(w, 4), 0.4);
        step.position.y = -1.4 - bandH - h / 2 - i * h;
        g.add(step);
      }
      g.add(grassTufts(mats.mossDark, spec.width, STAGE_D, Math.round(spec.width * 0.5), -1.4, rand));
      g.add(vines(spec.width, -1.4, STAGE_D / 2 + 0.4, Math.round(spec.width / 4)));
      g.position.z = -(STAGE_D + 1.6) / 2;
      return g;
    }
    const slabH = Math.min(1.6, spec.height);
    const slab = outlined(slabGeo(spec.width, 9, slabH, 0.6, 0.25, 1), blocks(spec.width, 6), 0.3);
    slab.position.y = -slabH / 2;
    g.add(slab);
    const moss = outlined(slabGeo(spec.width * 0.7, 8, 0.4, 0.4, 0.1, 1), mats.moss, 0.12);
    moss.position.set(range(-2, 2), 0.05, -0.4);
    g.add(moss);
    const under = outlined(rockGeo(Math.min(5, spec.width * 0.3), 6, 1.2, 80 + spec.index, 0.25), mats.stoneDark, 0.3);
    under.position.y = -slabH - 3;
    g.add(under);
    g.add(vines(spec.width, -slabH, 4.6, Math.round(spec.width / 3)));
    g.position.z = -4.5;
    return g;
  };

  const update = ({ elapsed, dt }: StageClock) => {
    sky.time.value = elapsed;
    fallMat.uniforms.time!.value = elapsed;
    rayMat.opacity = 0.035 + 0.015 * Math.sin(elapsed * 0.6);
    door.material.opacity = 0.6 + 0.3 * Math.sin(elapsed * 1.4);
    clouds.update(dt, 0.4);
    fireflies.update(dt, elapsed);
  };

  return { platform, update, spriteTint: new THREE.Color(0xf2ead8), moods: ['dusk'], setMood: () => {} };
};
