import type { CharacterPackage } from './types';

/** The package as canonical JSON: keys sorted at every level, two-space indent, final newline.
 * The same package always produces the same bytes. */
export function canonicalJson(pkg: CharacterPackage): string {
  return JSON.stringify(sortKeys(pkg), null, 2) + '\n';
}

/** Returns the package with `revision` set to the SHA-256 of its canonical form
 * (computed with an empty revision), so any content change changes the revision. */
export async function withRevision(pkg: CharacterPackage): Promise<CharacterPackage> {
  const bytes = new TextEncoder().encode(canonicalJson({ ...pkg, revision: '' }));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return { ...pkg, revision: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys((value as Record<string, unknown>)[key])]));
}
