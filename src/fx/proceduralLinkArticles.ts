/** Renderer-neutral code art for Link articles without painted sheets.
 * Coordinates are local design pixels; bomb root is its bottom and beam
 * root is its real damage area's centre. Sizes never feed gameplay. */
export type LinkArticleShape =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly radius: number; readonly fill: number; readonly alpha?: number; readonly stroke?: number; readonly strokeWidth?: number }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fill: number; readonly alpha?: number }
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly width: number; readonly fill: number; readonly alpha?: number };

/** Blue Sheikah sphere, bright glass, metal cap and cyan seams. */
export function remoteBombShapes(): readonly LinkArticleShape[] {
  return [
    { kind: 'circle', x: 0, y: -10, radius: 10, fill: 0x13254c, stroke: 0x08172c, strokeWidth: 1.5 },
    { kind: 'circle', x: -.7, y: -10.7, radius: 8.6, fill: 0x2f64c9 },
    { kind: 'circle', x: 2, y: -8.5, radius: 6.3, fill: 0x204b9c },
    { kind: 'line', x1: -8, y1: -12, x2: 8, y2: -12, width: 1.2, fill: 0x69eaff },
    { kind: 'line', x1: -6, y1: -5, x2: 6, y2: -5, width: 1, fill: 0x69eaff, alpha: .85 },
    { kind: 'circle', x: 0, y: -10, radius: 3.6, fill: 0x18487a, stroke: 0x80edff, strokeWidth: 1 },
    { kind: 'circle', x: 0, y: -10, radius: 1.4, fill: 0xd4fbff },
    { kind: 'circle', x: -3.5, y: -14, radius: 2.8, fill: 0xd5eaff, alpha: .85 },
    { kind: 'rect', x: 0, y: -20.5, width: 7, height: 4, fill: 0x17233a },
    { kind: 'rect', x: -.4, y: -21, width: 5.5, height: 2.7, fill: 0xc6d9e7 },
    { kind: 'line', x1: -1.4, y1: -22, x2: 1.4, y2: -22, width: .8, fill: 0xf1fbff },
  ];
}

/** Luminous energy capsule and fast streaks, contained by the real extents. */
export function swordBeamShapes(width: number, height: number, facing: 1 | -1, frame: number): readonly LinkArticleShape[] {
  const radius = Math.min(width / 2, height / 2), half = Math.max(0, width / 2 - radius);
  const shapes: LinkArticleShape[] = [];
  const capsule = (r: number, fill: number, alpha: number) => {
    shapes.push({ kind: 'rect', x: 0, y: 0, width: half * 2, height: r * 2, fill, alpha },
      { kind: 'circle', x: -half, y: 0, radius: r, fill, alpha },
      { kind: 'circle', x: half, y: 0, radius: r, fill, alpha });
  };
  capsule(radius, 0x38cfff, .32);
  capsule(radius * .68, 0x83f6ff, .82);
  capsule(radius * .28, 0xf0ffff, 1);
  for (const sign of [-1, 1]) shapes.push({ kind: 'line', x1: -facing * half * .94, y1: sign * radius * .6,
    x2: facing * half * (.35 + .1 * Math.sin(frame * .5)), y2: sign * radius * .35,
    width: Math.max(.7, radius * .07), fill: 0xd9ffff, alpha: .85 });
  return shapes;
}
