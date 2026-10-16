import * as THREE from 'three';
import { toWorldLength, toWorldX, toWorldY } from '../space';

/**
 * Flat shapes drawn over the sprites, in design px, like Phaser's Arc / Line /
 * Rectangle game objects: what the game's effect formatters describe (hit
 * sparks, charge rings, shield bubbles, blast areas, hit boxes). Immediate
 * mode: submit this frame's shapes, then `flush`. Meshes are pooled; each
 * shape is one quad whose shader draws an anti-aliased circle or a box.
 */
export interface CircleShape {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly fill?: number;
  readonly fillAlpha?: number;
  readonly stroke?: number;
  readonly strokeAlpha?: number;
  readonly strokeWidth?: number;
}
export interface LineShape {
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  readonly width: number;
  readonly color: number;
  readonly alpha?: number;
}
/** Axis-aligned box by its centre, Phaser Rectangle's default origin. */
export interface RectShape {
  readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
  readonly color: number;
  readonly alpha?: number;
}

export interface ItemEffectShape {
  readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
  readonly phase: number;
  readonly facing?: 1 | -1;
}

const VERT = `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// Circle: unit quad from -1..1; fill inside, a ring of strokeWidth (in radius
// units) at the edge, one screen-pixel-ish soft edge. Box: solid colour.
const FRAG = `
  uniform int shape;
  uniform vec3 fill;
  uniform float fillAlpha;
  uniform vec3 stroke;
  uniform float strokeAlpha;
  uniform float strokeWidth;
  uniform float phase;
  varying vec2 vLocal;
  // Signed distance to a five-point silhouette. One quad, with no per-frame
  // geometry/material allocation and no image-decode hitch on the first shot.
  float starDistance(vec2 p) {
    float distanceSquared = 100.0;
    bool inside = false;
    vec2 a = vec2(0.0, 1.0);
    for (int i = 1; i <= 10; i++) {
      float angle = 1.570796327 + float(i) * 0.628318531;
      float radius = mod(float(i), 2.0) < 0.5 ? 1.0 : 0.46;
      vec2 b = vec2(cos(angle), sin(angle)) * radius;
      vec2 edge = b - a;
      vec2 closest = p - a - edge * clamp(dot(p - a, edge) / dot(edge, edge), 0.0, 1.0);
      distanceSquared = min(distanceSquared, dot(closest, closest));
      if ((a.y > p.y) != (b.y > p.y)) {
        float crossing = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
        if (p.x < crossing) inside = !inside;
      }
      a = b;
    }
    return sqrt(distanceSquared) * (inside ? -1.0 : 1.0);
  }
  void main() {
    if (shape == 1) { gl_FragColor = vec4(fill * fillAlpha, fillAlpha); return; }
    if (shape == 2) {
      float d = starDistance(vLocal);
      float aa = max(fwidth(d), 0.003);
      float alpha = (1.0 - smoothstep(-aa, aa, d)) * fillAlpha;
      float rim = smoothstep(-0.16, -0.06, d);
      vec3 gold = mix(fill, vec3(1.0, 0.96, 0.55), clamp(vLocal.y * 0.5 + 0.35, 0.0, 1.0));
      vec3 colour = mix(gold, stroke, rim);
      float glint = exp(-28.0 * dot(vLocal - vec2(-0.16, 0.24), vLocal - vec2(-0.16, 0.24)));
      colour = mix(colour, vec3(1.0, 1.0, 0.9), glint * 0.9);
      gl_FragColor = vec4(colour * alpha, alpha); return;
    }
    if (shape == 3) {
      vec2 p = vLocal;
      float wave = sin(p.x * 6.5 - phase) * (p.x + 1.0) * 0.11;
      float profile = sqrt(max(0.0, 1.0 - p.x * p.x)) * (0.83 - p.x * 0.26);
      float d = abs(p.y - wave) - profile;
      float aa = max(fwidth(d), 0.015);
      float alpha = (1.0 - smoothstep(-aa, aa, d)) * fillAlpha;
      float heat = clamp(1.0 - abs(p.y - wave) / max(profile, 0.01), 0.0, 1.0);
      vec3 colour = mix(vec3(0.85, 0.07, 0.008), vec3(1.0, 0.4, 0.015), smoothstep(0.0, 0.3, heat));
      colour = mix(colour, vec3(1.0, 0.92, 0.22), smoothstep(0.22, 0.78, heat));
      colour = mix(colour, vec3(1.0, 1.0, 0.75), smoothstep(0.76, 1.0, heat) * (1.0 - (p.x + 1.0) * 0.4));
      gl_FragColor = vec4(colour * alpha, alpha); return;
    }
    float d = length(vLocal);
    float aa = fwidth(d);
    float outside = smoothstep(1.0 - aa, 1.0, d);
    float inner = 1.0 - strokeWidth;
    float inRing = smoothstep(inner - aa, inner, d) * (1.0 - outside);
    float inFill = (1.0 - smoothstep(inner - aa, inner, d)) * (1.0 - outside);
    if (strokeWidth <= 0.0) { inFill = 1.0 - outside; inRing = 0.0; }
    vec4 f = vec4(fill * fillAlpha, fillAlpha) * inFill;
    vec4 s = vec4(stroke * strokeAlpha, strokeAlpha) * inRing;
    gl_FragColor = f + s * (1.0 - f.a);
  }`;

function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

type Uniforms = ReturnType<typeof uniforms>;
function uniforms() {
  return {
    shape: { value: 0 }, fill: { value: new THREE.Color() }, fillAlpha: { value: 0 },
    stroke: { value: new THREE.Color() }, strokeAlpha: { value: 0 }, strokeWidth: { value: 0 }, phase: { value: 0 },
  };
}

export class ShapeLayer {
  readonly group = new THREE.Group();
  private readonly geometry = quad();
  private readonly pool: Array<{ mesh: THREE.Mesh; u: Uniforms }> = [];
  private used = 0;

  /**
   * `renderOrderBase` puts the shapes above the sprites drawn the same frame;
   * `additive` adds light (glows) instead of covering (premultiplied output).
   */
  constructor(private readonly renderOrderBase = 1000, private readonly additive = false) {}

  /** Reserve the first real draw's material for scene compilation during
   * loading. Hidden meshes are included by Three's compile traversal; this
   * neither submits a shape nor consumes a frame's pooled slot. */
  prepare(): void { this.slot(0); }

  circle(c: CircleShape): void {
    if (c.radius <= 0) return;
    const { mesh, u } = this.next();
    u.shape.value = 0;
    u.fill.value.setHex(c.fill ?? 0); u.fillAlpha.value = c.fill === undefined ? 0 : c.fillAlpha ?? 1;
    u.stroke.value.setHex(c.stroke ?? 0); u.strokeAlpha.value = c.stroke === undefined ? 0 : c.strokeAlpha ?? 1;
    u.strokeWidth.value = c.stroke === undefined ? 0 : Math.min(1, (c.strokeWidth ?? 1) / c.radius);
    const r = toWorldLength(c.radius);
    mesh.position.set(toWorldX(c.x), toWorldY(c.y), 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(r, r, 1);
  }

  line(l: LineShape): void {
    const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    if (len <= 0 || l.width <= 0) return;
    const { mesh } = this.box(l.color, l.alpha ?? 1);
    mesh.position.set(toWorldX((l.x1 + l.x2) / 2), toWorldY((l.y1 + l.y2) / 2), 0);
    // Design y runs down, world y up: the angle flips sign.
    mesh.rotation.set(0, 0, -Math.atan2(l.y2 - l.y1, l.x2 - l.x1));
    mesh.scale.set(toWorldLength(len) / 2, toWorldLength(l.width) / 2, 1);
  }

  rect(r: RectShape): void {
    if (r.width <= 0 || r.height <= 0) return;
    const { mesh } = this.box(r.color, r.alpha ?? 1);
    mesh.position.set(toWorldX(r.x), toWorldY(r.y), 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(toWorldLength(r.width) / 2, toWorldLength(r.height) / 2, 1);
  }

  /** A crisp spinning Star Rod star, sized to the actual projectile extent. */
  star(s: ItemEffectShape): void {
    if (s.width <= 0 || s.height <= 0) return;
    const { mesh, u } = this.next();
    u.shape.value = 2;
    u.fill.value.setHex(0xffcd32); u.stroke.value.setHex(0xa84906); u.fillAlpha.value = 1;
    mesh.position.set(toWorldX(s.x), toWorldY(s.y), 0);
    mesh.rotation.set(0, 0, -s.phase);
    mesh.scale.set(toWorldLength(s.width) / 2, toWorldLength(s.height) / 2, 1);
  }

  /** A rolling flame tongue; phase is the deterministic simulation clock. */
  flame(s: ItemEffectShape): void {
    if (s.width <= 0 || s.height <= 0) return;
    const { mesh, u } = this.next();
    u.shape.value = 3; u.fillAlpha.value = 1; u.phase.value = s.phase;
    mesh.position.set(toWorldX(s.x), toWorldY(s.y), 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(toWorldLength(s.width) / 2 * (s.facing ?? 1), toWorldLength(s.height) / 2, 1);
    // Mirroring a flat quad reverses winding; keep the material double-sided.
  }

  /** Hide what was not drawn this frame; call once per frame after submitting. */
  flush(): void {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.mesh.visible = false;
    this.used = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { mesh } of this.pool) (mesh.material as THREE.Material).dispose();
    this.geometry.dispose();
    this.group.clear();
    this.pool.length = 0;
    this.used = 0;
  }

  private box(color: number, alpha: number) {
    const slot = this.next();
    slot.u.shape.value = 1;
    slot.u.fill.value.setHex(color);
    slot.u.fillAlpha.value = alpha;
    return slot;
  }

  private next() {
    const slot = this.slot(this.used);
    slot.mesh.visible = true;
    slot.mesh.renderOrder = this.renderOrderBase + this.used;
    this.used += 1;
    return slot;
  }

  private slot(index: number) {
    let slot = this.pool[index];
    if (!slot) {
      const u = uniforms();
      const material = new THREE.ShaderMaterial({
        uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, forceSinglePass: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: this.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      slot = { mesh, u };
      this.pool.push(slot);
    }
    return slot;
  }
}
