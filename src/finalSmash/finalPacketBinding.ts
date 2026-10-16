import bindings from './selectedPackets.json';
import forceBindings from './forceReactionBindings.json';
import { readLinkNativeAttackPacket, type LinkNativeScalar, type LinkNativeAttackPacket } from '../characters/linkNativeAttackPacket';
import { nativePacketHit } from '../characters/nativePacketHit';
import type { HitInfo } from '../characters/combat';
import type { FinalRun } from './finalSmashSchema';
export interface FinalBoundPacket { readonly native: LinkNativeAttackPacket; readonly forceReaction: boolean;
  readonly unblockable: true; readonly sourceShieldSentinel: boolean; }
export function finalPacketBinding(actor: string, sheet: string, label: string, id: number): FinalBoundPacket | null {
  const air = sheet.includes('air');
  let callback: string, damage: number;
  if (label === 'dk-detection') { callback = air ? 'game_finalairstart' : 'game_finalstart'; damage = 12; }
  else if (label === 'dk-early' || label === 'dk-late') { callback = air ? 'game_finalairattack' : 'game_finalattack'; damage = label === 'dk-early' ? 1.2 : 1.1; }
  else if (label === 'dk-finisher') { callback = air ? 'game_finalairend' : 'game_finalend'; damage = 14; }
  else if (label === 'pika-start' || label === 'pika-start-transition') { callback = air ? 'game_finalair' : 'game_final'; damage = label === 'pika-start' ? .3 : 1; }
  else if (label === 'pika-dash') { callback = 'game_finaldash'; damage = 1; }
  else if (label === 'pika-loop' || label === 'pika-loop-finish') { callback = label === 'pika-loop-finish' ? 'game_finalattackfinish' : 'game_finalattack'; damage = 1.5; }
  else if (label === 'pika-finish-pre' || label === 'pika-finisher') { callback = air ? 'game_finalair2' : 'game_final2'; damage = label === 'pika-finisher' ? 20 : 0; }
  // SmashWiki Link (SSBU)/Final Smash: Flying 0%, Explosion (fighter) 35%, Explosion (wall) 20%.
  else if (label === 'ancient-flight') { callback = 'game_fly'; damage = 0; }
  else if (label === 'ancient-fighter' || label === 'ancient-terrain') { callback = label === 'ancient-fighter' ? 'game_stick' : 'game_stickwall'; damage = label === 'ancient-fighter' ? 35 : 20; }
  else return null;
  const row = bindings.packets.find(p => p.actor === actor && p.function === callback && p.packet.id === id && p.packet.damage === damage);
  if (!row) return null;
  const raw: Record<string, LinkNativeScalar> = { ...row.packet };
  for (const override of row.wikiPriorityOverrides) raw[override.field] = override.selected;
  const sourceShieldSentinel = raw.shieldDamage === 'f32::NAN';
  // Public Ultimate all-Final unblockability selects the real shield route.
  // Preserve native NaN provenance; no NaN may enter damage/physics state.
  if (sourceShieldSentinel) raw.shieldDamage = 0;
  const result = readLinkNativeAttackPacket(raw, { sourcePath: row.sourcePath, function: row.function,
    line: row.line, selection: row.wikiPriorityOverrides.length ? 'wiki-selected' : 'native-source-silent' });
  if (result.kind === 'unresolved') throw new Error(`Unresolved Final ${label}: ${result.fields.join(',')}`);
  const forced = forceBindings as Readonly<Record<string, boolean>>;
  return { native: result.packet, forceReaction: forced[`${row.sourcePath}#${row.function}#${row.line}`] ?? false,
    unblockable: true, sourceShieldSentinel };
}
/** A Final run's packet as a combat hit, scaled by the run's resource (SmashWiki "Final Smash Meter": the
 * meter version's damage and knockback multipliers; a Smash Ball run is unscaled). */
export function finalRunPacketHit(packet: FinalBoundPacket, run: FinalRun, facing: 1 | -1, damageMultiplier: number): HitInfo {
  return nativePacketHit(packet.native, { facing, damageMultiplier, forceReaction: packet.forceReaction,
    unblockable: packet.unblockable, appliedDamageMultiplier: run.scales.damage,
    reactionMultiplier: run.scales.reaction, finalSmashRunId: run.id });
}
