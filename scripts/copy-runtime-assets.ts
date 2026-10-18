/** Standalone hosting artifact: copy only manifest-referenced runtime files.
 * Local previews serve the same files directly from assets/, avoiding copies
 * of source captures, pose-generation work and personal images per build. */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getAllAssetEntries } from '../src/assets/manifest';
import { packageAssetPath, SHIPPED_PACKAGES } from '../port/src/fighters/packageIndex';

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

// Optional compressed fighter sheets (tools/encode-compressed-sheets.py) and the Basis transcoder that reads them.
const countFiles = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
let compressed = 0;
for (const id of readdirSync(path.join(root, 'assets/characters'))) {
  const source = path.join(root, 'assets/characters', id, 'compressed');
  if (!existsSync(source)) continue;
  cpSync(source, path.join(root, 'dist/characters', id, 'compressed'), { recursive: true });
  compressed += countFiles(source);
}
// Shipped character packages (npm run character:package), fetched at runtime by the package library.
let packages = 0;
for (const id of Object.keys(SHIPPED_PACKAGES.packages)) {
  cpSync(path.join(root, 'assets', packageAssetPath(id, '')), path.join(root, 'dist', packageAssetPath(id, '')), { recursive: true });
  packages++;
}
const basis = path.join(root, 'node_modules/three/examples/jsm/libs/basis');
mkdirSync(path.join(root, 'dist/basis'), { recursive: true });
for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
  copyFileSync(path.join(basis, name), path.join(root, 'dist/basis', name));
process.stdout.write(`Copied ${files.size} runtime assets, ${compressed} compressed sheet files, ${packages} character packages and the Basis transcoder into dist/\n`);
