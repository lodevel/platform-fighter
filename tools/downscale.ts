/**
 * downscale.ts — area-average (box filter) PNG downscale (pngjs).
 *
 * Z-Image emits 1024² art; the in-game sheets are small (cat frames are 50×50,
 * items 40–70px, etc.). Committing 1024² PNGs would bloat the repo, so we keep
 * the raw renders in gitignored assets/gen/ and downscale a game-ready copy.
 *
 * Area-averaging (vs nearest) is correct for the Brawlhalla smooth-cartoon style:
 * it antialiases cleanly when shrinking by a large factor. Alpha is averaged too,
 * so transparent edges from bg-remove stay soft.
 *
 * Usage:
 *   npx tsx tools/downscale.ts --in big.png --out small.png --width 128 --height 128
 *   npx tsx tools/downscale.ts --in big.png --out small.png --max 128   (fit longest side, keep aspect)
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.ts';

/**
 * Box-filter downscale an RGBA buffer to (dstW, dstH). Pure + deterministic.
 * Premultiplies alpha while averaging so transparent pixels don't darken edges.
 */
export function downscaleRgba(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (src.length !== srcW * srcH * 4) {
    throw new Error(`downscaleRgba: src length ${src.length} != ${srcW}x${srcH}x4`);
  }
  if (dstW <= 0 || dstH <= 0) throw new Error('downscaleRgba: target dims must be > 0');
  const out = new Uint8Array(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const y0 = Math.floor(dy * sy);
    const y1 = Math.max(y0 + 1, Math.min(srcH, Math.ceil((dy + 1) * sy)));
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = Math.floor(dx * sx);
      const x1 = Math.max(x0 + 1, Math.min(srcW, Math.ceil((dx + 1) * sx)));

      let rAcc = 0, gAcc = 0, bAcc = 0, aAcc = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * srcW + x) * 4;
          const a = src[i + 3]!;
          // Premultiply so transparent source pixels contribute no colour.
          rAcc += src[i]! * a;
          gAcc += src[i + 1]! * a;
          bAcc += src[i + 2]! * a;
          aAcc += a;
          n++;
        }
      }
      const di = (dy * dstW + dx) * 4;
      if (aAcc > 0) {
        out[di] = Math.round(rAcc / aAcc);
        out[di + 1] = Math.round(gAcc / aAcc);
        out[di + 2] = Math.round(bAcc / aAcc);
        out[di + 3] = Math.round(aAcc / n);
      } else {
        out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 0;
      }
    }
  }
  return out;
}

interface Args {
  in?: string;
  out?: string;
  width?: number;
  height?: number;
  max?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--in': args.in = next(); break;
      case '--out': args.out = next(); break;
      case '--width': args.width = Number(next()); break;
      case '--height': args.height = Number(next()); break;
      case '--max': args.max = Number(next()); break;
      case '--help': case '-h':
        process.stdout.write(
          'downscale.ts — area-average downscale a PNG.\n' +
            'Usage: npx tsx tools/downscale.ts --in <png> --out <png> ' +
            '(--width N --height N | --max N)\n',
        );
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default: throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in) throw new Error('--in is required');
  if (!args.out) throw new Error('--out is required');

  const png = PNG.sync.read(await readFile(args.in));
  const src = new Uint8Array(png.data.length);
  src.set(png.data);

  let dstW: number;
  let dstH: number;
  if (args.max !== undefined) {
    const scale = args.max / Math.max(png.width, png.height);
    dstW = Math.max(1, Math.round(png.width * scale));
    dstH = Math.max(1, Math.round(png.height * scale));
  } else {
    if (args.width === undefined && args.height === undefined) {
      throw new Error('provide --width/--height or --max');
    }
    if (args.width !== undefined && args.height !== undefined) {
      dstW = args.width;
      dstH = args.height;
    } else if (args.width !== undefined) {
      dstW = args.width;
      dstH = Math.max(1, Math.round((png.height / png.width) * args.width));
    } else {
      dstH = args.height!;
      dstW = Math.max(1, Math.round((png.width / png.height) * args.height!));
    }
  }

  const out = downscaleRgba(src, png.width, png.height, dstW, dstH);
  const outPng = new PNG({ width: dstW, height: dstH, colorType: 6, bitDepth: 8, inputHasAlpha: true });
  outPng.data = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const outBytes = PNG.sync.write(outPng);

  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, outBytes);
  console.log(
    `[downscale] ${args.in} (${png.width}x${png.height}) -> ${outPath} ` +
      `(${dstW}x${dstH}, ${outBytes.length} bytes)`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`[downscale] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
