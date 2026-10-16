/**
 * Golden-replay digest (STEP5-DESIGN 8.4 A): the hash of the one canonical
 * whole-world record, `captureMatchHistoryEvidence()`
 * (`replay/MatchHistoryEvidence.ts`). There is no second record: the goldens
 * and the history-restore check read the same evidence.
 *
 * FNV-1a 64 (two exact 32-bit words, both bytes of each UTF-16 code unit). This is NOT
 * `computeReplayChecksum` (`replay/replayChecksum.ts`, two 32-bit passes over
 * UTF-8). Phaser-free.
 */
import { STATE_CHECKSUM_HEX_LENGTH } from '../replay/stateChecksum';

/** FNV prime = 2^40 + 435. Keeping the product as two unsigned words
 * avoids a BigInt allocation for every byte of the large world evidence.
 * All intermediate integer products fit exactly in Number's 53-bit mantissa.
 */
export function fnv1a64(text: string): string {
  let high = 0xcbf29ce4, low = 0x84222325;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    low = (low ^ (code & 0xff)) >>> 0;
    let product = low * 435;
    high = (Math.imul(high, 435) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
    low = product >>> 0;
    low = (low ^ (code >>> 8)) >>> 0;
    product = low * 435;
    high = (Math.imul(high, 435) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
    low = product >>> 0;
  }
  const wordLength = STATE_CHECKSUM_HEX_LENGTH / 2;
  return high.toString(16).padStart(wordLength, '0') + low.toString(16).padStart(wordLength, '0');
}

/** A canonical evidence text and its FNV-1a 64 hash. */
export function simDigest(evidence: string): { readonly text: string; readonly hash: string } {
  return { text: evidence, hash: fnv1a64(evidence) };
}
