import {describe,it,expect} from 'vitest';
import {beginLinkOwnBowArticle,parseLinkOwnBowArticleLease} from './linkOwnBowArticle';
describe('actual first-use own Bow lease',()=>{
  it('requires an accepted action',()=>{
    expect(beginLinkOwnBowArticle({ownerIndex:0,generation:2,frame:30,acceptedBow:false})).toBeNull();
    expect(beginLinkOwnBowArticle({ownerIndex:0,generation:2,frame:30,acceptedBow:true})?.id).toBe('["own-bow",0,2,30]');
  });
  it('strictly preserves real first-use identity through JSON',()=>{
    const lease=beginLinkOwnBowArticle({ownerIndex:0,generation:3,frame:250,acceptedBow:true})!;
    expect(parseLinkOwnBowArticleLease(JSON.parse(JSON.stringify(lease)))).toEqual(lease);
    expect(()=>parseLinkOwnBowArticleLease({...lease,generation:4})).toThrow();
    expect(()=>parseLinkOwnBowArticleLease({...lease,admissionPolicy:'NATIVE_CALLER_PROVEN'})).toThrow();
  });
});
