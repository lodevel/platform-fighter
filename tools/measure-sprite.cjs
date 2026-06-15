const { PNG } = require('pngjs');
const fs = require('fs');
function measure(file, fw, fh) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let minX=fw, maxX=0, minY=fh, maxY=0, any=false;
  for (let y=0;y<Math.min(fh,png.height);y++)
    for (let x=0;x<Math.min(fw,png.width);x++){
      const a = png.data[(png.width*y + x)*4 + 3];
      if (a>16){ any=true; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
  if(!any) return null;
  return { fw, fh, charW: maxX-minX+1, charH: maxY-minY+1,
    padBottom: fh-1-maxY, padTop: minY,
    fillH: +((maxY-minY+1)/fh).toFixed(2), fillW: +((maxX-minX+1)/fw).toFixed(2) };
}
const cfg = { blaze:[48,48], puff:[136,89], aegis:[128,130], wolf:[64,64], cat:[50,50] };
for (const [name,[fw,fh]] of Object.entries(cfg)){
  console.log(name.padEnd(7), JSON.stringify(measure(`assets/characters/${name}/animations/idle.png`,fw,fh)));
}
