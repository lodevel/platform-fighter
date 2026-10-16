import { readFile, writeFile, mkdir, mkdtemp, cp, rename, rmdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const receiptPath = process.argv[2];
if (!receiptPath) throw new Error('Supply the guarded production receipt');
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
if (receipt.state !== 'GUARDED_PRODUCTION_ASSETS_STAGED' || receipt.missing.length) throw new Error('Incomplete production receipt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gallery = '.tmp/dk-live-gallery';
await mkdir(gallery, { recursive: true });
const staged = await mkdtemp(path.join(gallery, 'publication-staged-'));
const app = path.join(staged, 'platform-fighter');
await cp(receipt.outDir, app, { recursive: true });
if (hash(await readFile(path.join(app, 'assets', receipt.bundle))) !== receipt.bundleSha256) throw new Error('Staged bundle changed');
for (const fighter of Object.values(receipt.fighterAssets))
  for (const [file, expected] of Object.entries(fighter.strips))
    if (hash(await readFile(path.join(app, file))) !== expected) throw new Error(`Staged strip changed: ${file}`);
const publicationPath = path.join(gallery, 'publication.json');
const target = path.join(gallery, 'platform-fighter');
let previous;
try { previous = JSON.parse(await readFile(publicationPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let targetExists = true;
try { await access(target); } catch (error) { if (error.code === 'ENOENT') targetExists = false; else throw error; }
if (targetExists) {
  const archive = path.join(gallery, `archive-${previous?.bundle ?? Date.now()}`);
  await rename(target, archive);
}
await rename(app, target); await rmdir(staged);
const publication = { state: 'MECHANICS_CHECKPOINT_UNDER_LIVE_VERIFICATION', bundle: receipt.bundle,
  bundleSha256: receipt.bundleSha256, checkpoint: receiptPath,
  description: process.argv[3] ?? 'Revised mechanics checkpoint is undergoing live verification. Sprites remain the audited baseline; full DK action qualification is pending.' };
await writeFile(publicationPath + '.pending', JSON.stringify(publication, null, 2) + '\n');
await rename(publicationPath + '.pending', publicationPath);
console.log(JSON.stringify({ published: target, bundle: publication.bundle, sha256: publication.bundleSha256 }));
