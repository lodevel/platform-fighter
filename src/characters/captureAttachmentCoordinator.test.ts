import { describe, expect, it } from 'vitest';
import type { Character, CaptureAttachmentLink } from './Character';
import type { CaptureAttachmentResult } from './donkeykongCaptureAttachment';
import { coordinateCaptureAttachments,captureAttachmentLinkIdentity,isNewCaptureAttachmentLink } from './captureAttachmentCoordinator';

/** Orchestration doubles only; actual reciprocal/reset/Matter proof owned by integration suite. */
function actors() {
  const events:string[]=[],result={status:'paired'} as Extract<CaptureAttachmentResult,{status:'paired'}>;
  let enabled=true,nested=false,commitAllowed=true;
  const target={body:{id:48},getPosition:()=>{events.push('target-root');return{x:150,y:200};},
    hasCaptureAttachmentNestedTarget:()=>nested,getCaptureAttachmentLink:()=>null,
    getCaptureAttachmentPendingLegacyRestore:()=>null};
  const link={target:target as unknown as Character,captureId:3,captorReset:2,recipientReset:4,
    context:'ordinary-held'} satisfies CaptureAttachmentLink;
  const captor={body:{id:12},getPosition:()=>{events.push('captor-root');return{x:100,y:200};},
    getCaptureAttachmentLink:()=>enabled?link:null,getCaptureAttachmentPendingLegacyRestore:()=>link,
    hasCaptureAttachmentNestedTarget:()=>true,
    resolveCaptureAttachmentCandidate:()=>{events.push('solve');return result;},
    recordCaptureAttachmentFallback:(reason:string)=>events.push(`fallback:${reason}`),
    restoreCaptureAttachmentLegacyPosition:(old:CaptureAttachmentLink)=>{expect(old).toBe(link);events.push('restore');},
    commitCaptureAttachmentCandidate:()=>{events.push('commit');return commitAllowed;}};
  return {characters:[captor,target] as unknown as Character[],events,
    disable:()=>{enabled=false;},nest:()=>{nested=true;},rejectCommit:()=>{commitAllowed=false;}};
}
describe('candidate coordinator policy/lifecycle orchestration, not real contact qualification',()=>{
  it('reads every root before solving/committing and leaves original sampler to its caller',()=>{
    const f=actors();coordinateCaptureAttachments(f.characters);f.events.push('original-sampler');
    expect(f.events).toEqual(['captor-root','target-root','solve','commit','original-sampler']);
  });
  it('blocks a legacy/non-DK nested captor even when target anchored link getter is null',()=>{
    const f=actors();f.nest();coordinateCaptureAttachments(f.characters);
    expect(f.events).toContain('fallback:missing-target-or-nested-capture');
    expect(f.events).not.toContain('solve');expect(f.events).not.toContain('commit');
  });
  it('restores a pending same-link legacy pin after policy disable rather than skipping the solved step',()=>{
    const f=actors();f.disable();coordinateCaptureAttachments(f.characters);
    expect(f.events).toEqual(['captor-root','target-root','fallback:attachment-policy-disabled','restore']);
  });
  it('does not attempt restoration when Character invalidated pending capture/reset identity',()=>{
    const f=actors();f.disable();
    const captor=f.characters[0]! as unknown as {getCaptureAttachmentPendingLegacyRestore:()=>CaptureAttachmentLink|null};
    captor.getCaptureAttachmentPendingLegacyRestore=()=>null;
    coordinateCaptureAttachments(f.characters);expect(f.events).toEqual(['captor-root','target-root']);
  });
  it('reports and safely restores when commit revalidation rejects revised metadata/link',()=>{
    const f=actors();f.rejectCommit();coordinateCaptureAttachments(f.characters);
    expect(f.events).toEqual(['captor-root','target-root','solve','commit','fallback:commit-link-or-pose-revised','restore']);
  });
  it('restricted pass skips established links without restoring or changing them',()=>{
    const f=actors();coordinateCaptureAttachments(f.characters,undefined,()=>false);
    expect(f.events).toEqual(['captor-root','target-root']);
  });
  it('restricted pending pass preserves every global body ID and root',()=>{
    const f=actors(),captor=f.characters[0]!;
    let ids:number[]=[];
    (captor as any).resolveCaptureAttachmentCandidate=(all:number[])=>{ids=all;f.events.push('solve');return{status:'paired'};};
    coordinateCaptureAttachments([...f.characters,f.characters[1]!],undefined,c=>c===captor);
    expect(ids).toEqual([12,48,48]);
    expect(f.events.slice(0,3)).toEqual(['captor-root','target-root','target-root']);
  });
  it('restricted pending pass retains nested-target and placement guards',()=>{
    const f=actors();f.nest();coordinateCaptureAttachments(f.characters,()=>false,c=>c===f.characters[0]);
    expect(f.events).toContain('fallback:missing-target-or-nested-capture');expect(f.events).not.toContain('commit');
    const g=actors();coordinateCaptureAttachments(g.characters,()=>false,c=>c===g.characters[0]);
    expect(g.events).toContain('fallback:stage-placement-not-supported');expect(g.events).not.toContain('commit');
  });

  it('immutable identity distinguishes fresh sequence, resets, context, body and target',()=>{
    const f=actors(),captor=f.characters[0]!,link=captor.getCaptureAttachmentLink()!,before=captureAttachmentLinkIdentity(captor,link)!;
    expect(isNewCaptureAttachmentLink(before,captor,link)).toBe(false);
    expect(isNewCaptureAttachmentLink(null,captor,link)).toBe(true);
    expect(isNewCaptureAttachmentLink(before,captor,null)).toBe(false);
    for(const key of ['captureId','captorReset','recipientReset'] as const)
      expect(isNewCaptureAttachmentLink(before,captor,{...link,[key]:link[key]+1})).toBe(true);
    expect(isNewCaptureAttachmentLink(before,captor,{...link,context:'ordinary-damage'})).toBe(true);
    const other={...link.target,body:{id:link.target.body.id}} as Character;
    expect(isNewCaptureAttachmentLink(before,captor,{...link,target:other})).toBe(true);
    const body=link.target.body as {id:number};body.id++;
    expect(before.recipientBodyId).toBe(48);expect(isNewCaptureAttachmentLink(before,captor,link)).toBe(true);
    body.id--;const own=captor.body as {id:number};own.id++;
    expect(isNewCaptureAttachmentLink(before,captor,link)).toBe(true);
  });

});
