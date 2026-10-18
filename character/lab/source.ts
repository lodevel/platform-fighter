import type { CharacterPackage } from '../package/types';
import { validatePackage } from '../package/validate';

/** A package opened in the lab: its data and where each of its files can be fetched. */
export interface OpenPackage {
  readonly pkg: CharacterPackage;
  readonly fileUrl: (file: string) => string;
  /** Validation problems; a package with problems is still shown so they can be inspected. */
  readonly problems: readonly string[];
}

/** Package ids the dev server exports from `.tmp/character-packages` (empty in a static build). */
export async function servedPackages(): Promise<string[]> {
  try {
    const response = await fetch('/packages/index.json');
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return [];
    return ((await response.json()) as { packages: string[] }).packages;
  } catch { return []; }
}

export async function openServedPackage(id: string): Promise<OpenPackage> {
  const base = `/packages/${encodeURIComponent(id)}/`, response = await fetch(`${base}character.json`);
  if (!response.ok) throw new Error(`${id}: character.json returned HTTP ${response.status}`);
  return opened(await response.json(), file => base + file);
}

/** A package directory chosen with the folder picker: character.json plus its pages. */
export async function openPickedFolder(files: FileList): Promise<OpenPackage> {
  const list = [...files], json = list.find(file => file.webkitRelativePath.split('/').at(-1) === 'character.json');
  if (!json) throw new Error('The chosen folder has no character.json');
  const prefix = json.webkitRelativePath.slice(0, -'character.json'.length), urls = new Map<string, string>();
  for (const file of list) if (file.webkitRelativePath.startsWith(prefix)) urls.set(file.webkitRelativePath.slice(prefix.length), URL.createObjectURL(file));
  return opened(JSON.parse(await json.text()), file => {
    const url = urls.get(file);
    if (!url) throw new Error(`The package folder is missing ${file}`);
    return url;
  });
}

function opened(value: unknown, fileUrl: (file: string) => string): OpenPackage {
  return { pkg: value as CharacterPackage, fileUrl, problems: validatePackage(value) };
}
