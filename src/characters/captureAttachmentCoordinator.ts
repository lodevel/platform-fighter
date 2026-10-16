import type { Character, CaptureAttachmentLink } from './Character';
import type { CaptureAttachmentResult } from './donkeykongCaptureAttachment';

/** Immutable identity snapshot taken before the original sampler. Descriptor or
 * diagnostic state is deliberately not capture identity. */
export interface CaptureAttachmentLinkIdentity {
  readonly target: Character;
  readonly captorBodyId: number;
  readonly recipientBodyId: number;
  readonly captureId: number;
  readonly captorReset: number;
  readonly recipientReset: number;
  readonly context: CaptureAttachmentLink['context'];
}
export function captureAttachmentLinkIdentity(captor: Character,
  link: CaptureAttachmentLink | null): CaptureAttachmentLinkIdentity | null {
  return link ? {target:link.target,captorBodyId:captor.body.id,recipientBodyId:link.target.body.id,
    captureId:link.captureId,captorReset:link.captorReset,recipientReset:link.recipientReset,context:link.context} : null;
}
export function isNewCaptureAttachmentLink(previous: CaptureAttachmentLinkIdentity | null,
  captor: Character, link: CaptureAttachmentLink | null): boolean {
  const current=captureAttachmentLinkIdentity(captor,link);
  return current !== null && (previous === null || previous.target !== current.target ||
    previous.captorBodyId !== current.captorBodyId || previous.recipientBodyId !== current.recipientBodyId ||
    previous.captureId !== current.captureId || previous.captorReset !== current.captorReset ||
    previous.recipientReset !== current.recipientReset || previous.context !== current.context);
}

/** Coordinates solved roots without advancing input clocks. A restricted birth pass
 * still observes every participant for identity, duplicate and nested-link guards. */
export function coordinateCaptureAttachments(characters: readonly Character[],
  placementAllowed?: (captor: Character, target: Character, result: Extract<CaptureAttachmentResult,{status:'paired'}>) => boolean,
  eligible?: (captor: Character, link: CaptureAttachmentLink | null) => boolean): void {
  // All roots are read before anyone commits; duplicate IDs remain visible to the solver.
  const roots = new Map(characters.map(c => [c, c.getPosition()] as const));
  const ids = characters.map(c => c.body.id);
  const links = characters.map(c => ({ captor:c, link:c.getCaptureAttachmentLink(), pending:c.getCaptureAttachmentPendingLegacyRestore() }));
  const requests = links.flatMap(({captor,link,pending}) => {
    if (eligible && !eligible(captor,link)) return [];
    if (!link) {
      if(pending){captor.recordCaptureAttachmentFallback('attachment-policy-disabled');captor.restoreCaptureAttachmentLegacyPosition(pending);}
      return [];
    }
    if (!roots.has(link.target) || link.target.hasCaptureAttachmentNestedTarget()) {
      captor.recordCaptureAttachmentFallback('missing-target-or-nested-capture');
      if(pending)captor.restoreCaptureAttachmentLegacyPosition(pending);return [];
    }
    const result = captor.resolveCaptureAttachmentCandidate(ids, roots.get(captor)!);
    return [{captor,link,result}];
  });
  for (const {captor,link,result} of requests.sort((a,b)=>a.captor.body.id-b.captor.body.id)) {
    if (!result || result.status !== 'paired') {
      captor.restoreCaptureAttachmentLegacyPosition(link);continue;
    }
    if (placementAllowed && !placementAllowed(captor,link.target,result)) {
      captor.recordCaptureAttachmentFallback('stage-placement-not-supported');
      captor.restoreCaptureAttachmentLegacyPosition(link); continue;
    }
    if(!captor.commitCaptureAttachmentCandidate(link,result)) {
      captor.recordCaptureAttachmentFallback('commit-link-or-pose-revised');
      captor.restoreCaptureAttachmentLegacyPosition(link);
    }
  }
}
