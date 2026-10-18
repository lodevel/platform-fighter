import type { CharacterPackage } from '../package/types';
import { costumeShifts, recolorColor } from './recolor';

/**
 * The package palette in costume `costume`, as straight RGBA bytes (4 per entry), ready
 * for a 1D lookup texture. Costume 0 is the palette as drawn; other costumes move the
 * entries with the same colour shifts the costume applies to RGBA art.
 */
export function costumePalette(pkg: CharacterPackage, costume: number): Uint8Array {
  const colors = pkg.palette ?? [], shifts = costumeShifts(pkg.costumes, costume), out = new Uint8Array(colors.length * 4);
  colors.forEach((hex, i) => {
    const value = parseInt(hex.slice(1), 16) >>> 0;
    const rgba = [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255].map(c => c / 255) as [number, number, number, number];
    recolorColor(rgba, shifts).forEach((c, k) => { out[i * 4 + k] = Math.round(c * 255); });
  });
  return out;
}
