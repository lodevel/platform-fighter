import reviewedFrames from '../../assets/characters/pikachu/frames.json';

/** Reviewed strips keep source canvas registration; never fit each pose to its
 * opaque bounding box. A square padded special is taller than ordinary normals.
 */
export interface PikachuSheetRenderMetrics {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly rootX: number;
  readonly rootY: number;
  readonly originX: number;
  readonly originY: number;
  readonly scaleToWorld: number;
  readonly bodyCentreFromRootY: number;
}
export function getPikachuSheetRenderMetrics(sheet: string): PikachuSheetRenderMetrics {
  const animation = (reviewedFrames.animations as Record<string, {
    frameWidth: number; frameHeight: number; root?: number[]; scaleToWorld?: number;
  }>)[sheet === 'tilt' ? 'ftilt' : sheet];
  // Effect strips (e.g. the Final Smash electricity) carry no root/scale: they use the padded fallback below.
  if (animation?.root && animation.scaleToWorld !== undefined) return { frameWidth: animation.frameWidth, frameHeight: animation.frameHeight,
    rootX: animation.root[0]!, rootY: animation.root[1]!, originX: animation.root[0]! / animation.frameWidth,
    originY: animation.root[1]! / animation.frameHeight, scaleToWorld: animation.scaleToWorld,
    bodyCentreFromRootY: -25 };
  const padded = sheet === 'fair' || sheet.startsWith('tilt') || /^(neutral_special|side_special|up_special|down_special|walk|run|jump|fall|crouch|shield|dodge|roll|air_dodge|grab|pummel|[fbud]throw|ledge|getup|trip|hurt)/.test(sheet);
  const frameWidth = 512, frameHeight = sheet === 'fair' ? 528 : padded ? 512 : 384;
  const rootX = 256, rootY = padded ? 416 : 288;
  return { frameWidth, frameHeight, rootX, rootY, originX: rootX / frameWidth,
    originY: rootY / frameHeight, scaleToWorld: 4 * 70 / 600,
    bodyCentreFromRootY: -25 };
}

/** Shared pose/receiving normalization for actually accepted ordinary strips.
 * The input is an observed simulation/status clock, never rendering wall time.
 * Native endpoints retained after an action do not extend its playable windows.
 */
export function getPikachuReviewedStateClock(sheet: string, elapsed: number): {
  readonly localFrame: number; readonly artFrameIndex: number; readonly frameCount: number;
} | null {
  const clip = (reviewedFrames.animations as Record<string, {
    frameCount: number; loopDuration?: number | null;
    frameWindows?: Array<{ startFrame: number; endFrame: number | null; artFrameIndex: number }>;
  }>)[sheet];
  if (!clip?.frameWindows?.length) return null;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error(`Invalid Pikachu ${sheet} source clock`);
  const windows = clip.frameWindows;
  const end = windows[windows.length - 1]!.endFrame;
  const localFrame = clip.loopDuration ? elapsed % clip.loopDuration
    : end === null ? elapsed : Math.min(elapsed, end - 1);
  const pose = windows.find(row => row.startFrame <= localFrame && (row.endFrame === null || localFrame < row.endFrame));
  if (!pose) throw new Error(`Reviewed Pikachu ${sheet} lacks drawing at action frame ${localFrame}`);
  return { localFrame, artFrameIndex: pose.artFrameIndex, frameCount: clip.frameCount };
}
