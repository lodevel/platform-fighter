import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface BuildSource { readonly path: string; readonly contents: string }

/** Sorted, length-delimited text sources make the identity independent of
 * traversal order and Windows/WSL line endings, sensitive to code and content. */
export function computeBuildIdentity(sources: ReadonlyArray<BuildSource>): string {
  const normalized = sources.map(source => ({
    path: source.path.replace(/\\/g, '/'),
    contents: source.contents.replace(/\r\n/g, '\n'),
  })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const hash = createHash('sha256');
  for (const source of normalized) {
    hash.update(`${source.path.length}:${source.path}${source.contents.length}:${source.contents}`);
  }
  return `platform-fighter-sha256-${hash.digest('hex')}`;
}

export function readBuildIdentity(projectRoot: string): string {
  const sources: BuildSource[] = [];
  const add = (relative: string) => sources.push({ path: relative, contents: readFileSync(path.join(projectRoot, relative), 'utf8') });
  const visit = (directory: string) => {
    for (const entry of readdirSync(path.join(projectRoot, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== '__fixtures__') visit(relative);
      } else if (/\.(ts|js|json)$/.test(entry.name) && !/\.(test|check)\.[jt]s$/.test(entry.name)) add(relative);
    }
  };
  visit('src');
  // The Three host owns input sampling and animation clocks. Vendored Matter
  // JavaScript above also affects gameplay independently of package-lock.json.
  if (existsSync(path.join(projectRoot, 'port/src'))) visit('port/src');
  if (existsSync(path.join(projectRoot, 'port/vite.config.ts'))) add('port/vite.config.ts');
  // Authored model/animation data can affect collision and presentation timing.
  visit('assets/characters');
  for (const relative of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'scripts/buildIdentity.ts']) add(relative);
  return computeBuildIdentity(sources);
}
