import http from 'node:http';
import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dkProgress } from './dk-progress-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gallery = path.join(root, '.tmp/dk-live-gallery');
const baseline = path.join(root, '.tmp/pikachu-live-gallery/platform-fighter');
const port = Number(process.env.DK_REVIEW_PORT ?? 4196);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/dk-progress.json') {
      res.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(dkProgress(root))); return;
    }
    const app = url.pathname.startsWith('/platform-fighter/');
    const directory = app ? (existsSync(path.join(gallery, 'platform-fighter/index.html'))
      ? path.join(gallery, 'platform-fighter') : baseline) : root;
    const relative = app ? url.pathname.slice('/platform-fighter/'.length) : url.pathname.slice(1);
    const file = path.resolve(directory, relative || (app ? 'index.html' : 'dk-motion-preview.html'));
    if (!file.startsWith(directory + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store' }); res.end(readFileSync(file));
  } catch (error) { res.writeHead(500); res.end(String(error.message)); }
}).listen(port, '0.0.0.0', () => console.log(`DK review: http://localhost:${port}/dk-motion-preview.html`));
