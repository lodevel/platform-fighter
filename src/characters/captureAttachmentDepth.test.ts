import {describe, expect, it} from 'vitest';
import {CaptureAttachmentDepthAdapter, type CaptureDepthPair} from './captureAttachmentDepth';

class Surface {
  constructor(public depth: number) {}
  setDepth(depth: number) { this.depth = depth; }
}
function fixture(captor = new Surface(1), recipient = new Surface(7.25)): CaptureDepthPair {
  return {captor, recipient, captorCharacterId: 'donkeykong', attachmentPolicy: 'pose-anchors-beta-v1',
    result: {status: 'paired', context: 'ordinary-held', captureId: 3,
      captorBodyId: 11, recipientBodyId: 29, occlusion: 'recipient-back'},
    live: {active: true, reciprocal: true, context: 'ordinary-held', captureId: 3,
      captorBodyId: 11, recipientBodyId: 29, captorReset: 5, recipientReset: 6,
      currentCaptorReset: 5, currentRecipientReset: 6}, isCurrent: () => true};
}

describe('reviewed whole-sprite capture occlusion project adapter', () => {
  it('uses captor depth and restores the recipient own prior depth, touching no other surface', () => {
    const adapter = new CaptureAttachmentDepthAdapter(), pair = fixture(), effect = new Surface(8);
    expect(adapter.update([pair])[0]?.status).toBe('applied');
    expect(pair.recipient.depth).toBeCloseTo(0.999, 12);
    expect(pair.captor.depth).toBe(1); expect(effect.depth).toBe(8);
    adapter.update([]); expect(pair.recipient.depth).toBe(7.25); expect(effect.depth).toBe(8);
    adapter.restore(); expect(pair.recipient.depth).toBe(7.25);
  });
  it.each([false, true])('is independent of fighter-slot order (swapped=%s)', swapped => {
    const sprites = [new Surface(1), new Surface(1)];
    const captor = sprites[swapped ? 1 : 0]!, recipient = sprites[swapped ? 0 : 1]!;
    const adapter = new CaptureAttachmentDepthAdapter();
    adapter.update([fixture(captor, recipient)]);
    expect(recipient.depth).toBeLessThan(captor.depth);
    adapter.restore(); expect(sprites.map(s => s.depth)).toEqual([1, 1]);
  });
  it('changes explicit back/front intent while retaining the original recipient depth', () => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter();
    adapter.update([pair]);
    adapter.update([{...pair, result: {...pair.result, occlusion: 'recipient-front'}}]);
    expect(pair.recipient.depth).toBeCloseTo(1.001, 12);
    adapter.restore(); expect(pair.recipient.depth).toBe(7.25);
  });
  it('follows an externally changed captor depth without changing captor/effects', () => {
    const captor = new Surface(2.5), pair = fixture(captor), adapter = new CaptureAttachmentDepthAdapter();
    adapter.update([pair]); captor.setDepth(4.125); adapter.update([pair]);
    expect(pair.recipient.depth).toBeCloseTo(4.124, 12); expect(captor.depth).toBe(4.125);
    adapter.restore(); expect(pair.recipient.depth).toBe(7.25);
  });
  it.each(['capture', 'reset-captor', 'reset-recipient', 'context', 'reciprocity', 'inactive', 'pose', 'wrong-target', 'policy', 'non-DK'])
  ('restores on live %s mismatch instead of moving an unrelated or stale sprite', reason => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter(); adapter.update([pair]);
    const bad: CaptureDepthPair = {...pair, live: {...pair.live}};
    const replacements: Record<string, CaptureDepthPair> = {
      capture: {...bad, live: {...bad.live, captureId: 4}},
      'reset-captor': {...bad, live: {...bad.live, currentCaptorReset: 8}},
      'reset-recipient': {...bad, live: {...bad.live, currentRecipientReset: 9}},
      context: {...bad, live: {...bad.live, context: 'ordinary-throw'}},
      reciprocity: {...bad, live: {...bad.live, reciprocal: false}},
      inactive: {...bad, live: {...bad.live, active: false}},
      pose: {...bad, isCurrent: () => false},
      'wrong-target': {...bad, live: {...bad.live, recipientBodyId: 30}},
      policy: {...bad, attachmentPolicy: undefined},
      'non-DK': {...bad, captorCharacterId: 'pikachu'},
    };
    expect(adapter.update([replacements[reason]!])).toEqual([{status: 'skipped', reason: 'invalid-binding'}]);
    expect(pair.recipient.depth).toBe(7.25); expect(pair.captor.depth).toBe(1);
  });
  it('restores when selected metadata requests legacy-order', () => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter(); adapter.update([pair]);
    expect(adapter.update([{...pair, result: {...pair.result, occlusion: 'legacy-order'}}]))
      .toEqual([{status: 'skipped', reason: 'legacy-order'}]);
    expect(pair.recipient.depth).toBe(7.25);
  });
  it('rejects duplicate/conflicting participant objects and restores prior override', () => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter(); adapter.update([pair]);
    expect(adapter.update([pair, {...pair}]).map(r => r.status)).toEqual(['skipped', 'skipped']);
    expect(pair.recipient.depth).toBe(7.25);
    const nested = fixture(pair.recipient, new Surface(5));
    expect(adapter.update([pair, {...nested, result: {...nested.result, captorBodyId: 29, recipientBodyId: 42},
      live: {...nested.live, captorBodyId: 29, recipientBodyId: 42}}]).every(r => r.status === 'skipped')).toBe(true);
  });
  it('rejects duplicate body IDs even when sprite objects differ', () => {
    const a = fixture(), b = fixture(new Surface(2), new Surface(3));
    expect(new CaptureAttachmentDepthAdapter().update([a, b])).toEqual([
      {status: 'skipped', reason: 'conflicting-pairs'}, {status: 'skipped', reason: 'conflicting-pairs'}]);
    expect(a.recipient.depth).toBe(7.25); expect(b.recipient.depth).toBe(3);
  });
  it('handles two disjoint live pairs and restores only the released pair', () => {
    const a = fixture(), b0 = fixture(new Surface(3), new Surface(9));
    const b = {...b0, result: {...b0.result, captorBodyId: 41, recipientBodyId: 53},
      live: {...b0.live, captorBodyId: 41, recipientBodyId: 53}};
    const adapter = new CaptureAttachmentDepthAdapter();
    expect(adapter.update([a, b]).every(r => r.status === 'applied')).toBe(true);
    adapter.update([b]); expect(a.recipient.depth).toBe(7.25); expect(b.recipient.depth).toBeCloseTo(2.999, 12);
    adapter.restore(); expect(b.recipient.depth).toBe(9);
  });
  it('fails closed if the read-only current-pose predicate throws', () => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter(); adapter.update([pair]);
    expect(adapter.update([{...pair, isCurrent: () => {throw new Error('missing binding');}}])[0]?.status).toBe('skipped');
    expect(pair.recipient.depth).toBe(7.25);
  });
  it.each([NaN, Infinity, Number.MAX_VALUE])('rejects a nonfinite/unorderable captor depth %s', depth => {
    const pair = fixture(new Surface(depth));
    expect(new CaptureAttachmentDepthAdapter().update([pair])).toEqual([{status: 'skipped', reason: 'invalid-depth'}]);
    expect(pair.recipient.depth).toBe(7.25);
  });
  it('rejects self surfaces and invalid integer lifecycle fields', () => {
    const pair = fixture(), adapter = new CaptureAttachmentDepthAdapter();
    expect(adapter.update([{...pair, recipient: pair.captor}])[0]?.status).toBe('skipped');
    expect(adapter.update([{...pair, live: {...pair.live, captureId: 3.5}}])[0]?.status).toBe('skipped');
    expect(pair.recipient.depth).toBe(7.25);
  });
  it('restores all owned depths on shutdown while preserving unrelated depths', () => {
    const pair = fixture(), unrelated = new Surface(-11), adapter = new CaptureAttachmentDepthAdapter();
    adapter.update([pair]); adapter.restore(); adapter.restore();
    expect(pair.recipient.depth).toBe(7.25); expect(pair.captor.depth).toBe(1); expect(unrelated.depth).toBe(-11);
  });
});
