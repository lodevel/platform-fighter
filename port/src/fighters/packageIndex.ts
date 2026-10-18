import shipped from '../../../assets/characters/packages.json';

/**
 * The character packages the game ships (`assets/characters/<id>/package/`), written by
 * `npm run character:package`. A package's files are fetched at runtime, never bundled;
 * only this small index is.
 */
export const PACKAGE_INDEX_SCHEMA = 'character-package-index/1';

export interface PackageIndexEntry {
  /** The package's content hash; the profile revision a match pins. */
  readonly revision: string;
  readonly pages: number;
  readonly drawings: number;
  /** `packageMemory(pkg).gpuBytes`: one byte per page pixel for indexed pages. */
  readonly gpuBytes: number;
  /** character.json plus its pages, as stored. */
  readonly diskBytes: number;
}

export interface PackageIndex {
  readonly schema: typeof PACKAGE_INDEX_SCHEMA;
  readonly packages: Record<string, PackageIndexEntry>;
}

export const SHIPPED_PACKAGES = shipped as PackageIndex;

/** Where a shipped package's file lives, relative to the asset root (`manifestAssetUrl`). */
export const packageAssetPath = (id: string, file: string): string => `characters/${id}/package/${file}`;
