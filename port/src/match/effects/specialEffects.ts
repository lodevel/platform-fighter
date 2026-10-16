import type { ShapeLayer } from '../../engine/shapes/shapeLayer';

/** Original Pikachu effect presentation from its simulation-owned objects. */
export function drawSpecialEffects(layer: ShapeLayer, effects: readonly { kind: string; x: number; y: number; age: number }[]): void {
  const polyline = (points: readonly { x: number; y: number }[], width: number, color: number, alpha = 1) => {
    for (let i = 1; i < points.length; i++) layer.line({ x1: points[i - 1]!.x, y1: points[i - 1]!.y,
      x2: points[i]!.x, y2: points[i]!.y, width, color, alpha });
  };
  for (const effect of effects) {
    const { x, y, age } = effect;
    if (effect.kind === 'footstoolStep') {
      const radius = 8 + age * 3;
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        layer.line({ x1: x + Math.cos(angle) * radius, y1: y + Math.sin(angle) * radius * .5,
          x2: x + Math.cos(angle) * (radius + 5), y2: y + Math.sin(angle) * (radius + 5) * .5,
          width: 2, color: 0xffffff, alpha: Math.max(0, 1 - age / 6) });
      }
    } else if (effect.kind === 'cloud') {
      for (const [dx, dy, radius] of [[-36, 0, 27], [-12, -13, 34], [22, -8, 29], [43, 4, 22]])
        layer.circle({ x: x + dx!, y: y + dy!, radius: radius!, fill: 0x465266, fillAlpha: .92 });
    } else if (effect.kind === 'bolt') {
      const points = Array.from({ length: 7 }, (_, i) => ({ x: x + (i % 2 ? 11 : -8), y: y - 72 + i * 12 }));
      polyline(points, 10, 0x60adff, .3); polyline(points, 5, 0xffec72); polyline(points, 2, 0xffffff);
    } else if (effect.kind === 'burst') {
      const radius = 65 * Math.max(.4, 1 - age / 14);
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5;
        polyline([{ x: x + Math.cos(a) * radius * .3, y: y + Math.sin(a) * radius * .3 },
          { x: x + Math.cos(a + .13) * radius * .65, y: y + Math.sin(a + .13) * radius * .65 },
          { x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius }], 4, 0xffef72, Math.max(0, 1 - age / 12));
      }
    } else if (effect.kind === 'quickAttackTrail') {
      layer.circle({ x, y, radius: 15, fill: 0x8aceff, fillAlpha: .25 * Math.max(0, 1 - age / 6) });
    } else polyline([{ x: x - 14, y: y + 7 }, { x: x - 4, y: y - 10 }, { x: x + 2, y: y + 8 }, { x: x + 13, y: y - 8 }], 3, 0xffeb6e);
  }
}
