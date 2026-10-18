/** An Ultimate reference recording decoded frame by frame, so it plays on the lab's tick clock.
 * Ultimate Frame Data GIFs hold one frame per 60 Hz game frame, displayed slowed (130 ms each),
 * so frame N is tick N whatever the GIF's own delays say. */
export interface ReferenceClip {
  readonly width: number;
  readonly height: number;
  /** Recording length in 60 Hz ticks (one per frame). */
  readonly ticks: number;
  frameAt(tick: number): ImageBitmap;
  close(): void;
}

interface DecodedImage { readonly image: { close(): void } }
interface GifDecoder {
  readonly tracks: { readonly ready: Promise<void>; readonly selectedTrack: { readonly frameCount: number } | null };
  readonly completed: Promise<void>;
  decode(options: { frameIndex: number }): Promise<DecodedImage>;
  close(): void;
}
type DecoderClass = new (init: { data: ArrayBuffer; type: string }) => GifDecoder;

/** Decodes every frame with WebCodecs `ImageDecoder` (Chromium/Edge). Returns null where it is unavailable. */
export async function loadReference(url: string): Promise<ReferenceClip | null> {
  const Decoder = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder;
  if (!Decoder) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const decoder = new Decoder({ data: await response.arrayBuffer(), type: 'image/gif' });
  await decoder.tracks.ready; await decoder.completed;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0, frames: ImageBitmap[] = [];
  for (let frameIndex = 0; frameIndex < count; frameIndex++) {
    const { image } = await decoder.decode({ frameIndex });
    frames.push(await createImageBitmap(image as unknown as ImageBitmapSource));
    image.close();
  }
  decoder.close();
  if (!frames.length) return null;
  const first = frames[0]!;
  return {
    width: first.width, height: first.height, ticks: frames.length,
    frameAt: tick => frames[((Math.floor(tick) % frames.length) + frames.length) % frames.length]!,
    close() { for (const frame of frames) frame.close(); },
  };
}
