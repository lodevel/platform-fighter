/** Exact translating 2D capsule/rectangle against a frozen capsule/AABB.
 * Minkowski difference is a convex polygon plus the sum of capsule radii.
 * Its straight edge strips and vertex circles supply analytic entry times.
 * Local attacker offsets are already facing-transformed by the caller.
 * Target motion/rotation during the step is not inferred by this adapter. */
export interface SourceSweepPoint {readonly x:number;readonly y:number;}
export type SourceSweepShape=
  |{readonly kind:'capsule';readonly start:SourceSweepPoint;readonly end:SourceSweepPoint;readonly radius:number}
  |{readonly kind:'rectangle';readonly offsetX:number;readonly offsetY:number;readonly width:number;readonly height:number};
export type SourceSweepTarget=
  |{readonly kind:'capsule';readonly start:SourceSweepPoint;readonly end:SourceSweepPoint;readonly radius:number}
  |{readonly kind:'bounds';readonly min:SourceSweepPoint;readonly max:SourceSweepPoint};
function point(p:SourceSweepPoint):void {
  if(!p||![p.x,p.y].every(v=>typeof v==='number'&&Number.isFinite(v)))throw new TypeError('Source sweep requires finite 2D points');
}
function finite(n:number):number {
  if(!Number.isFinite(n))throw new RangeError('Source sweep arithmetic overflow');return n;
}
function corners(min:SourceSweepPoint,max:SourceSweepPoint):SourceSweepPoint[] {
  return [min,{x:max.x,y:min.y},max,{x:min.x,y:max.y}];
}
function capsule(c:Extract<SourceSweepShape,{kind:'capsule'}>):{points:SourceSweepPoint[];radius:number} {
  point(c.start);point(c.end);
  if(typeof c.radius!=='number'||!Number.isFinite(c.radius)||c.radius<0)throw new TypeError('Source sweep requires a nonnegative capsule radius');
  return {points:[c.start,c.end],radius:c.radius};
}
function shapeGeometry(s:SourceSweepShape):{points:SourceSweepPoint[];radius:number} {
  if(!s||s.kind!=='capsule'&&s.kind!=='rectangle')throw new TypeError('Unknown source sweep shape');
  if(s.kind==='capsule')return capsule(s);
  if(![s.offsetX,s.offsetY,s.width,s.height].every(v=>typeof v==='number'&&Number.isFinite(v))||s.width<=0||s.height<=0)
    throw new TypeError('Source sweep requires a positive finite rectangle');
  return {points:corners({x:finite(s.offsetX-s.width/2),y:finite(s.offsetY-s.height/2)},
    {x:finite(s.offsetX+s.width/2),y:finite(s.offsetY+s.height/2)}),radius:0};
}
function targetGeometry(t:SourceSweepTarget):{points:SourceSweepPoint[];radius:number} {
  if(!t||t.kind!=='capsule'&&t.kind!=='bounds')throw new TypeError('Unknown source sweep target');
  if(t.kind==='capsule')return capsule(t);
  point(t.min);point(t.max);
  if(t.min.x>t.max.x||t.min.y>t.max.y)throw new RangeError('Source sweep bounds are reversed');
  return {points:corners(t.min,t.max),radius:0};
}
function cross(a:SourceSweepPoint,b:SourceSweepPoint,c:SourceSweepPoint):number {
  return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}
function hull(points:SourceSweepPoint[]):SourceSweepPoint[] {
  const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((p,i,a)=>i===0||p.x!==a[i-1]!.x||p.y!==a[i-1]!.y);
  if(sorted.length<3)return sorted;
  const lower:SourceSweepPoint[]=[],upper:SourceSweepPoint[]=[];
  for(const p of sorted){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
}
function distanceSquared(p:SourceSweepPoint,a:SourceSweepPoint,b:SourceSweepPoint):number {
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
  const t=l===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l));
  return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
}
function circleEntry(from:SourceSweepPoint,velocity:SourceSweepPoint,centre:SourceSweepPoint,radius:number):number|null {
  const x=from.x-centre.x,y=from.y-centre.y,a=velocity.x**2+velocity.y**2,c=x*x+y*y-radius*radius;
  if(c<=0)return 0;if(a===0)return null;
  const b=2*(x*velocity.x+y*velocity.y),discriminant=b*b-4*a*c;
  if(discriminant<0)return null;
  const root=Math.sqrt(discriminant),q=-.5*(b+(b<0?-root:root));
  // Stable quadratic roots avoid cancellation for nearly grazing long rays.
  const roots=q===0?[-b/(2*a)]:[q/a,c/q];
  let first:number|null=null;
  for(const t of roots)if(Number.isFinite(t)&&t>=0&&t<=1&&(first===null||t<first))first=t;
  return first;
}
function roundedHullEntry(from:SourceSweepPoint,to:SourceSweepPoint,polygon:readonly SourceSweepPoint[],radius:number):number|null {
  const velocity={x:to.x-from.x,y:to.y-from.y};
  if(polygon.length===1)return circleEntry(from,velocity,polygon[0]!,radius);
  const edgeCount=polygon.length===2?1:polygon.length;
  if(polygon.length>=3&&polygon.every((a,i)=>cross(a,polygon[(i+1)%polygon.length]!,from)>=0))return 0;
  for(let i=0;i<edgeCount;i++)if(distanceSquared(from,polygon[i]!,polygon[(i+1)%polygon.length]!)<=radius*radius)return 0;
  let earliest:number|null=null;
  const accept=(t:number|null)=>{if(t!==null&&t>=0&&t<=1&&(earliest===null||t<earliest))earliest=t;};
  for(const vertex of polygon)accept(circleEntry(from,velocity,vertex,radius));
  for(let i=0;i<edgeCount;i++) {
    const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,dx=b.x-a.x,dy=b.y-a.y,
      length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length;
    const distance=(from.x-a.x)*nx+(from.y-a.y)*ny,rate=velocity.x*nx+velocity.y*ny;
    if(rate===0)continue;
    for(const side of [-1,1]) {
      const t=(side*radius-distance)/rate;
      if(t<0||t>1)continue;
      const projection=((from.x+t*velocity.x-a.x)*dx+(from.y+t*velocity.y-a.y)*dy)/(length*length);
      if(projection>=0&&projection<=1)accept(t);
    }
  }
  return earliest;
}
export function sweepTranslatedSourceShape(input:{readonly from:SourceSweepPoint;readonly to:SourceSweepPoint;
  readonly shape:SourceSweepShape;readonly target:SourceSweepTarget}):
  {readonly fraction:number;readonly origin:SourceSweepPoint}|null {
  point(input.from);point(input.to);
  const attacker=shapeGeometry(input.shape),target=targetGeometry(input.target),radius=finite(attacker.radius+target.radius);
  const difference=target.points.flatMap(t=>attacker.points.map(a=>({x:finite(t.x-a.x),y:finite(t.y-a.y)})));
  // Normalizing all operands uniformly keeps convex products/ray quadratics
  // finite without growing any collision surface or changing the time domain.
  const scale=Math.max(1,radius,...difference.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)]),
    Math.abs(input.from.x),Math.abs(input.from.y),Math.abs(input.to.x),Math.abs(input.to.y));
  const normalize=(p:SourceSweepPoint)=>({x:p.x/scale,y:p.y/scale});
  const fraction=roundedHullEntry(normalize(input.from),normalize(input.to),hull(difference.map(normalize)),radius/scale);
  if(fraction===null)return null;
  const origin={x:finite(input.from.x*(1-fraction)+input.to.x*fraction),y:finite(input.from.y*(1-fraction)+input.to.y*fraction)};
  // This is the attack MODELROOT at first overlap, not a contact point.
  return Object.freeze({fraction,origin:Object.freeze(origin)});
}
