import { PNG } from 'pngjs';

/**
 * The image shrunk to `width` × `height` (each at most the source size) by area
 * averaging in premultiplied space, so transparent pixels never darken the edges.
 */
export function shrink(image: PNG, width: number, height: number): PNG {
  const { width: w, height: h, data } = image;
  const premultiplied = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    for (let k = 0; k < 3; k++) premultiplied[i * 4 + k] = data[i * 4 + k]! * a;
    premultiplied[i * 4 + 3] = data[i * 4 + 3]!;
  }
  const rows = axis(premultiplied, w, width, h, w, width, 1), out = axis(rows, h, height, width, 1, 1, width);
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const a = out[i * 4 + 3]!;
    for (let k = 0; k < 3; k++) png.data[i * 4 + k] = a > 0 ? Math.round(Math.min(255, out[i * 4 + k]! * 255 / a)) : 0;
    png.data[i * 4 + 3] = Math.round(a);
  }
  return png;
}

/**
 * Area-averages one axis of a pixel grid: `from` samples along the axis become `to`,
 * for each of `lines` lines. Lines start every `inLine` / `outLine` pixels in the input
 * and output; samples along the axis are `step` pixels apart in both.
 */
function axis(input: Float32Array, from: number, to: number, lines: number, inLine: number, outLine: number, step: number): Float32Array {
  const output = new Float32Array(input.length / from * to), ratio = from / to;
  for (let o = 0; o < to; o++) {
    const start = o * ratio, end = start + ratio;
    for (let s = Math.floor(start); s < Math.min(from, Math.ceil(end)); s++) {
      const weight = (Math.min(end, s + 1) - Math.max(start, s)) / ratio;
      if (weight <= 0) continue;
      for (let line = 0; line < lines; line++) {
        const src = (line * inLine + s * step) * 4, dst = (line * outLine + o * step) * 4;
        for (let k = 0; k < 4; k++) output[dst + k] = output[dst + k]! + input[src + k]! * weight;
      }
    }
  }
  return output;
}
