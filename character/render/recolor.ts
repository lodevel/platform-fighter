import { MAX_COLOR_REGIONS, type Costumes } from '../package/types';

/**
 * Shift one colour region of a drawing, keeping its shading: pixels near
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

function hsv(hex: string): [number, number, number] {
  const color = parseInt(hex.slice(1, 7), 16);
  return rgbToHsv((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255);
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const channel = (offset: number) => {
    const p = Math.abs((((h + offset) % 1) + 1) % 1 * 6 - 3);
    return v * (1 + (Math.min(1, Math.max(0, p - 1)) - 1) * s);
  };
  return [channel(1), channel(2 / 3), channel(1 / 3)];
}

/**
 * One straight-alpha colour (each channel 0..1) recoloured by `shifts`: the same
 * maths as `recolor()` in `RECOLOR_GLSL`, applied to a palette entry instead of a texel.
 */
export function recolorColor([r, g, b, a]: readonly [number, number, number, number], shifts: readonly HsvShift[]): [number, number, number, number] {
  if (shifts.length === 0 || a <= 0) return [r, g, b, a];
  const [h, s, v] = rgbToHsv(r, g, b);
  let best = Infinity, pick: HsvShift | undefined;
  for (const shift of shifts.slice(0, MAX_COLOR_REGIONS)) {
    const dh = Math.min(Math.abs(h - shift.key[0]), 1 - Math.abs(h - shift.key[0]));
    const dist = Math.hypot(dh / shift.tolerance[0], Math.abs(s - shift.key[1]) / shift.tolerance[1], Math.abs(v - shift.key[2]) / shift.tolerance[2]);
    if (dist < best) { best = dist; pick = shift; }
  }
  if (!pick || best >= 1) return [r, g, b, a];
  const moved = hsvToRgb(((h + pick.hueShift) % 1 + 1) % 1, Math.min(1, Math.max(0, s * pick.saturationRatio)), Math.min(1, Math.max(0, v * pick.valueRatio)));
  const edge = Math.min(1, Math.max(0, (best - 0.6) / 0.4)), weight = 1 - edge * edge * (3 - 2 * edge);
  return [r + (moved[0] - r) * weight, g + (moved[1] - g) * weight, b + (moved[2] - b) * weight, a];
}

/**
 * The shifts that dress a character in costume `index` (wrapped to the list):
 * each region moves by its slot's colour in that costume relative to costume 0.
 * Costume 0, or a character without costumes, draws the art unchanged.
 */
export function costumeShifts(costumes: Costumes | undefined, index: number): HsvShift[] {
  const count = costumes?.list.length ?? 0;
  const wrapped = Number.isFinite(index) && count ? ((Math.trunc(index) % count) + count) % count : 0;
  if (!costumes || wrapped === 0) return [];
  const base = costumes.list[0]!.slots, costume = costumes.list[wrapped]!.slots;
  return costumes.regions.map(region => {
    const [h0, s0, v0] = hsv(base[region.slot]!), [h1, s1, v1] = hsv(costume[region.slot]!);
    return {
      key: hsv(region.color), tolerance: region.tolerance,
      hueShift: h1 - h0, saturationRatio: s0 > 0 ? s1 / s0 : 1, valueRatio: v0 > 0 ? v1 / v0 : 1,
    };
  });
}

/** Flat uniform arrays for `RECOLOR_GLSL` (three floats per region). */
export interface RecolorUniforms {
  count: number;
  readonly key: Float32Array;
  readonly shift: Float32Array;
  readonly tolerance: Float32Array;
}

export function recolorUniforms(): RecolorUniforms {
  const vec3s = () => new Float32Array(MAX_COLOR_REGIONS * 3);
  return { count: 0, key: vec3s(), shift: vec3s(), tolerance: vec3s() };
}

/** Writes `shifts` (at most MAX_COLOR_REGIONS) into `out`. */
export function packRecolor(shifts: readonly HsvShift[], out: RecolorUniforms): void {
  const regions = shifts.slice(0, MAX_COLOR_REGIONS);
  out.count = regions.length;
  regions.forEach((r, i) => {
    out.key.set(r.key, i * 3);
    out.shift.set([r.hueShift, r.saturationRatio, r.valueRatio], i * 3);
    out.tolerance.set(r.tolerance, i * 3);
  });
}

/**
 * GLSL for `vec4 recolor(vec4 premultipliedTexel)` and its uniforms
 * (`recolorCount`, `recolorKey`, `recolorShift`, `recolorTolerance`). With no
 * regions the texel is returned untouched.
 */
export const RECOLOR_GLSL = `
  #define REGIONS ${MAX_COLOR_REGIONS}
  uniform int recolorCount;
  uniform vec3 recolorKey[REGIONS];
  uniform vec3 recolorShift[REGIONS];
  uniform vec3 recolorTolerance[REGIONS];
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
  }`;
