/** Standalone hosting artifact: copy only manifest-referenced runtime files.
 * Local previews serve the same files directly from assets/, avoiding copies
 * of source captures, pose-generation work and personal images per build. */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getAllAssetEntries } from '../src/assets/manifest';

const root = process.cwd();
const files = new Set(getAllAssetEntries().flatMap((entry) =>
  'urls' in entry ? [...entry.urls]
    : entry.kind === 'atlas' ? [entry.textureUrl, entry.jsonUrl] : [entry.url]));
for (const url of files) {
  const relative = url.replace(/^\//, '');
  if (!relative || relative.split('/').includes('..') || /^[a-z]+:/i.test(relative))
    throw new Error(`Expected an asset-relative manifest URL: ${url}`);
  const target = path.join(root, 'dist', relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, 'assets', relative), target);
}
process.stdout.write(`Copied ${files.size} runtime assets into dist/\n`);
