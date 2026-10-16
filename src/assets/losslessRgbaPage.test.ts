import {describe,it,expect} from 'vitest';
import {decodeRgbaBlock,decodeLosslessRgbaPage,RGBA_PAGE_MAGIC,RGBA_PAGE_HEADER_BYTES,RGBA_PAGE_BLOCK_BYTES} from './losslessRgbaPage';
describe('bounded exact RGBA decode',()=>{
  it('copies an independent literal including transparent and opaque bytes',()=>{
    const out=new Uint8Array(8);decodeRgbaBlock(new Uint8Array([0x80,0,0,0,0,43,71,90,255]),out);
    expect([...out]).toEqual([0,0,0,0,43,71,90,255]);
  });
  it('decodes an overlapping match without reading another block',()=>{
    const out=new Uint8Array(12);decodeRgbaBlock(new Uint8Array([0x44,4,5,6,7,4,0]),out);
    expect([...out]).toEqual([4,5,6,7,4,5,6,7,4,5,6,7]);
  });
  it('rejects truncated lengths and out-of-range/zero match offsets',()=>{
    for(const bytes of [[0xf0],[0x10,2,0,0],[0x10,2,2,0],[0x10,2,1],[0x50,1]])
      expect(()=>decodeRgbaBlock(new Uint8Array(bytes),new Uint8Array(5))).toThrow();
  });
  it('enforces exact page dimensions, length and alpha representation',()=>{
    const encoded=new Uint8Array(RGBA_PAGE_HEADER_BYTES+8+5),view=new DataView(encoded.buffer);
    encoded.set([...RGBA_PAGE_MAGIC].map(c=>c.charCodeAt(0)));
    [1,1,RGBA_PAGE_BLOCK_BYTES,1,1].forEach((n,i)=>view.setUint32(8+i*4,n,true));
    view.setUint32(28,4,true);view.setUint32(32,5,true);encoded.set([0x40,9,8,7,255],36);
    expect([...decodeLosslessRgbaPage(encoded,{width:1,height:1,decodedBytes:4})]).toEqual([9,8,7,255]);
    expect(()=>decodeLosslessRgbaPage(encoded,{width:2,height:1,decodedBytes:8})).toThrow();
    view.setUint32(24,0,true);expect(()=>decodeLosslessRgbaPage(encoded,{width:1,height:1,decodedBytes:4})).toThrow();
  });
});
