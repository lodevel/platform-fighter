import { decodeIndexedPng, type IndexedImage } from '../../../character/render/indexedPng';

type Decode = (bytes: Uint8Array<ArrayBuffer>) => Promise<IndexedImage>;
type Reply = { job: number; image: IndexedImage; error?: undefined } | { job: number; error: string };

/**
 * Indexed page decoding for the package library. In a browser the inflate and row unfiltering
 * run on a few workers, so loading a fighter never blocks a menu frame; without workers (Node,
 * tests) it decodes in place.
 */
export function createPageDecoder(): Decode {
  if (typeof Worker === 'undefined') return decodeIndexedPng;
  const count = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));
  const workers: Worker[] = [], pending = new Map<number, { resolve(image: IndexedImage): void; reject(error: Error): void }>();
  let jobs = 0;
  const worker = (job: number) => {
    const index = job % count;
    if (!workers[index]) {
      const created = new Worker(new URL('./pageDecoder.worker.ts', import.meta.url), { type: 'module' });
      created.onmessage = ({ data }: MessageEvent<Reply>) => {
        const waiting = pending.get(data.job);
        pending.delete(data.job);
        if (data.error === undefined) waiting?.resolve(data.image);
        else waiting?.reject(new Error(data.error));
      };
      workers[index] = created;
    }
    return workers[index]!;
  };
  return bytes => new Promise((resolve, reject) => {
    const job = jobs++;
    pending.set(job, { resolve, reject });
    worker(job).postMessage({ job, bytes }, [bytes.buffer]);
  });
}
