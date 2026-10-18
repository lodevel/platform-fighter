import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * The character lab: a standalone app over character packages, built without the game.
 *   npm run lab          dev server; serves exported packages and local Ultimate references
 *   npm run lab:build    static build in dist-lab/ (packages are then opened with the folder picker)
 */
const PACKAGES = path.resolve(__dirname, '.tmp/character-packages');
const REFERENCES = path.resolve(__dirname, 'assets/gen');
const TYPES: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

/** Serves `/packages/` (with a generated index.json) and `/references/` from local, git-ignored folders. */
function localFolders(): Plugin {
  const serve = (root: string): Connect.NextHandleFunction => (request, response, next) => {
    const relative = decodeURIComponent((request.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
    if (root === PACKAGES && relative === 'index.json') {
      const ids = existsSync(PACKAGES) ? readdirSync(PACKAGES).filter(id => existsSync(path.join(PACKAGES, id, 'character.json'))).sort() : [];
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ packages: ids }));
      return;
    }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) { next(); return; }
    response.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(response);
  };
  return {
    name: 'character-lab-local-folders',
    configureServer(server) {
      server.middlewares.use('/packages', serve(PACKAGES));
      server.middlewares.use('/references', serve(REFERENCES));
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'character/lab'),
  base: './',
  plugins: [localFolders()],
  build: { outDir: path.resolve(__dirname, 'dist-lab'), emptyOutDir: true },
  server: { host: '0.0.0.0', port: 5180, strictPort: false, open: false },
});
