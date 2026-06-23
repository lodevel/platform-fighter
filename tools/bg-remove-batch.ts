/**
 * bg-remove-batch.ts — run chroma-key on every PNG in a frames directory, in-place.
 * Usage: npx tsx tools/bg-remove-batch.ts <dir> [--key RRGGBB] [--tolerance N]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { chromaKey } from './bg-remove.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: bg-remove-batch.ts <dir>');

const keyArg = process.argv.indexOf('--key');
const tolArg = process.argv.indexOf('--tolerance');
const key = keyArg >= 0 ? parseInt(process.argv[keyArg + 1]!, 16) : 0x00ff00;
const tol = tolArg >= 0 ? parseInt(process.argv[tolArg + 1]!, 10) : 80;

const files = (await readdir(dir)).filter(f => f.endsWith('.png'));
console.log(`[bg-batch] keying ${files.length} files in ${dir} (key=#${key.toString(16).padStart(6,'0')} tol=${tol})`);

for (const file of files) {
  const path = join(dir, file);
  const buf = await readFile(path);
  const png = PNG.sync.read(buf);
  const { pixels } = chromaKey(new Uint8Array(png.data.buffer), png.width, png.height, { key, tol, despill: true });
  png.data = Buffer.from(pixels);
  await writeFile(path, PNG.sync.write(png));
  process.stdout.write(`  keyed: ${file}\n`);
}
console.log('[bg-batch] done');
