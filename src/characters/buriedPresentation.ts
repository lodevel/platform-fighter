/** A buried fighter's sunk body: the drawing, its hurtboxes and Ultimate's progress effects (all fighters; the bury mechanics
 * stay in buriedState.ts). SmashWiki Buried (https://www.ssbwiki.com/Buried): "A buried character is embedded in the ground,
 * with the visible part of their body surrounded by churned dirt"; "Fighters are normally buried upright". The sink depth is
 * not stated in text: the Ultimate screenshots on that page (lead image; Shovel Knight gallery image) show the fighter in the
 * ground to about the waist, so half the body height is an authored reading of those images. */
import type { Hurtbox } from './moveSchema';

export const BURIED_SINK_FRACTION = 0.5;

/** How far a buried fighter's body (drawing and hurtboxes) goes into the floor. */
export function buriedSinkDepth(bodyHeight: number): number {
  return bodyHeight * BURIED_SINK_FRACTION;
}

/** Where a fighter's sprite goes while buried: moved down by the sink and cut at the floor line. `spriteY`/`originY`/`scaleY`/
 * `frameHeight` describe the sprite as normally placed (feet on the floor); `cropHeight` = frame rows kept from the top. */
export function buriedSpriteSink(s: { floorY: number; spriteY: number; originY: number; frameHeight: number; scaleY: number;
  bodyHeight: number }): { offsetY: number; cropHeight: number } {
  const offsetY = buriedSinkDepth(s.bodyHeight);
  const top = s.spriteY + offsetY - s.originY * s.frameHeight * s.scaleY;
  return { offsetY, cropHeight: Math.max(0, Math.min(s.frameHeight, (s.floorY - top) / s.scaleY)) };
}

/** SmashWiki Buried: "Being buried upright or upside down affects the hurtbox placement of the buried character". The
 * hurtboxes move down with the drawing (same depth), so the space the standing head filled is empty. The part under the
 * floor line keeps its boxes, like the native bones that stay in the ground. */
export function sinkHurtboxes(hurtboxes: ReadonlyArray<Hurtbox>, depth: number): Hurtbox[] {
  return hurtboxes.map(h => ({ ...h, offsetY: h.offsetY + depth,
    ...(h.capsule ? { capsule: { ...h.capsule, start: { ...h.capsule.start, y: h.capsule.start.y + depth },
      end: { ...h.capsule.end, y: h.capsule.end.y + depth } } } : {}) }));
}

/** SmashWiki Buried, Appearance: "In Smash 4, however, they shake when button mashing to escape faster. Ultimate, in addition
 * to keeping this visual effect, adds others that better indicate how close a buried character is to escaping; when 30% of
 * the initial bury duration has passed, small portions of dirt splash out of them, and when 60% of the duration has passed,
 * the character flashes yellow with larger and louder portions of dirt splashing out of them." The share counts the
 * mash-shortened time too (the effects show how close the escape is; text silent on mashing). Burying throws (33.3%) do not
 * exist in this roster. Shake length/size, blink period and splash shapes are authored (text silent). */
export const BURIED_SMALL_SPLASH_SHARE = 0.3;
export const BURIED_FLASH_SHARE = 0.6;
export const BURIED_MASH_SHAKE_FRAMES = 4;
const MASH_SHAKE_X = 2;
const FLASH_BLINK_FRAMES = 4;
const SPLASH_CYCLE = 12;

export interface BuriedEffects {
  readonly shakeX: number;
  readonly splash: 'none' | 'small' | 'large';
  /** Past the 60% share (the flashing phase). */
  readonly flashing: boolean;
  /** The yellow flash is lit on this step. */
  readonly flash: boolean;
}

export function buriedEffects(s: { initialFrames: number; age: number; mashReduction: number;
  framesSinceMash: number | null }): BuriedEffects {
  const share = (s.age + s.mashReduction) / s.initialFrames;
  const flashing = share >= BURIED_FLASH_SHARE;
  const shaking = s.framesSinceMash !== null && s.framesSinceMash < BURIED_MASH_SHAKE_FRAMES;
  return {
    shakeX: shaking ? (s.framesSinceMash! % 2 === 0 ? -MASH_SHAKE_X : MASH_SHAKE_X) : 0,
    splash: flashing ? 'large' : share >= BURIED_SMALL_SPLASH_SHARE ? 'small' : 'none',
    flashing,
    flash: flashing && Math.floor(s.age / FLASH_BLINK_FRAMES) % 2 === 0,
  };
}

/** Dirt clods thrown up from the floor line around a buried fighter (offsets from the fighter's floor point, y up negative). */
export function buriedDirtSplashes(splash: BuriedEffects['splash'], age: number, width: number):
  { dx: number; dy: number; radius: number }[] {
  if (splash === 'none') return [];
  const large = splash === 'large', count = large ? 6 : 3;
  return Array.from({ length: count }, (_, i) => {
    const t = ((age + i * Math.floor(SPLASH_CYCLE / count)) % SPLASH_CYCLE) / SPLASH_CYCLE;
    const side = i % 2 === 0 ? -1 : 1;
    return { dx: side * width * (0.35 + 0.45 * t), dy: -(large ? 34 : 18) * 4 * t * (1 - t), radius: large ? 4 : 2.5 };
  });
}
