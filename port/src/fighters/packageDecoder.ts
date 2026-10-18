import { decodeIndexedPng, type IndexedImage } from '../../../character/render/indexedPng';
import { decodeDescription, describePackage, type EncodedDescription, type PackageDescription } from './packageDescription';

/** The heavy work of loading a package, off the main thread in a browser. */
export interface PackageDecoder {
  /** character.json bytes → parsed, validated, pin-checked description of package `id`. */
  describe(id: string, bytes: Uint8Array<ArrayBuffer>, pinned: string | undefined): Promise<PackageDescription>;
  /** Indexed PNG → one byte per pixel. */
  page(bytes: Uint8Array<ArrayBuffer>): Promise<IndexedImage>;
}

/** Requests to the decoder worker (`packageDecoder.worker.ts`). */
export type DecoderRequest = { job: number } & ({ kind: 'describe'; id: string; bytes: Uint8Array<ArrayBuffer>; pinned: string | undefined }
  | { kind: 'page'; bytes: Uint8Array<ArrayBuffer> });
export type DecoderReply = { job: number; result: EncodedDescription | IndexedImage; error?: undefined } | { job: number; error: string };

/**
 * The package decoder. In a browser, parsing and validating character.json, inflating and
 * unfiltering pages run on a few workers, so loading a fighter never blocks a menu frame;
 * without workers (Node, tests) it runs in place.
 */
export function createPackageDecoder(): PackageDecoder {
  if (typeof Worker === 'undefined') return { describe: async (id, bytes, pinned) => describePackage(id, bytes, pinned), page: decodeIndexedPng };
  const count = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));
  const workers: Worker[] = [], pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>();
  let jobs = 0;
  const worker = (job: number) => {
    const index = job % count;
    if (!workers[index]) {
      const created = new Worker(new URL('./packageDecoder.worker.ts', import.meta.url), { type: 'module' });
      created.onmessage = ({ data }: MessageEvent<DecoderReply>) => {
        const waiting = pending.get(data.job);
        pending.delete(data.job);
        if (data.error === undefined) waiting?.resolve(data.result);
        else waiting?.reject(new Error(data.error));
      };
      workers[index] = created;
    }
    return workers[index]!;
  };
  // The bytes are transferred, not copied; so are the results' buffers on the way back.
  const run = <T>(request: DecoderRequest) => new Promise<T>((resolve, reject) => {
    pending.set(request.job, { resolve: resolve as (result: unknown) => void, reject });
    worker(request.job).postMessage(request, [request.bytes.buffer]);
  });
  return {
    describe: (id, bytes, pinned) => run<EncodedDescription>({ job: jobs++, kind: 'describe', id, bytes, pinned }).then(decodeDescription),
    page: bytes => run({ job: jobs++, kind: 'page', bytes }),
  };
}
