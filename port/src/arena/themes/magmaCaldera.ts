import * as THREE from 'three';
import {
  LEGACY_LIGHT, crackTexture, glowSprite, jaggedGeo, pointCloud, rangeOf, seededRand, slabGeo, softTexture, toonPalette,
} from '../kit/toonKit';
import { batWing } from '../kit/creatures';
import { lavaKit } from '../kit/lavaKit';
import type { LavaPoolSpec, LavaPoolVisual, PlatformSpec, StageClock, StageTheme } from '../contract';

/**
 * Magma Caldera: basalt stage over a lava sea, an erupting volcano and a
 * dragon circling it. Ported from the approved demo
 * (docs/review/2026-10-13/threejs-port/demos/magma-caldera.src.html).
 *
 * The pools' height comes from the simulation's LavaHazard each frame. The
 * demo's dragon-breath attack is not a game hazard, so the dragon only
 * circles here: nothing in this theme looks dangerous without being so.
 */
export const magmaCaldera: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(4242);
  const range = rangeOf(rand);
  const palette = toonPalette([80, 165, 255], 0x120608);
  const { toon, outlined } = palette;
  const glowTex = softTexture(1);
  const puffTex = softTexture(0.85);
  const groundCentre = (groundLeft + groundRight) / 2;
  const STAGE_D = 28;
  const SEA_Y = groundTop - 42;

  const FOG = { color: new THREE.Color(0x2a0c10), near: 260, far: 950 };
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);

  // The demo asked for flat shading, which toon materials ignore; plain toon is the approved look.
  const flat = toon;
  const basalt = [flat(0x3d3644), flat(0x463e4e), flat(0x352f3c)];
  const mats = { top: flat(0x5f5566), spire: flat(0x261e2b) };
  const hexColumn = (len: number, r: number, i: number) =>
    outlined(new THREE.CylinderGeometry(r, r * 1.02, len, 6), basalt[((i % 3) + 3) % 3]!, 0.22);

  const crackTex = (w: number, h: number, n: number) => crackTexture(rand, w, h, n);

  // ---------- lava shader (pools, sea, falls, crater) ----------
  const { time: lavaTime, skyFlash, lavaMaterial } = lavaKit(scene, scene.fog, { top: 0x12050d, horizon: 0x8c2112, below: 0xf25214 });

  const hemi = new THREE.HemisphereLight(0x3a2f55, 0xff5a1a, 0.7 * LEGACY_LIGHT);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0x9fb0ff, 0.6 * LEGACY_LIGHT);
  key.position.set(groundCentre - 40, groundTop + 110, 90);
  key.target.position.set(groundCentre, groundTop, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -110, right: 110, top: 70, bottom: -60, near: 10, far: 400 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.04;
  scene.add(key, key.target);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1800), lavaMaterial(1, 0.035, [0.25, 0.1], 0.85));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(groundCentre, SEA_Y, -650);
  scene.add(sea);

  // Glowing crack planes pulse together.
  const glowMats: Array<{ mat: THREE.MeshBasicMaterial; base: number }> = [];
  const crackPlane = (w: number, h: number, tex: THREE.Texture, color: number, opacity: number) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    glowMats.push({ mat, base: opacity });
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  };

  // ---------- volcano, spires, falls ----------
  const CRATER = new THREE.Vector3(groundCentre + 90, SEA_Y + 202, -560);
  const volcano = new THREE.Group();
  volcano.position.set(CRATER.x, SEA_Y, CRATER.z);
  scene.add(volcano);
  const cone = outlined(jaggedGeo(34, 190, 200, 3, 0.12, 16), mats.spire, 1.2);
  cone.position.y = 100;
  volcano.add(cone);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(30, 20), lavaMaterial(1, 0.12, [0.2, 0.3], 1.2));
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = 199;
  volcano.add(crater);
  const craterGlow = glowSprite(glowTex, 0xff6a1a, 160, 110, false);
  craterGlow.position.y = 205;
  volcano.add(craterGlow);
  const craterLight = new THREE.PointLight(0xff5a14, 2 * LEGACY_LIGHT, 600, 1);
  craterLight.position.y = 215;
  volcano.add(craterLight);
  ([[-14, 0.06], [22, -0.08]] as const).forEach(([dx, tilt]) => {
    const river = new THREE.Mesh(new THREE.PlaneGeometry(9, 205), lavaMaterial(2, 1, [0, 0.35], 1.1, true));
    river.position.set(dx, 100, 112 * 0.98 + 4);
    river.rotation.set(-Math.atan2(156, 200), 0, tilt);
    volcano.add(river);
  });

  const spires = [[-150, -190, 150], [-230, -260, 200], [-120, -330, 120], [175, -230, 170], [260, -300, 210], [140, -170, 95], [-320, -420, 230], [330, -440, 240]] as const;
  spires.forEach(([x, z, h], i) => {
    const s = outlined(jaggedGeo(range(4, 10), range(22, 34), h, 20 + i, 0.25, 8), mats.spire, 0.8);
    s.position.set(groundCentre + x, SEA_Y + h / 2 - 2, z);
    scene.add(s);
  });
  ([[-138, -176, 120], [161, -214, 140]] as const).forEach(([x, z, top]) => {
    const fallMesh = new THREE.Mesh(new THREE.PlaneGeometry(10, top), lavaMaterial(2, 1, [0, 0.5], 1.15, true));
    fallMesh.position.set(groundCentre + x, SEA_Y + top / 2, z);
    scene.add(fallMesh);
    const splash = glowSprite(glowTex, 0xffa040, 50, 22);
    splash.position.set(groundCentre + x, SEA_Y + 3, z + 2);
    scene.add(splash);
  });

  // ---------- particles ----------
  const EMBERS = 420;
  const embers = pointCloud(EMBERS, 0.9, 0xff8a2e, glowTex);
  for (let i = 0; i < EMBERS; i++) {
    embers.pos.set([groundCentre + range(-140, 140), range(SEA_Y, groundTop + 60), range(-60, 30)], i * 3);
    embers.vel[i * 3 + 1] = range(2, 7);
  }
  const DRIPS = 60;
  const drips = pointCloud(DRIPS, 1.1, 0xffa040, glowTex);
  const BLOBS = 500;
  const lavaBlobs = pointCloud(BLOBS, 7, 0xff7a24, glowTex);
  scene.add(embers.points, drips.points, lavaBlobs.points);
  const spawnBlob = (i: number, power: number) => {
    const a = range(0, Math.PI * 2), spread = range(0.1, 0.45) * power;
    lavaBlobs.pos.set([CRATER.x + range(-8, 8), CRATER.y, CRATER.z + range(-8, 8)], i * 3);
    lavaBlobs.vel.set([Math.cos(a) * spread * 60, range(45, 80) * power, Math.sin(a) * spread * 30], i * 3);
    lavaBlobs.life[i] = 1;
  };
  const smoke: THREE.Sprite[] = [];
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0x2a1418, transparent: true, depthWrite: false }));
    s.userData.age = i / 26;
    scene.add(s);
    smoke.push(s);
  }
  /** Drip emitters, as points local to platform visuals that may move. */
  const dripSources: Array<{ owner: THREE.Object3D; local: THREE.Vector3 }> = [];

  // ---------- dragon (decoration only) ----------
  const dragonMat = {
    body: flat(0x9b2230), belly: flat(0xe8a65a), horn: flat(0xf3e6c8), dark: flat(0x4a0f18),
    wing: flat(0xc4473a, { side: THREE.DoubleSide }),
  };

  const blob = (sx: number, sy: number, sz: number, mat: THREE.Material, t = 0.22) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(sx, sy, sz);
    return outlined(g, mat, t);
  };
  const spike = (r: number, h: number, mat: THREE.Material) => outlined(new THREE.ConeGeometry(r, h, 5), mat, 0.12);
  const dragon = (() => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.add(blob(3.2, 2.8, 7, dragonMat.body, 0.3));
    const belly = blob(2.5, 2, 6, dragonMat.belly, 0.01);
    belly.position.set(0, -0.9, 0.3);
    body.add(belly);
    for (let z = -5; z <= 4; z += 1.8) {
      const s = spike(0.55, 1.8, dragonMat.horn);
      s.position.set(0, 2.7 - Math.abs(z) * 0.12, z);
      s.rotation.x = -0.5;
      body.add(s);
    }
    const chain = (count: number, start: THREE.Vector3, step: THREE.Vector3, make: (i: number) => THREE.Object3D) => {
      const joints: THREE.Group[] = [];
      let parent: THREE.Object3D = body, offset = start;
      for (let i = 0; i < count; i++) {
        const j = new THREE.Group();
        j.position.copy(offset);
        parent.add(j);
        j.add(make(i));
        joints.push(j);
        parent = j;
        offset = step;
      }
      return joints;
    };
    const neck = chain(5, new THREE.Vector3(0, 1.1, 5.6), new THREE.Vector3(0, 0.55, 1.8),
      (i) => blob(1.6 - i * 0.1, 1.6 - i * 0.1, 1.7, dragonMat.body, 0.2));
    const head = new THREE.Group();
    head.position.set(0, 0.6, 2);
    neck[neck.length - 1]!.add(head);
    head.add(blob(1.9, 1.6, 2.2, dragonMat.body, 0.22));
    const snout = outlined(new THREE.BoxGeometry(2.1, 1.1, 3), dragonMat.body, 0.18);
    snout.position.set(0, -0.1, 2.5);
    head.add(snout);
    [-1, 1].forEach((side) => {
      const horn = spike(0.45, 3.2, dragonMat.horn);
      horn.position.set(side * 0.9, 1.4, -1.1);
      horn.rotation.set(-2.1, 0, side * 0.25);
      head.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
      eye.position.set(side * 1.05, 0.55, 1.1);
      head.add(eye);
    });
    const tail = chain(9, new THREE.Vector3(0, 0.2, -6.4), new THREE.Vector3(0, 0, -1.9), (i) => {
      const r = 1.4 - i * 0.12;
      const g = new THREE.Group();
      g.add(blob(r, r, 1.4, dragonMat.body, 0.15));
      const s = spike(0.3, 1.1, dragonMat.horn);
      s.position.set(0, r, 0);
      s.rotation.x = -0.6;
      g.add(s);
      return g;
    });
    const spade = outlined(new THREE.ConeGeometry(1.1, 2.4, 4), dragonMat.dark, 0.15);
    spade.rotation.x = -Math.PI / 2;
    spade.position.z = -1.6;
    spade.scale.y = 0.35;
    tail[tail.length - 1]!.add(spade);
    const wings = ([-1, 1] as const).map((side) => {
      const pivot = batWing(palette, dragonMat.wing, dragonMat.dark, side);
      pivot.position.set(side * 2.4, 1.8, 2.2);
      body.add(pivot);
      return { pivot, side };
    });
    root.scale.setScalar(1.7);
    root.position.set(CRATER.x + 230, CRATER.y - 40, CRATER.z);
    scene.add(root);
    return { root, neck, head, tail, wings };
  })();
  const prevDragon = new THREE.Vector3();
  const lookDummy = new THREE.Object3D();

  // ---------- gameplay surfaces ----------
  const platform = (spec: PlatformSpec): THREE.Object3D => {
    const g = new THREE.Group();
    if (spec.kind === 'ground') {
      const capH = 1.6;
      const cap = outlined(slabGeo(spec.width + 1.4, STAGE_D + 1.4, capH, 1.6, 0.35, 1), mats.top);
      cap.position.y = -capH / 2;
      g.add(cap);
      const bodyH = Math.max(1, spec.height - capH);
      const body = outlined(new THREE.BoxGeometry(spec.width, bodyH, STAGE_D), basalt[0]!);
      body.position.y = -capH - bodyH / 2;
      g.add(body);
      const front = crackPlane(spec.width - 2, spec.height - 2, crackTex(1024, 96, 46), 0xff7a1e, 0.95);
      front.position.set(0, -spec.height / 2 - 0.4, STAGE_D / 2 + 0.05);
      g.add(front);
      const rim = crackPlane(spec.width, 0.5, glowTex, 0xffa040, 0.55);
      rim.position.set(0, -1.75, STAGE_D / 2 + 0.75);
      g.add(rim);
      // Basalt columns under the ground, longest in the middle, sinking into the sea.
      for (let x = -spec.width / 2 + 2.6; x <= spec.width / 2 - 2.4; x += 4.35) {
        [-8, 0, 8].forEach((z, row) => {
          const t = x / (spec.width / 2);
          const len = 8 + 34 * (1 - t * t) + range(-3, 5) - row * 2;
          const col = hexColumn(len, 2.4, Math.round(x) + row);
          col.position.set(x + range(-0.4, 0.4), -spec.height - len / 2 + 0.2, z + range(-0.6, 0.6));
          col.rotation.y = range(0, 1);
          g.add(col);
        });
      }
      g.position.z = -(STAGE_D + 1.4) / 2;
      return g;
    }
    const slabH = Math.min(1.4, spec.height);
    const slab = outlined(slabGeo(spec.width, 9, slabH, 1, 0.3, 1), mats.top, 0.3);
    slab.position.y = -slabH / 2;
    g.add(slab);
    const band = outlined(new THREE.BoxGeometry(spec.width - 1.5, 1.4, 8), basalt[1]!, 0.25);
    band.position.y = -slabH - 0.7;
    g.add(band);
    const cracks = crackPlane(spec.width - 3, 1.2, crackTex(512, 40, 14), 0xff7a1e, 0.9);
    cracks.position.set(0, -slabH - 0.7, 4.05);
    g.add(cracks);
    const n = Math.max(3, Math.round(spec.width / 3));
    for (let k = 0; k < n; k++) {
      const cx = -spec.width / 2 + 2.6 + (k * (spec.width - 5.2)) / (n - 1), t = cx / (spec.width / 2);
      const len = 1.5 + 8 * (1 - t * t) + range(-1.2, 1.2);
      const col = hexColumn(len, 1.55, k + spec.index);
      col.position.set(cx, -slabH - 1.4 - len / 2, range(-1, 1));
      col.rotation.y = range(0, 1);
      g.add(col);
      if (k % 3 === 1) dripSources.push({ owner: g, local: new THREE.Vector3(cx, -slabH - 1.4 - len, 0.5) });
    }
    g.position.z = -4.5;
    return g;
  };

  const lavaPool = (spec: LavaPoolSpec): LavaPoolVisual => {
    const side = Math.sign(spec.x - groundCentre) || 1;
    for (let i = 0; i < 4; i++) {
      const len = range(26, 40);
      const col = hexColumn(len, 2.6, i);
      col.position.set(spec.x + side * (spec.width / 2 + 3 + i * 3.6), SEA_Y + len / 2 - 2 + (i === 0 ? 4 : i * 2), range(-14, -2));
      scene.add(col);
    }
    const basin = outlined(new THREE.BoxGeometry(spec.width + 2, 4, 18), basalt[2]!);
    basin.position.set(spec.x, spec.base - 2, -9);
    scene.add(basin);
    const geo = new THREE.BoxGeometry(spec.width, 1, 16);
    // Front face on the gameplay plane, like the platforms.
    geo.translate(0, 0.5, -8);
    const mat = lavaMaterial(0, 0.09, [0.05, 0.22], 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spec.x, spec.base, 0);
    scene.add(mesh);
    const light = new THREE.PointLight(0xff6a1a, 0.4 * LEGACY_LIGHT, 75, 2);
    light.position.set(spec.x, spec.base + 6, 14);
    scene.add(light);
    const halo = glowSprite(glowTex, 0xff7a2a, 70, 34);
    scene.add(halo);
    return {
      update(height, norm) {
        const h = Math.max(0.05, height);
        mesh.scale.y = h;
        mat.uniforms.glow!.value = 0.75 + norm * 0.6;
        light.intensity = (0.3 + norm * 1.1) * LEGACY_LIGHT;
        light.position.y = spec.base + h + 4;
        halo.position.set(spec.x, spec.base + h, 9);
        halo.material.opacity = 0.25 + norm * 0.55;
      },
    };
  };

  // ---------- animation ----------
  const ERUPTION_PERIOD = 22;
  let eruption = 0, lastEruption = 0;
  const work = new THREE.Vector3();
  const update = ({ elapsed, dt }: StageClock) => {
    lavaTime.value = elapsed;
    glowMats.forEach(({ mat, base }, i) => { mat.opacity = base * (0.7 + 0.3 * Math.sin(elapsed * 1.8 + i)); });

    for (let i = 0; i < EMBERS; i++) {
      embers.pos[i * 3 + 1]! += embers.vel[i * 3 + 1]! * dt;
      embers.pos[i * 3]! += Math.sin(elapsed * 0.9 + i) * dt * 1.2;
      if (embers.pos[i * 3 + 1]! > groundTop + 65) embers.pos[i * 3 + 1] = SEA_Y;
    }
    embers.commit();

    for (let i = 0; i < DRIPS; i++) {
      if (drips.life[i]! <= 0) {
        if (dripSources.length && rand() < dt * 0.6) {
          const s = dripSources[i % dripSources.length]!;
          s.owner.localToWorld(work.copy(s.local));
          drips.pos.set([work.x, work.y, work.z], i * 3);
          drips.vel[i * 3 + 1] = 0;
          drips.life[i] = 1;
        }
        continue;
      }
      drips.vel[i * 3 + 1]! -= 60 * dt;
      drips.pos[i * 3 + 1]! += drips.vel[i * 3 + 1]! * dt;
      if (drips.pos[i * 3 + 1]! < SEA_Y) { drips.life[i] = 0; drips.pos[i * 3 + 1] = -9999; }
    }
    drips.commit();

    // A periodic eruption, purely visual.
    if (elapsed - lastEruption > ERUPTION_PERIOD) {
      lastEruption = elapsed;
      eruption = 1;
      let n = 0;
      for (let i = 0; i < BLOBS && n < 260; i++) if (lavaBlobs.life[i]! <= 0) { spawnBlob(i, range(1.1, 1.6)); n++; }
    }
    for (let i = 0; i < BLOBS; i++) {
      if (lavaBlobs.life[i]! <= 0) { if (rand() < dt * 0.05) spawnBlob(i, 0.7); continue; }
      lavaBlobs.vel[i * 3 + 1]! -= 35 * dt;
      for (let k = 0; k < 3; k++) lavaBlobs.pos[i * 3 + k]! += lavaBlobs.vel[i * 3 + k]! * dt;
      if (lavaBlobs.pos[i * 3 + 1]! < SEA_Y) { lavaBlobs.life[i] = 0; lavaBlobs.pos[i * 3 + 1] = -9999; }
    }
    lavaBlobs.commit();
    smoke.forEach((s, i) => {
      s.userData.age = (s.userData.age + dt * (0.035 + eruption * 0.08)) % 1;
      const a = s.userData.age as number;
      s.position.set(CRATER.x + Math.sin(i * 2.3) * 18 * a + a * 90, CRATER.y + 10 + a * 220, CRATER.z + Math.cos(i) * 10);
      s.scale.setScalar(40 + a * 160);
      s.material.opacity = Math.sin(a * Math.PI) * 0.85;
    });
    eruption = Math.max(0, eruption - dt * 0.4);
    craterLight.intensity = (2 + eruption * 6) * LEGACY_LIGHT;
    craterGlow.material.opacity = 0.7 + eruption * 0.3;
    skyFlash.value = eruption;
    hemi.intensity = (0.7 + eruption * 0.35) * LEGACY_LIGHT;

    // Dragon circles the volcano.
    const a = elapsed * 0.22;
    prevDragon.copy(dragon.root.position);
    work.set(CRATER.x + Math.cos(a) * 230, CRATER.y - 40 + Math.sin(elapsed * 0.7) * 12, CRATER.z + Math.sin(a) * 200);
    dragon.root.position.lerp(work, 1 - Math.exp(-dt * 1.5));
    const v = work.copy(dragon.root.position).sub(prevDragon);
    if (v.lengthSq() > 1e-6) {
      lookDummy.position.copy(dragon.root.position);
      lookDummy.lookAt(v.add(dragon.root.position));
      dragon.root.quaternion.slerp(lookDummy.quaternion, 1 - Math.exp(-dt * 2.5));
    }
    const flap = elapsed * 5;
    dragon.wings.forEach((w) => {
      w.pivot.rotation.z = w.side * (Math.sin(flap) * 0.75 + 0.1);
      w.pivot.rotation.y = w.side * Math.sin(flap - 0.6) * 0.15;
    });
    dragon.neck.forEach((j, i) => { j.rotation.x = -0.05 + Math.sin(elapsed * 2.2 - i * 0.6) * 0.08; });
    dragon.head.rotation.x = 0.1;
    dragon.tail.forEach((j, i) => { j.rotation.y = Math.sin(elapsed * 2.4 - i * 0.55) * 0.16; j.rotation.x = 0.04; });
  };

  return {
    platform, lavaPool, update,
    spriteTint: new THREE.Color(0xffd8c4),
    moods: ['night'],
    setMood: () => {},
  };
};
