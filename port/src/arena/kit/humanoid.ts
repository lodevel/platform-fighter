import * as THREE from 'three';
import type { Toon } from './props';

/**
 * A jointed toon humanoid for background figures. Every limb hangs from a
 * joint (`THREE.Group`) so poses are joint rotations; geometry is smooth
 * (lathe torso, tapered limbs, rounded joints) with toon outlines on the
 * large parts. Units: world units, standing height ≈ `height`, feet at y = 0.
 */
export interface HumanoidMaterials {
  readonly skin: THREE.Material;
  /** Mouth, eye sockets, nails. */
  readonly dark: THREE.Material;
  /** Eye whites or glowing eyes. */
  readonly eyes: THREE.Material;
  /** Optional cloth (loincloth / rags). */
  readonly cloth?: THREE.Material;
}

export interface HumanoidBuild {
  readonly height: number;
  /** 0.7 gaunt … 1.4 brawny. */
  readonly bulk: number;
  /** Hooves instead of feet, claws instead of fingers. */
  readonly beast?: boolean;
}

export type JointName = 'pelvis' | 'spine' | 'chest' | 'neck' | 'head' | 'jaw'
  | 'shoulderL' | 'elbowL' | 'wristL' | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL' | 'hipR' | 'kneeR' | 'ankleR';

export interface Humanoid {
  readonly root: THREE.Group;
  readonly joints: Readonly<Record<JointName, THREE.Group>>;
}

/** Rotations (radians, x/y/z) per joint; unspecified joints keep rest pose. */
export type Pose = Partial<Record<JointName, readonly [number, number, number]>>;

export function applyPose(h: Humanoid, pose: Pose): void {
  for (const [name, r] of Object.entries(pose) as Array<[JointName, readonly [number, number, number]]>) h.joints[name].rotation.set(r[0], r[1], r[2]);
}

/** Blend two poses (t = 0 → a, 1 → b); joints missing on one side use 0. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<JointName>) {
    const ra = a[name] ?? [0, 0, 0], rb = b[name] ?? [0, 0, 0];
    out[name] = [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t];
  }
  return out;
}

export function buildHumanoid(t: Toon, m: HumanoidMaterials, build: HumanoidBuild): Humanoid {
  const u = build.height / 18; // proportions authored for an 18-unit figure
  const k = build.bulk;
  const joint = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x * u, y * u, z * u);
    parent.add(g);
    return g;
  };
  /** Tapered limb hanging down from its joint, with a rounded cap at the far end. */
  const limb = (parent: THREE.Object3D, rTop: number, rBottom: number, length: number, mat: THREE.Material, outline = 0.12) => {
    const geo = new THREE.CylinderGeometry(rTop * u * k, rBottom * u * k, length * u, 14, 3);
    geo.translate(0, -length * u / 2, 0);
    parent.add(t.outlined(geo, mat, outline * u));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(rBottom * u * k, 12, 10), mat);
    cap.position.y = -length * u;
    parent.add(cap);
  };

  const root = new THREE.Group();
  const pelvis = joint(root, 0, 9.4);
  // Hips: a squashed sphere.
  const hipGeo = new THREE.SphereGeometry(1.9 * u * k, 18, 12);
  hipGeo.scale(1.05, 0.75, 0.72);
  pelvis.add(t.outlined(hipGeo, m.cloth ?? m.skin, 0.12 * u));

  const spine = joint(pelvis, 0, 0.6);
  // Torso: lathe profile, waist to shoulders, deeper chest for bulky builds.
  const profile = [
    [1.55, 0], [1.4, 1.2], [1.5, 2.4], [1.8 + 0.25 * k, 3.6], [1.95 + 0.35 * k, 4.6], [1.75 + 0.3 * k, 5.4], [1.1, 5.9], [0.45, 6.1],
  ].map(([r, y]) => new THREE.Vector2(r! * u * k, y! * u));
  const torsoGeo = new THREE.LatheGeometry(profile, 22);
  torsoGeo.scale(1, 1, 0.72);
  spine.add(t.outlined(torsoGeo, m.skin, 0.14 * u));
  const chest = joint(spine, 0, 4.4);
  if (k < 0.9) {
    // Gaunt: ribs show as dark bands.
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry((1.55 - i * 0.08) * u * k, 0.07 * u, 6, 20, Math.PI), m.dark);
      rib.rotation.set(Math.PI / 2, 0, 0);
      rib.scale.set(1, 0.72, 1);
      rib.position.set(0, (-0.4 - i * 0.55) * u, 0.05 * u);
      chest.add(rib);
    }
  }
  const neck = joint(chest, 0, 1.5);
  const neckGeo = new THREE.CylinderGeometry(0.42 * u * k, 0.55 * u * k, 1.2 * u, 12);
  neckGeo.translate(0, 0.5 * u, 0);
  neck.add(t.outlined(neckGeo, m.skin, 0.1 * u));
  const head = joint(neck, 0, 1.0);
  const skullGeo = new THREE.SphereGeometry(1.25 * u, 24, 18);
  skullGeo.scale(0.92, 1.08, 1);
  skullGeo.translate(0, 1.15 * u, 0);
  head.add(t.outlined(skullGeo, m.skin, 0.12 * u));
  [-1, 1].forEach((s) => {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.3 * u, 12, 10), m.dark);
    socket.scale.set(1.2, 0.85, 0.5);
    socket.position.set(s * 0.45 * u, 1.35 * u, 1.08 * u);
    head.add(socket);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14 * u, 10, 8), m.eyes);
    eye.position.set(s * 0.45 * u, 1.35 * u, 1.2 * u);
    head.add(eye);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.28 * u, 10, 8), m.skin);
    ear.scale.set(0.45, build.beast ? 1.6 : 1, 0.8);
    ear.position.set(s * 1.13 * u, 1.25 * u, 0);
    if (build.beast) ear.rotation.z = -s * 0.5;
    head.add(ear);
  });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2 * u, 0.55 * u, 10), m.skin);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.05 * u, 1.3 * u);
  head.add(nose);
  // Jaw hinge: an open mouth is a dark cavity behind a hinged chin.
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.42 * u, 14, 10), m.dark);
  mouth.scale.set(1, 0.8, 0.5);
  mouth.position.set(0, 0.45 * u, 0.95 * u);
  head.add(mouth);
  const jaw = joint(head, 0, 0.55, 0.2);
  const chinGeo = new THREE.SphereGeometry(0.75 * u, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  chinGeo.scale(1, 0.7, 1.05);
  jaw.add(t.outlined(chinGeo, m.skin, 0.08 * u));

  const arm = (side: 1 | -1) => {
    const shoulder = joint(chest, side * (1.9 + 0.35 * k), 0.9);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62 * u * k, 14, 10), m.skin);
    shoulder.add(ball);
    limb(shoulder, 0.55, 0.42, 3.3, m.skin);
    const elbow = joint(shoulder, 0, -3.3);
    limb(elbow, 0.42, 0.32, 3.0, m.skin);
    const wrist = joint(elbow, 0, -3.0);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.75 * u, 0.85 * u, 0.32 * u), m.skin);
    palm.position.y = -0.45 * u;
    wrist.add(palm);
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Mesh(build.beast ? new THREE.ConeGeometry(0.1 * u, 0.9 * u, 6) : new THREE.CapsuleGeometry(0.08 * u, 0.6 * u, 2, 6),
        build.beast ? m.dark : m.skin);
      finger.position.set((f - 1.5) * 0.18 * u, -1.15 * u, 0);
      if (build.beast) finger.rotation.x = Math.PI;
      wrist.add(finger);
    }
    return { shoulder, elbow, wrist };
  };
  const leg = (side: 1 | -1) => {
    const hip = joint(pelvis, side * 1.0, -0.4);
    limb(hip, 0.75, 0.52, 4.2, m.skin);
    const knee = joint(hip, 0, -4.2);
    limb(knee, 0.5, 0.36, 4.0, m.skin);
    const ankle = joint(knee, 0, -4.0);
    const foot = new THREE.Mesh(build.beast ? new THREE.CylinderGeometry(0.42 * u, 0.55 * u, 0.6 * u, 10) : new THREE.BoxGeometry(0.6 * u, 0.4 * u, 1.4 * u),
      build.beast ? m.dark : m.skin);
    foot.position.set(0, -0.3 * u, build.beast ? 0 : 0.4 * u);
    ankle.add(foot);
    return { hip, knee, ankle };
  };
  const [aL, aR, lL, lR] = [arm(-1), arm(1), leg(-1), leg(1)];
  if (m.cloth) {
    const rag = t.outlined(new THREE.CylinderGeometry(1.7 * u * k, 2.2 * u * k, 2.2 * u, 14, 1, true), m.cloth, 0.08 * u);
    rag.position.y = -1.3 * u;
    pelvis.add(rag);
  }
  root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return {
    root,
    joints: {
      pelvis, spine, chest, neck, head, jaw,
      shoulderL: aL.shoulder, elbowL: aL.elbow, wristL: aL.wrist, shoulderR: aR.shoulder, elbowR: aR.elbow, wristR: aR.wrist,
      hipL: lL.hip, kneeL: lL.knee, ankleL: lL.ankle, hipR: lR.hip, kneeR: lR.knee, ankleR: lR.ankle,
    },
  };
}
