import { getAllAssetEntries } from '../../../../src/assets/manifest';
import type { CharacterId } from '../../../../src/types';
import { sheetTextureBytes, type SheetTexture, type TextureStore } from '../../engine/sprites/textureStore';
import { LEGACY_SPRITE_CAPABILITY } from '../../../../src/characterPresentation/legacy/profiles';
import { pikachuFinalStartupPage, replacedPikachuFinalOwnerPage } from '../finalVisual';
import { registerAppearanceResourceProvider, registerSharedAppearanceResources } from '../resources';

const preloadEpoch = new WeakMap<TextureStore, number>();
/** Avoid moving a multi-GiB PNG bank's first-use cost into an enormous GPU
 * allocation. Initial poses and Final startup compete within this explicit
 * total budget; remaining sheets upload through their actual first draw. */
const GPU_WARM_BYTES = 64 * 1024 * 1024;
function warmPriority(key: string): number {
  const sheet = key.split('.').at(-1);
  if (sheet === 'idle' || sheet === 'j00entryr' || sheet === 'entry') return 0;
  if (pikachuFinalStartupPage(key)) return 1;
  if (sheet && ['final', 'final_air', 'final_start', 'final_air_start', 'd04final', 'd04finalair'].includes(sheet)) return 1;
  return 2;
}

/** Finish decoding match art before its first action can select a sheet. */
export async function preloadLegacyMatchArt(textures: TextureStore, fighters: readonly CharacterId[], progress: (done: number, total: number) => void,
  prepare?: (sheet: SheetTexture) => void, signal?: AbortSignal, includeItems = true): Promise<void> {
  if (signal?.aborted) return;
  const epoch = (preloadEpoch.get(textures) ?? 0) + 1;
  preloadEpoch.set(textures, epoch);
  const active = () => !signal?.aborted && preloadEpoch.get(textures) === epoch;
  textures.retainMatchFighters(fighters);
  const prefixes = [...new Set(fighters)].map((fighter) => `char.${fighter}.`);
  const entries = getAllAssetEntries().filter((entry) => (entry.kind === 'image' || entry.kind === 'spritesheet')
    && !replacedPikachuFinalOwnerPage(entry.key)
    && (prefixes.some((prefix) => entry.key.startsWith(prefix)) || (includeItems && entry.key.startsWith('item.'))))
    .sort((a, b) => warmPriority(a.key) - warmPriority(b.key));
  let next = 0, done = 0, warmedBytes = 0;
  const warmCandidates: Array<{ key: string; sheet: SheetTexture; bytes: number }> = [];
  progress(done, entries.length);
  try { await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
    while (next < entries.length && active()) {
      const entry = entries[next++]!;
      const sheet = await textures.load(entry.key);
      if (active()) {
        const bytes = sheetTextureBytes(sheet);
        if (prepare && warmPriority(entry.key) < 2) warmCandidates.push({ key: entry.key, sheet, bytes });
        progress(++done, entries.length);
      }
    }
  })); } catch (error: unknown) {
    // Stop scheduling the remaining bank after one failed fetch/decode. The
    // already in-flight workers can finish, but cannot keep uploading behind
    // the fault dialog or supersede a newer match's preload.
    if (preloadEpoch.get(textures) === epoch) preloadEpoch.set(textures, epoch + 1);
    throw error;
  }
  // Decode completion order must not let Final pages consume the budget
  // before a slower entry page. Upload only after decoding, in priority order.
  for (const candidate of warmCandidates.sort((a, b) => warmPriority(a.key) - warmPriority(b.key) || a.key.localeCompare(b.key))) {
    if (!active()) return;
    if (warmedBytes + candidate.bytes > GPU_WARM_BYTES) continue;
    prepare?.(candidate.sheet);
    textures.recordPreparation(candidate.key, candidate.bytes);
    warmedBytes += candidate.bytes;
  }
}

let registered = false;
export function registerLegacyAppearanceResources(): void {
  if (registered) return;
  registered = true;
  registerAppearanceResourceProvider({ capability: LEGACY_SPRITE_CAPABILITY,
    prepare(resources, host, { signal, progress }) {
      const fighters: CharacterId[] = [];
      for (const resource of resources) {
        if (resource === 'items') continue;
        if (!resource.startsWith('fighter:')) throw new Error(`Unsupported legacy resource '${resource}'`);
        fighters.push(resource.slice('fighter:'.length) as CharacterId);
      }
      return preloadLegacyMatchArt(host.textures, fighters, progress,
        sheet => { if (!signal.aborted) host.renderer.initTexture(sheet.texture); }, signal, resources.includes('items'));
    },
  });
  registerSharedAppearanceResources(LEGACY_SPRITE_CAPABILITY, ['items']);
}
