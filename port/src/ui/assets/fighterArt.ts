import { appearancePreviewIdentity, snapshotCharacterAppearance } from '../../fighters/appearance';

/**
 * A fighter's menu art: its idle appearance in the chosen costume,
 * rendered by the game's appearance service, trimmed to the opaque pixels, as
 * a data URL for CSS backgrounds. Cached per profile revision, capability and costume.
 */
const cache = new Map<string, Promise<string>>();

export function fighterArtUrl(characterId: string, paletteIndex = 0): Promise<string> {
  const id = appearancePreviewIdentity(characterId, paletteIndex);
  let job = cache.get(id);
  if (!job) {
    job = snapshotCharacterAppearance(characterId, paletteIndex).then(trimToOpaque).catch((error: unknown) => {
      if (cache.get(id) === job) cache.delete(id);
      throw error;
    });
    cache.set(id, job);
  }
  return job;
}

function trimToOpaque(c: HTMLCanvasElement): string {
  const { data } = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return '';
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL();
}

/** Set an element's background to the fighter art once it is ready. */
export function paintFighterArt(node: HTMLElement, characterId: string | null, paletteIndex = 0): void {
  const id = characterId ? appearancePreviewIdentity(characterId, paletteIndex) : '';
  node.dataset.fighter = id;
  if (!characterId) { node.style.backgroundImage = ''; return; }
  void fighterArtUrl(characterId, paletteIndex).then((url) => {
    if (node.dataset.fighter === id) node.style.backgroundImage = url ? `url(${url})` : '';
  }).catch(() => {
    if (node.dataset.fighter === id) node.style.backgroundImage = '';
  });
}
