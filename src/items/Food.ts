import type {ItemDefinition} from './ItemDefinition';
import {ultimateItemThrowProfile} from './nativeItemThrow';

/** SmashWiki Food#List_of_food, Ultimate column. The three character-only foods are excluded. */
export const FOOD_HEAL_AMOUNTS=Object.freeze({
  Apple:4,Bread:10,Cheese:5,Cherries:1,'Cherry pie':6,Chocolate:5,Cola:3,'Corn dog':6,
  'Dim sum':5,Donut:5,Dumplings:5,Eggs:5,Grapes:4,Hamburger:7,'Hot dog':6,Kebab:5,Kiwi:2,Lemons:2,
  Lollipop:3,Milk:5,'Mont Blanc':5,Onigiri:4,Pancakes:7,Pear:4,Pineapple:5,Pizza:7,Popcorn:6,Salad:5,
  'Salisbury steak':7,Spaghetti:8,'Squash soup':4,Steak:12,'Strawberry shortcake':11,Tea:2,Tempura:6,Turkey:15,
});
export type FoodVariant=keyof typeof FOOD_HEAL_AMOUNTS;
export const FOOD_VARIANTS:readonly FoodVariant[]=Object.freeze(Object.keys(FOOD_HEAL_AMOUNTS) as FoodVariant[]);
/** Recovery items cannot produce damaging throws. The profile only drives passive fall/drop kinetics. */
export function recoveryFallProfile(gravity:number,terminalFallSpeed:number,airBrakeX:number,mapBottom:number){
  return Object.freeze({...ultimateItemThrowProfile({damage:0,attackRadius:0,mapBottom,
    knockback:Object.freeze({base:0,growth:0,fixed:0,angle:0}),
    kinetics:Object.freeze({gravity,terminalFallSpeed,airBrakeX,maxSpeedX:Number.POSITIVE_INFINITY,
      throwRebound:Object.freeze({mul:0,addX:0,addY:0})})}),damageSpeedAdd:0,damageSpeedMultiplier:0});
}
export function foodDefinition(variant:FoodVariant):ItemDefinition {
  return Object.freeze({type:'food',itemClass:'recovery',holdable:false,ttlFrames:1200,brokenDespawnFrames:0,
    // Native item_common tabemono physics; negative map-bottom is adapted to zero for a ground cutout.
    throwProfile:recoveryFallProfile(.1,1.4,.01,0),foodVariant:variant,
    pickupBounds:Object.freeze({offsetX:0,offsetY:-12.5,width:30,height:25}),
    recovery:Object.freeze({amount:FOOD_HEAL_AMOUNTS[variant],mode:'instant',delayFrames:0,pointsPerFrame:0,eat:true}),
    visual:Object.freeze({spriteKey:`item.food.${variant}.sprite`,width:36,height:30,restAngle:0})});
}
export const FOOD_DEFINITION=foodDefinition('Apple');
