import * as THREE from 'three';
import { PX_PER_UNIT } from '../space';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../../src/stages/stageDefinitions';
import { frameRect } from '../../../../src/assets/packedFrames';
import type { TextureStore } from './textureStore';
import type { ManagedGeometry } from '../presentation/submission';

/**
 * One sprite to draw this frame, in the terms of a Phaser `Sprite` so the
 * game's presentation code can drive it field for field. Positions are
 * design pixels (y down); `rotation` is radians, clockwise on screen.
 */
export interface SpriteDraw {
  readonly key: string;
  readonly frame?: number;
  readonly x: number;
  readonly y: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** On-screen size in design px (Phaser's setDisplaySize); overrides the scales. */
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly rotation?: number;
  readonly alpha?: number;
  /** Multiply tint, 0xRRGGBB. */
  readonly tint?: number;
  /** Phaser's ADD blend mode (light that adds up); default covers like NORMAL. */
  readonly blend?: 'normal' | 'add';
  /** Colour regions to shift (alternate costumes), applied before the tint. */
  readonly recolor?: ReadonlyArray<HsvShift>;
  readonly depth?: number;
  /** Visible rows in the logical frame (before origin/flip), for native shooting body layers. */
  readonly clipRows?: { readonly top?: number; readonly bottom?: number };
}

/**
 * Shift one colour region of a sprite, keeping its shading: pixels near
 * `key` (HSV, each 0..1) have their hue rotated by `hueShift` and their
 * saturation and value multiplied by the ratios. Nearness is a per-channel
 * distance scaled by `tolerance` (hue, saturation, value), with a soft edge
 * so anti-aliased pixels blend. Each pixel follows its nearest key only.
 */
export interface HsvShift {
  readonly key: readonly [number, number, number];
  readonly hueShift: number;
  readonly saturationRatio: number;
  readonly valueRatio: number;
  readonly tolerance: readonly [number, number, number];
}
export const MAX_RECOLOR_REGIONS = 4;

const VERT = `
  uniform vec4 uvRect;
  varying vec2 vUv;
  void main() {
    vUv = vec2(uvRect.x + uv.x * uvRect.z, uvRect.y + uv.y * uvRect.w);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// Phaser's multi pipeline: premultiplied texel * (tint * alpha, alpha).
// With no recolour regions the texel is untouched, so parity with Phaser holds.
const FRAG = `
  #define REGIONS ${MAX_RECOLOR_REGIONS}
  uniform sampler2D map;
  uniform vec3 tint;
  uniform float alpha;
  uniform int recolorCount;
  uniform vec3 recolorKey[REGIONS];
  uniform vec3 recolorShift[REGIONS];
  uniform vec3 recolorTolerance[REGIONS];
  varying vec2 vUv;
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  vec4 recolor(vec4 texel) {
    if (recolorCount == 0 || texel.a <= 0.0) return texel;
    vec3 hsv = rgb2hsv(texel.rgb / texel.a);
    float best = 1e9;
    int pick = -1;
    for (int i = 0; i < REGIONS; i++) {
      if (i >= recolorCount) break;
      vec3 d = abs(hsv - recolorKey[i]);
      d.x = min(d.x, 1.0 - d.x);
      float dist = length(d / recolorTolerance[i]);
      if (dist < best) { best = dist; pick = i; }
    }
    if (pick < 0 || best >= 1.0) return texel;
    vec3 shift = vec3(0.0);
    for (int i = 0; i < REGIONS; i++) if (i == pick) shift = recolorShift[i];
    vec3 moved = vec3(fract(hsv.x + shift.x), clamp(hsv.y * shift.y, 0.0, 1.0), clamp(hsv.z * shift.z, 0.0, 1.0));
    vec3 rgb = mix(texel.rgb / texel.a, hsv2rgb(moved), 1.0 - smoothstep(0.6, 1.0, best));
    return vec4(rgb * texel.a, texel.a);
  }
  void main() {
    gl_FragColor = recolor(texture2D(map, vUv)) * vec4(tint * alpha, alpha);
  }`;

/** Unit quad: x right, y down from the frame's top-left, like a Phaser frame box. */
function frameQuad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

interface Slot {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly uniforms: ReturnType<typeof slotUniforms>;
}

function slotUniforms() {
  const vecs = () => Array.from({ length: MAX_RECOLOR_REGIONS }, () => new THREE.Vector3());
  return {
    map: { value: null as THREE.Texture | null }, uvRect: { value: new THREE.Vector4() }, tint: { value: new THREE.Color() }, alpha: { value: 1 },
    recolorCount: { value: 0 }, recolorKey: { value: vecs() }, recolorShift: { value: vecs() }, recolorTolerance: { value: vecs() },
  };
}

/**
 * Three.js stand-in for Phaser's sprite display list. Each frame the caller
 * submits `SpriteDraw`s; the layer places a pooled quad for each, with
 * Phaser's origin, flip and rotation rules, ordered by depth then
 * submission order, drawn without depth testing like a 2D canvas.
 */
export class SpriteLayer {
  readonly scene = new THREE.Scene();
  private readonly quad = frameQuad();
  private readonly slots: Slot[] = [];
  private used = 0;
  private readonly queue: Array<{ sprite: SpriteDraw; depth: number } | { geometry: ManagedGeometry; depth: number }> = [];
  private readonly geometryNodes = new Set<ManagedGeometry>();
  private order = 0;
  private submitted: SpriteDraw[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly step = new THREE.Matrix4();

  /**
   * `renderOrderBase` stacks a second layer above other passes of the same
   * scene (e.g. effects drawn above effect shapes); the texture store can be
   * shared between layers.
   */
  constructor(readonly textures: TextureStore, private readonly renderOrderBase = 0) {}

  draw(sprite: SpriteDraw): void {
    this.queue.push({ sprite, depth: sprite.depth ?? 0 });
  }

  /** Borrow instance-owned geometry for this frame, in the same queue as sprites. */
  drawGeometry(geometry: ManagedGeometry, depth = 0): void {
    if (geometry.active) this.queue.push({ geometry, depth });
  }

  /** Place this frame's sprites and managed nodes before rendering `scene`. */
  flush(): void {
    const ordered = this.queue.map((s, i) => ({ s, i })).sort((a, b) => a.s.depth - b.s.depth || a.i - b.i);
    this.used = 0;
    this.order = 0;
    for (const geometry of this.geometryNodes) if (geometry.node.parent === this.scene) geometry.node.removeFromParent();
    this.geometryNodes.clear();
    this.submitted = [];
    for (const { s } of ordered) {
      if ('geometry' in s) {
        if (!s.geometry.active) continue;
        this.geometryNodes.add(s.geometry);
        this.scene.add(s.geometry.node);
        s.geometry.node.traverse(object => {
          object.renderOrder = object instanceof THREE.Mesh ? this.renderOrderBase + ++this.order : 0;
        });
      } else {
        const previous = this.used;
        this.place(s.sprite);
        if (this.used > previous) this.submitted.push({ ...s.sprite });
      }
    }
    for (let i = this.used; i < this.slots.length; i++) this.slots[i]!.mesh.visible = false;
    this.queue.length = 0;
  }

  /** Draws that received textured quads in the last actual flush. */
  submittedDraws(): readonly SpriteDraw[] { return this.submitted.map(draw => ({ ...draw })); }

  /** Shared textures remain owned by TextureStore. */
  dispose(): void {
    this.scene.removeFromParent();
    for (const { mesh } of this.slots) (mesh.material as THREE.Material).dispose();
    this.quad.dispose();
    this.slots.length = 0;
    this.queue.length = 0;
    this.submitted = [];
    for (const geometry of this.geometryNodes) if (geometry.node.parent === this.scene) geometry.node.removeFromParent();
    this.geometryNodes.clear();
  }

  private slot(): Slot {
    let slot = this.slots[this.used];
    if (!slot) {
      const uniforms = slotUniforms();
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide, forceSinglePass: true,
      });
      const mesh = new THREE.Mesh(this.quad, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      slot = { mesh, uniforms };
      this.slots.push(slot);
    }
    this.used += 1;
    return slot;
  }

  private place(s: SpriteDraw): void {
    const sheet = this.textures.get(s.key);
    if (!sheet) return;
    const frame = Math.max(0, Math.min(sheet.frameCount - 1, Math.floor(s.frame ?? 0)));
    // The drawing's rect in the image, and its offset inside the logical cell (0,0 and the whole cell for a grid).
    const source = frameRect(sheet, frame);
    const top = Math.max(source.dy, s.clipRows?.top ?? source.dy);
    const bottom = Math.min(source.dy + source.h, s.clipRows?.bottom ?? source.dy + source.h);
    if (bottom <= top) return;
    const rect = { ...source, y: source.y + top - source.dy, dy: top, h: bottom - top };
    const { frameWidth: w, frameHeight: h } = sheet;

    const slot = this.slot();
    slot.mesh.visible = true;
    slot.mesh.renderOrder = this.renderOrderBase + ++this.order;
    slot.mesh.material.blendDst = s.blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
    slot.uniforms.map.value = sheet.texture;
    // Texture rows run bottom-up after the flipY upload.
    slot.uniforms.uvRect.value.set(rect.x / sheet.width, 1 - (rect.y + rect.h) / sheet.height, rect.w / sheet.width, rect.h / sheet.height);
    slot.uniforms.tint.value.setHex(s.tint ?? 0xffffff);
    slot.uniforms.alpha.value = s.alpha ?? 1;
    const regions = (s.recolor ?? []).slice(0, MAX_RECOLOR_REGIONS);
    slot.uniforms.recolorCount.value = regions.length;
    regions.forEach((r, i) => {
      slot.uniforms.recolorKey.value[i]!.set(...r.key);
      slot.uniforms.recolorShift.value[i]!.set(r.hueShift, r.saturationRatio, r.valueRatio);
      slot.uniforms.recolorTolerance.value[i]!.set(...r.tolerance);
    });

    // Phaser's batchSprite: the quad starts at -displayOrigin plus the trim offset; a flip
    // keeps the same logical box and mirrors the frame inside it (x = origin*W - W + dx).
    const ox = (s.originX ?? 0.5) * w, oy = (s.originY ?? 0.5) * h;
    const fx = s.flipX ? -1 : 1, fy = s.flipY ? -1 : 1;
    const qx = (s.flipX ? ox - w : -ox) + rect.dx, qy = (s.flipY ? oy - h : -oy) + rect.dy;
    const r = s.rotation ?? 0;
    // design (y down) → world (y up): scale by 1/PX_PER_UNIT, flip y, recentre.
    this.m.set(
      1 / PX_PER_UNIT, 0, 0, -STAGE_DESIGN_WIDTH / 2 / PX_PER_UNIT,
      0, -1 / PX_PER_UNIT, 0, STAGE_DESIGN_HEIGHT / 2 / PX_PER_UNIT,
      0, 0, 1, 0,
      0, 0, 0, 1);
    this.m.multiply(this.step.makeTranslation(s.x, s.y, 0));
    this.m.multiply(this.step.makeRotationZ(r));
    const sx = s.displayWidth !== undefined ? s.displayWidth / w : s.scaleX ?? 1;
    const sy = s.displayHeight !== undefined ? s.displayHeight / h : s.scaleY ?? 1;
    this.m.multiply(this.step.makeScale(sx * fx, sy * fy, 1));
    this.m.multiply(this.step.makeTranslation(qx, qy, 0));
    this.m.multiply(this.step.makeScale(rect.w, rect.h, 1));
    slot.mesh.matrix.copy(this.m);
    slot.mesh.matrixWorld.copy(this.m);
  }
}
