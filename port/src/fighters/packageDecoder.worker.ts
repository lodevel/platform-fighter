import { decodeIndexedPng } from '../../../character/render/indexedPng';
import type { DecoderReply, DecoderRequest } from './packageDecoder';
import { describePackage, encodeDescription } from './packageDescription';

/** Decodes character packages off the main thread; byte results come back transferred, not copied. */
const scope = self as unknown as Worker;
scope.onmessage = async ({ data }: MessageEvent<DecoderRequest>) => {
  const reply = (message: DecoderReply, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
  try {
    if (data.kind === 'describe') {
      const result = encodeDescription(describePackage(data.id, data.bytes, data.pinned));
      reply({ job: data.job, result }, [result.json.buffer, result.palette.buffer]);
    } else {
      const result = await decodeIndexedPng(data.bytes);
      reply({ job: data.job, result }, [result.data.buffer]);
    }
  } catch (error) {
    reply({ job: data.job, error: error instanceof Error ? error.message : String(error) });
  }
};
