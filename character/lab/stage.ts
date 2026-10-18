import type { CharacterPackage, Drawing } from '../package/types';
import type { DisplayPose, Facing } from '../evaluator/evaluate';

export interface StageView {
  /** Screen pixels per design pixel: 1.4 is the closest match camera on a 1920×1080 screen. */
  readonly zoom: number;
  readonly facing: Facing;
  readonly overlays: { readonly root: boolean; readonly sockets: boolean; readonly bounds: boolean };
}

/** A drawing's pixels: the `rect` of `image` (its page, or a recoloured copy). */
export interface DrawingPixels { readonly image: CanvasImageSource; readonly rect: readonly [number, number, number, number] }

export interface StageColors { readonly stage: string; readonly floor: string; readonly root: string; readonly socket: string; readonly bounds: string }

/** Draws one pose at real match size, the root on the floor line at the stage centre. */
export function drawStage(canvas: HTMLCanvasElement, pkg: CharacterPackage, pose: DisplayPose,
  pixels: (drawing: Drawing) => DrawingPixels | undefined, view: StageView, colors: StageColors): void {
  const ratio = devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = colors.stage; ctx.fillRect(0, 0, width, height);
  const root = { x: width / 2, y: Math.round(height * 0.8) };
  ctx.fillStyle = colors.floor; ctx.fillRect(0, root.y, width, 2);

  const drawing = pose.drawing === null ? undefined : pkg.drawings[pose.drawing];
  const scale = drawing ? drawing.scale * view.zoom : 0;
  if (drawing) {
    const source = pixels(drawing), [, , rw, rh] = drawing.rect;
    ctx.save();
    ctx.translate(root.x, root.y); ctx.scale(view.facing, 1);
    if (source) ctx.drawImage(source.image, ...source.rect, -drawing.anchor[0] * scale, -drawing.anchor[1] * scale, rw * scale, rh * scale);
    if (view.overlays.bounds) {
      ctx.strokeStyle = colors.bounds; ctx.lineWidth = 1;
      ctx.strokeRect(-drawing.anchor[0] * scale, -drawing.anchor[1] * scale, rw * scale, rh * scale);
    }
    ctx.restore();
  }

  const bodyCentre = { x: root.x, y: root.y + pose.bodyCentreFromRootY * view.zoom };
  if (view.overlays.root) {
    cross(ctx, root, colors.root, 8);
    ctx.fillStyle = colors.root; ctx.beginPath(); ctx.arc(bodyCentre.x, bodyCentre.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (view.overlays.sockets) for (const socket of Object.values(pose.sockets)) {
    const origin = socket.space === 'root' ? root : bodyCentre;
    const at = { x: origin.x + socket.x * view.zoom, y: origin.y + socket.y * view.zoom };
    ctx.strokeStyle = colors.socket; ctx.fillStyle = colors.socket; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(at.x, at.y, 4, 0, Math.PI * 2); ctx.fill();
    if (socket.angle !== undefined) {
      const radians = socket.angle * Math.PI / 180, length = 40 * view.zoom * (socket.length ?? 1);
      ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + Math.sin(radians) * length, at.y - Math.cos(radians) * length); ctx.stroke();
    }
  }
}

function cross(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, color: string, size: number): void {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(at.x - size, at.y); ctx.lineTo(at.x + size, at.y); ctx.moveTo(at.x, at.y - size); ctx.lineTo(at.x, at.y + size);
  ctx.stroke();
}
