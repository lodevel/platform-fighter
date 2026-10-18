import * as THREE from '/home/lombet/Workspace/platform-fighter/node_modules/three/build/three.module.js';
import fs from 'fs';
const data = JSON.parse(fs.readFileSync(process.argv[2]));
for (const [name, layers] of Object.entries(data)) {
  const run = () => { let tris = 0;
    for (const polys of layers) for (const poly of polys) {
      const v = r => r.map(([x, y]) => new THREE.Vector2(x, y));
      tris += THREE.ShapeUtils.triangulateShape(v(poly[0]), poly.slice(1).map(v)).length;
    } return tris; };
  run(); run();
  const t = performance.now(); let n = 0, tris = 0; while (performance.now() - t < 1000) { tris = run(); n++; }
  console.log(name, 'tris', tris, 'ms per drawing', ((performance.now() - t) / n).toFixed(2));
}
