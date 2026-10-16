import * as THREE from 'three';
import {
  LEGACY_LIGHT, canvasTexture, glowSprite, rangeOf, rockGeo, seededRand, slabGeo, softTexture, toonPalette,
} from '../kit/toonKit';
import { floatingIsland, toonTree } from '../kit/props';
import { cloudField, gradientSky, moteField, toonLights, waterMaterial } from '../kit/skyKit';
import type { PlatformSpec, StageClock, StageTheme } from '../contract';

/**
 * Sky Ruins: floating grass islands, ruined pillars, a rune ring and a
 * cloud sea, with day / sunset / night lighting. Ported from the approved
 * demo (docs/review/2026-10-13/threejs-port/demos/sky-ruins.src.html), with
 * every gameplay surface taken from the stage layout instead of constants.
 */
export const skyRuins: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(20261012);
  const range = rangeOf(rand);
  const palette = toonPalette([95, 175, 255], 0x1d1333);
  const { toon, outlined } = palette;
  const glowTex = softTexture(1, 0.45, 0.35);
  const puffTex = softTexture(0.95, 0.75, 0.55);
  const groundCentre = (groundLeft + groundRight) / 2;
  const groundWidth = groundRight - groundLeft;
  const STAGE_D = 30;

  const mats = {
    grass: toon(0x63c24c),
    grassDark: toon(0x3f9a3d),
    rock: toon(0x8b6f8f),
    stone: toon(0xe6d8bd),
    trunk: toon(0x7a4f35),
    leaf: [toon(0x4fae4a), toon(0x6cc957), toon(0x3d9446)],
    far: toon(0x7d6a9a),
  };

  const brickMaterial = (width: number) => {
    const tex = canvasTexture(256, 64, (x, w, h) => {
      x.fillStyle = '#9d8a7a';
      x.fillRect(0, 0, w, h);
      const rows = 3, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let bx = -(r % 2) * 32; bx < w; bx += 64) {
          x.fillStyle = '#' + new THREE.Color(0xd9c7a8).offsetHSL(range(-0.01, 0.01), 0, range(-0.06, 0.05)).getHexString();
          x.fillRect(bx + 3, r * rh + 3, 58, rh - 6);
        }
      }
    });
    tex.repeat.set(width / 9, 1);
    return toon(0xffffff, { map: tex });
  };

  const glowSprites: THREE.Sprite[] = [];
  const glow = (color: number, size: number) => {
    const s = glowSprite(glowTex, color, size);
    glowSprites.push(s);
    return s;
  };

  const crystalMats: THREE.MeshToonMaterial[] = [];
  const CRYSTAL = 0x5ff0ff;
  const crystal = (size: number, color: number, dir: THREE.Vector3) => {
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.45 * size, 1.5 * size, 0.45 * size);
    const mat = toon(color, { emissive: color, emissiveIntensity: 0.6 });
    crystalMats.push(mat);
    const m = outlined(geo, mat, 0.18);
    m.add(glow(color, size * 5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };

  // Rune band texture shared by the ground face and the platform strips.
  const runeTex = canvasTexture(1024, 32, (x) => {
    x.strokeStyle = '#fff';
    x.lineWidth = 2.6;
    x.lineCap = 'round';
    for (let i = 0; i < 38; i++) {
      const ox = 10 + i * 26.5, oy = 6;
      x.beginPath();
      for (let s = 0; s < 3; s++) {
        x.moveTo(ox + Math.round(rand() * 2) * 7, oy + Math.round(rand() * 2) * 10);
        x.lineTo(ox + Math.round(rand() * 2) * 7, oy + Math.round(rand() * 2) * 10);
      }
      x.stroke();
    }
  });
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTex, color: 0x7ff3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

  /** Grass-capped island; `height` is the authored collision thickness. */
  const island = (w: number, d: number, height: number, rockH: number, salt: number, bricks: boolean) => {
    const { group, rockTop } = floatingIsland(palette, {
      top: mats.grass, band: bricks ? brickMaterial(w) : mats.rock, rock: mats.rock, tuft: mats.grassDark,
    }, w, d, height, rockH, salt, rand);
    return { g: group, rockTop };
  };

  const tree = (scale: number) => toonTree(palette, mats.trunk, mats.leaf, scale, rand);

  const pillar = (height: number, broken: boolean) => {
    const g = new THREE.Group();
    const base = outlined(new THREE.BoxGeometry(5.6, 1, 5.6), mats.stone, 0.25);
    base.position.y = 0.5;
    g.add(base);
    const shaft = outlined(new THREE.CylinderGeometry(2, 2.3, height, 10), mats.stone, 0.25);
    shaft.position.y = 1 + height / 2;
    g.add(shaft);
    const top = broken
      ? outlined(new THREE.CylinderGeometry(1.4, 2, 2.4, 7), mats.stone, 0.25)
      : outlined(new THREE.BoxGeometry(6, 1.3, 6), mats.stone, 0.25);
    top.position.set(broken ? 0.5 : 0, 1 + height + (broken ? 0.9 : 0.65), 0);
    if (broken) top.rotation.z = -0.35;
    g.add(top);
    return g;
  };

  // ---------- sky and light ----------
  scene.fog = new THREE.Fog(0xe8987a, 230, 720);
  const skyUniforms = gradientSky(scene, { top: 0, horizon: 0, bottom: 0, sun: 0, sunDir: [0, 0.1, -1] });

  const { hemi, key } = toonLights(scene, new THREE.Vector3(groundCentre, groundTop, 0), new THREE.Vector3(55, 120, 85));

  // ---------- landmarks behind the fighting plane ----------
  const backdrop = new THREE.Group();
  backdrop.position.set(groundCentre, groundTop, 0);
  scene.add(backdrop);
  const span = groundWidth / 2;
  const decor: Array<[THREE.Object3D, number, number]> = [
    [tree(1.15), -0.85, -24], [tree(0.85), 0.8, -25], [tree(0.7), 0.56, -26],
    [pillar(17, false), -0.64, -24], [pillar(8, true), 0.37, -23], [pillar(13, true), 0.93, -20],
  ];
  decor.forEach(([obj, fx, z]) => { obj.position.set(fx * span, 0, z); backdrop.add(obj); });
  const fallen = outlined(new THREE.CylinderGeometry(2, 2, 9, 10), mats.stone, 0.25);
  fallen.rotation.set(0, 0.5, Math.PI / 2);
  fallen.position.set(-0.25 * span, 2, -24);
  backdrop.add(fallen);

  const ring = new THREE.Group();
  ring.position.set(groundCentre, groundTop + 34, -95);
  scene.add(ring);
  ring.add(outlined(new THREE.TorusGeometry(36, 2.6, 8, 40), mats.stone, 0.4));
  const ringGlowMat = new THREE.MeshBasicMaterial({ color: CRYSTAL, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(32.6, 0.45, 6, 80), ringGlowMat));
  const ringCore = glow(0x9ff7ff, 70);
  ring.add(ringCore);
  const orbiters = new THREE.Group();
  ring.add(orbiters);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = outlined(new THREE.IcosahedronGeometry(range(1.4, 2.6), 0), mats.rock, 0.25);
    s.position.set(Math.cos(a) * 44, Math.sin(a) * 44, range(-3, 3));
    s.rotation.set(rand() * 3, rand() * 3, 0);
    orbiters.add(s);
  }

  const farIslands = [
    { w: 42, d: 20, rockH: 32, x: -175, y: 32, z: -270, tree: true },
    { w: 28, d: 14, rockH: 22, x: 195, y: 6, z: -300, tree: false },
    { w: 64, d: 26, rockH: 40, x: 70, y: 86, z: -500, tree: true },
    { w: 22, d: 12, rockH: 18, x: -300, y: 92, z: -430, tree: false },
  ];
  farIslands.forEach((f, i) => {
    const { g } = island(f.w, f.d, 3.6, f.rockH, 50 + i, false);
    g.position.set(groundCentre + f.x, groundTop + f.y, f.z);
    if (f.tree) {
      const t = tree(f.w / 40);
      t.position.set(-f.w * 0.2, 0, -2);
      g.add(t);
    }
    scene.add(g);
  });
  const waterMat = waterMaterial(0xa8e0ff);
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(7, 90), waterMat);
  fall.position.set(groundCentre - 175 + 13, groundTop + 32 - 3.2 - 45, -270 + 10.6);
  scene.add(fall);

  for (let i = 0; i < 14; i++) {
    const h = range(70, 140);
    const m = new THREE.Mesh(rockGeo(range(80, 130), h, 0.6, 90 + i, 0.15), mats.far);
    m.rotation.x = Math.PI;
    m.position.set(groundCentre - 700 + i * 105 + range(-30, 30), groundTop - 95 + h / 2, -680 + range(-40, 40));
    scene.add(m);
  }

  // ---------- clouds and motes ----------
  const clouds = cloudField(scene, rand, puffTex, groundCentre, groundTop);
  const motes = moteField(scene, rand, glowTex, groundCentre, groundTop);

  // ---------- time of day ----------
  const PRESETS = {
    sunset: { top: 0x29296b, horizon: 0xff8f5a, bottom: 0xffc79a, sun: 0xffd28a, sunDir: [-0.42, 0.07, -1], fog: 0xe8987a,
      hemiSky: 0xffc8a8, hemiGround: 0x5a3d5a, hemiI: 0.78, key: 0xffb784, keyI: 1.0, cloud: 0xffc4a8, tint: 0xffe6d4,
      glow: 1.0, stars: 0.15, mote: 0xffc66e, water: 0xffcdb5, rune: 0.85 },
    day: { top: 0x2f7fe0, horizon: 0xbfe5ff, bottom: 0xdff3ff, sun: 0xfff4d0, sunDir: [0.32, 0.13, -1], fog: 0xc9e4f6,
      hemiSky: 0xdcefff, hemiGround: 0x7a6a58, hemiI: 0.9, key: 0xfff1d9, keyI: 1.05, cloud: 0xffffff, tint: 0xffffff,
      glow: 0.45, stars: 0, mote: 0xfff3b0, water: 0xa8e0ff, rune: 0.55 },
    night: { top: 0x04061a, horizon: 0x1d2c5e, bottom: 0x24356b, sun: 0xdfe9ff, sunDir: [0.42, 0.16, -1], fog: 0x1b2650,
      hemiSky: 0x7a90d4, hemiGround: 0x1a1630, hemiI: 0.6, key: 0xa6b8ff, keyI: 0.6, cloud: 0x52628f, tint: 0xa4b4e0,
      glow: 1.8, stars: 1, mote: 0x9ff7ff, water: 0x6d8fd6, rune: 1 },
  } as const;
  type Preset = (typeof PRESETS)[keyof typeof PRESETS];
  const COLOR_KEYS = ['top', 'horizon', 'bottom', 'sun', 'fog', 'hemiSky', 'hemiGround', 'key', 'cloud', 'tint', 'mote', 'water'] as const;
  const NUM_KEYS = ['hemiI', 'keyI', 'glow', 'stars', 'rune'] as const;
  type Mood = Record<(typeof COLOR_KEYS)[number], THREE.Color> & Record<(typeof NUM_KEYS)[number], number> & { sunDir: THREE.Vector3 };
  const toMood = (p: Preset): Mood => {
    const m = { sunDir: new THREE.Vector3(...p.sunDir).normalize() } as Mood;
    COLOR_KEYS.forEach((k) => { m[k] = new THREE.Color(p[k]); });
    NUM_KEYS.forEach((k) => { m[k] = p[k]; });
    return m;
  };
  const current = toMood(PRESETS.sunset);
  let target = toMood(PRESETS.sunset);
  const spriteTint = new THREE.Color();
  const fog = scene.fog;

  const applyMood = (s: Mood) => {
    skyUniforms.top.value.copy(s.top);
    skyUniforms.horizon.value.copy(s.horizon);
    skyUniforms.bottom.value.copy(s.bottom);
    skyUniforms.sunCol.value.copy(s.sun);
    skyUniforms.sunDir.value.copy(s.sunDir);
    skyUniforms.stars.value = s.stars;
    fog.color.copy(s.fog);
    hemi.color.copy(s.hemiSky);
    hemi.groundColor.copy(s.hemiGround);
    hemi.intensity = s.hemiI * LEGACY_LIGHT;
    key.color.copy(s.key);
    key.intensity = s.keyI * LEGACY_LIGHT;
    clouds.materials.forEach((m) => m.color.copy(s.cloud));
    spriteTint.copy(s.tint);
    crystalMats.forEach((m) => { m.emissiveIntensity = s.glow * 0.7; });
    glowSprites.forEach((g) => { g.material.opacity = Math.min(1, 0.25 + s.glow * 0.45); });
    motes.mat.color.copy(s.mote);
    motes.mat.opacity = 0.35 + s.glow * 0.35;
    waterMat.uniforms.color!.value.copy(s.water);
    runeMat.opacity = s.rune;
    ringGlowMat.opacity = s.rune;
  };
  applyMood(current);

  const platform = (spec: PlatformSpec): THREE.Object3D => {
    if (spec.kind === 'ground') {
      const { g, rockTop } = island(spec.width, STAGE_D, spec.height, 38, 7 + spec.index, true);
      const runes = new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 14, 1.5), runeMat);
      runes.position.set(0, -1.4 - (spec.height - 1.4) / 2, STAGE_D / 2 + 0.05);
      g.add(runes);
      const rockR = spec.width * 0.5, rockH = 38;
      for (let i = 0; i < 10; i++) {
        const t = range(0.12, 0.8), side = i % 2 ? 1 : -1;
        const c = crystal(range(1.4, 2.6), CRYSTAL, new THREE.Vector3(side * range(0.6, 1), -range(0.4, 1), range(0, 0.4)));
        c.position.set(side * rockR * (1 - t) * 0.92, rockTop - t * rockH, range(2, 8) * (1 - t));
        g.add(c);
      }
      for (let i = 0; i < 3; i++) {
        const c = crystal(range(2.4, 3.4), CRYSTAL, new THREE.Vector3(range(-0.5, 0.5), -1, range(-0.2, 0.2)));
        c.position.set(range(-3, 3), rockTop - rockH * 0.9, range(-1, 2));
        g.add(c);
      }
      g.position.z = -(STAGE_D + 1.6) / 2;
      return g;
    }
    // Floating and moving platforms: a stone slab, a hanging rock and a crystal.
    const g = new THREE.Group();
    const slabH = Math.min(1.2, spec.height);
    const slab = outlined(slabGeo(spec.width, 10, slabH, 1.2, 0.3), mats.stone, 0.3);
    slab.position.y = -slabH / 2;
    g.add(slab);
    const rockR = Math.min(5, spec.width * 0.3);
    const under = outlined(rockGeo(rockR, rockR * 1.1, 1.3, 30 + spec.index, 0.25), mats.rock, 0.3);
    under.position.y = -slabH - rockR * 0.55;
    g.add(under);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 3, 0.5), runeMat);
    strip.position.set(0, -slabH / 2, 5.31);
    g.add(strip);
    const c = crystal(1.3, CRYSTAL, new THREE.Vector3(0, -1, 0));
    c.position.y = -slabH - rockR * 1.1 - 2;
    g.add(c);
    g.position.z = -5;
    return g;
  };

  const update = ({ elapsed, dt }: StageClock) => {
    const k = 1 - Math.exp(-dt * 2.2);
    COLOR_KEYS.forEach((c) => current[c].lerp(target[c], k));
    NUM_KEYS.forEach((n) => { current[n] += (target[n] - current[n]) * k; });
    current.sunDir.lerp(target.sunDir, k).normalize();
    applyMood(current);
    skyUniforms.time.value = elapsed;
    waterMat.uniforms.time!.value = elapsed;
    ring.rotation.z = elapsed * 0.05;
    orbiters.rotation.z = -elapsed * 0.11;
    ringCore.material.opacity = 0.25 + 0.1 * Math.sin(elapsed * 1.3);
    clouds.update(dt);
    motes.update(dt, elapsed);
  };

  return {
    platform, update, spriteTint,
    moods: Object.keys(PRESETS),
    setMood: (name) => {
      const preset = PRESETS[name as keyof typeof PRESETS];
      if (preset) target = toMood(preset);
    },
  };
};
