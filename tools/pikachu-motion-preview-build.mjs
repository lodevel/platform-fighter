import { build, preview } from 'vite';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const prototype = process.argv.includes('--prototype');
if (prototype) throw new Error('The old prototype is immutable. Use its preserved build; this builder prepares the new eight-pose candidate only.');
const recordName = 'motion-eight-pose';
const { PIKACHU_TILT_PREVIEW_FILES, PIKACHU_TILT_PREVIEW_SCHEDULE } = await tsImport(
  path.join(root, 'src/previews/pikachuForwardTiltPreviewPoses.ts'), import.meta.url);
// Root/art review is required before a generated drawing enters this candidate.
const approval = JSON.parse(readFileSync(path.join(root,
  `docs/review/2026-10-06/pikachu-character/${recordName}/art-approval.json`), 'utf8'));
if (approval.status !== 'accepted_for_candidate_build') throw new Error('Eight-pose drawings remain unqualified; no preview build is authorized yet.');
const poseFiles = Object.values(PIKACHU_TILT_PREVIEW_FILES);
const renderMetrics = {};
const art = Object.fromEntries(poseFiles.map(file => {
  const bytes = readFileSync(path.join(root, 'docs/review/2026-10-06/pikachu-character/art', file));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const row = approval.files[file];
  if (!row || row.status !== 'accepted_for_rough_preview' || row.sha256 !== hash
    || !row.artReview || !row.rootReview) throw new Error(`Missing or stale qualified drawing: ${file}`);
  const png = PNG.sync.read(bytes);
  const expectedWidth = file === 'reference-registered.png' ? 1024 : 1536;
  if (png.width !== expectedWidth || png.height !== 1024) throw new Error(`Wrong registered canvas: ${file}`);
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1, transparent = 0, opaque = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const alpha = png.data[(y * png.width + x) * 4 + 3];
    if (alpha === 0) transparent++;
    if (alpha === 255) opaque++;
    if (alpha > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  if (!transparent || !opaque) throw new Error(`Missing actual transparent/opaque foreground: ${file}`);
  renderMetrics[file] = { width: png.width, height: png.height, nonzeroAlphaBounds: { minX, minY, maxX, maxY },
    transparentFraction: transparent / (png.width * png.height), foregroundBottomFromRootWorld: (maxY - 880) * 70 / 600 };
  return [file, hash];
}));
// Keep earlier served builds and their acceptance evidence intact on every run.
const outDir = mkdtempSync('/tmp/platform-fighter-pikachu-motion-eight-pose-20261006-');
const { readBuildIdentity } = await tsImport(path.join(root, 'scripts/buildIdentity.ts'), import.meta.url);
const buildIdentity = readBuildIdentity(root);
await build({ configFile: false, root, base: '/', publicDir: false,
  plugins: [{ name: 'pikachu-motion-preview-build-identity', enforce: 'pre', transform(_code, id) {
    if (id.replace(/\\/g, '/').endsWith('/src/engine/buildIdentity.ts')) {
      return { code: `export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`, map: null };
    }
  } }],
  build: { outDir, emptyOutDir: true, target: 'es2022', sourcemap: true,
    rollupOptions: { input: path.join(root, 'pikachu-forward-tilt-preview.html') } } });
const files = {};
for (const relative of ['pikachu-forward-tilt-preview.html', ...readdirSync(path.join(outDir, 'assets')).map(file => `assets/${file}`)]) {
  files[relative] = createHash('sha256').update(readFileSync(path.join(outDir, relative))).digest('hex');
}
writeFileSync(path.join(root, `docs/review/2026-10-06/pikachu-character/${recordName}-build.json`),
  JSON.stringify({ scope: 'isolated rough eight-pose normal-attack candidate', buildIdentity, outDir, art,
    poseSchedule: PIKACHU_TILT_PREVIEW_SCHEDULE, approval, renderMetrics, files }, null, 2) + '\n');
console.log(`Isolated motion preview built at ${outDir}; existing previews preserved.`);
if (process.argv.includes('--serve')) {
  const server = await preview({ configFile: false, root, base: '/', publicDir: false,
    build: { outDir }, preview: { host: '127.0.0.1', port: 4185, strictPort: true } });
  server.printUrls();
}
