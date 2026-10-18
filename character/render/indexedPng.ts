/**
 * Decodes an `indexed` page (an 8-bit greyscale PNG whose values are palette entries) to
 * one byte per pixel, rows top to bottom. Exact by construction: no colour management,
 * gamma or alpha premultiplication can touch the indices, which an image decoder might.
 * Uses the platform's `DecompressionStream`, so it runs in browsers, workers and Node.
 */
export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function decodeIndexedPng(bytes: Uint8Array): Promise<IndexedImage> {
  if (SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, offset = 8;
  const chunks: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colorType !== 0 || interlace !== 0) throw new Error(`indexed pages are 8-bit greyscale, not interlaced (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
    } else if (type === 'IDAT') chunks.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !chunks.length) throw new Error('PNG without a header or image data');
  const stream = new Blob(chunks as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (raw.length < (width + 1) * height) throw new Error('PNG image data is truncated');
  return { width, height, data: unfilter(raw, width, height) };
}

/** Reverses the PNG row filters for one byte per pixel. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]!, src = y * (width + 1) + 1, row = y * width, up = row - width;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? out[row + x - 1]! : 0, b = y > 0 ? out[up + x]! : 0, c = x > 0 && y > 0 ? out[up + x - 1]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[row + x] = (raw[src + x]! + predictor) & 255;
    }
  }
  return out;
}
