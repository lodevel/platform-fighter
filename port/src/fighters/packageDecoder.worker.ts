import { decodeIndexedPng } from '../../../character/render/indexedPng';

/** Decodes indexed pages off the main thread; the indices come back transferred, not copied. */
const scope = self as unknown as Worker;
scope.onmessage = async ({ data: { job, bytes } }: MessageEvent<{ job: number; bytes: Uint8Array<ArrayBuffer> }>) => {
  try {
    const image = await decodeIndexedPng(bytes);
    scope.postMessage({ job, image }, [image.data.buffer]);
  } catch (error) {
    scope.postMessage({ job, error: error instanceof Error ? error.message : String(error) });
  }
};
