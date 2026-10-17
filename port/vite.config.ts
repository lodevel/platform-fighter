import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { readBuildIdentity } from '../scripts/buildIdentity';

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Replay/history metadata is bound to the same real source digest as Node. */
const simulationBuildIdentity = (): Plugin => ({
  name: 'simulation-build-identity',
  enforce: 'pre',
  transform(_code, id) {
    if (!id.replace(/\\/g, '/').endsWith('/src/engine/buildIdentity.ts')) return null;
    return { code: `export const SIMULATION_BUILD_ID = ${JSON.stringify(readBuildIdentity(PROJECT_ROOT))};`, map: null };
  },
  handleHotUpdate(context) {
    const identity = context.server.moduleGraph.getModuleById(path.resolve(PROJECT_ROOT, 'src/engine/buildIdentity.ts').replace(/\\/g, '/'));
    if (!identity) return;
    context.server.moduleGraph.invalidateModule(identity);
    return [...context.modules, identity];
  },
});

const ASSETS = path.resolve(__dirname, '../assets');
const PRIVATE = path.resolve(__dirname, 'private');
const BASIS = path.resolve(__dirname, '../node_modules/three/examples/jsm/libs/basis');
const MIME: Record<string, string> = { '.png': 'image/png', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

/** Serve files under `root` at `mount` (no copy into the build). */
function serveDir(mount: string, root: string) {
  return (req: { url?: string }, res: { setHeader(k: string, v: string): void } & NodeJS.WritableStream, next: () => void) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
    if (!url.startsWith(mount)) return next();
    const file = path.join(root, url.slice(mount.length));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  };
}

/**
 * ../assets is served by the preview server instead of being copied into
 * every build; port/private (personal pictures) is served by dev and preview
 * only, so it never reaches a build or a deploy. three's KTX2 transcoder is
 * served at basis/ by both, as the deploy copy places it.
 */
const sharedFiles = (): Plugin => ({
  name: 'shared-files',
  configureServer(server) {
    server.middlewares.use(serveDir('/private/', PRIVATE));
    server.middlewares.use(serveDir('/basis/', BASIS));
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveDir('/private/', PRIVATE));
    server.middlewares.use(serveDir('/basis/', BASIS));
    server.middlewares.use(serveDir('/', ASSETS));
    const base = server.config.base;
    if (base !== '/') {
      server.middlewares.use(serveDir(`${base}private/`, PRIVATE));
      server.middlewares.use(serveDir(`${base}basis/`, BASIS));
      server.middlewares.use(serveDir(base, ASSETS));
    }
  },
});

// The port reads the game's Phaser-free modules from ../src and serves the
// game's assets/ at the root, exactly like the root config does, so asset
// URLs from src/assets/manifest.ts resolve unchanged.
export default defineConfig({
  plugins: [simulationBuildIdentity(), sharedFiles()],
  root: '.',
  publicDir: '../assets',
  // WSL does not deliver file events for /mnt/c, so poll for edits.
  server: { host: '0.0.0.0', fs: { allow: ['..'] }, watch: { usePolling: true, interval: 1000 } },
  build: {
    target: 'es2022', outDir: 'dist', emptyOutDir: true, copyPublicDir: false,
    rollupOptions: { input: Object.fromEntries(['index', 'viewer', 'sandbox', 'costumes', ...(process.env.PF_PRESENTATION_FIXTURE === '1' ? ['appearance-fixture', 'appearance-match-fixture'] : [])]
      .map((page) => [page === 'index' ? 'main' : page, path.resolve(__dirname, `${page}.html`)])) },
  },
  // Static captures: the dev server reloads whenever another agent edits ../src.
  preview: { host: '0.0.0.0', port: 4211, strictPort: true },
  // Port tests are named *.check.ts so the root `vitest run` never picks them up.
  // After the gate merge the checks live in src/ as *.test.ts; none may remain here.
  test: { include: ['src/**/*.check.ts'], passWithNoTests: true },
});
