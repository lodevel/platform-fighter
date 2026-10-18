import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repack } from '/home/lombet/Workspace/platform-fighter/character/candidates/pixels';
import { packageMemory } from '/home/lombet/Workspace/platform-fighter/character/package/memory';
const S = process.argv[2]!;
const base = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages';
const rows: any[] = [];
for (const id of ['donkeykong','link','pikachu']) {
  const holds = JSON.parse(readFileSync(`${base}/${id}~holds-0.12/character.json`, 'utf8'));
  for (const cand of ['A-1080-all','B-1080-final2.8','C-1440-final2.8']) {
    const dir = path.join(S, 'stage', `${id}~${cand}`);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'character.json'), 'utf8'));
    const keep = Object.fromEntries(Object.entries(pkg.drawings).filter(([k]) => k in holds.drawings));
    const out = path.join(S, 'packed', `${id}~${cand}+holds`); mkdirSync(path.join(out, 'pages'), { recursive: true });
    const m = packageMemory(repack({ ...pkg, drawings: keep, actions: holds.actions }, dir, out));
    rows.push({ id, cand: cand + '+holds0.12', drawings: m.drawings, bc7MiB: m.bc7Bytes / 2**20 });
    console.log(id, cand, '+holds', (m.bc7Bytes / 2**20).toFixed(1));
  }
}
writeFileSync(path.join(S, 'memory-combined.json'), JSON.stringify(rows, null, 1));
