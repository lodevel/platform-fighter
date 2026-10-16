import * as THREE from 'three';
import type { WindZoneHazard } from '../../../../src/entities/WindZoneHazard';
import { toWorldLength, toWorldX, toWorldY } from '../../engine/space';
import { seededRand } from '../kit/toonKit';
import { outlineRect } from '../outline';

/**
 * Wind zones on the gameplay plane, the same for every theme. Zones that
 * cover the same rectangle act together on a fighter (the sim adds every
 * active zone's force), so they are drawn as one area showing their net
 * force: streak speed and density follow the real push, calm means no push.
 */
export interface WindZonesView {
  readonly group: THREE.Group;
  /** Collision-overlay outlines (debug / acceptance). */
  readonly outlines: THREE.Group;
  /** Net horizontal force of the strongest area, -1..1 of its peak, for theme decor. */
  update(dt: number): number;
}

const STREAKS = 140;

export function createWindZones(zones: ReadonlyArray<WindZoneHazard>): WindZonesView {
  const group = new THREE.Group();
  const outlines = new THREE.Group();
  const areas = new Map<string, WindZoneHazard[]>();
  for (const z of zones) {
    const b = z.getBounds();
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    areas.set(key, [...(areas.get(key) ?? []), z]);
  }
  const rand = seededRand(77);

  const views = [...areas.values()].map((members) => {
    const b = members[0]!.getBounds();
    const w = toWorldLength(b.width), h = toWorldLength(b.height);
    const cx = toWorldX(b.x), cy = toWorldY(b.y);
    const peak = Math.max(...members.map((m) => Math.abs(m.getPeakForceX())), 1e-6);
    // Streaks: short horizontal dashes drifting with the net force.
    const pos = new Float32Array(STREAKS * 6);
    const seeds = Array.from({ length: STREAKS }, () => ({ x: rand(), y: rand(), len: 1.5 + rand() * 4, speed: 0.6 + rand() * 0.8 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    group.add(lines);
    // The real area, faintly framed while it pushes.
    const frameGeo = new THREE.BufferGeometry().setFromPoints(
      [[-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]].map(([x, y]) => new THREE.Vector3(cx + (x! * w) / 2, cy + (y! * h) / 2, 0.5)));
    const frameMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 2, transparent: true, opacity: 0, depthTest: false });
    const frame = new THREE.Line(frameGeo, frameMat);
    frame.computeLineDistances();
    group.add(frame);
    const outline = outlineRect(w, h, 0x9fe0ff);
    outline.position.set(cx, cy + h / 2, 0);
    outlines.add(outline);

    let shown = 0;
    return (dt: number): number => {
      const net = members.reduce((sum, m) => sum + (m.isActive() ? m.getCurrentForce().x : 0), 0);
      const strength = Math.min(1, Math.abs(net) / peak);
      // Ease the look so a single-frame push still reads, then fades.
      shown = Math.max(strength, shown - dt * 2.5);
      mat.opacity = 0.75 * shown;
      frameMat.opacity = 0.35 * shown;
      const dir = Math.sign(net) || 1;
      seeds.forEach((s, i) => {
        s.x = (s.x + dir * s.speed * shown * dt * 0.9 + 1) % 1;
        const x = cx - w / 2 + s.x * w, y = cy - h / 2 + s.y * h;
        pos.set([x, y, 0.5, x - dir * s.len * (0.4 + shown), y, 0.5], i * 6);
      });
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      return (net / peak) * Math.min(1, shown / Math.max(strength, 1e-6));
    };
  });

  return {
    group, outlines,
    update(dt) {
      let strongest = 0;
      for (const step of views) {
        const v = step(dt);
        if (Math.abs(v) > Math.abs(strongest)) strongest = v;
      }
      return strongest;
    },
  };
}
