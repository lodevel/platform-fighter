import { build, preview } from 'vite';
import { tsImport } from 'tsx/esm/api';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

// Build the actual application with the repository Vite configuration. Stage
// only manifest assets, keeping native generation inputs out of the browser build.
const root = path.resolve(import.meta.dirname, '..');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'platform-fighter-pikachu-production-'));
const checkpoint = process.env.PF_BUILD_CHECKPOINT ?? '.tmp/pikachu-current-production';
const pikachuFramesPath = path.join(root, 'assets/characters/pikachu/frames.json');
const pikachuFramesBytes = await readFile(pikachuFramesPath);
const pikachuFramesSha256 = createHash('sha256').update(pikachuFramesBytes).digest('hex');
const pikachuFrames = JSON.parse(pikachuFramesBytes.toString('utf8'));
// Pin the actual application sources as well as assets. A specialist can
// update a runtime hook or reviewed receiving leaf during a long build.
const sourceFiles = (await readdir(path.join(root, 'src'), { recursive: true }))
  .filter(file => /\.(ts|tsx|json)$/.test(file) && !/\.(test|spec)\./.test(file))
  .map(file => path.join('src', file)).sort();
const sourceHashes = {};
for (const file of sourceFiles) sourceHashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
await build({ root, publicDir: false, build: { outDir, emptyOutDir: true } });
const { ASSET_MANIFEST } = await tsImport(path.join(root, 'src/assets/manifest.ts'), import.meta.url);
const manifest = Object.values(ASSET_MANIFEST).flat();
const files = new Set(manifest.flatMap(entry => entry.urls ?? [entry.url, entry.textureURL, entry.atlasURL]).filter(Boolean));
const missing = [];
let copied = 0;
for (const url of files) {
  const relative = url.replace(/^\//, '');
  if (!relative || relative.includes('..') || /^https?:/.test(relative)) throw new Error(`Unsupported manifest URL: ${url}`);
  const source = path.join(root, 'assets', relative);
  const target = path.join(outDir, relative);
  try { await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target); copied++; }
  catch (error) { if (error.code === 'ENOENT') missing.push(relative); else throw error; }
}
if (missing.length) throw new Error(`Production manifest assets missing: ${missing.join(', ')}`);
// Generation/packing can run independently. A build must bind the reviewed
// body metadata and actual staged PNGs rather than silently combine revisions.
for (const [sheet, clip] of Object.entries(pikachuFrames.animations)) {
  const staged = await readFile(path.join(outDir, 'characters/pikachu', clip.strip));
  const actualSha = createHash('sha256').update(staged).digest('hex');
  if (actualSha !== clip.sha256) throw new Error(`Reviewed Pikachu strip changed while building: ${sheet}`);
}
if (createHash('sha256').update(await readFile(pikachuFramesPath)).digest('hex') !== pikachuFramesSha256)
  throw new Error('Reviewed Pikachu metadata changed while building; rebuild this checkpoint');
for (const [file, expected] of Object.entries(sourceHashes))
  if (createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') !== expected)
    throw new Error(`Application source changed while building: ${file}; rebuild this checkpoint`);
const bundle = (await readdir(path.join(outDir, 'assets'))).find(file => /^index-.*\.js$/.test(file));
if (!bundle) throw new Error('Production application bundle missing');
const bundleSha256 = createHash('sha256').update(await readFile(path.join(outDir, 'assets', bundle))).digest('hex');
await mkdir(path.dirname(path.resolve(root, checkpoint)), { recursive: true });
await writeFile(`${checkpoint}-build-dir.txt`, `${outDir}\n`);
await writeFile(`${checkpoint}-pikachu-frames.json`, pikachuFramesBytes);
await writeFile(`${checkpoint}-source-hashes.json`, JSON.stringify(sourceHashes, null, 2) + '\n');
// Preserve the exact offline receiving expectations that production probes
// compare with this bundle, even after generation appends another body family.
// Hash guards above bind these immutable leaf copies to the built consumers.
const leafNames=['pikachuStateHurtboxes', 'pikachuSpecialPhaseHurtboxes', 'pikachuSpecialHurtboxes', 'pikachuAuxiliaryBody', 'pikachuLedgeJumpRuntime', 'pikachuSurfaceTech', 'pikachuItemAttachment', 'pikachuFootstool', 'pikachuJabHurtboxes', 'pikachuVerticalTiltHurtboxes', 'pikachuSmashHurtboxes'];
const sourceLeafDirectory=`${checkpoint}-source-leaves`;
await mkdir(sourceLeafDirectory,{recursive:true});
for (const leaf of leafNames) {
  const relative = `src/characters/${leaf}.ts`;
  const bytes = await readFile(path.join(root, relative));
  if (createHash('sha256').update(bytes).digest('hex') !== sourceHashes[relative])
    throw new Error(`Receiving expectation changed after source guard: ${relative}`);
  // Preserve runtime-relative helper imports in an immutable same-directory
  // graph. The four older dependency-free prefix snapshots remain compatible.
  await writeFile(path.join(sourceLeafDirectory,`${leaf}.ts`),bytes);
  if(leafNames.indexOf(leaf)<4)await writeFile(`${checkpoint}-${leaf}.ts`, bytes);
}
const record = { outDir, bundle, bundleSha256, copied, missing, pikachuFramesSha256, sourceLeafDirectory,
  sourceHashes: `${checkpoint}-source-hashes.json`,
  pikachuStrips: Object.keys(pikachuFrames.animations).length,
  pikachuCells: Object.values(pikachuFrames.animations).reduce((sum, clip) => sum + clip.frameCount, 0) };
await writeFile(`${checkpoint}-assets-staged.json`, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
if (process.argv.includes('--serve')) {
  const server = await preview({ root, base: '/platform-fighter/', publicDir: false, build: { outDir },
    preview: { host: '127.0.0.1', port: Number(process.env.PF_PREVIEW_PORT ?? 4214), strictPort: true } });
  server.printUrls();
}
