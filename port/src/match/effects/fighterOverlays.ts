import { computeChargeIndicatorVisual } from '../../../../src/ui/chargeIndicatorFormat';
import { computeShieldBubbleVisual } from '../../../../src/ui/shieldBubbleFormat';
import type { ShapeLayer } from '../../engine/shapes/shapeLayer';
import type { FighterView } from '../../../../src/sim/view';

/** The radius MatchScene gives both formatters: half the larger body side. */
const bodyRadius = (f: FighterView) => Math.max(f.body.width, f.body.height) / 2;

/** A fighter's shield bubble, as the game's `computeShieldBubbleVisual` describes it. */
export function drawShieldBubble(shapes: ShapeLayer, f: FighterView, frame: number): void {
  if (!f.shield) return;
  const v = computeShieldBubbleVisual({ state: f.shield.state, maxHealth: f.shield.maxHealth, bodyRadius: bodyRadius(f), frame, parry: f.shield.parry, activeRadius: f.shield.activeRadius });
  if (!v.visible) return;
  shapes.circle({
    x: f.shield.centre?.x ?? f.position.x, y: f.shield.centre?.y ?? f.position.y, radius: v.radius,
    fill: v.fillColor, fillAlpha: v.fillAlpha, stroke: v.strokeColor, strokeAlpha: v.strokeAlpha, strokeWidth: v.strokeWidth,
  });
}

/**
 * A fighter's smash-charge bar above the head, as the game's ChargeIndicator
 * applies `computeChargeIndicatorVisual` (bar only, track 0x101014; the
 * labelled readout of `chargeReadout.ts` comes with step 6).
 */
export function drawChargeIndicator(shapes: ShapeLayer, f: FighterView, frame: number): void {
  const v = computeChargeIndicatorVisual({ chargeProgress: f.chargeProgress, frame, bodyRadius: bodyRadius(f), bodyHeight: f.body.height });
  if (!v.visible) return;
  const { x, y } = f.position;
  const barY = y + v.barCenterOffsetY;
  shapes.rect({ x, y: barY, width: Math.max(1, v.barMaxWidth), height: Math.max(1, v.barHeight), color: 0x101014, alpha: v.barTrackAlpha });
  // The fill grows rightward from the track's left edge.
  shapes.rect({ x: x - v.barMaxWidth / 2 + v.barFillWidth / 2, y: barY, width: v.barFillWidth, height: Math.max(1, v.barHeight), color: v.barColor, alpha: v.barFillAlpha });
}
