/** Whole-sprite project occlusion adapter. This cannot establish visible grip,
 * limb interleaving, native attachment constraints or native renderer parity. */
export interface CaptureDepthSurface {
  readonly depth: number;
  setDepth(depth: number): unknown;
}
export interface CaptureDepthResult {
  readonly status: 'paired';
  readonly context: string;
  readonly captureId: number;
  readonly captorBodyId: number;
  readonly recipientBodyId: number;
  readonly occlusion: 'recipient-front' | 'recipient-back' | 'legacy-order';
}
export interface CaptureDepthPair {
  readonly captor: CaptureDepthSurface;
  readonly recipient: CaptureDepthSurface;
  readonly captorCharacterId: string;
  readonly attachmentPolicy: string | undefined;
  readonly result: CaptureDepthResult;
  readonly live: Readonly<{
    active: boolean; reciprocal: boolean; context: string; captureId: number;
    captorBodyId: number; recipientBodyId: number;
    captorReset: number; recipientReset: number;
    currentCaptorReset: number; currentRecipientReset: number;
  }>;
  /** Mandatory, read-only runtime binding check: selected grip/anchor revisions,
   * descriptors and faces must still match the live simulation-owned poses. */
  readonly isCurrent: (result: CaptureDepthResult) => boolean;
}
export type CaptureDepthDecision = Readonly<{
  status: 'applied'; captureId: number; recipientBodyId: number;
  occlusion: 'recipient-front' | 'recipient-back'; depth: number;
}> | Readonly<{status: 'skipped'; reason: 'invalid-binding' | 'conflicting-pairs' | 'legacy-order' | 'invalid-depth'}>;

const contexts = new Set(['ordinary-held', 'ordinary-damage', 'ordinary-throw', 'cargo-held', 'cargo-throw']);
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const depthGap = 0.001; // Explicit project ordering calibration, unrelated to source units.

function validBinding(pair: CaptureDepthPair): boolean {
  const r = pair.result, l = pair.live;
  if (pair.captorCharacterId !== 'donkeykong' || pair.attachmentPolicy !== 'pose-anchors-beta-v1' ||
    pair.captor === pair.recipient || !l.active || !l.reciprocal || r.status !== 'paired' ||
    !contexts.has(r.context) || r.context !== l.context ||
    !['recipient-front', 'recipient-back', 'legacy-order'].includes(r.occlusion) ||
    ![r.captureId, r.captorBodyId, r.recipientBodyId, l.captureId, l.captorBodyId, l.recipientBodyId,
      l.captorReset, l.recipientReset, l.currentCaptorReset, l.currentRecipientReset].every(integer) ||
    r.captorBodyId === r.recipientBodyId || r.captureId !== l.captureId ||
    r.captorBodyId !== l.captorBodyId || r.recipientBodyId !== l.recipientBodyId ||
    l.captorReset !== l.currentCaptorReset || l.recipientReset !== l.currentRecipientReset) return false;
  try { return typeof pair.isCurrent === 'function' && pair.isCurrent(r) === true; }
  catch { return false; }
}

/** Owns only overrides it applied. No fighter-slot defaults or effects are reset. */
export class CaptureAttachmentDepthAdapter {
  private readonly priorDepths = new Map<CaptureDepthSurface, number>();

  update(pairs: readonly CaptureDepthPair[]): readonly CaptureDepthDecision[] {
    const valid = pairs.map(validBinding);
    // Fail closed on overlapping participant objects OR body IDs. Nested and
    // conflicting captures must never derive their order from iteration/slots.
    const conflicted = new Set<number>();
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      if (!valid[i] || !valid[j]) continue;
      const a = pairs[i]!, b = pairs[j]!;
      if ([a.captor, a.recipient].some(s => s === b.captor || s === b.recipient) ||
        [a.result.captorBodyId, a.result.recipientBodyId].some(id =>
          id === b.result.captorBodyId || id === b.result.recipientBodyId)) {
        conflicted.add(i); conflicted.add(j);
      }
    }
    const retained = new Set(pairs.filter((p, i) => valid[i] && !conflicted.has(i) &&
      p.result.occlusion !== 'legacy-order').map(p => p.recipient));
    for (const [surface, original] of this.priorDepths) if (!retained.has(surface)) {
      surface.setDepth(original); this.priorDepths.delete(surface);
    }
    return pairs.map((pair, i): CaptureDepthDecision => {
      if (!valid[i]) return {status: 'skipped', reason: 'invalid-binding'};
      if (conflicted.has(i)) return {status: 'skipped', reason: 'conflicting-pairs'};
      const occlusion = pair.result.occlusion;
      if (occlusion === 'legacy-order') return {status: 'skipped', reason: 'legacy-order'};
      const original = this.priorDepths.get(pair.recipient) ?? pair.recipient.depth;
      const captorDepth = pair.captor.depth;
      const depth = captorDepth + (occlusion === 'recipient-front' ? depthGap : -depthGap);
      if (!Number.isFinite(original) || !Number.isFinite(captorDepth) || !Number.isFinite(depth) ||
        (occlusion === 'recipient-front' ? depth <= captorDepth : depth >= captorDepth)) {
        if (this.priorDepths.has(pair.recipient)) {
          pair.recipient.setDepth(original); this.priorDepths.delete(pair.recipient);
        }
        return {status: 'skipped', reason: 'invalid-depth'};
      }
      if (!this.priorDepths.has(pair.recipient)) this.priorDepths.set(pair.recipient, original);
      pair.recipient.setDepth(depth);
      return {status: 'applied', captureId: pair.result.captureId,
        recipientBodyId: pair.result.recipientBodyId, occlusion, depth};
    });
  }

  restore(): void {
    for (const [surface, original] of this.priorDepths) surface.setDepth(original);
    this.priorDepths.clear();
  }
}
