import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repack } from '/home/lombet/Workspace/platform-fighter/character/candidates/pixels';
import { packageMemory, actionMemory } from '/home/lombet/Workspace/platform-fighter/character/package/memory';
import { validatePackage } from '/home/lombet/Workspace/platform-fighter/character/package/validate';
const S = process.argv[2]!;
const base = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages';
const rows: any[] = [];
const names = [['donkeykong','current'],['link','current'],['pikachu','current'],...readdirSync(path.join(S,'stage')).map(n=>[n.split('~')[0]!,n.split('~')[1]!])];
const isFinal = (a: string) => a.toLowerCase().includes('final') && !a.includes('victim');
for (const [id, cand] of names) {
  const dir = cand === 'current' ? path.join(base, `${id}~repack`) : path.join(S, 'stage', `${id}~${cand}`);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'character.json'), 'utf8'));
  let packed = pkg;
  if (cand !== 'current') { const out = path.join(S, 'packed', `${id}~${cand}`); mkdirSync(path.join(out, 'pages'), { recursive: true }); packed = repack(pkg, dir, out); }
  const m = packageMemory(packed);
  let fin = 0, normal = 0;
  const finalIds = Object.keys(packed.actions).filter(isFinal);
  const fm = finalIds.reduce((n, a) => n + actionMemory(packed, a).bc7Bytes, 0);
  rows.push({ id, cand, drawings: m.drawings, pages: m.pages, drawnPixels: m.drawnPixels, rgbaMiB: m.rgbaBytes / 2**20, bc7MiB: m.bc7Bytes / 2**20, finalActionsBc7MiB: fm / 2**20, problems: validatePackage(packed).length });
  console.log(id, cand, (m.bc7Bytes/2**20).toFixed(1), 'MiB BC7', validatePackage(packed).length, 'problems');
}
writeFileSync(path.join(S, 'memory.json'), JSON.stringify(rows, null, 1));
