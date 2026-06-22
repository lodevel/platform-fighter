/**
 * is-main.ts — robust "was this module run directly as a CLI?" check.
 *
 * The naive `import.meta.url === ` + `file://${resolve(argv[1])}`` comparison
 * breaks on Windows node (drive letters, backslashes, %20 URL-encoding of the
 * worktree path). `pathToFileURL` produces a canonical file URL on every
 * platform, so comparing the two canonical URLs is reliable.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return importMetaUrl === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}
