import type {ItemDefinition} from './ItemDefinition';
import {recoveryFallProfile} from './Food';
/** Wiki:50 points, brief delay then gradual recovery. Native item_common maximtomato row12. */
export const MAXIM_TOMATO_DEFINITION:ItemDefinition=Object.freeze({
  type:'maximTomato',itemClass:'recovery',holdable:false,ttlFrames:1200,brokenDespawnFrames:0,
  throwProfile:recoveryFallProfile(.1,1.8,.0025,2.2),
  pickupBounds:Object.freeze({offsetX:0,offsetY:-15,width:35,height:30}),
  recovery:Object.freeze({amount:50,mode:'gradual',delayFrames:6,pointsPerFrame:1,eat:true}),
  visual:Object.freeze({spriteKey:'item.maximTomato.sprite',width:38,height:34,restAngle:0}),
});
