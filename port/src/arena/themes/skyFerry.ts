import * as THREE from 'three';
import type { PlatformSpec, StageClock, StageTheme } from '../contract';
import { floatingIsland, plankDeck, toonTree } from '../kit/props';
import { cloudField, gradientSky, moteField, toonLights } from '../kit/skyKit';
import { glowSprite, rangeOf, rockGeo, seededRand, softTexture, toonPalette } from '../kit/toonKit';

/**
 * Sky Ferry: two wooden docks on floating rock above a cloud sea, with
 * rotor rafts and a chain lift as the moving platforms (they ride the game's
 * own moving-platform path) and an airship drifting behind.
 */
export const skyFerry: StageTheme = ({ scene, groundTop, groundLeft, groundRight }) => {
  const rand = seededRand(16180);
  const range = rangeOf(rand);
  const t = toonPalette([95, 175, 255], 0x1a1f3a);
  const { toon, outlined } = t;
  const glowTex = softTexture(1, 0.45, 0.35);
  const puffTex = softTexture(0.95, 0.75, 0.55);
  const centre = (groundLeft + groundRight) / 2;
  const STAGE_D = 26;

  const mats = {
    wood: toon(0xb07a4a), woodDark: toon(0x7a4f30), hull: toon(0xc8443c), hullDark: toon(0x8e2b2a), brass: toon(0xf0c45a),
    stone: toon(0x8f8170), chain: toon(0x5a5f6e), rock: toon(0x8a7f9c), grass: toon(0x6cc957), grassDark: toon(0x45a14a), trunk: toon(0x7a4f35),
    leaves: [toon(0x4fae4a), toon(0x6cc957)], balloon: toon(0xf2e6c9), balloonStripe: toon(0x3e7cc4), rope: toon(0xe8d6a8),
  };

  // ---------- sky, clouds, light ----------
  scene.fog = new THREE.Fog(0xcfe9ff, 260, 900);
  const sky = gradientSky(scene, { top: 0x2a6fd6, horizon: 0xc9ecff, bottom: 0xffffff, sun: 0xfff6d8, sunDir: [0.35, 0.22, -1] });
  toonLights(scene, new THREE.Vector3(centre, groundTop, 0), new THREE.Vector3(50, 120, 90), 0xe6f4ff, 0x6f7f9a);
  const clouds = cloudField(scene, rand, puffTex, centre, groundTop, { sea: 200, clusters: 16, seaY: [-70, -40] });
  const sparkles = moteField(scene, rand, glowTex, centre, groundTop, 120, 0.7);
  sparkles.mat.color.setHex(0xfff6d8);

  // ---------- distant islands ----------
  const islandMats = { top: mats.grass, band: mats.stone, rock: mats.rock, tuft: mats.grassDark };
  ([[-230, 40, -320, 50], [260, 70, -380, 40], [-60, 110, -560, 70], [420, 10, -520, 36]] as const).forEach(([x, y, z, w], i) => {
    const { group } = floatingIsland(t, islandMats, w, w * 0.45, 3, w * 0.7, 120 + i, rand);
    group.position.set(centre + x, groundTop + y, z);
    const tree = toonTree(t, mats.trunk, mats.leaves, w / 40, rand);
    tree.position.set(-w * 0.2, 0, -2);
    group.add(tree);
    scene.add(group);
  });

  // ---------- airship ----------
  const airship = new THREE.Group();
  const envelope = new THREE.SphereGeometry(1, 20, 12);
  envelope.scale(46, 14, 14);
  airship.add(outlined(envelope, mats.balloon, 0.8));
  [-1, 0, 1].forEach((k) => {
    const band = outlined(new THREE.TorusGeometry(14.2 - Math.abs(k) * 3, 0.9, 6, 20), mats.balloonStripe, 0.2);
    band.rotation.y = Math.PI / 2;
    band.position.x = k * 22;
    airship.add(band);
  });
  const gondola = outlined(new THREE.BoxGeometry(22, 5, 7), mats.wood, 0.4);
  gondola.position.y = -19;
  airship.add(gondola);
  const fins = outlined(new THREE.ConeGeometry(8, 12, 4), mats.balloonStripe, 0.3);
  fins.rotation.z = Math.PI / 2;
  fins.position.x = -50;
  airship.add(fins);
  const shipProp = outlined(new THREE.BoxGeometry(0.8, 10, 1.4), mats.brass, 0.15);
  shipProp.position.set(-52, -19, 0);
  airship.add(shipProp);
  airship.position.set(centre - 300, groundTop + 95, -420);
  scene.add(airship);

  // ---------- birds ----------
  const birds = Array.from({ length: 7 }, (_, i) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2, 0.6, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0.6, 0)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2a3150 }));
    line.position.set(centre + range(-200, 200), groundTop + range(60, 110), range(-260, -160));
    scene.add(line);
    return { line, geo, phase: i * 0.9, speed: range(6, 11) };
  });

  // ---------- gameplay surfaces ----------
  const propellers: THREE.Object3D[] = [];
  const glows: THREE.Sprite[] = [];
  const lamp = (x: number, z: number) => {
    const g = new THREE.Group();
    const post = outlined(new THREE.CylinderGeometry(0.3, 0.4, 9, 6), mats.woodDark, 0.12);
    post.position.y = 4.5;
    g.add(post);
    const head = outlined(new THREE.BoxGeometry(1.6, 1.8, 1.6), mats.brass, 0.15);
    head.position.y = 9.6;
    g.add(head);
    const light = glowSprite(glowTex, 0xffd27a, 6);
    light.position.y = 9.6;
    g.add(light);
    glows.push(light);
    g.position.set(x, 0, z);
    return g;
  };

  const platform = (spec: PlatformSpec): THREE.Object3D => {
    const g = new THREE.Group();
    if (spec.kind === 'ground') {
      g.add(plankDeck(t, mats.wood, mats.woodDark, spec.width, 1.2, STAGE_D, rand));
      const bandH = Math.max(1, spec.height - 2.1);
      const pier = outlined(new THREE.BoxGeometry(spec.width - 2, bandH, STAGE_D - 2), mats.stone, 0.35);
      pier.position.y = -2.1 - bandH / 2;
      g.add(pier);
      const rockH = 34;
      const rock = outlined(rockGeo(spec.width * 0.48, rockH, (STAGE_D / spec.width) * 1.2, 140 + spec.index, 0.2), mats.rock, 0.45);
      rock.position.y = -2.1 - bandH - rockH / 2 + 0.3;
      g.add(rock);
      g.add(lamp(-spec.width * 0.35, -STAGE_D / 2 + 2), lamp(spec.width * 0.35, -STAGE_D / 2 + 2));
      g.position.z = -STAGE_D / 2;
      return g;
    }
    if (spec.kind === 'moving' && spec.travel.y > spec.travel.x) {
      // Lift: a framed deck hanging from chains that run up out of view.
      const deckH = Math.min(1.2, spec.height);
      g.add(plankDeck(t, mats.wood, mats.woodDark, spec.width, deckH, 9, rand));
      const frame = outlined(new THREE.BoxGeometry(spec.width + 0.6, 0.7, 9.4), mats.brass, 0.12);
      frame.position.y = -deckH - 0.35;
      g.add(frame);
      [-1, 1].forEach((side) => {
        const chain = outlined(new THREE.CylinderGeometry(0.25, 0.25, 120, 5), mats.chain, 0.06);
        chain.position.set(side * (spec.width / 2 - 1), 60, -3.5);
        g.add(chain);
      });
      g.position.z = -4.5;
      return g;
    }
    if (spec.kind === 'moving') {
      // Sky raft: it passes just over the docks, so nothing hangs below the
      // deck; rotor masts at both ends carry it.
      const deckH = Math.min(1.2, spec.height);
      g.add(plankDeck(t, mats.wood, mats.woodDark, spec.width, deckH, 9, rand));
      const rim = outlined(new THREE.BoxGeometry(spec.width + 0.6, 0.6, 9.4), mats.hull, 0.12);
      rim.position.y = -deckH - 0.3;
      g.add(rim);
      [-1, 1].forEach((side) => {
        const mast = outlined(new THREE.CylinderGeometry(0.3, 0.4, 6, 6), mats.brass, 0.1);
        mast.position.set(side * (spec.width / 2 - 1), 3, -3.6);
        g.add(mast);
        const rotor = new THREE.Group();
        rotor.position.set(side * (spec.width / 2 - 1), 6.2, -3.6);
        [0, Math.PI / 2].forEach((r) => {
          const blade = outlined(new THREE.BoxGeometry(7, 0.25, 0.8), mats.hullDark, 0.06);
          blade.rotation.y = r;
          rotor.add(blade);
        });
        g.add(rotor);
        propellers.push(rotor);
      });
      const engine = glowSprite(glowTex, 0x7fd4ff, 10, 3);
      engine.position.set(0, -deckH - 0.8, 2);
      g.add(engine);
      glows.push(engine);
      g.position.z = -4.5;
      return g;
    }
    // Floating: a small hanging deck under a balloon-free rope rig.
    const deckH = Math.min(1.2, spec.height);
    g.add(plankDeck(t, mats.wood, mats.woodDark, spec.width, deckH, 8, rand));
    const under = outlined(rockGeo(Math.min(5, spec.width * 0.25), 6, 1.2, 150 + spec.index, 0.25), mats.rock, 0.3);
    under.position.y = -deckH - 3.5;
    g.add(under);
    g.add(lamp(0, -3.2));
    g.position.z = -4;
    return g;
  };

  const update = ({ elapsed, dt }: StageClock) => {
    sky.time.value = elapsed;
    clouds.update(dt, 0.8);
    sparkles.update(dt, elapsed);
    propellers.forEach((p, i) => { p.rotation.y = elapsed * (14 + i); });
    shipProp.rotation.x = elapsed * 6;
    airship.position.x = centre - 300 + ((elapsed * 4) % 600);
    airship.position.y = groundTop + 95 + Math.sin(elapsed * 0.4) * 3;
    glows.forEach((s, i) => { s.material.opacity = 0.7 + 0.2 * Math.sin(elapsed * 2 + i); });
    birds.forEach((b) => {
      b.line.position.x += dt * b.speed;
      if (b.line.position.x > centre + 260) b.line.position.x = centre - 260;
      const flap = Math.sin(elapsed * 8 + b.phase) * 0.8;
      const p = b.geo.attributes.position as THREE.BufferAttribute;
      p.setY(0, flap);
      p.setY(2, flap);
      p.needsUpdate = true;
    });
  };

  return { platform, update, spriteTint: new THREE.Color(0xffffff), moods: ['day'], setMood: () => {} };
};
