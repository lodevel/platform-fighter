/** Stable texture wrappers retain their original pixels/metrics while GPU
 * handles are uploaded on demand. Eviction runs only after the renderer has
 * flushed every camera; anything used this render frame stays pinned.
 * Byte counts estimate RGBA8 plus native POT mipmaps, not physical GPU memory.
 */
export interface ResidencyGl {
  readonly ACTIVE_TEXTURE:number;
  isContextLost():boolean;
  getParameter(parameter:number):unknown;
  activeTexture(unit:number):void;
  deleteTexture(texture:WebGLTexture):void;
}
export interface ResidencyTexture {
  webGLTexture:WebGLTexture|null;
  gl:ResidencyGl|null;
  pixels:unknown;
  createResource():void;
  destroy():void;
  spectorMetadata:unknown;
  __SPECTOR_Metadata?:unknown;
}
interface TextureRecord {
  readonly wrapper:ResidencyTexture;
  readonly label:string;
  readonly bytes:number;
  handle:WebGLTexture|null;
  counted:boolean;
  destroyed:boolean;
  uploading:boolean;
  lastFrame:number;
  lastUse:number;
}
const managedTextures=new WeakMap<object,()=>boolean>();
/** Called when a wrapper enters a render batch, including when Phaser reuses
 * its cached GL binding and therefore never reads webGLTexture that frame.
 * Returns true for a cold wrapper so that pipeline can discard stale binds.
 */
export function touchResidencyTexture(texture:object):boolean {
  return managedTextures.get(texture)?.()??false;
}
export function rgbaTextureBytes(width:number,height:number):number {
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)
    throw new RangeError('Texture residency requires positive integer dimensions');
  const powerOfTwo=(value:number)=>Number.isInteger(Math.log2(value));
  let bytes=width*height*4;
  if(powerOfTwo(width)&&powerOfTwo(height)){
    let w=width,h=height;
    while(w>1||h>1){w=Math.max(1,w/2);h=Math.max(1,h/2);bytes+=w*h*4;}
  }
  if(!Number.isSafeInteger(bytes))throw new RangeError('Texture byte estimate exceeds safe precision');
  return bytes;
}
export class TextureResidency {
  private readonly records=new Map<ResidencyTexture,TextureRecord>();
  private frame=0;
  private useSerial=0;
  private residentBytes=0;
  private peakBytes=0;
  private uploads=0;
  private evictions=0;
  private losses=0;
  constructor(readonly budgetBytes:number){
    if(!Number.isSafeInteger(budgetBytes)||budgetBytes<=0)throw new RangeError('Texture residency requires a positive byte budget');
  }
  /** Admission occurs before a wrapper has ever created a native handle. */
  track(wrapper:ResidencyTexture,label:string,bytes:number):void {
    if(this.records.has(wrapper)||wrapper.webGLTexture!==null||!wrapper.gl||!label.trim()||
      !Number.isSafeInteger(bytes)||bytes<=0)throw new TypeError('Invalid deferred texture admission');
    const originalCreate=wrapper.createResource.bind(wrapper);
    const record:TextureRecord={wrapper,label,bytes,handle:null,counted:false,destroyed:false,
      uploading:false,lastFrame:-1,lastUse:-1};
    this.records.set(wrapper,record);
    const touch=()=>{record.lastFrame=this.frame;record.lastUse=++this.useSerial;return record.handle===null;};
    managedTextures.set(wrapper,touch);
    Object.defineProperty(wrapper,'webGLTexture',{configurable:true,enumerable:true,
      get:()=>{
        if(record.destroyed)return null;
        touch();
        const gl=wrapper.gl;
        if(!record.handle&&!record.uploading&&gl&&!gl.isContextLost()){
          // Native creation changes ACTIVE_TEXTURE to0. A lazy upload may run
          // inside a bind on another unit, so restore that unit before returning.
          const active=gl.getParameter(gl.ACTIVE_TEXTURE);
          record.uploading=true;
          try {
            originalCreate();
            if(!record.handle)throw new Error(`Texture upload produced no handle: ${label}`);
            record.counted=true;this.residentBytes+=bytes;this.uploads++;
            this.peakBytes=Math.max(this.peakBytes,this.residentBytes);
          }catch(error){this.release(record);throw error;}
          finally {record.uploading=false;if(typeof active==='number')gl.activeTexture(active);}
        }
        return record.handle;
      },
      set:(handle:WebGLTexture|null)=>{record.handle=handle;},
    });
    // TextureSource.init assigns debug metadata immediately after construction.
    // The native setter reads webGLTexture and would defeat deferred loading.
    Object.defineProperty(wrapper,'spectorMetadata',{configurable:true,enumerable:true,
      get:()=>wrapper.__SPECTOR_Metadata,
      set:(value:unknown)=>{wrapper.__SPECTOR_Metadata=value;
        if(record.handle)(record.handle as WebGLTexture&{__SPECTOR_Metadata?:unknown}).__SPECTOR_Metadata=value;},
    });
    // Phaser invokes every wrapper on context restoration. Managed static
    // images remain lazy; the next draw invokes the retained native method.
    wrapper.createResource=()=>{};
    wrapper.destroy=()=>{
      if(record.destroyed)return;
      this.release(record);record.destroyed=true;managedTextures.delete(wrapper);
      this.records.delete(wrapper);wrapper.pixels=null;wrapper.gl=null;
    };
  }
  beginFrame():void {this.frame++;}
  isResident(wrapper:ResidencyTexture):boolean {return this.records.get(wrapper)?.handle!=null;}
  /** Current-frame visible textures can temporarily exceed the soft budget;
   * never delete a texture whose queued batch could still require its pixels. */
  finishFrame():void {
    const cold=[...this.records.values()].filter(r=>r.handle&&r.lastFrame!==this.frame)
      .sort((a,b)=>a.lastUse-b.lastUse);
    for(const record of cold){if(this.residentBytes<=this.budgetBytes)break;this.release(record);this.evictions++;}
  }
  contextLost():void {
    this.losses++;
    for(const record of this.records.values()){record.handle=null;record.counted=false;}
    this.residentBytes=0;
  }
  private release(record:TextureRecord):void {
    const gl=record.wrapper.gl;
    if(record.handle&&gl&&!gl.isContextLost())gl.deleteTexture(record.handle);
    record.handle=null;
    if(record.counted){this.residentBytes-=record.bytes;record.counted=false;}
  }
  snapshot(){
    const pages=[...this.records.values()].map(r=>Object.freeze({label:r.label,estimatedBytes:r.bytes,
      resident:r.handle!==null,pinned:r.lastFrame===this.frame,lastUsedFrame:r.lastFrame}));
    const pinnedBytes=pages.filter(p=>p.resident&&p.pinned).reduce((sum,p)=>sum+p.estimatedBytes,0);
    return Object.freeze({frame:this.frame,budgetBytes:this.budgetBytes,estimatedResidentBytes:this.residentBytes,
      estimatedPinnedBytes:pinnedBytes,estimatedPeakBytes:this.peakBytes,
      estimatedPinnedOverflowBytes:Math.max(0,pinnedBytes-this.budgetBytes),uploads:this.uploads,
      evictions:this.evictions,contextLosses:this.losses,pages:Object.freeze(pages),
      cpuDecodedImageMemory:'NOT_CONTROLLED_BY_THIS_GPU_CACHE' as const});
  }
}
