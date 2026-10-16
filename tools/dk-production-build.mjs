import { build } from 'vite';
import { tsImport } from 'tsx/esm/api';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Freeze source and both reviewed fighter manifests before compilation. Stage
// only application manifest assets; raw reference/generation archives stay out.
const root = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checkpoint = process.env.PF_BUILD_CHECKPOINT ?? '.tmp/dk-current-production';
const outDir = await mkdtemp(path.join(os.tmpdir(), 'platform-fighter-dk-production-'));
const files = (await readdir(path.join(root, 'src'), { recursive: true }))
  .filter(file => /\.(ts|tsx|json)$/.test(file) && !/\.(test|spec)\./.test(file))
  .map(file => path.join('src', file)).sort();
const sourceHashes = {}, fighterAssets = {};
for (const file of files) sourceHashes[file] = hash(await readFile(path.join(root, file)));
for (const id of ['donkeykong', 'pikachu']) {
  const metadataPath = path.join('assets/characters', id, 'frames.json');
  const bytes = await readFile(path.join(root, metadataPath));
  const metadata = JSON.parse(bytes.toString());
  const strips = {};
  for (const [sheet, clip] of Object.entries(metadata.animations)) {
    const relative = path.join('characters', id, clip.strip);
    strips[relative] = hash(await readFile(path.join(root, 'assets', relative)));
    if (clip.sha256 && clip.sha256 !== strips[relative]) throw new Error(`Stale ${id} strip receipt: ${sheet}`);
  }
  fighterAssets[id] = { metadataPath, metadataSha256: hash(bytes), strips,
    sheets: Object.keys(metadata.animations).length,
    cells: Object.values(metadata.animations).reduce((sum, clip) => sum + clip.frameCount, 0) };
}
await build({ root, publicDir: false, build: { outDir, emptyOutDir: true } });
const { ASSET_MANIFEST } = await tsImport(path.join(root, 'src/assets/manifest.ts'), import.meta.url);
const entries = Object.values(ASSET_MANIFEST).flat();
const urls = new Set(entries.flatMap(entry => entry.urls ?? [entry.url, entry.textureURL, entry.atlasURL]).filter(Boolean));
for (const url of urls) {
  const relative = url.replace(/^\//, '');
  if (!relative || relative.includes('..') || /^https?:/.test(relative)) throw new Error(`Unsupported asset URL: ${url}`);
  await mkdir(path.dirname(path.join(outDir, relative)), { recursive: true });
  await copyFile(path.join(root, 'assets', relative), path.join(outDir, relative));
}
for (const [id, receipt] of Object.entries(fighterAssets)) {
  if (hash(await readFile(path.join(root, receipt.metadataPath))) !== receipt.metadataSha256)
    throw new Error(`${id} metadata changed during build`);
  for (const [relative, expected] of Object.entries(receipt.strips)) {
    if (hash(await readFile(path.join(root, 'assets', relative))) !== expected ||
        hash(await readFile(path.join(outDir, relative))) !== expected)
      throw new Error(`${id} strip changed during build: ${relative}`);
  }
}
for (const [file, expected] of Object.entries(sourceHashes))
  if (hash(await readFile(path.join(root, file))) !== expected) throw new Error(`Source changed during build: ${file}`);
const bundle = (await readdir(path.join(outDir, 'assets'))).find(file => /^index-.*\.js$/.test(file));
if (!bundle) throw new Error('Application bundle missing');
await mkdir(path.dirname(path.resolve(root, checkpoint)), { recursive: true });
const sourceLeaves = `${checkpoint}-source-leaves`;
for (const file of files) {
  const target = path.join(sourceLeaves, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, file), target);
  if (hash(await readFile(target)) !== sourceHashes[file]) throw new Error(`Changed frozen source: ${file}`);
}
await writeFile(`${checkpoint}-source-hashes.json`, JSON.stringify(sourceHashes, null, 2) + '\n');
const record = { state: 'GUARDED_PRODUCTION_ASSETS_STAGED', outDir, bundle,
  bundleSha256: hash(await readFile(path.join(outDir, 'assets', bundle))),
  copied: urls.size, missing: [], sourceLeaves, sourceHashes: `${checkpoint}-source-hashes.json`, fighterAssets };
await writeFile(`${checkpoint}-assets-staged.json`, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ ...record, fighterAssets: Object.fromEntries(
  Object.entries(fighterAssets).map(([id, receipt]) => [id, {
    metadataSha256: receipt.metadataSha256, sheets: receipt.sheets, cells: receipt.cells,
    strips: Object.keys(receipt.strips).length,
  }]),
) }));
