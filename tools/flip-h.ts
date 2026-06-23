/**
 * flip-h.ts — flip a PNG horizontally (mirror left-right)
 * Usage: npx tsx tools/flip-h.ts <path.png> [path2.png ...]
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';

const paths = process.argv.slice(2);
if (!paths.length) throw new Error('usage: flip-h.ts <file.png> [...]');

for (const inPath of paths) {
  const buf = readFileSync(inPath);
  const png = PNG.sync.read(buf);
  const { width, height } = png;
  const data = new Uint8Array(png.data.buffer);
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + (width - 1 - x)) * 4;
      out[dstIdx]     = data[srcIdx]!;
      out[dstIdx + 1] = data[srcIdx + 1]!;
      out[dstIdx + 2] = data[srcIdx + 2]!;
      out[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }
  png.data = Buffer.from(out);
  writeFileSync(inPath, PNG.sync.write(png));
  console.log('flipped:', inPath);
}
