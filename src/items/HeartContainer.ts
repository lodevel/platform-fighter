import type {ItemDefinition} from './ItemDefinition';
import {recoveryFallProfile} from './Food';
/** Wiki:100 points, gradual recovery, no held-food flinch drop; native item_common heart row13. */
export const HEART_CONTAINER_DEFINITION:ItemDefinition=Object.freeze({
  type:'heartContainer',itemClass:'recovery',holdable:false,ttlFrames:1200,brokenDespawnFrames:0,
  throwProfile:recoveryFallProfile(.06,.4,.01,3),
  pickupBounds:Object.freeze({offsetX:0,offsetY:-20,width:45,height:40}),
  recovery:Object.freeze({amount:100,mode:'gradual',delayFrames:0,pointsPerFrame:1,eat:false}),
  visual:Object.freeze({spriteKey:'item.heartContainer.sprite',width:46,height:42,restAngle:0}),
});
