import { build, preview } from 'vite';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root = path.resolve(import.meta.dirname, '..');
const outDir = '/tmp/platform-fighter-pikachu-jab-preview-20261006';
const { readBuildIdentity } = await tsImport(path.join(root, 'scripts/buildIdentity.ts'), import.meta.url);
const buildIdentity = readBuildIdentity(root);
await build({ configFile: false, root, base: '/', publicDir: false,
  plugins: [{ name: 'pikachu-preview-build-identity', enforce: 'pre', transform(_code, id) {
    if (id.replace(/\\/g, '/').endsWith('/src/engine/buildIdentity.ts')) {
      return { code: `export const SIMULATION_BUILD_ID = ${JSON.stringify(buildIdentity)};`, map: null };
    }
  } }],
  build: { outDir, emptyOutDir: true, target: 'es2022', sourcemap: true,
    rollupOptions: { input: path.join(root, 'pikachu-preview.html') } } });
const files = {};
for (const relative of ['pikachu-preview.html', ...readdirSync(path.join(outDir, 'assets')).map(file => `assets/${file}`)]) {
  files[relative] = createHash('sha256').update(readFileSync(path.join(outDir, relative))).digest('hex');
}
writeFileSync(path.join(root, 'docs/review/2026-10-06/pikachu-character/preview-build.json'),
  JSON.stringify({ scope: 'isolated jab-only unfinished-animation preview', buildIdentity, outDir, files }, null, 2) + '\n');
console.log(`Isolated preview built at ${outDir}; workspace dist untouched.`);
if (process.argv.includes('--serve')) {
  const server = await preview({ configFile: false, root, base: '/', publicDir: false,
    build: { outDir }, preview: { host: '127.0.0.1', port: 4178, strictPort: true } });
  server.printUrls();
}
