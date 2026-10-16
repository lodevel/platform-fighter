import { DK_NATIVE_ATTACKS } from './donkeykongAttackData';
import { donkeyKongAttackReactionMetadata } from './donkeykongAttackReactionMetadata';
import type { AttackMove, AttackCollisionHit } from './attacks';

type Motion = keyof typeof DK_NATIVE_ATTACKS;
type Row = (typeof DK_NATIVE_ATTACKS)[Motion][number];

/** Native HIT_NODE regions with UFD-selected gameplay clocks. Source ages are
 * zero-based, half-open; see the October 8 mechanics contract for raw clocks
 * and the explicitly retained SpecialAirHi motion-rate discrepancy. */
export const DK_PROTECTION_WINDOWS: Partial<Record<Motion, NonNullable<AttackMove['protectionWindows']>>> = {
  AttackS3: [{ startFrame: 5, endFrame: 9, regions: ['arml'] }],
  AttackS3Hi: [{ startFrame: 5, endFrame: 9, regions: ['arml'] }],
  AttackS3Lw: [{ startFrame: 5, endFrame: 9, regions: ['arml'] }],
  AttackHi3: [{ startFrame: 4, endFrame: 11, regions: ['armr'] }],
  AttackLw3: [{ startFrame: 4, endFrame: 7, regions: ['arml', 'shoulderl'] }],
  AttackS4: [{ startFrame: 19, endFrame: 26, regions: ['head', 'arml', 'armr'] }],
  AttackHi4: [{ startFrame: 11, endFrame: 15, regions: ['head', 'armr', 'arml'] }],
  AttackLw4: [{ startFrame: 10, endFrame: 14, regions: ['armr', 'arml'] }],
  AttackAirHi: [{ startFrame: 4, endFrame: 10, regions: ['head'] }],
  SpecialN: [{ startFrame: 3, endFrame: 20, regions: ['arml'] }],
  SpecialAirN: [{ startFrame: 3, endFrame: 20, regions: ['arml'] }],
  // The grounded source marks armr only; UFD's plural arm summary does not
  // authorize removing the untouched arml/shoulder receiving regions.
  SpecialHi: [{ startFrame: 18, endFrame: 24, regions: ['armr'] }],
  SpecialAirHi: [{ startFrame: 9, endFrame: 38, regions: ['armr', 'arml'] }],
};

/** SmashWiki values that replace a native script row (SmashWiki wins over native data,
 * user rule 2026-10-11). The native records in donkeykongAttackData.ts stay verbatim. */
const DK_SOURCE_KNOCKBACK_OVERRIDES: Partial<Record<Motion, readonly {
  readonly frame: number; readonly ids: readonly number[]; readonly kbg: number; readonly fkb: number;
}[]>> = {
  // https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special Grounded "Hit 1" rows ids 0–5:
  // "bk=0 ks=30 fkv=90" (the native parse reads kbg 90 / fkb 30; the same template's rung
  // rows "ks=55 fkv=90" match native kbg 55 / fkb 90, so the columns are not swapped).
  SpecialHi: [{ frame: 19, ids: [0, 1, 2, 3, 4, 5], kbg: 30, fkb: 90 }],
};

function dkSourceRow(motion: Motion, row: Row): Row {
  const override = DK_SOURCE_KNOCKBACK_OVERRIDES[motion]?.find(o => o.frame === row.frame && o.ids.includes(row.id));
  return override ? { ...row, kbg: override.kbg, fkb: override.fkb } as Row : row;
}

export function dkSourceKnockback(row: Row): AttackMove['knockback'] {
  const a = row.angle > 360 ? 38 : row.angle;
  return { x: Math.cos(a * Math.PI / 180), y: -Math.sin(a * Math.PI / 180), scaling: 0,
    reference: { base: row.bkb, growth: row.kbg, ...(row.fkb ? { fixed: row.fkb } : {}), angle: row.angle, ...(row.set_weight ? { setWeight: true } : {}) } };
}

/** Keep explicit move/phase geometry; root-bone regions convert at 5 px/unit. */
export function dkSourceHits(motion: Motion, frame: number, authored?: readonly AttackCollisionHit[]): readonly AttackCollisionHit[] {
  const sourceFrame = Math.max(...DK_NATIVE_ATTACKS[motion].filter(r => r.frame <= frame).map(r => r.frame));
  return DK_NATIVE_ATTACKS[motion].filter(r => r.frame === sourceFrame && !(motion === 'AttackAirN' && frame > 10 && sourceFrame === 10 && r.id === 3)).map(native => {
    const row = dkSourceRow(motion, native);
    const old = authored?.find(h => h.id === row.id)
      ?? (motion === 'SpecialHi' && sourceFrame === 19 && row.id >= 3
        ? authored?.find(h => h.id === row.id - 3) : undefined);
    // Hand Slap's script rows carry zero offsets because its status code places them;
    // the authored SmashWiki placement is kept for those (see DONKEYKONG_DOWN_SPECIAL).
    const root = row.bone === 'top' && !(motion === 'SpecialLwLoop' && old);
    const start = { x: row.z * 5, y: 42 - row.y * 5 };
    const end = { x: (row.z2 ?? row.z) * 5, y: 42 - (row.y2 ?? row.y) * 5 };
    if (!root && !old) {
      throw new Error(`Missing authored DK collision geometry: ${motion} frame ${sourceFrame} region ${row.id} (${row.bone})`);
    }
    const capsule = root ? { start, end, radius: row.size * 5 }
      : { ...old!.capsule, radius: row.size * 5 };
    const reactionMetadata = donkeyKongAttackReactionMetadata(motion, row.frame, row.id);
    return { ...old, nativeCollisionAttribute: reactionMetadata?.nativeCollisionAttribute,
      nativeForceReaction: reactionMetadata?.nativeForceReaction,
      id: row.id, capsule, damage: row.damage,
      knockback: { ...dkSourceKnockback(row), reference: { ...dkSourceKnockback(row).reference!,
        ...(motion === 'AttackLw3' ? { additionalHitstunFrames: 5 } : {}),
        ...(old?.knockback?.reference?.additionalHitstunFrames === undefined ? {} : { additionalHitstunFrames: old.knockback.reference.additionalHitstunFrames }) } },
      hitlagMultiplier: row.hitlag, sdiMultiplier: row.sdi, shieldDamage: row.shield_damage,
      // Captured ATTACK_SETOFF_KIND_THRU still clanks but cannot rebound;
      // OFF is the distinct Hand Slap transcendent interaction.
      setoff: motion === 'AttackS4' || motion === 'AttackHi4' || motion === 'AttackLw4'
        || motion === 'SpecialN' || motion === 'SpecialAirN' || motion === 'SpecialNMax' || motion === 'SpecialAirNMax'
        ? 'through' as const : motion === 'SpecialLwLoop' || motion === 'SpecialAirLw'
          || motion === 'CatchAttack' || motion === 'CliffAttack' || motion === 'DownAttackD'
          || motion === 'DownAttackU' || motion === 'SlipAttack' ? 'off' as const : 'on' as const,
      ...(motion === 'AttackLw3' ? { tripChance: 0.4 } : motion === 'AttackS3Lw' ? { tripChance: 0.15 }
        : motion === 'SpecialAirLw' ? { tripChance: 0.2 } : {}),
      ...(motion === 'SpecialLwLoop' ? { shieldSetoffMultiplier: 0.58 } : {}),
      ...(motion === 'SpecialLwLoop' ? { direct: false } : {}),
      // Bair is authored on an already reversed attack axis in this engine.
      launchDirection: row.lr_check === 'ATTACK_LR_CHECK_POS' ? 'position'
        : row.lr_check === 'ATTACK_LR_CHECK_B' && motion !== 'AttackAirB' ? 'back' : 'forward',
      ...(row.situation === 'COLLISION_SITUATION_MASK_G' ? { situation: 'ground' as const }
        : row.situation === 'COLLISION_SITUATION_MASK_A' ? { situation: 'air' as const } : {}),
      targetCategory: row.category === 'COLLISION_CATEGORY_MASK_FIGHTER' ? 'fighter' : 'all',
      // Native collision_attr_bury: the shared consumer buries grounded
      // victims; airborne victims retain the source meteor launch.
      ...((motion === 'SpecialS' && row.id < 2) || (motion === 'SpecialAirS' && row.id === 0)
        ? { statusEffect: 'bury' as const } : {}),
    };
  });
}

/** Overlay every actual source region onto authored moves, including early/late windows. */
export function dkSourceMove<T extends AttackMove>(move: T, motion: Motion, frameOffset = 0): T {
  const rows = DK_NATIVE_ATTACKS[motion];
  const first = rows[0]!;
  const windows = move.hitWindows?.map(w => {
    const sourceFrame = w.startFrame + 1 - frameOffset;
    const collisionHits = dkSourceHits(motion, sourceFrame, w.collisionHits);
    if (!collisionHits.length) throw new Error(`No DK source hits: ${motion} frame ${sourceFrame}`);
    return { ...w, damage: collisionHits[0]!.damage, collisionHits, shieldDamage: collisionHits[0]!.shieldDamage };
  });
  // Windowed moves carry their pose geometry on each window, not on the parent.
  const hits = windows ? undefined : dkSourceHits(motion, first.frame, move.collisionHits);
  return { ...move, shieldDamage: first.shield_damage,
    ...(DK_PROTECTION_WINDOWS[motion] ? { protectionWindows: DK_PROTECTION_WINDOWS[motion] } : {}),
    ...(windows ? { hitWindows: windows } : { collisionHits: hits }) };
}
