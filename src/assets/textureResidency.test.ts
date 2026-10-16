/** Prepared for the one final verification. GPU-facing invariants are tested
 * independently of Phaser; actual upload/page/context behavior also needs the
 * exact-build browser checks. These fixtures have not yet been executed. */
import {describe,expect,it} from 'vitest';
import {rgbaTextureBytes,TextureResidency,touchResidencyTexture,type ResidencyTexture,type ResidencyGl} from './textureResidency';
function fixture(){
  const state={lost:false,active:3,created:0,deleted:[] as WebGLTexture[],fail:false};
  const gl:ResidencyGl={ACTIVE_TEXTURE:34016,isContextLost:()=>state.lost,
    getParameter:()=>state.active,activeTexture:unit=>{state.active=unit;},deleteTexture:handle=>{state.deleted.push(handle);}};
  const source={width:10,height:10};
  const wrapper:ResidencyTexture={webGLTexture:null,gl,pixels:source,spectorMetadata:null,
    createResource(){
      state.created++;gl.activeTexture(0);
      this.webGLTexture={serial:state.created,__SPECTOR_Metadata:this.__SPECTOR_Metadata} as unknown as WebGLTexture;
      // Mimic the native _processTexture reentrant handle read after assignment.
      if(!this.webGLTexture)throw new Error('missing native handle');
      if(state.fail)throw new Error('upload failed');
    },destroy(){throw new Error('native eager destruction must be replaced');}};
  return {state,wrapper,source};
}
describe('stable full-quality texture GPU residency',()=>{
  it('leaves admitted pixels and metadata cold until a real handle is requested',()=>{
    const cache=new TextureResidency(500),f=fixture();cache.track(f.wrapper,'page',400);
    f.wrapper.spectorMetadata={key:'page'};
    expect(f.state.created).toBe(0);expect(cache.snapshot().estimatedResidentBytes).toBe(0);
    const handle=f.wrapper.webGLTexture;
    expect(f.state.created).toBe(1);expect(f.wrapper.webGLTexture).toBe(handle);
    expect(f.wrapper.pixels).toBe(f.source);expect(f.state.active).toBe(3);
    expect((handle as WebGLTexture&{__SPECTOR_Metadata?:unknown}).__SPECTOR_Metadata)
      .toEqual({key:'page'});
    expect(f.wrapper.__SPECTOR_Metadata).toEqual({key:'page'});
  });
  it('pins visible cached bindings even when no getter runs again',()=>{
    const cache=new TextureResidency(400),a=fixture(),b=fixture();
    cache.track(a.wrapper,'a',400);cache.track(b.wrapper,'b',400);
    void a.wrapper.webGLTexture;void b.wrapper.webGLTexture;
    cache.beginFrame();expect(touchResidencyTexture(a.wrapper)).toBe(false);cache.finishFrame();
    expect(a.state.deleted).toHaveLength(0);expect(b.state.deleted).toHaveLength(1);
    expect(cache.snapshot().estimatedResidentBytes).toBe(400);
  });
  it('evicts least recently used cold pages and recreates their stable wrappers from the same pixels',()=>{
    const cache=new TextureResidency(400),a=fixture(),b=fixture(),c=fixture();
    for(const [label,f] of [['a',a],['b',b],['c',c]] as const)cache.track(f.wrapper,label,400);
    const first=a.wrapper.webGLTexture;void b.wrapper.webGLTexture;
    cache.beginFrame();void c.wrapper.webGLTexture;cache.finishFrame();
    expect(a.state.deleted).toEqual([first]);expect(b.state.deleted).toHaveLength(1);
    expect(touchResidencyTexture(a.wrapper)).toBe(true);
    expect(a.wrapper.webGLTexture).not.toBe(first);expect(a.state.created).toBe(2);
    expect(a.wrapper.pixels).toBe(a.source);
  });
  it('permits a measured soft overflow while all pages are in the current render',()=>{
    const cache=new TextureResidency(400),a=fixture(),b=fixture();
    cache.track(a.wrapper,'a',400);cache.track(b.wrapper,'b',400);
    cache.beginFrame();void a.wrapper.webGLTexture;void b.wrapper.webGLTexture;cache.finishFrame();
    expect(cache.snapshot().estimatedPinnedOverflowBytes).toBe(400);
    expect(a.state.deleted).toEqual([]);expect(b.state.deleted).toEqual([]);
    cache.beginFrame();touchResidencyTexture(b.wrapper);cache.finishFrame();
    expect(cache.snapshot().estimatedResidentBytes).toBe(400);
    expect(cache.snapshot().estimatedPinnedOverflowBytes).toBe(0);
  });
  it('keeps restoration lazy and abandons lost handles without GPU deletes',()=>{
    const cache=new TextureResidency(400),f=fixture();cache.track(f.wrapper,'page',400);
    const first=f.wrapper.webGLTexture;f.state.lost=true;cache.contextLost();
    expect(f.wrapper.webGLTexture).toBeNull();expect(f.state.created).toBe(1);
    expect(f.state.deleted).toEqual([]);expect(cache.snapshot().estimatedResidentBytes).toBe(0);
    f.state.lost=false;f.wrapper.createResource();expect(f.state.created).toBe(1);
    expect(f.wrapper.webGLTexture).not.toBe(first);expect(f.state.created).toBe(2);
    expect(cache.snapshot().contextLosses).toBe(1);
  });
  it('destroys cold pages without creating a handle and resident pages exactly once',()=>{
    const cache=new TextureResidency(400),cold=fixture(),live=fixture();
    cache.track(cold.wrapper,'cold',400);cache.track(live.wrapper,'live',400);
    cold.wrapper.destroy();cold.wrapper.destroy();expect(cold.state.created).toBe(0);
    expect(cold.wrapper.pixels).toBeNull();expect(cold.wrapper.webGLTexture).toBeNull();
    void live.wrapper.webGLTexture;live.wrapper.destroy();live.wrapper.destroy();
    expect(live.state.deleted).toHaveLength(1);expect(cache.snapshot().pages).toEqual([]);
    expect(cache.snapshot().estimatedResidentBytes).toBe(0);
  });
  it('discards a partially uploaded handle and restores the active GL unit on failure',()=>{
    const cache=new TextureResidency(400),f=fixture();cache.track(f.wrapper,'page',400);f.state.fail=true;
    expect(()=>f.wrapper.webGLTexture).toThrow('upload failed');
    expect(f.state.active).toBe(3);expect(f.state.deleted).toHaveLength(1);
    expect(cache.snapshot().estimatedResidentBytes).toBe(0);
    f.state.fail=false;expect(f.wrapper.webGLTexture).not.toBeNull();
    expect(cache.snapshot().uploads).toBe(1);
  });
  it('accounts for native POT mipmaps and rejects impossible byte estimates',()=>{
    expect(rgbaTextureBytes(4,2)).toBe(44);expect(rgbaTextureBytes(3,2)).toBe(24);
    for(const dimensions of [[0,1],[-1,2],[1.5,2],[Infinity,2],[Number.MAX_SAFE_INTEGER,2]])
      expect(()=>rgbaTextureBytes(dimensions[0]!,dimensions[1]!)).toThrow();
    expect(()=>new TextureResidency(0)).toThrow();
  });
  it('does not treat unrelated wrappers as managed textures',()=>{
    expect(touchResidencyTexture({})).toBe(false);
    const cache=new TextureResidency(400),f=fixture();
    f.wrapper.webGLTexture={} as WebGLTexture;
    expect(()=>cache.track(f.wrapper,'already-uploaded',400)).toThrow();
  });
});
