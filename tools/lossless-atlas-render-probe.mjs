// Real SpriteLayer/WebGL pixel readback of old grid and new packed PNGs.
// Source canvases were independently proven equal by the guarded installer.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i<0?d:process.argv[i+1];};
const root=process.cwd(),out=arg('out','docs/review/2026-10-15/user-bugs/link/lossless-webgl');await mkdir(out,{recursive:true});
const jobs=[];
for(const fighter of ['pikachu','donkeykong']) {
 const beforeDir=`docs/review/2026-10-15/user-bugs/link/lossless-before/${fighter}`;
 const old=JSON.parse(await readFile(beforeDir+'/frames.json','utf8')).animations;
 const current=JSON.parse(await readFile(`assets/characters/${fighter}/frames.json`,'utf8')).animations;
 const sheets=['idle','tumble',fighter==='pikachu'?'hurt_air':'hurt','final_victim_volt_vortex','final_victim_jungle_stagger_a'];
 for(const sheet of sheets) jobs.push({fighter,sheet,old:old[sheet],current:current[sheet],
  beforeURL:'/@fs'+path.join(root,beforeDir,old[sheet].strip),afterURL:`/characters/${fighter}/${current[sheet].strip}`});
}
const report={url:arg('url','http://127.0.0.1:5181/'),errors:[],rows:[]};
if(process.argv.includes('--pilot'))jobs.splice(1);
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1024,height:800}});page.on('pageerror',e=>report.errors.push(e.message));
try {
 await page.goto(report.url);await page.waitForFunction(()=>window.__sim?.startMatch);
 const result=await page.evaluate(async ({jobs,nearest,highp,manualFilter})=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {SpriteLayer}=await import('/src/engine/sprites/spriteLayer.ts');const {PlaneCamera}=await import('/src/engine/space.ts');
  THREE.ColorManagement.enabled=false;
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setSize(512,512,false);renderer.setClearColor(0,0);
  const camera=new PlaneCamera();camera.frame({x:0,y:0,width:512,height:512});
  const load=async(url,c)=>{const bitmap=await createImageBitmap(await(await fetch(url)).blob(),{premultiplyAlpha:'premultiply',imageOrientation:'flipY'});
   const texture=new THREE.Texture(bitmap);texture.flipY=false;texture.premultiplyAlpha=false;texture.minFilter=nearest?THREE.NearestFilter:THREE.LinearFilter;texture.magFilter=nearest?THREE.NearestFilter:THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
   return{...c,texture,width:c.atlas?.[0]??bitmap.width,height:c.atlas?.[1]??bitmap.height,columns:c.trims?1:Math.floor(bitmap.width/c.frameWidth)};};
  const rows=[],gl=renderer.getContext();let shaderInfo=null;
  for(const j of jobs){
   const before=await load(j.beforeURL,j.old),after=await load(j.afterURL,j.current);let chosen=before;
   const layer=new SpriteLayer({get:()=>chosen});
   for(const frame of [...new Set([0,Math.floor(j.old.frameCount/2),j.old.frameCount-1])])for(const facing of [1,-1]){
    const read=sheet=>{chosen=sheet;layer.draw({key:'actual',frame,x:256,y:360,originX:facing===1?sheet.root[0]/sheet.frameWidth:1-sheet.root[0]/sheet.frameWidth,
     originY:sheet.root[1]/sheet.frameHeight,scaleX:sheet.scaleToWorld,scaleY:sheet.scaleToWorld,flipX:facing===-1});layer.flush();
     if(highp){const material=layer.scene.children[0].material;if(!material.userData.highp){material.userData.highp=true;
      material.vertexShader=material.vertexShader.replace('varying vec2 vUv;', 'varying highp vec2 vUv;');
      material.fragmentShader=material.fragmentShader.replace('varying vec2 vUv;', 'varying highp vec2 vUv;').replace('uniform sampler2D map;', 'uniform highp sampler2D map;');}}
     if(manualFilter){const material=layer.scene.children[0].material;if(!material.userData.manualFilter){material.userData.manualFilter=true;
      material.fragmentShader=material.fragmentShader.replace('void main() {', `
       vec4 sampleAtlas(highp sampler2D source, highp vec2 uv) {
         highp vec2 xy = uv * vec2(textureSize(source, 0)) - .5;
         highp ivec2 i = ivec2(floor(xy)); highp vec2 f = fract(xy);
         highp ivec2 hi = textureSize(source, 0) - 1;
         return mix(mix(texelFetch(source, clamp(i, ivec2(0), hi), 0), texelFetch(source, clamp(i+ivec2(1,0), ivec2(0), hi), 0), f.x),
                    mix(texelFetch(source, clamp(i+ivec2(0,1), ivec2(0), hi), 0), texelFetch(source, clamp(i+ivec2(1,1), ivec2(0), hi), 0), f.x), f.y);
       }
       void main() {`).replace('texture2D(map, vUv)', 'sampleAtlas(map, vUv)');}}
     renderer.clear();renderer.render(layer.scene,camera);
     if(!shaderInfo){const program=renderer.info.programs[0];shaderInfo=program&&{fragment:gl.getShaderSource(program.fragmentShader),vertex:gl.getShaderSource(program.vertexShader)};}
     const pixels=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
    const a=read(before),b=read(after);let changedPixels=0,maxDelta=0,alphaPixels=0,totalDelta=0,alphaDelta=0;const deltas=[];
    const bounds=p=>{let x0=512,y0=512,x1=0,y1=0;for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(p[(y*512+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return[x0,y0,x1,y1];};
    for(let i=0;i<a.length;i+=4){let delta=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);delta=Math.max(delta,d);totalDelta+=d;}if(delta)changedPixels++;maxDelta=Math.max(maxDelta,delta);alphaDelta=Math.max(alphaDelta,Math.abs(a[i+3]-b[i+3]));if(b[i+3]){alphaPixels++;deltas.push(delta);}}
    deltas.sort((a,b)=>a-b);
    rows.push({fighter:j.fighter,sheet:j.sheet,frame,facing,changedPixels,maxDelta,alphaPixels,alphaDelta,meanChannelDelta:totalDelta/(4*alphaPixels),p99Delta:deltas[Math.floor(deltas.length*.99)],beforeBounds:bounds(a),afterBounds:bounds(b)});
   }
   layer.dispose();before.texture.dispose();after.texture.dispose();before.texture.image.close();after.texture.image.close();
  }
  const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
  const subpixelBits=gl.getParameter(gl.SUBPIXEL_BITS);
  renderer.dispose();return{rows,...shaderInfo,subpixelBits,precision:{precision:precision.precision,rangeMin:precision.rangeMin,rangeMax:precision.rangeMax}};
 },{jobs,nearest:process.argv.includes('--nearest'),highp:process.argv.includes('--highp'),manualFilter:process.argv.includes('--manual-filter')});
 report.rows=result.rows;report.shaderDiagnostics={fragment:result.fragment,vertex:result.vertex,precision:result.precision,subpixelBits:result.subpixelBits};
 report.summary={draws:report.rows.length,nonempty:report.rows.every(r=>r.alphaPixels>0),maxDelta:Math.max(...report.rows.map(r=>r.maxDelta)),changedPixels:report.rows.reduce((n,r)=>n+r.changedPixels,0)};
 console.log(JSON.stringify(report.summary));
 if(report.errors.length||!report.summary.nonempty||report.summary.maxDelta>1)throw new Error('Packed WebGL draws differ beyond one channel quantization level or are empty');
}finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
