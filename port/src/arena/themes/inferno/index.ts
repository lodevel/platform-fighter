import * as THREE from 'three';
import type { GazeView, PlatformSpec, StageClock, StageTheme } from '../../contract';
import { lavaGeysers, lavaKit } from '../../kit/lavaKit';
import { moteField, toonLights } from '../../kit/skyKit';
import {
  LEGACY_LIGHT, crackTexture, jaggedGeo, rangeOf, seededRand, slabGeo, softTexture, toonPalette,
} from '../../kit/toonKit';
import { cauldronScene, hangingCage, tormentScene, type FigureMaterials } from './figures';
import { createGiantHead } from './head';
import { mustachePlatform } from './mustache';

/**
 * The Inferno: obsidian platforms over a lava sea in a smoky red hell,
 * demons tormenting souls on the rocks behind, caged souls swinging, and the
 * giant head that rises from the lava (GazeHazard drives it; the theme only
 * draws what the hazard state says).
 */
export const inferno: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(66613);
  const range = rangeOf(rand);
  const t = toonPalette([70, 150, 255], 0x0c0406);
  const { toon, outlined } = t;
  const glowTex = softTexture(1, 0.45, 0.35);
  const centre = (groundLeft + groundRight) / 2;
  const STAGE_D = 28;
  /** Where the figure scenes stand, a little under the stage. */
  const LEDGE_Y = groundTop - 42;
  /**
   * The lava sea sits deep below the stage so the risen head, aligned behind
   * its mustache platform, shows its mouth and chin before reaching the lava.
   */
  const SEA_Y = groundTop - 70;

  scene.fog = new THREE.Fog(0x1c0507, 240, 900);
  const lava = lavaKit(scene, scene.fog, { top: 0x060103, horizon: 0x52090a, below: 0xd2300c });
  const lights = toonLights(scene, new THREE.Vector3(centre, groundTop, 0), new THREE.Vector3(-30, 60, 90), 0x5a1a20, 0xff3a10);
  lights.hemi.intensity = 0.7 * LEGACY_LIGHT;
  lights.key.color.setHex(0xff8a5a);
  lights.key.intensity = 0.55 * LEGACY_LIGHT;

  const mats = {
    obsidian: toon(0x2a1a24), obsidianLight: toon(0x5a3a48), spike: toon(0x1a0f14),
    rock: toon(0x2b1d22),
  };
  const glowMats: THREE.MeshBasicMaterial[] = [];
  const crackPlane = (w: number, h: number, n: number) => {
    const mat = new THREE.MeshBasicMaterial({ map: crackTexture(rand, 1024, 96, n), color: 0xff3a12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    glowMats.push(mat);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  };

  // ---------- lava sea and the head ----------
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1800), lava.lavaMaterial(1, 0.03, [0.2, 0.08], 0.75));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(centre, SEA_Y, -650);
  scene.add(sea);
  // Aimed at a default spot until the centre platform (its mustache) is built and re-aims it.
  // Geysers erupt from the sea behind the stage, clear of the head's column.
  const geysers = lavaGeysers(scene, {
    surfaceY: SEA_Y, glow: glowTex, rand,
    spots: [{ x: centre - 130, z: -260 }, { x: centre + 150, z: -220 }, { x: centre - 270, z: -480 }, { x: centre + 300, z: -430 }, { x: centre + 60, z: -580 }],
  });
  const head = createGiantHead(scene, glowTex, { seaY: SEA_Y, z: -300, haze: 0x2a0a0a, target: new THREE.Vector3(centre, LEDGE_Y + 30, 0), width: 17 });

  // ---------- hell's inhabitants ----------
  const animators: Array<(e: number) => void> = [];
  const figureMats: FigureMaterials = {
    demonSkin: toon(0xc0282a), demonDark: toon(0x3a080c), demonEyes: new THREE.MeshBasicMaterial({ color: 0xffd23a }),
    horn: toon(0xe8dcc0), wing: toon(0x7a1420, { side: THREE.DoubleSide }),
    soulSkin: toon(0xc9cdd8), soulDark: toon(0x1a0e14), soulEyes: new THREE.MeshBasicMaterial({ color: 0xf2f0ea }),
    rags: toon(0x6b5a4c), iron: toon(0x3a3438), rock: mats.rock,
    molten: new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
  };
  // Near the screen edges, clear of the head and of the gameplay space.
  const scenes = [
    { make: () => tormentScene(t, figureMats, 1, 2, 1, 'pitchfork'), x: -104, z: -58, scale: 1.5 },
    { make: () => tormentScene(t, figureMats, 2, 2, -1, 'whip'), x: 106, z: -62, scale: 1.5 },
    { make: () => cauldronScene(t, figureMats, 3), x: -165, z: -150, scale: 2.1 },
    { make: () => tormentScene(t, figureMats, 4, 3, -1, 'pitchfork'), x: 172, z: -160, scale: 2.1 },
    { make: () => tormentScene(t, figureMats, 5, 1, 1, 'whip'), x: -250, z: -270, scale: 2.9 },
    { make: () => cauldronScene(t, figureMats, 6), x: 262, z: -280, scale: 2.9 },
  ];
  scenes.forEach(({ make, x, z, scale }) => {
    const sc = make();
    sc.group.position.set(centre + x, LEDGE_Y + 9 * scale + range(0, 3), z);
    sc.group.scale.setScalar(scale);
    scene.add(sc.group);
    // A rock pillar from the scene's ledge down into the lava.
    const drop = sc.group.position.y - SEA_Y;
    const pillar = outlined(jaggedGeo(6 * scale, 9 * scale, drop, 500 + z, 0.2, 8), mats.rock, 0.5);
    pillar.position.set(centre + x, SEA_Y + drop / 2 - 6 * scale, z - 1);
    scene.add(pillar);
    animators.push(sc.animate);
  });
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const cage = hangingCage(t, figureMats, range(30, 70), rand);
    cage.group.position.set(centre + side * range(75, 120), groundTop + 125, range(-70, -40));
    cage.group.scale.setScalar(0.85);
    scene.add(cage.group);
    animators.push(cage.animate);
  }
  // Spires and chains framing the pit.
  ([[-200, -80, 140], [210, -90, 160], [-330, -200, 220], [340, -210, 230], [-120, -380, 260], [150, -400, 240]] as const).forEach(([x, z, h], i) => {
    const s = outlined(jaggedGeo(range(3, 8), range(18, 30), h, 300 + i, 0.25, 7), mats.rock, 0.7);
    s.position.set(centre + x, SEA_Y + h / 2 - 4, z);
    scene.add(s);
  });

  const embers = moteField(scene, rand, glowTex, centre, groundTop, 380, 0.9);
  embers.mat.color.setHex(0xff6a24);

  // ---------- gameplay surfaces: obsidian ----------
  const spikes = (w: number, y: number, z: number, count: number, down: boolean) => {
    const g = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const h = range(1.5, 4);
      const c = outlined(new THREE.ConeGeometry(range(0.5, 1), h, 5), mats.spike, 0.1);
      c.position.set(-w / 2 + (i + 0.5) * (w / count) + range(-0.5, 0.5), y + (down ? -h / 2 : h / 2), z + range(-1, 1));
      if (down) c.rotation.x = Math.PI;
      g.add(c);
    }
    return g;
  };
  const platform = (spec: PlatformSpec): THREE.Object3D => {
    const g = new THREE.Group();
    if (spec.kind === 'ground') {
      const capH = 1.6;
      const cap = outlined(slabGeo(spec.width + 1.4, STAGE_D + 1.4, capH, 1.2, 0.35, 1), mats.obsidianLight);
      cap.position.y = -capH / 2;
      g.add(cap);
      const bodyH = Math.max(1, spec.height - capH);
      const body = outlined(new THREE.BoxGeometry(spec.width, bodyH, STAGE_D), mats.obsidian);
      body.position.y = -capH - bodyH / 2;
      g.add(body);
      const cracks = crackPlane(spec.width - 2, spec.height - 2, 50);
      cracks.position.set(0, -spec.height / 2 - 0.4, STAGE_D / 2 + 0.05);
      g.add(cracks);
      const under = outlined(jaggedGeo(spec.width * 0.42, spec.width * 0.08, 40, 400, 0.2, 9), mats.obsidian, 0.5);
      under.position.y = -spec.height - 20;
      g.add(under);
      g.add(spikes(spec.width, 0, -STAGE_D / 2 + 2, Math.round(spec.width / 5), false));
      g.add(spikes(spec.width, -spec.height, STAGE_D / 2 - 2, Math.round(spec.width / 3), true));
      g.position.z = -(STAGE_D + 1.4) / 2;
      return g;
    }
    // The centre platform is the head's mustache: same collision, hair look, and the head lines up behind it.
    if (spec.kind === 'floating' && Math.abs(spec.x - centre) < spec.width / 2) {
      head.alignPhiltrum(new THREE.Vector3(spec.x, spec.top, 0), spec.width);
      return mustachePlatform(t, spec, rand);
    }
    const slabH = Math.min(1.4, spec.height);
    const slab = outlined(slabGeo(spec.width, 9, slabH, 0.8, 0.3, 1), mats.obsidianLight, 0.3);
    slab.position.y = -slabH / 2;
    g.add(slab);
    const cracks = crackPlane(spec.width - 2, 1.1, 12);
    cracks.position.set(0, -slabH / 2, 4.55);
    g.add(cracks);
    g.add(spikes(spec.width, -slabH, 0, Math.max(3, Math.round(spec.width / 2.5)), true));
    g.position.z = -4.5;
    return g;
  };

  const gaze = (view: GazeView, clock: StageClock) => head.update(view, clock);
  const update = ({ elapsed, dt }: StageClock) => {
    lava.time.value = elapsed;
    lava.skyFlash.value = Math.max(head.flash, head.eyeGlow * 0.35);
    glowMats.forEach((m, i) => { m.opacity = (0.65 + 0.3 * Math.sin(elapsed * 1.7 + i)) * (1 + head.eyeGlow); });
    animators.forEach((a) => a(elapsed));
    embers.update(dt, elapsed);
    geysers.update(elapsed);
  };

  return { platform, gaze, update, spriteTint: new THREE.Color(0xffd0c0), moods: ['hell'], setMood: () => {} };
};
