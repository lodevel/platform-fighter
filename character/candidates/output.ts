import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, withRevision } from '../package/canonical';
import { actionMemory, packageMemory, type MemoryEstimate } from '../package/memory';
import type { CharacterPackage } from '../package/types';
import { validatePackage } from '../package/validate';

/** What every candidate command reads: `<id> [--packages dir] …options`. */
export interface CandidateSource {
  readonly option: (name: string) => string | undefined;
  readonly id: string;
  readonly root: string;
  readonly dir: string;
  readonly pkg: CharacterPackage;
}

export function readCandidateSource(usage: string): CandidateSource {
  const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!id) throw new Error(`Usage: ${usage}`);
  const root = path.resolve(option('--packages') ?? '.tmp/character-packages'), dir = path.join(root, id);
  return { option, id, root, dir, pkg: JSON.parse(readFileSync(path.join(dir, 'character.json'), 'utf8')) as CharacterPackage };
}

/**
 * Writes `<id>~<name>` beside the source: the package built by `pack` into the new
 * folder, with a revision and provenance, and a candidate-report.json comparing it with
 * the source.
 */
export async function writeCandidate(source: CandidateSource, name: string, importer: { name: string; version: string },
  settings: Record<string, unknown>, pack: (dir: string) => CharacterPackage): Promise<void> {
  const dir = path.join(source.root, `${source.id}~${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'pages'), { recursive: true });
  const packed = await withRevision({ ...pack(dir), revision: '',
    provenance: { importer, sources: { [`${source.id}/character.json`]: source.pkg.revision } } });
  const problems = validatePackage(packed);
  writeFileSync(path.join(dir, 'character.json'), canonicalJson(packed));
  const row = (m: MemoryEstimate) => ({ drawings: m.drawings, pages: m.pages, drawnPixels: m.drawnPixels, rgbaBytes: m.rgbaBytes, bc7Bytes: m.bc7Bytes, gpuBytes: m.gpuBytes });
  const actions = Object.keys(packed.actions).sort().map(action => ({ action,
    windows: [source.pkg.actions[action]!.drawings.windows.length, packed.actions[action]!.drawings.windows.length],
    drawings: [actionMemory(source.pkg, action).drawings, actionMemory(packed, action).drawings],
    drawnPixels: [actionMemory(source.pkg, action).drawnPixels, actionMemory(packed, action).drawnPixels] }));
  const before = packageMemory(source.pkg), total = packageMemory(packed);
  writeFileSync(path.join(dir, 'candidate-report.json'), JSON.stringify({ schema: 'character-candidate/1', candidate: name,
    source: { id: source.id, revision: source.pkg.revision }, ...settings, problems,
    source_memory: row(before), memory: row(total), actions }, null, 1) + '\n');
  console.log(`${source.id}~${name}: ${total.drawings} drawings, ${(total.drawnPixels / 1e6).toFixed(1)} M drawn px, ` +
    `GPU ${(total.gpuBytes / 2 ** 20).toFixed(1)} MiB (source ${(before.gpuBytes / 2 ** 20).toFixed(1)}), ${problems.length} problems`);
}
