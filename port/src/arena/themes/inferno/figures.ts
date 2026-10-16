import * as THREE from 'three';
import { batWing, taperedCurve } from '../../kit/creatures';
import { applyPose, blendPose, buildHumanoid, type Humanoid, type Pose } from '../../kit/humanoid';
import type { Toon } from '../../kit/props';
import { jaggedGeo, type Rand } from '../../kit/toonKit';

/**
 * The Inferno's inhabitants, built on the jointed humanoid kit: demons
 * (horns, wings, tail, pitchfork or whip) tormenting souls (kneeling in
 * chains, cowering, boiling in a cauldron, caged over the lava). Each scene
 * returns its group and an `animate(elapsed)`; all of it is decoration far
 * behind the gameplay plane.
 */
export interface FigureMaterials {
  readonly demonSkin: THREE.Material;
  readonly demonDark: THREE.Material;
  readonly demonEyes: THREE.Material;
  readonly horn: THREE.Material;
  readonly wing: THREE.Material;
  readonly soulSkin: THREE.Material;
  readonly soulDark: THREE.Material;
  readonly soulEyes: THREE.Material;
  readonly rags: THREE.Material;
  readonly iron: THREE.Material;
  readonly rock: THREE.Material;
  readonly molten: THREE.Material;
}

type Animate = (elapsed: number) => void;
interface Scene { readonly group: THREE.Group; readonly animate: Animate }

const FIGURE_HEIGHT = 10;

// ---------- poses (radians per joint) ----------
const KNEEL: Pose = {
  hipL: [-1.5, 0, 0.1], kneeL: [2.4, 0, 0], ankleL: [-0.9, 0, 0], hipR: [-1.5, 0, -0.1], kneeR: [2.4, 0, 0], ankleR: [-0.9, 0, 0],
  pelvis: [0, 0, 0],
};
const KNEEL_BOUND: Pose = { ...KNEEL, shoulderL: [0.2, 0, -2.6], elbowL: [0, 0, -0.5], shoulderR: [0.2, 0, 2.6], elbowR: [0, 0, 0.5], spine: [0.15, 0, 0] };
const KNEEL_PLEAD: Pose = { ...KNEEL, shoulderL: [-1.3, 0, -0.3], elbowL: [-1.2, 0, 0], shoulderR: [-1.3, 0, 0.3], elbowR: [-1.2, 0, 0], spine: [-0.25, 0, 0], neck: [-0.4, 0, 0], jaw: [0.5, 0, 0] };
const COWER_A: Pose = { ...KNEEL, spine: [0.6, 0, 0], neck: [0.3, 0, 0], shoulderL: [-2.4, 0, -0.4], elbowL: [-1.9, 0, 0], shoulderR: [-2.4, 0, 0.4], elbowR: [-1.9, 0, 0] };
const COWER_B: Pose = { ...COWER_A, spine: [0.45, 0.15, 0], jaw: [0.6, 0, 0] };
const SCREAM_A: Pose = { shoulderL: [0, 0, -2.7], elbowL: [0, 0, -0.4], shoulderR: [0, 0, 2.5], elbowR: [0, 0, 0.6], neck: [-0.5, 0, 0], jaw: [0.7, 0, 0], spine: [-0.15, 0, 0] };
const SCREAM_B: Pose = { shoulderL: [0, 0, -2.3], elbowL: [0, 0, -1.0], shoulderR: [0, 0, 2.8], elbowR: [0, 0, 0.2], neck: [-0.3, 0.3, 0], jaw: [0.35, 0, 0], spine: [-0.05, 0.2, 0] };
const HANG_A: Pose = { shoulderL: [0, 0, -2.9], elbowL: [0, 0, -0.2], shoulderR: [0, 0, 2.9], elbowR: [0, 0, 0.2], hipL: [0.2, 0, 0], hipR: [-0.1, 0, 0], kneeL: [0.6, 0, 0], kneeR: [0.3, 0, 0], neck: [0.4, 0, 0] };
const HANG_B: Pose = { ...HANG_A, hipL: [-0.2, 0, 0], hipR: [0.3, 0, 0], kneeL: [0.2, 0, 0], kneeR: [0.7, 0, 0], neck: [-0.3, 0, 0], jaw: [0.6, 0, 0] };
const DEMON_STANCE: Pose = { hipL: [-0.3, 0, 0.15], kneeL: [0.5, 0, 0], ankleL: [-0.2, 0, 0], hipR: [0.25, 0, -0.1], kneeR: [0.3, 0, 0], spine: [0.1, 0, 0], shoulderL: [0, 0, -0.5], elbowL: [-0.6, 0, 0] };
const JAB_A: Pose = { ...DEMON_STANCE, shoulderR: [-1.1, 0, 0.3], elbowR: [-1.3, 0, 0], chest: [0, -0.2, 0] };
const JAB_B: Pose = { ...DEMON_STANCE, shoulderR: [-1.55, 0, 0.1], elbowR: [-0.1, 0, 0], chest: [0.15, 0.25, 0], spine: [0.3, 0, 0] };
const WHIP_A: Pose = { ...DEMON_STANCE, shoulderR: [-2.9, 0, 0.4], elbowR: [-0.6, 0, 0], chest: [-0.15, -0.3, 0] };
const WHIP_B: Pose = { ...DEMON_STANCE, shoulderR: [-0.6, 0, 0.2], elbowR: [-0.1, 0, 0], chest: [0.25, 0.3, 0], spine: [0.35, 0, 0] };
const STIR_A: Pose = { ...DEMON_STANCE, shoulderL: [-1.0, 0, -0.2], elbowL: [-1.0, 0, 0], shoulderR: [-1.2, 0, 0.2], elbowR: [-0.8, 0, 0], chest: [0.2, -0.3, 0] };
const STIR_B: Pose = { ...STIR_A, chest: [0.2, 0.3, 0] };

/** Ease between two poses: phase 0..1 → a..b..a. */
const swing = (h: Humanoid, a: Pose, b: Pose, e: number, speed: number, offset: number, sharp = 1) =>
  applyPose(h, blendPose(a, b, (0.5 - 0.5 * Math.cos(e * speed + offset)) ** sharp));

// ---------- figures ----------
function soul(t: Toon, m: FigureMaterials, height = FIGURE_HEIGHT) {
  return buildHumanoid(t, { skin: m.soulSkin, dark: m.soulDark, eyes: m.soulEyes, cloth: m.rags }, { height, bulk: 0.72 });
}

function demon(t: Toon, m: FigureMaterials, height = FIGURE_HEIGHT * 1.25) {
  const h = buildHumanoid(t, { skin: m.demonSkin, dark: m.demonDark, eyes: m.demonEyes }, { height, bulk: 1.35, beast: true });
  const u = height / 18;
  ([-1, 1] as const).forEach((side) => {
    const horn = taperedCurve(t, m.horn, [
      new THREE.Vector3(side * 0.7 * u, 2.1 * u, 0.3 * u), new THREE.Vector3(side * 1.5 * u, 3.0 * u, -0.2 * u),
      new THREE.Vector3(side * 1.6 * u, 4.0 * u, -1.0 * u), new THREE.Vector3(side * 1.1 * u, 4.6 * u, -1.8 * u),
    ], 0.35 * u, 0.05 * u, 8);
    h.joints.head.add(horn.group);
    const wing = batWing(t, m.wing, m.demonDark, side, 0.45 * u);
    wing.position.set(side * 1.1 * u, 1.0 * u, -1.2 * u);
    wing.rotation.y = side * 0.5;
    h.joints.chest.add(wing);
  });
  const tail = taperedCurve(t, m.demonSkin, [
    new THREE.Vector3(0, 0, -1.3 * u), new THREE.Vector3(0, -1.5 * u, -3.5 * u), new THREE.Vector3(0.8 * u, -4 * u, -4.5 * u), new THREE.Vector3(2.2 * u, -6.5 * u, -3.5 * u),
  ], 0.4 * u, 0.12 * u, 10);
  const spade = t.outlined(new THREE.ConeGeometry(0.7 * u, 1.6 * u, 4), m.demonDark, 0.06 * u);
  spade.position.copy(tail.end);
  spade.rotation.z = Math.PI * 0.8;
  tail.group.add(spade);
  h.joints.pelvis.add(tail.group);
  return { h, u, tail: tail.group };
}

function pitchfork(t: Toon, m: FigureMaterials, u: number): THREE.Group {
  const g = new THREE.Group();
  const shaft = t.outlined(new THREE.CylinderGeometry(0.14 * u, 0.14 * u, 13 * u, 8), m.iron, 0.05 * u);
  shaft.position.y = -2.5 * u;
  g.add(shaft);
  const bar = t.outlined(new THREE.BoxGeometry(2.2 * u, 0.28 * u, 0.28 * u), m.iron, 0.05 * u);
  bar.position.y = -9 * u;
  g.add(bar);
  [-1, 0, 1].forEach((k) => {
    const prong = t.outlined(new THREE.ConeGeometry(0.16 * u, 2.2 * u, 8), m.iron, 0.04 * u);
    prong.position.set(k * 1 * u, -10.2 * u, 0);
    prong.rotation.x = Math.PI;
    g.add(prong);
  });
  return g;
}

/** A whip: a chain of joints from the hand that trails the swing. */
function whip(t: Toon, m: FigureMaterials, u: number) {
  const root = new THREE.Group();
  const joints: THREE.Group[] = [];
  let parent: THREE.Object3D = root;
  for (let i = 0; i < 12; i++) {
    const j = new THREE.Group();
    j.position.y = i === 0 ? -0.6 * u : -1.1 * u;
    parent.add(j);
    const seg = t.outlined(new THREE.CylinderGeometry(0.1 * u * (1 - i / 14), 0.12 * u * (1 - i / 14), 1.1 * u, 6), m.demonDark, 0.03 * u);
    seg.position.y = -0.55 * u;
    j.add(seg);
    joints.push(j);
    parent = j;
  }
  return { root, animate: (e: number, speed: number, offset: number) => joints.forEach((j, i) => { j.rotation.x = 0.35 * Math.sin(e * speed + offset - i * 0.45); }) };
}

function rockBase(t: Toon, m: FigureMaterials, salt: number, radius: number): THREE.Mesh {
  const rock = t.outlined(jaggedGeo(radius * 0.6, radius, radius * 0.9, salt, 0.18, 9), m.rock, 0.3);
  rock.position.y = -radius * 0.45;
  return rock;
}

function chain(from: THREE.Object3D, to: THREE.Vector3, owner: THREE.Object3D) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to.clone()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x1e1719 }));
  owner.add(line);
  const p = new THREE.Vector3();
  return () => {
    from.getWorldPosition(p);
    owner.worldToLocal(p);
    (geo.attributes.position as THREE.BufferAttribute).setXYZ(0, p.x, p.y, p.z);
    geo.attributes.position!.needsUpdate = true;
  };
}

/** A demon with a pitchfork or whip over souls kneeling in chains. */
export function tormentScene(t: Toon, m: FigureMaterials, salt: number, souls: number, facing: 1 | -1, weapon: 'pitchfork' | 'whip'): Scene {
  const group = new THREE.Group();
  group.add(rockBase(t, m, salt, 14));
  const d = demon(t, m);
  d.h.root.position.set(-facing * 6, 0, -1);
  d.h.root.rotation.y = facing * 0.9;
  group.add(d.h.root);
  const fork = weapon === 'pitchfork' ? pitchfork(t, m, d.u) : null;
  const lash = weapon === 'whip' ? whip(t, m, d.u) : null;
  if (fork) { fork.rotation.x = Math.PI / 2; d.h.joints.wristR.add(fork); }
  if (lash) d.h.joints.wristR.add(lash.root);
  const victims = Array.from({ length: souls }, (_, i) => {
    const s = soul(t, m);
    s.root.position.set(facing * (1.5 + i * 4.5), 0, 1.5 - i * 1.6);
    s.root.rotation.y = -facing * 0.6;
    group.add(s.root);
    const anchor = new THREE.Vector3(facing * (6 + i * 4.5), -1, -4);
    return { s, links: [chain(s.joints.wristL, anchor, group), chain(s.joints.wristR, anchor, group)], pose: i % 2 ? 'plead' : 'bound', offset: i * 1.7 + salt };
  });
  const speed = weapon === 'whip' ? 2.4 : 2.0;
  return {
    group,
    animate(e) {
      swing(d.h, weapon === 'whip' ? WHIP_A : JAB_A, weapon === 'whip' ? WHIP_B : JAB_B, e, speed, salt, weapon === 'whip' ? 3 : 2);
      lash?.animate(e, speed, salt);
      d.tail.rotation.y = 0.3 * Math.sin(e * 1.4 + salt);
      victims.forEach(({ s, links, pose, offset }) => {
        if (pose === 'bound') swing(s, KNEEL_BOUND, { ...KNEEL_BOUND, spine: [0.45, 0.2, 0], jaw: [0.6, 0, 0], neck: [-0.4, 0, 0] }, e, speed, offset + salt);
        else swing(s, KNEEL_PLEAD, COWER_B, e, 1.3, offset);
        links.forEach((l) => l());
      });
    },
  };
}

/** Souls boiling in a cauldron while a demon stirs it. */
export function cauldronScene(t: Toon, m: FigureMaterials, salt: number): Scene {
  const group = new THREE.Group();
  group.add(rockBase(t, m, salt, 16));
  const pot = t.outlined(new THREE.SphereGeometry(7, 28, 18, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), m.iron, 0.25);
  pot.position.y = 6.4;
  group.add(pot);
  const lip = t.outlined(new THREE.TorusGeometry(6.2, 0.6, 10, 32), m.iron, 0.12);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 10.4;
  group.add(lip);
  const brew = new THREE.Mesh(new THREE.CircleGeometry(6, 28), m.molten);
  brew.rotation.x = -Math.PI / 2;
  brew.position.y = 10;
  group.add(brew);
  const souls = [-3, 0, 3].map((x, i) => {
    const s = soul(t, m, FIGURE_HEIGHT * 0.9);
    s.root.position.set(x, 3 + (i % 2) * 0.8, -0.5 + i * 0.4);
    s.root.rotation.y = (i - 1) * 0.5;
    group.add(s.root);
    return { s, offset: i * 2.1 + salt };
  });
  const d = demon(t, m);
  d.h.root.position.set(9, 0, -2);
  d.h.root.rotation.y = -1.2;
  const fork = pitchfork(t, m, d.u);
  fork.rotation.x = Math.PI / 2.4;
  d.h.joints.wristR.add(fork);
  group.add(d.h.root);
  return {
    group,
    animate(e) {
      souls.forEach(({ s, offset }) => {
        swing(s, SCREAM_A, SCREAM_B, e, 2.6, offset);
        s.root.position.y = 3 + Math.sin(e * 1.7 + offset) * 0.6;
      });
      swing(d.h, STIR_A, STIR_B, e, 1.2, salt);
      d.tail.rotation.y = 0.3 * Math.sin(e * 1.1 + salt);
    },
  };
}

/** A soul gripping the bars of a cage that swings on a chain over the lava. */
export function hangingCage(t: Toon, m: FigureMaterials, chainLength: number, rand: Rand): Scene {
  const group = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -chainLength, 0)]),
    new THREE.LineBasicMaterial({ color: 0x1e1719 }));
  group.add(line);
  const cage = new THREE.Group();
  cage.position.y = -chainLength - 7;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const bar = t.outlined(new THREE.CylinderGeometry(0.16, 0.16, 14, 6), m.iron, 0.05);
    bar.position.set(Math.cos(a) * 4, 0, Math.sin(a) * 4);
    cage.add(bar);
  }
  [-7, 7].forEach((y) => {
    const ring = t.outlined(new THREE.TorusGeometry(4, 0.3, 6, 20), m.iron, 0.06);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    cage.add(ring);
  });
  const cap = t.outlined(new THREE.ConeGeometry(4.4, 2.6, 20), m.iron, 0.1);
  cap.position.y = 8.3;
  cage.add(cap);
  const s = soul(t, m, FIGURE_HEIGHT * 0.95);
  s.root.position.y = -6.8;
  cage.add(s.root);
  group.add(cage);
  const phase = rand() * 6;
  return {
    group,
    animate(e) {
      group.rotation.z = Math.sin(e * 0.9 + phase) * 0.12;
      group.rotation.y = Math.sin(e * 0.4 + phase) * 0.3;
      swing(s, HANG_A, HANG_B, e, 1.8, phase);
    },
  };
}
