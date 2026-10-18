import { afterEach, describe, expect, it, vi } from 'vitest';
import { fighterArtUrl, paintFighterArt } from './fighterArt';

const preview = vi.hoisted(() => ({ revision: '1', capability: 'legacy', snapshot: vi.fn() }));
vi.mock('../../fighters/appearance', () => ({
  appearancePreviewIdentity: (character: string, palette: number) => `${character}:${palette}:${preview.revision}:${preview.capability}`,
  snapshotCharacterAppearance: preview.snapshot,
}));

function canvas(url: string): HTMLCanvasElement {
  return { width: 1, height: 1, url, getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, 255] }) }) } as unknown as HTMLCanvasElement;
}
function installCanvas() {
  vi.stubGlobal('document', { createElement: () => {
    let source: { url: string };
    return { width: 0, height: 0, getContext: () => ({ drawImage: (image: { url: string }) => { source = image; } }),
      toBlob: (done: (blob: { url: string }) => void) => done({ url: source.url }) };
  } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => (blob as unknown as { url: string }).url);
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); preview.snapshot.mockReset(); });

describe('character card previews', () => {
  it('shares previews only within the same profile revision, capability and palette', async () => {
    installCanvas();
    preview.snapshot.mockResolvedValue(canvas('data:card'));
    preview.revision = '1'; preview.capability = 'legacy';
    await Promise.all([fighterArtUrl('cache-test', 2), fighterArtUrl('cache-test', 2)]);
    expect(preview.snapshot).toHaveBeenCalledOnce();
    preview.revision = '2';
    await fighterArtUrl('cache-test', 2);
    preview.capability = 'computed';
    await fighterArtUrl('cache-test', 2);
    await fighterArtUrl('cache-test', 3);
    expect(preview.snapshot).toHaveBeenCalledTimes(4);
  });

  it('allows a failed preview to retry', async () => {
    installCanvas();
    preview.snapshot.mockRejectedValueOnce(new Error('preview failed')).mockResolvedValueOnce(canvas('data:retry'));
    await expect(fighterArtUrl('retry-test')).rejects.toThrow('preview failed');
    await expect(fighterArtUrl('retry-test')).resolves.toBe('data:retry');
    expect(preview.snapshot).toHaveBeenCalledTimes(2);
  });

  it('does not paint a superseded card when its old preview completes late', async () => {
    installCanvas();
    const node = { dataset: {}, style: { backgroundImage: '' } } as unknown as HTMLElement;
    let finishOld!: (value: HTMLCanvasElement) => void;
    preview.snapshot.mockImplementationOnce(() => new Promise<HTMLCanvasElement>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(canvas('data:new'));
    paintFighterArt(node, 'old-card');
    paintFighterArt(node, 'new-card');
    await fighterArtUrl('new-card');
    await Promise.resolve();
    expect(node.style.backgroundImage).toBe('url(data:new)');
    finishOld(canvas('data:old'));
    await fighterArtUrl('old-card');
    await Promise.resolve();
    expect(node.style.backgroundImage).toBe('url(data:new)');
  });
});
