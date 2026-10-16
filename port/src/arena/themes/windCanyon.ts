import * as THREE from 'three';
import type { PlatformSpec, StageClock, StageTheme } from '../contract';
import { plankDeck, stripeTexture } from '../kit/props';
import { gradientSky, moteField, toonLights } from '../kit/skyKit';
import { jaggedGeo, rangeOf, rockGeo, seededRand, slabGeo, softTexture, toonPalette } from '../kit/toonKit';

/**
 * Wind Canyon: a sandstone mesa in a red-rock canyon at golden hour. Prayer
 * flags and the dust follow the stage's real net wind (`StageClock.wind`),
 * so the scenery never shows a gust the fighters don't feel.
 */
export const windCanyon: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(31415);
  const range = rangeOf(rand);
  const t = toonPalette([90, 170, 255], 0x2b1408);
  const { toon, outlined } = t;
  const glowTex = softTexture(1, 0.45, 0.35);
  const centre = (groundLeft + groundRight) / 2;
  const span = (groundRight - groundLeft) / 2;
  const STAGE_D = 30;

  const strata = (repeatX: number, repeatY = 1) => {
    const tex = stripeTexture(['#c8673d', '#d9824f', '#b4532f', '#e39a62', '#a94a2b', '#cf7445'], 9, rand);
    tex.repeat.set(repeatX, repeatY);
    return toon(0xffffff, { map: tex });
  };
  const mats = {
    sand: toon(0xf0c387), rock: toon(0xc4643c), dark: toon(0x8a3c25), far: toon(0xd98a62),
    wood: toon(0x9a6a3f), woodDark: toon(0x6b4527), rope: toon(0xe8d6a8),
    flag: [0xe94e4e, 0xf5c242, 0x4fb3e8, 0x6cd17a, 0xf7f2e6].map((c) => toon(c, { side: THREE.DoubleSide })),
  };

  // ---------- sky, haze, light ----------
  scene.fog = new THREE.Fog(0xf0b07c, 260, 900);
  const sky = gradientSky(scene, { top: 0x3f7cc4, horizon: 0xffc58a, bottom: 0xf3a066, sun: 0xffe2a8, sunDir: [0.5, 0.12, -1] });
  toonLights(scene, new THREE.Vector3(centre, groundTop, 0), new THREE.Vector3(70, 110, 80), 0xffe0bf, 0x7a3b22)
    .key.color.setHex(0xffd2a0);

  // ---------- canyon walls and buttes ----------
  const mesa = (w: number, h: number, d: number, salt: number) => {
    const g = new THREE.Group();
    const body = outlined(jaggedGeo(w * 0.42, w * 0.55, h, salt, 0.12, 9), strata(3, 2.5), 0.6);
    body.position.y = h / 2;
    g.add(body);
    const cap = outlined(slabGeo(w * 0.9, d, 3, 2, 0.6, 1), mats.sand, 0.4);
    cap.position.y = h + 1;
    g.add(cap);
    return g;
  };
  const floor = groundTop - 70;
  ([[-300, -260, 110, 140], [-190, -380, 90, 180], [300, -280, 120, 150], [200, -420, 80, 200], [-460, -520, 160, 230], [470, -560, 170, 240], [0, -700, 260, 150]] as const)
    .forEach(([x, z, w, h], i) => {
      const m = mesa(w, h, w * 0.6, 40 + i);
      m.position.set(centre + x, floor, z);
      scene.add(m);
    });
  // A natural arch framing the stage.
  const arch = new THREE.Group();
  arch.position.set(centre + 40, floor, -460);
  [-1, 1].forEach((side) => {
    const leg = outlined(jaggedGeo(16, 24, 150, 70 + side, 0.15, 8), strata(2, 2), 0.6);
    leg.position.set(side * 70, 75, 0);
    arch.add(leg);
  });
  const span3 = outlined(new THREE.TorusGeometry(70, 16, 6, 18, Math.PI), strata(6, 1), 0.6);
  span3.position.y = 150;
  arch.add(span3);
  scene.add(arch);
  // Canyon floor far below.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1600), mats.far);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(centre, floor, -500);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- prayer flags (sway with the wind) ----------
  const flagLines: Array<{ flags: THREE.Mesh[]; phase: number }> = [];
  const flagLine = (from: THREE.Vector3, to: THREE.Vector3, count: number) => {
    const g = new THREE.Group();
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color: 0xe8d6a8 }));
    g.add(rope);
    const flags: THREE.Mesh[] = [];
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.1, 0, 0), new THREE.Vector3(1.1, 0, 0), new THREE.Vector3(0, -3, 0)]);
    tri.computeVertexNormals();
    for (let i = 1; i <= count; i++) {
      const p = from.clone().lerp(to, i / (count + 1));
      p.y -= Math.sin((i / (count + 1)) * Math.PI) * 3;
      const f = new THREE.Mesh(tri, mats.flag[i % mats.flag.length]!);
      f.position.copy(p);
      g.add(f);
      flags.push(f);
    }
    scene.add(g);
    flagLines.push({ flags, phase: rand() * 6 });
  };
  const pole = (x: number, z: number, h: number) => {
    const p = outlined(new THREE.CylinderGeometry(0.35, 0.45, h, 6), mats.woodDark, 0.15);
    p.position.set(x, groundTop + h / 2, z);
    scene.add(p);
    return new THREE.Vector3(x, groundTop + h - 0.5, z);
  };
  // Low enough to hang under the floating platforms, never across them.
  const a = pole(centre - span * 0.9, -26, 10), b = pole(centre - span * 0.05, -27, 11), c = pole(centre + span * 0.85, -25, 10);
  flagLine(a, b, 14);
  flagLine(b, c, 16);

  // ---------- dust ----------
  const dust = moteField(scene, rand, glowTex, centre, groundTop, 320, 0.8);
  dust.mat.color.setHex(0xffe0b8);
  dust.mat.opacity = 0.55;

  // ---------- gameplay surfaces ----------
  const platform = (spec: PlatformSpec): THREE.Object3D => {
    const g = new THREE.Group();
    if (spec.kind === 'ground') {
      const cap = outlined(slabGeo(spec.width + 1.6, STAGE_D + 1.6, 1.6, 2.4, 0.4), mats.sand);
      cap.position.y = -0.8;
      g.add(cap);
      const bandH = Math.max(1, spec.height - 1.6);
      const band = outlined(new THREE.BoxGeometry(spec.width, bandH, STAGE_D), strata(spec.width / 20, 0.6));
      band.position.y = -1.6 - bandH / 2;
      g.add(band);
      const rockH = 60;
      const rock = outlined(rockGeo(spec.width * 0.5, rockH, (STAGE_D / spec.width) * 1.1, 11, 0.12), strata(4, 3), 0.5);
      rock.position.y = -1.6 - bandH - rockH / 2 + 0.3;
      g.add(rock);
      // Boulders on the back of the mesa top.
      for (let i = 0; i < 6; i++) {
        const r = range(1.6, 3.4);
        const bd = outlined(new THREE.DodecahedronGeometry(r, 0), i % 2 ? mats.rock : mats.dark, 0.25);
        bd.position.set((i / 5 - 0.5) * spec.width * 0.9 + range(-4, 4), r * 0.6, -STAGE_D / 2 + range(1, 5));
        bd.rotation.set(rand() * 3, rand() * 3, 0);
        g.add(bd);
      }
      g.position.z = -(STAGE_D + 1.6) / 2;
      return g;
    }
    // Floating and moving platforms: plank decks on two beams, lashed with rope.
    const deckH = Math.min(1.2, spec.height);
    g.add(plankDeck(t, mats.wood, mats.woodDark, spec.width, deckH, 9, rand));
    const tuft = outlined(rockGeo(Math.min(5, spec.width * 0.25), 5, 1.2, 60 + spec.index, 0.2), strata(1, 1), 0.3);
    tuft.position.y = -deckH - 3.5;
    g.add(tuft);
    g.position.z = -4.5;
    return g;
  };

  // ---------- animation ----------
  let sway = 0;
  const update = ({ elapsed, dt, wind }: StageClock) => {
    sky.time.value = elapsed;
    sway += (wind - sway) * Math.min(1, dt * 3);
    flagLines.forEach(({ flags, phase }) => flags.forEach((f, i) => {
      // Calm: flags hang and ripple. Wind: they stream out downwind.
      const flutter = Math.sin(elapsed * (3 + Math.abs(sway) * 8) + i * 0.7 + phase);
      f.rotation.x = 0.15 * flutter;
      f.rotation.z = sway * 1.2 + 0.08 * flutter;
    }));
    dust.update(dt, elapsed, sway * 40);
  };

  return { platform, update, spriteTint: new THREE.Color(0xfff0dc), moods: ['golden hour'], setMood: () => {} };
};
