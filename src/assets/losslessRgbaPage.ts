/** Bounded lossless page transport. The encoded source is ready before
 * gameplay; decoding never waits on a browser image decoder or changes an
 * action clock. Source alpha/upload equivalence still needs the final gate. */
export const RGBA_PAGE_MAGIC = 'PFRGBA1\0';
export const RGBA_PAGE_HEADER_BYTES = 28;
export const RGBA_PAGE_BLOCK_BYTES = 64 * 1024;
export const RGBA_PAGE_MAX_DECODED_BYTES = 8 * 1024 * 1024;
export interface RgbaPageIdentity {readonly width:number;readonly height:number;readonly decodedBytes:number;}
function integer(n:number,label:string):number {
  if(!Number.isSafeInteger(n)||n<=0)throw new RangeError(`Invalid page ${label}`);return n;
}
/** Decode a raw LZ4 block into its exact preallocated range. References are
 * limited to this block; malformed lengths/offsets cannot grow the buffer. */
export function decodeRgbaBlock(source:Uint8Array,destination:Uint8Array):void {
  let cursor=0,write=0;
  const length=(initial:number)=>{let n=initial;
    if(initial===15){let extra:number;do{if(cursor>=source.length)throw new TypeError('Truncated RGBA block length');
      extra=source[cursor++]!;n+=extra;if(n>destination.length)throw new RangeError('RGBA block exceeds decoded bound');}while(extra===255);}
    return n;};
  while(cursor<source.length){
    const token=source[cursor++]!,literal=length(token>>>4);
    if(cursor+literal>source.length||write+literal>destination.length)throw new TypeError('Invalid RGBA literal range');
    destination.set(source.subarray(cursor,cursor+literal),write);cursor+=literal;write+=literal;
    if(cursor===source.length)break;
    if(cursor+2>source.length)throw new TypeError('Truncated RGBA match offset');
    const offset=source[cursor]!|(source[cursor+1]!<<8);cursor+=2;
    const count=length(token&15)+4;
    if(offset===0||offset>write||write+count>destination.length)throw new TypeError('Invalid RGBA match range');
    // Seed the real previous bytes, then double already-expanded output.
    // Typed-array bulk copies preserve overlap semantics without a JS loop
    // across megabytes of transparent/solid atlas pixels.
    let copied=Math.min(offset,count);
    destination.copyWithin(write,write-offset,write-offset+copied);
    while(copied<count){const n=Math.min(copied,count-copied);destination.copyWithin(write+copied,write,write+n);copied+=n;}
    write+=count;
  }
  if(write!==destination.length)throw new TypeError('RGBA block did not produce exact declared length');
}
export function rgbaPageIdentity(encoded:Uint8Array):RgbaPageIdentity {
  if(encoded.length<RGBA_PAGE_HEADER_BYTES||RGBA_PAGE_MAGIC.split('').some((c,i)=>encoded[i]!==c.charCodeAt(0)))
    throw new TypeError('Invalid encoded RGBA page header');
  const view=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength);
  const width=integer(view.getUint32(8,true),'width'),height=integer(view.getUint32(12,true),'height');
  const decodedBytes=integer(width*height*4,'decoded byte count');
  if(decodedBytes>RGBA_PAGE_MAX_DECODED_BYTES||view.getUint32(16,true)!==RGBA_PAGE_BLOCK_BYTES||
    view.getUint32(20,true)!==Math.ceil(decodedBytes/RGBA_PAGE_BLOCK_BYTES)||view.getUint32(24,true)!==1)
    throw new TypeError('Unadmitted RGBA page dimensions/block/alpha representation');
  return Object.freeze({width,height,decodedBytes});
}
export function decodeLosslessRgbaPage(encoded:Uint8Array,expected:RgbaPageIdentity,destination?:Uint8Array):Uint8Array {
  const actual=rgbaPageIdentity(encoded);
  if(actual.width!==expected.width||actual.height!==expected.height||actual.decodedBytes!==expected.decodedBytes)
    throw new TypeError('Encoded page differs from admitted source metadata');
  if(destination&&destination.length!==actual.decodedBytes)throw new TypeError('Invalid exact decoded buffer range');
  const out=destination??new Uint8Array(actual.decodedBytes),view=new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength);
  let cursor=RGBA_PAGE_HEADER_BYTES,write=0;
  while(write<out.length){
    if(cursor+8>encoded.length)throw new TypeError('Truncated RGBA block header');
    const decoded=view.getUint32(cursor,true),size=view.getUint32(cursor+4,true);cursor+=8;
    const required=Math.min(RGBA_PAGE_BLOCK_BYTES,out.length-write);
    if(decoded!==required||size===0||size>decoded+Math.ceil(decoded/255)+16||cursor+size>encoded.length)
      throw new TypeError('Invalid encoded RGBA block boundaries');
    decodeRgbaBlock(encoded.subarray(cursor,cursor+size),out.subarray(write,write+decoded));cursor+=size;write+=decoded;
  }
  if(cursor!==encoded.length)throw new TypeError('Trailing encoded RGBA source bytes');
  return out;
}
