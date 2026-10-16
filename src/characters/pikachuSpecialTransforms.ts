/** Guarded d01specials native Rot identity matrix and all12 receiving-node
 * ancestries: sources/posed-resources/special-slope-rot-pivot.json. The joint
 * rotates about its body-relative pivot, not the art's fixed foot root. */
import type { Hurtbox } from './moveSchema';

export const PIKACHU_SPECIAL_ROT_PIVOT = { x: 0, y: 0.2500009536743164 } as const;
/** Guarded d02specialairhi Rot identity/ancestry, all native0..5 samples:
 * sources/full-body-native-review/specials/quick-warp-rotation-pivot-review.json. */
export const PIKACHU_QUICK_ROT_PIVOT = { x: -4.682244956493378, y: -2.0922493934631348 } as const;

export function rotatePikachuSpecialPoint(point: { x: number; y: number },
  worldRotation: number, facing: 1 | -1, pivot: { x: number; y: number } = PIKACHU_SPECIAL_ROT_PIVOT) {
  const pivotX = pivot.x * facing;
  const x = point.x * facing - pivotX;
  const y = point.y - pivot.y;
  const cos = Math.cos(worldRotation), sin = Math.sin(worldRotation);
  return { x: (pivotX + x * cos - y * sin) * facing,
    y: pivot.y + x * sin + y * cos };
}

export function rotatePikachuSpecialHurtboxes(boxes: readonly Hurtbox[], rotation: number, facing: 1 | -1,
  pivot: { x: number; y: number } = PIKACHU_SPECIAL_ROT_PIVOT): readonly Hurtbox[] {
  return boxes.map(box => {
    if (!box.capsule) return box;
    const start = rotatePikachuSpecialPoint(box.capsule.start, rotation, facing, pivot);
    const end = rotatePikachuSpecialPoint(box.capsule.end, rotation, facing, pivot);
    return { ...box, offsetX: (start.x + end.x) / 2, offsetY: (start.y + end.y) / 2,
      width: Math.abs(start.x - end.x) + box.capsule.radius * 2,
      height: Math.abs(start.y - end.y) + box.capsule.radius * 2,
      capsule: { ...box.capsule, start, end } };
  });
}
