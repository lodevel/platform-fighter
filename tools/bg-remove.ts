/**
 * bg-remove.ts — flat chroma-key background removal (pngjs).
 *
 * WHY chroma-key (and not a ComfyUI bg-removal node):
 *   The server exposes `RemoveBackground` + `LoadBackgroundRemovalModel`, but
 *   `LoadBackgroundRemovalModel`'s model list is EMPTY (no BiRefNet/rembg weight
 *   installed), and `RemoveBackground` only emits a MASK that would still need a
 *   JoinImageWithAlpha tail. Rather than depend on an un-downloaded model, we
 *   prompt the subject on a flat chroma-key colour and key it out here. This is
 *   self-contained, deterministic, offline-testable, and needs no extra weights.
 *
 *   Recipe: render the subject with the prompt suffix
 *     "on a solid flat chroma-key magenta #FF00FF background, no shadows"
 *   then run this tool to turn that colour (within tolerance) transparent.
 *
 * Usage:
 *   npx tsx tools/bg-remove.ts --in assets/gen/sword.png --out assets/gen/sword-cut.png
 *   [--key RRGGBB] (default ff00ff) [--tolerance N] (0-255 per-channel, default 60)
 *   [--despill] (desaturate the keyed colour from edge pixels)
 *
 * Pure-ish: keying is a deterministic per-pixel function; only fs I/O at the edges.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { isMain } from './is-main.ts';

export interface ChromaKeyOpts {
  /** Key colour as packed 0xRRGGBB. Default magenta 0xff00ff. */
  key?: number;
  /** Per-channel max distance to treat a pixel as background. Default 60. */
  tolerance?: number;
  /** Reduce the key hue bleeding into kept edge pixels. Default true. */
  despill?: boolean;
}

/**
 * Key out a flat background colour from an RGBA buffer, returning a NEW buffer
 * with matched pixels set fully transparent. Deterministic + pure.
 */
export function chromaKey(
  pixels: Uint8Array,
  width: number,
  height: number,
  opts: ChromaKeyOpts = {},
): { pixels: Uint8Array; keyedPixels: number } {
  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(`chromaKey: buffer length ${pixels.length} != ${width}x${height}x4`);
  }
  const key = opts.key ?? 0xff00ff;
  const tol = opts.tolerance ?? 60;
  const despill = opts.despill ?? true;
  const kr = (key >> 16) & 0xff;
  const kg = (key >> 8) & 0xff;
  const kb = key & 0xff;

  const out = new Uint8Array(pixels.length);
  out.set(pixels);
  let keyed = 0;

  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!;
    const g = out[i + 1]!;
    const b = out[i + 2]!;
    const dr = Math.abs(r - kr);
    const dg = Math.abs(g - kg);
    const db = Math.abs(b - kb);
    if (dr <= tol && dg <= tol && db <= tol) {
      // Background — fully transparent.
      out[i + 3] = 0;
      keyed++;
      continue;
    }
    if (despill) {
      // Magenta despill: where green is the minimum channel (typical for
      // magenta bleed on edges), clamp R/B toward G to kill the purple fringe.
      // Generalised: pull the two strong key-channels toward the weak one.
      if (kg < kr && kg < kb && g < r && g < b) {
        const avg = (r + b) >> 1;
        if (avg > g) {
          const corrected = Math.round(g + (avg - g) * 0.5);
          if (r > corrected) out[i] = corrected;
          if (b > corrected) out[i + 2] = corrected;
        }
      }
    }
  }
  return { pixels: out, keyedPixels: keyed };
}

interface Args {
  in?: string;
  out?: string;
  key: number;
  tolerance: number;
  despill: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { key: 0xff00ff, tolerance: 60, despill: true };
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
      case '--key': args.key = parseInt(next().replace(/^#/, ''), 16); break;
      case '--tolerance': args.tolerance = Number(next()); break;
      case '--no-despill': args.despill = false; break;
      case '--despill': args.despill = true; break;
      case '--help': case '-h':
        process.stdout.write(
          'bg-remove.ts — chroma-key a flat background colour to transparency.\n' +
            'Usage: npx tsx tools/bg-remove.ts --in <png> --out <png> ' +
            '[--key RRGGBB] [--tolerance N] [--no-despill]\n',
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

  const bytes = await readFile(args.in);
  const png = PNG.sync.read(bytes);
  const src = new Uint8Array(png.data.length);
  src.set(png.data);

  const { pixels, keyedPixels } = chromaKey(src, png.width, png.height, {
    key: args.key,
    tolerance: args.tolerance,
    despill: args.despill,
  });

  const outPng = new PNG({ width: png.width, height: png.height, colorType: 6, bitDepth: 8, inputHasAlpha: true });
  outPng.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const outBytes = PNG.sync.write(outPng);

  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, outBytes);

  const total = png.width * png.height;
  console.log(
    `[bg-remove] ${args.in} -> ${outPath} ` +
      `(keyed ${keyedPixels}/${total} px = ${((keyedPixels / total) * 100).toFixed(1)}% transparent, ` +
      `key=#${args.key.toString(16).padStart(6, '0')} tol=${args.tolerance})`,
  );
}

// Only run as a CLI when invoked directly (so tests can import chromaKey).
if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`[bg-remove] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
