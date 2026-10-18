import { readFileSync, writeFileSync } from 'node:fs';
import { actionMemory, packageMemory } from '/home/lombet/Workspace/platform-fighter/character/package/memory';
const base = '/home/lombet/Workspace/platform-fighter/.tmp/character-packages';
const group = (a: string) => /victim|captured|cargo/.test(a) ? 'victim/cargo/captured' : /final/i.test(a) ? 'final' : /^h0|item|swing|throwitem|^e0\dcapture|hold_item/.test(a) ? 'held item' : 'core';
const out: any = {};
for (const id of ['donkeykong','link','pikachu']) {
  const pkg = JSON.parse(readFileSync(`${base}/${id}~repack/character.json`, 'utf8'));
  const g: Record<string, { n: number; mib: number }> = {};
  for (const a of Object.keys(pkg.actions)) { const k = group(a); g[k] ??= { n: 0, mib: 0 }; g[k].n++; g[k].mib += actionMemory(pkg, a).bc7Bytes / 2**20; }
  const tot = packageMemory(pkg).bc7Bytes / 2**20;
  out[id] = { total: tot, groups: g };
  console.log(id, tot.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, `${v.n} actions ${v.mib.toFixed(1)} MiB`]))));
}
writeFileSync(process.argv[2] + '/residency.json', JSON.stringify(out, null, 1));
