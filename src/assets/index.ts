/**
 * Barrel export for the assets module so consumers can write
 * `import { ASSET_KEYS } from '@/assets'` instead of digging into
 * `'@/assets/manifest'`.
 */
export {
  ASSET_KEYS,
  ASSET_MANIFEST,
  getAllAssetEntries,
  findAssetEntry,
} from './manifest';
export type {
  AssetEntry,
  AssetKey,
  AssetKind,
  AssetManifest,
  AtlasAssetEntry,
  AudioAssetEntry,
  ImageAssetEntry,
  SpritesheetAssetEntry,
} from './manifest';
