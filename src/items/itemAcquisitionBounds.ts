import type {ItemEntity} from './ItemEntity';
import type {FighterItemProfile} from './itemActions';

export interface ItemAcquisitionRectangle {readonly left:number;readonly right:number;readonly top:number;readonly bottom:number}

/** The fighter's native item range (fighter_param item_range_*) at five pixels per native unit. Native
 * height is the full height, its offset measured upward from the fighter's floor root. The optional
 * ground front-max selector is not modelled. */
export function fighterAcquisitionRectangle(profile:FighterItemProfile,position:{x:number;y:number},facing:1|-1,
  airborne:boolean,rootFromCentreY:number):ItemAcquisitionRectangle {
  const r=airborne?profile.catchRange.air:profile.catchRange.ground;
  const rootY=position.y+rootFromCentreY,centreY=rootY-r.offsetY*5;
  return{left:position.x-(facing===1?r.back:r.front)*5,right:position.x+(facing===1?r.front:r.back)*5,
    top:centreY-r.height*2.5,bottom:centreY+r.height*2.5};
}

/** Items have no native pickup rectangles. Their explicitly authored 24px square defaults are
 * independent of the thrown-hit radius. */
export function itemAcquisitionRectangle(item:ItemEntity):ItemAcquisitionRectangle {
  const p=item.getPosition(),r=item.definition.pickupBounds??{offsetX:0,offsetY:0,width:24,height:24};
  if(![r.offsetX,r.offsetY,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)
    throw new RangeError(`Invalid authored item pickup rectangle: ${item.definition.type}`);
  return{left:p.x+r.offsetX-r.width/2,right:p.x+r.offsetX+r.width/2,
    top:p.y+r.offsetY-r.height/2,bottom:p.y+r.offsetY+r.height/2};
}
export function acquisitionRectanglesOverlap(a:ItemAcquisitionRectangle,b:ItemAcquisitionRectangle):boolean {
  return a.left<=b.right&&a.right>=b.left&&a.top<=b.bottom&&a.bottom>=b.top;
}

/** The item a fighter at `position` acquires among `items`: inside its range, nearest first, lowest
 * id on a tie (one deterministic arbitration for ground pickups and catches). */
export function nearestAcquirableItem(range:ItemAcquisitionRectangle,position:{x:number;y:number},
  items:readonly ItemEntity[]):ItemEntity|undefined {
  return items.filter(item=>acquisitionRectanglesOverlap(range,itemAcquisitionRectangle(item)))
    .map(item=>({item,distance:Math.hypot(item.getPosition().x-position.x,item.getPosition().y-position.y)}))
    .sort((a,b)=>a.distance-b.distance||a.item.id-b.item.id)[0]?.item;
}
