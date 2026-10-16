#!/usr/bin/env python3
"""gen-donkeykong-kit.py — generates src/characters/DonkeyKong.ts from the
sourced record table below (UFD frame data + dumped Ultimate scripts; see
docs/review/2026-09-25/donkeykong-character/README.md).

Historical geometry/template generator. The audited runtime kit now uses
DonkeyKong.ts plus donkeykongSourceMoves.ts and donkeykongAttackData.ts.
Regenerate numeric source records with tools/gen-donkeykong-attack-data.py.
An explicit alternate destination can still produce the legacy template for comparison.
"""
"""Generate src/characters/DonkeyKong.ts from sourced records.
Conventions (docs/review/2026-09-25/donkeykong-character/README.md):
  engine_x = 5*z (forward), engine_y = 42 - 5*y (down positive), radius = 5*size.
  startupFrames = firstActive-1; activeFrames = lastActive-firstActive+1; recoveryFrames = total-lastActive.
  hitWindows/armorWindows [s-1, e).  reference = {base: BKB, growth: KBG, angle, fixed?: FKB, setWeight?}.
"""
import sys
from pathlib import Path
if len(sys.argv) < 2 or Path(sys.argv[1]).resolve() == (Path(__file__).resolve().parents[1] / 'src/characters/DonkeyKong.ts'):
    raise SystemExit('Legacy template cannot replace the audited kit. Use tools/gen-donkeykong-attack-data.py for numeric source regeneration, or supply an alternate destination for comparison.')

import math, json
PX = 5
FEET = 42  # body centre -> feet (84 px body)

def px(z): return round(z * PX, 1)
def py(y): return round(FEET - y * PX, 1)
def pr(size): return round(size * PX, 1)
def n(v):
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return repr(v) if isinstance(v, (int, float)) else str(v)

def legacy(angle, bkb, kbg, fkb=0):
    a = 40 if angle == 361 else (80 if angle in (366, 367) else angle)
    if fkb: m = 0.6 + fkb / 60; sc = 0.02
    else: m = (1.2 + bkb / 50 + kbg / 120) * 0.8; sc = kbg / 650
    rad = math.radians(a)
    return round(math.cos(rad) * m, 2), round(-math.sin(rad) * m, 2), round(sc, 3)

def kb(angle, bkb, kbg, fkb=0, extra=None, set_weight=None):
    x, y, sc = legacy(angle, bkb, kbg, fkb)
    # 367 has a contextual airborne pull in the damage handler. 366 remains
    # an explicit 80-degree approximation until its distinct rule is authored.
    ref = {'base': bkb, 'growth': kbg, 'angle': 80 if angle == 366 else angle}
    # Fixed knockback is percent-independent, not weight-independent.
    # The source's set_weight flag is a separate opt-in.
    if fkb: ref['fixed'] = fkb
    if set_weight: ref['setWeight'] = True
    if extra: ref.update(extra)
    reff = ', '.join(f'{k}: {n(v) if not isinstance(v,bool) else str(v).lower()}' for k, v in ref.items())
    return f"{{ x: {n(x)}, y: {n(y)}, scaling: {n(sc)}, reference: {{ {reff} }} }}"

def capsule(cx, cy, r, ex=None, ey=None):
    ex = cx if ex is None else ex; ey = cy if ey is None else ey
    return f"capsule: {{ start: {{ x: {n(cx)}, y: {n(cy)} }}, end: {{ x: {n(ex)}, y: {n(ey)} }}, radius: {n(r)} }}"

def hit(id, cx, cy, r, ex=None, ey=None, damage=None, knock=None, situation=None, target=None, hitlag=None):
    parts = [f"id: {id}"]
    if situation: parts.append(f"situation: '{situation}'")
    if target: parts.append(f"targetCategory: '{target}'")
    parts.append(capsule(cx, cy, r, ex, ey))
    if damage is not None: parts.append(f"damage: {n(damage)}")
    if hitlag is not None: parts.append(f"hitlagMultiplier: {n(hitlag)}")
    if knock: parts.append(f"knockback: {knock}")
    return "{ " + ", ".join(parts) + " }"

def rect(x0, x1, y0, y1):
    return f"{{ offsetX: {n(round((x0+x1)/2,1))}, offsetY: {n(round((y0+y1)/2,1))}, width: {n(round(x1-x0,1))}, height: {n(round(y1-y0,1))} }}"

def frames(first, last, total):
    return first - 1, last - first + 1, total - last

out = []
W = out.append
W('''/**
 * Donkey Kong — Super Smash Bros. Ultimate kit, sourced.
 *
 * Every timing, damage and launch value below comes from
 *   • Ultimate Frame Data (https://ultimateframedata.com/donkey_kong,
 *     2026-09-25) — startup / active / total frames, damage, landing lag,
 *     autocancel, armour and intangibility notes;
 *   • the dumped Ultimate scripts (WuBoytH/SSBU-Dumped-Scripts @
 *     59004685238a3f6f93bae905d3a4e079701c40b4, smashline/lua2cpp_donkey/donkey)
 *     — per-hitbox angle / KBG / FKB / BKB, hitlag, situation masks and
 *     bone-local geometry. The parsed records live in
 *     docs/review/2026-09-25/donkeykong-character/sources/dk-scripts.json.
 *
 * Conventions (see the evidence record's "Unit/frame contract"):
 *   • UFD frame 1 is elapsed step 0. `startupFrames` = first active − 1,
 *     `activeFrames` = active envelope length, `recoveryFrames` = UFD endlag;
 *     the three sum to the UFD total. `hitWindows` / `armorWindows` are
 *     zero-based half-open: source `[s, e]` → `[s − 1, e)`.
 *   • `knockback.reference` is the script record (`base` = BKB, `growth` =
 *     KBG, `fixed` = FKB; `setWeight` follows its separate source flag). The legacy x/y/scaling vector is
 *     only a fallback for tooling that ignores `reference`.
 *   • Geometry: 5 px per unit. Script offsets on the `top` bone convert
 *     exactly (x = 5·z forward, y = 42 − 5·y with the feet at +42 on this
 *     60×84 px body). Bone-attached regions (arms, hands, feet, head) are
 *     placed from the inspected UFD frames (docs/review/…/motion/*.md) and are
 *     therefore **approximate**; radii are the script sizes × 5.
 *   • Arm/head intangibility and "cannot rebound" (clang) flags are recorded
 *     in the evidence ledger but not modelled — the engine has one body
 *     hurtbox and no clang.
 *
 * Every numeric here is a frozen literal — no randomness, no wall-clock.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove, AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { ChargeSpecialMove } from './specialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { ShockwaveDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { DONKEYKONG_MOVEMENT_PROFILE } from './fighterMovementProfiles';

export { DONKEYKONG_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement fields spread from `DONKEYKONG_MOVEMENT_PROFILE` (UFD stats);
 * the 60×84 px movement body stays inline because it is collision data.
 * 84 px ≈ 16.8 units, matching the script's head/up-smash heights.
 */
export const DONKEYKONG_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion' | 'referenceWeight' | 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceWeight' | 'referenceLaunch'> = {
  ...DONKEYKONG_MOVEMENT_PROFILE,
  width: 60,
  height: 84,
  chamfer: 10,
};
''')

# ---------------- JAB 1 (Attack11) ----------------
s, a, r = frames(5, 6, 24)
W(f'''
/**
 * Jab 1 (Attack11): frames 5–6 of 24, 4 %. Two `top`-bone punches plus the
 * fist's own inward (fighter-only, 180°) / outward regions. Transitions to
 * jab 2 from frame 8 ("as early as frame 8").
 */
export const DONKEYKONG_JAB: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1.5, sdiMultiplier: 1,
  id: 'donkeykong.jab',
  type: 'jab',
  damage: 4,
  knockback: {kb(361, 25, 35)},
  hitbox: {rect(-5, 77.5, -45.5, 12)},
  collisionHits: [
    {hit(0, px(5), py(11.5), pr(6))},
    {hit(1, px(11), py(10.5), pr(4.5), knock=kb(361, 20, 30))},
    {hit(2, 60, -10, pr(4.5), target='fighter', knock=kb(180, 20, 20))},
    {hit(3, 60, -10, pr(4.5), target='all', knock=kb(361, 20, 20))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 1, recoveryFrames: 1 }},
  jabChain: {{ nextId: 'donkeykong.jab2', advanceWindowStart: 7 }},
}};
''')

# ---------------- JAB 2 (Attack12) ----------------
s, a, r = frames(4, 6, 31)
W(f'''
/** Jab 2 (Attack12): frames 4–6 of 31, 6 %, 70° uppercut. DK has no jab 3. */
export const DONKEYKONG_JAB2: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1.8, sdiMultiplier: 1,
  id: 'donkeykong.jab2',
  type: 'jab',
  damage: 6,
  knockback: {kb(70, 40, 100)},
  hitbox: {rect(-10, 75, -58, 22)},
  collisionHits: [
    {hit(0, 40, -18, pr(7))},
    {hit(1, px(7), py(9.5), pr(5.5))},
    {hit(2, px(5), py(15), pr(5))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 1, activeFrames: 2, recoveryFrames: 1 }},
}};
''')

# ---------------- FORWARD TILT (AttackS3) ----------------
s, a, r = frames(7, 9, 34)
W(f'''
/**
 * Forward tilt (AttackS3): frames 7–9 of 34, 8 %. A long backhand chop along
 * the far arm (three `arml`/`shoulderl` regions). The angled variants
 * (AttackS3Hi / AttackS3Lw, 9 %) are not selectable in this engine.
 * Arm intangibility 6–9 is recorded, not modelled.
 */
export const DONKEYKONG_TILT: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.tilt',
  type: 'tilt',
  damage: 8,
  knockback: {kb(361, 50, 78)},
  hitbox: {rect(-10, 132.5, -40, 16)},
  collisionHits: [
    {hit(0, 75, -12, pr(5.5), 105, -12)},
    {hit(1, 40, -12, pr(5))},
    {hit(2, 8, -15, pr(3.5))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 1, recoveryFrames: 2 }},
}};
''')

# ---------------- UP TILT (AttackHi3) ----------------
s, a, r = frames(5, 11, 38)
W(f'''
/**
 * Up tilt (AttackHi3): frames 5–11 of 38. Overhead windmill along the near
 * arm: shoulder 8 % / arm 9 % / hand 10 %, all 100° with position-based
 * launch. Lowest id wins where regions overlap (shoulder over hand).
 */
export const DONKEYKONG_UTILT: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.utilt',
  type: 'tilt',
  damage: 10,
  launchAwayFromSource: true,
  knockback: {kb(100, 40, 115)},
  hitbox: {rect(-60, 72, -118, 10)},
  collisionHits: [
    {hit(0, 12, -14, pr(4.8), damage=8, knock=kb(100, 40, 105))},
    {hit(1, 32, -66, pr(4.0), damage=9, knock=kb(100, 40, 110))},
    {hit(2, 45, -92, pr(5.3), damage=10)},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 1, activeFrames: 3, recoveryFrames: 2 }},
}};
''')

# ---------------- DOWN TILT (AttackLw3) ----------------
s, a, r = frames(6, 7, 24)
W(f'''
/**
 * Down tilt (AttackLw3): frames 6–7 of 24, 6 %, Sakurai angle with +5
 * reaction frames (`set_add_reaction_frame 5`). Low arm sweep along the
 * ground; arm/shoulder intangibility 5–7 recorded, not modelled.
 */
export const DONKEYKONG_DTILT: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.dtilt',
  type: 'tilt',
  damage: 6,
  launchAwayFromSource: true,
  knockback: {kb(361, 10, 80, extra={'additionalHitstunFrames': 5})},
  hitbox: {rect(-12, 112.5, 3, 58)},
  collisionHits: [
    {hit(0, 10, 30, pr(4.4))},
    {hit(1, 45, 30, pr(4.4))},
    {hit(2, 85, 30, pr(5.5))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 1, recoveryFrames: 2 }},
}};
''')

# ---------------- DASH ATTACK (AttackDash) ----------------
s, a, r = frames(9, 24, 34)
W(f'''
/**
 * Dash attack (AttackDash): a forward roll. Early 9–12: 12 %, 53°, BKB 85 /
 * KBG 46 on a `top` sphere (z 8, y 8, r 7). Late 13–24: 9 %, 45°, BKB 60 /
 * KBG 60 (z 5.2, r 5.5). Total 34, hitlag ×1.25. Body travel is the run
 * momentum the engine carries into the move.
 */
export const DONKEYKONG_DASHATTACK: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1.25, sdiMultiplier: 1,
  id: 'donkeykong.dashAttack',
  type: 'tilt',
  damage: 12,
  knockback: {kb(53, 85, 46)},
  hitbox: {rect(px(8)-pr(7), px(8)+pr(7), py(8)-pr(7), py(8)+pr(7))},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 8, endFrame: 12, group: 'roll', damage: 12 }},
    {{ startFrame: 12, endFrame: 24, group: 'roll-late', damage: 9,
      knockback: {kb(45, 60, 60)},
      hitbox: {rect(px(5.2)-pr(5.5), px(5.2)+pr(5.5), py(8)-pr(5.5), py(8)+pr(5.5))} }},
  ],
  animation: {{ startupFrames: 2, activeFrames: 2, recoveryFrames: 2 }},
}};
''')

# ---------------- FORWARD SMASH (AttackS4) ----------------
s, a, r = frames(22, 23, 54)
W(f'''
/**
 * Forward smash (AttackS4): a giant two-handed clap. Charge hold frame 14;
 * active 22–23 of 54; hitlag ×1.4; cannot rebound. Far sphere (z 24, r 5.7):
 * 22 %, 46°, BKB 21 / KBG 88. Close capsule (z 18→10, r 3.7): 21 %, Sakurai
 * angle, BKB 18 / KBG 86. Head/arm intangibility 20–26 recorded, not modelled.
 */
export const DONKEYKONG_SMASH: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1.4, sdiMultiplier: 1,
  chargeStartFrame: 13,
  id: 'donkeykong.smash',
  type: 'smash',
  damage: 22,
  knockback: {kb(46, 21, 88)},
  charge: {{
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 22,
    maxDamage: 30.8,
    minKnockback: {{ x: 4.4, y: -1.5, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 }},
    maxKnockback: {{ x: 6.16, y: -2.1, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 }},
  }},
  hitbox: {rect(px(10)-pr(3.7), px(24)+pr(5.7), py(6.4)-pr(5.7), py(6.4)+pr(5.7))},
  collisionHits: [
    {hit(0, px(24), py(6.4), pr(5.7), damage=22)},
    {hit(1, px(18), py(6.4), pr(3.7), px(10), py(6.4), damage=21, knock=kb(361, 18, 86))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 3, activeFrames: 1, recoveryFrames: 2 }},
}};
''')

# ---------------- UP SMASH (AttackHi4) ----------------
s, a, r = frames(14, 15, 49)
W(f'''
/**
 * Up smash (AttackHi4): overhead clap. Charge hold frame 6; active 14–15 of
 * 49; 19 %, 90°, BKB 40 / KBG 84, position-based launch; cannot rebound.
 * Sphere at y 28 (r 8.8) over a capsule at y 18 (z 5 → −5, r 7).
 */
export const DONKEYKONG_USMASH: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  chargeStartFrame: 5,
  id: 'donkeykong.usmash',
  type: 'smash',
  damage: 19,
  launchAwayFromSource: true,
  knockback: {kb(90, 40, 84)},
  charge: {{
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 19,
    maxDamage: 26.6,
    minKnockback: {{ x: 0.3, y: -3.9, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 }},
    maxKnockback: {{ x: 0.42, y: -5.46, scaling: 0.55, baseMagnitude: 1.4, damageGrowth: 0.5 }},
  }},
  hitbox: {rect(-pr(8.8), pr(8.8), py(28)-pr(8.8), py(18)+pr(7))},
  collisionHits: [
    {hit(0, 0, py(28), pr(8.8))},
    {hit(1, px(5), py(18), pr(7), px(-5), py(18))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 1, recoveryFrames: 3 }},
}};
''')

# ---------------- DOWN SMASH (AttackLw4) ----------------
s, a, r = frames(11, 14, 55)
W(f'''
/**
 * Down smash (AttackLw4): both palms slam the ground on both sides. Charge
 * hold frame 2; active 11–14 of 55; cannot rebound. Frames 11–12: fists
 * (17 %, 70°, BKB 35 / KBG 88) and shoulders (14 %, 82°). Frames 13–14: `top`
 * spheres at z 19 and z −12 (18 %, 55°, BKB 30 / KBG 88) and shoulders
 * (14 %, 98°). Arm intangibility 11–14 recorded, not modelled.
 */
export const DONKEYKONG_DSMASH: AttackMoveWithAnimation = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  chargeStartFrame: 1,
  id: 'donkeykong.dsmash',
  type: 'smash',
  damage: 17,
  launchAwayFromSource: true,
  knockback: {kb(70, 35, 88)},
  charge: {{
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 17,
    maxDamage: 23.8,
    minKnockback: {{ x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 }},
    maxKnockback: {{ x: 6.16, y: -1.4, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 }},
  }},
  hitbox: {rect(-90, 125, -50, 50)},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 10, endFrame: 12, group: 'fists', damage: 17,
      collisionHits: [
        {hit(0, 45, -30, pr(4.0))},
        {hit(1, -35, -30, pr(4.0))},
        {hit(2, 12, -25, pr(4.0), damage=14, knock=kb(82, 35, 88))},
        {hit(3, -12, -25, pr(4.0), damage=14, knock=kb(82, 35, 88))},
      ] }},
    {{ startFrame: 12, endFrame: 14, group: 'palms', damage: 18,
      knockback: {kb(55, 30, 88)},
      collisionHits: [
        {hit(0, px(19), py(4.5), pr(6))},
        {hit(1, px(-12), py(4.5), pr(6))},
        {hit(2, 12, -25, pr(4.5), damage=14, knock=kb(98, 35, 88))},
        {hit(3, -12, -25, pr(4.5), damage=14, knock=kb(98, 35, 88))},
      ] }},
  ],
  animation: {{ startupFrames: 1, activeFrames: 2, recoveryFrames: 3 }},
}};
''')

# ---------------- NAIR (AttackAirN) ----------------
s, a, r = frames(10, 26, 38)
W(f'''
/**
 * Neutral air (AttackAirN): a spinning double-arm swipe. Early 10–13: 12 %,
 * Sakurai angle, BKB 20 / KBG 100 on both arms, the hip and (frame 10 only)
 * a forward `top` sphere at z 15. Late 14–26: 9 %, BKB 10 / KBG 100. Total
 * 38, landing lag 10, autocancel 1–9 and 27+. Position-based launch.
 */
export const DONKEYKONG_NAIR: AerialMove = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 12,
  launchAwayFromSource: true,
  knockback: {kb(361, 20, 100)},
  hitbox: {rect(-45, 100, -32, 40)},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 9, endFrame: 13, group: 'early', damage: 12,
      collisionHits: [
        {hit(0, 40, -20, pr(5))},
        {hit(1, -30, 0, pr(5))},
        {hit(2, 8, 12, pr(5.7))},
        {hit(3, px(15), py(8), pr(5))},
      ] }},
    {{ startFrame: 13, endFrame: 26, group: 'late', damage: 9,
      knockback: {kb(361, 10, 100)},
      hitbox: {rect(-45, 65, -32, 40)},
      collisionHits: [
        {hit(0, 40, -20, pr(5))},
        {hit(1, -30, 0, pr(5))},
        {hit(2, 8, 12, pr(5.7))},
      ] }},
  ],
  animation: {{ startupFrames: 2, activeFrames: 3, recoveryFrames: 2 }},
  landingLagFrames: 10,
  autoCancelWindows: [{{ startFrame: 0, endFrame: 9 }}, {{ startFrame: 26, endFrame: 38 }}],
}};
''')

# ---------------- FAIR (AttackAirF) ----------------
s, a, r = frames(18, 23, 55)
W(f'''
/**
 * Forward air (AttackAirF): a two-fisted overhead hammer. Early 18–20: 16 %,
 * Sakurai angle, BKB 20 / KBG 85. Late 21–23: the fist (id 0) is a 15 %
 * meteor (270°, BKB 30 / KBG 100, hitlag ×1.5) and the arms (id 1) 13 %
 * Sakurai. Total 55, landing lag 17; autocancels only from frame 56, i.e.
 * never inside the move.
 */
export const DONKEYKONG_FAIR: AerialMove = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 16,
  knockback: {kb(361, 20, 85)},
  hitbox: {rect(-20, 92.5, -48, 52.5)},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 17, endFrame: 20, group: 'early', damage: 16,
      collisionHits: [
        {hit(0, 20, -20, pr(5.5), 65, 10)},
        {hit(1, 35, -15, pr(4.5))},
      ] }},
    {{ startFrame: 20, endFrame: 23, group: 'late', damage: 15, hitlagMultiplier: 1.5,
      knockback: {kb(270, 30, 100)},
      collisionHits: [
        {hit(0, 55, 25, pr(5.5), damage=15)},
        {hit(1, 30, 0, pr(5.0), damage=13, knock=kb(361, 30, 100))},
      ] }},
  ],
  animation: {{ startupFrames: 2, activeFrames: 2, recoveryFrames: 3 }},
  landingLagFrames: 17,
  // UFD: autocancels from frame 56 onward only, i.e. never inside the move.
  autoCancelWindows: [],
}};
''')

# ---------------- BAIR (AttackAirB) ----------------
s, a, r = frames(7, 16, 31)
W(f'''
/**
 * Back air (AttackAirB): a rearward kick (`LR_B` — back-aerial dispatch
 * reverses the attack axis, so the geometry is authored forward). Early 7–8:
 * 13 %, Sakurai angle, BKB 20 / KBG 97 (foot r 7, knee/hip r 5). Late 9–16:
 * 8 %, BKB 10 / KBG 100. Total 31, landing lag 11, autocancel 1–6 and 31+.
 */
export const DONKEYKONG_BAIR: AerialMove = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 13,
  knockback: {kb(361, 20, 97)},
  hitbox: {rect(-25, 95, -30, 40)},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 6, endFrame: 8, group: 'early', damage: 13,
      collisionHits: [
        {hit(0, 60, 5, pr(7))},
        {hit(1, 30, 0, pr(5))},
        {hit(2, 0, 5, pr(5))},
      ] }},
    {{ startFrame: 8, endFrame: 16, group: 'late', damage: 8,
      knockback: {kb(361, 10, 100)},
      collisionHits: [
        {hit(0, 60, 5, pr(6))},
        {hit(1, 30, 0, pr(4))},
        {hit(2, 0, 5, pr(4))},
      ] }},
  ],
  animation: {{ startupFrames: 2, activeFrames: 2, recoveryFrames: 2 }},
  landingLagFrames: 11,
  autoCancelWindows: [{{ startFrame: 0, endFrame: 6 }}, {{ startFrame: 30, endFrame: 31 }}],
}};
''')

# ---------------- UAIR (AttackAirHi) ----------------
s, a, r = frames(6, 10, 37)
W(f'''
/**
 * Up air (AttackAirHi): an upward headbutt. Frames 6–10 of 37: 13 %, 90°,
 * BKB 32 / KBG 90 on the head (r 7.5), position-based launch. Landing lag
 * 15, autocancel 1–5 and 26+. Head intangibility 5–10 recorded, not modelled.
 */
export const DONKEYKONG_UAIR: AerialMove = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 13,
  launchAwayFromSource: true,
  knockback: {kb(90, 32, 90)},
  hitbox: {rect(15-pr(7.5), 15+pr(7.5), -33-pr(7.5), -33+pr(7.5))},
  collisionHits: [{hit(0, 15, -33, pr(7.5))}],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 2, recoveryFrames: 3 }},
  landingLagFrames: 15,
  autoCancelWindows: [{{ startFrame: 0, endFrame: 5 }}, {{ startFrame: 25, endFrame: 37 }}],
}};
''')

# ---------------- DAIR (AttackAirLw) ----------------
s, a, r = frames(14, 16, 54)
W(f'''
/**
 * Down air (AttackAirLw): a double-foot stomp. Frames 14–16 of 54. Feet
 * (`top` y −5, r 7): 16 % meteor, 270°, BKB 30 / KBG 90. Body (y 6, r 5.8):
 * 13 %, Sakurai, BKB 20 / KBG 90. Position-based launch; landing lag 14;
 * autocancel 1–2 and 50+. The grounded response to the meteor is the
 * engine's generic reflection (no separate script record).
 */
export const DONKEYKONG_DAIR: AerialMove = {{
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 16,
  launchAwayFromSource: true,
  knockback: {kb(270, 30, 90)},
  hitbox: {rect(-pr(7), px(1)+pr(7), py(6)-pr(5.8), py(-5)+pr(7))},
  collisionHits: [
    {hit(0, px(1), py(-5), pr(7), damage=16)},
    {hit(1, 0, py(6), pr(5.8), damage=13, knock=kb(361, 20, 90))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  animation: {{ startupFrames: 2, activeFrames: 2, recoveryFrames: 3 }},
  landingLagFrames: 14,
  autoCancelWindows: [{{ startFrame: 0, endFrame: 2 }}, {{ startFrame: 49, endFrame: 54 }}],
}};
''')

# ---------------- GIANT PUNCH (SpecialN / SpecialNMax) ----------------
s, a, r = 18, 2, 35
W(f'''
/**
 * Giant Punch (SpecialN / SpecialNMax) — `charge` kind. Ultimate winds the
 * punch on a press and keeps the charge when cancelled with shield; this
 * engine's charge specials bank on a shield press and resume on the next
 * press, so the storage behaviour matches even though the input is
 * hold-to-charge (recorded approximation). Full charge takes 111 frames.
 * Release: active 19–20 after the charge state; uncharged 10 % (Sakurai,
 * BKB 45 / KBG 70) up to 28 % (BKB 35 / KBG 73). Full charge selects its separate launch record. Endlag 35 (uncharged);
 * the full-charge 27-frame endlag is not representable. Super armour on
 * frames 9–20 only at full charge (`minChargeRatio: 1`). Arm intangibility
 * 4–20 and the aerial 6 % / 25 % variant are recorded gaps.
 */
export const DONKEYKONG_NEUTRAL_SPECIAL: ChargeSpecialMove = {{
  id: 'donkeykong.neutral_special',
  type: 'special',
  specialKind: 'charge',
  damage: 10,
  knockback: {kb(361, 45, 70)},
  hitlagMultiplier: 1,
  sdiMultiplier: 1,
  hitbox: {rect(-15, 117.5, -40, 16)},
  collisionHits: [
    {hit(0, 60, -12, pr(5.5), 90, -12)},
    {hit(1, 25, -12, pr(4))},
    {hit(2, 0, -15, pr(3))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  armorWindows: [{{ startFrame: 8, endFrame: 20, minChargeRatio: 1 }}],
  animation: {{ startupFrames: 2, activeFrames: 1, recoveryFrames: 3 }},
  charge: {{
    // SpecialNMax switches launch records only when the charge is complete.
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 111,
    minDamage: 10,
    maxDamage: 28,
    fullChargeKnockback: {kb(361, 35, 73)},
    minKnockback: {{ x: 4.6, y: -1.5, scaling: 0.36 }},
    maxKnockback: {{ x: 6.2, y: -2.0, scaling: 0.5 }},
  }},
}};
''')

# ---------------- HEADBUTT (SpecialS) ----------------
s, a, r = frames(20, 21, 62)
W(f'''
/**
 * Headbutt (SpecialS) — modelled as a `dashStrike` with a minimal forward
 * step. Frames 20–21 of 62, super armour 5–14. Grounded targets: 10 %, 270°,
 * BKB 40 / KBG 40 with the source's bury effect (bury is not modelled; the
 * engine's grounded meteor handling applies). Airborne targets: 8 %, 70°,
 * BKB 15 / KBG 40 on a large head sphere (r 10). Shield damage 25 and the
 * aerial start-up hop are recorded gaps.
 */
export const DONKEYKONG_SIDE_SPECIAL: DashStrikeSideSpecialMove = {{
  id: 'donkeykong.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 10,
  knockback: {kb(270, 40, 40)},
  hitlagMultiplier: 1,
  sdiMultiplier: 1,
  launchAwayFromSource: true,
  hitbox: {rect(10, 120, -63, 42)},
  collisionHits: [
    {hit(0, px(19), py(5), pr(5), px(7), py(5), situation='ground')},
    {hit(1, px(18), py(13), pr(3), px(9), py(13), situation='ground')},
    {hit(2, px(14), py(11), pr(10), situation='air', damage=8, knock=kb(70, 15, 40))},
  ],
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  armorWindows: [{{ startFrame: 4, endFrame: 14 }}],
  animation: {{ startupFrames: 3, activeFrames: 1, recoveryFrames: 3 }},
  dashStrike: {{
    dashSpeed: 1.5, // a small forward lean (project calibration; the source barely travels)
    dashFrames: 2,
    helplessAfterDash: false,
  }},
}};
''')

# ---------------- SPINNING KONG (SpecialHi / SpecialAirHi) ----------------
# Aerial: first 4-6, multi 10-12,13-14,15-17,18-19,20-21,22-24,25-26,27-29,30-31,32-33,34-36,37-38, final 39-43
aerial_windows = [(4,6),(10,12),(13,14),(15,17),(18,19),(20,21),(22,24),(25,26),(27,29),(30,31),(32,33),(34,36),(37,38),(39,43)]
first_active = 4
hitFrames = [w[0]-first_active for w in aerial_windows]
activePer = [w[1]-w[0]+1 for w in aerial_windows]
dmg = [5] + [1]*12 + [2]
kbs = [kb(85, 50, 10)] + [kb(367, 55, 20)]*12 + [kb(361, 72, 80)]
hitlagPer = [1]*14; sdiPer = [1]*14
s = first_active - 1; a = 43 - first_active + 1; r = 20
gw = [(19,19),(25,27),(32,33),(40,42),(49,50),(55,58),(62,62)]
W(f'''
/**
 * Spinning Kong (SpecialAirHi / SpecialHi) — `multiHitRising`.
 *
 * Aerial: first hit 4–6 (5 %, 85°, BKB 50 / KBG 10), twelve 1 % autolink
 * rungs 10–38 (angle 367 contextual pull, BKB 55 / KBG 20), a
 * 2 % finisher 39–43 (Sakurai, BKB 72 / KBG 80). Landing lag 38. Ultimate's
 * aerial spin resets upward speed and reduces gravity while allowing drift.
 * Motion parameters use supplemental research at the project's 5 px scale;
 * they are not supplied by UFD. Reduced gravity ends after game frame 43.
 * Arm intangibility 10–38 remains a gap; `recoveryFrames` approximates the
 * aerial total because UFD supplies no total duration.
 *
 * Grounded: super armour 5–17; first hit 19 (5 %, fixed KB 30 at 95°), 1.4 %
 * rungs at 25–27 / 32–33 / 40–42 / 49–50 / 55–58 (fixed KB 80/90, autolink
 * 367 with calibrated airborne pull and grounded 80°; inner rungs use
 * 20° / fixed KB 65 / KBG 100;
 * the rear 3.5 % hit is a gap), finisher 62 (4 %,
 * Sakurai, BKB 60 / KBG 157, hitlag ×2). Total 104, endlag 42.
 * Fixed launch records retain target weight, as in the captured source;
 * fixed knockback does not imply the separate set-weight flag.
 */
export const DONKEYKONG_UP_SPECIAL: MultiHitRisingUpSpecialMove = {{
  id: 'donkeykong.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  damage: 5,
  knockback: {kb(85, 50, 10)},
  hitbox: {rect(-45, 45, -75, 25)},
  startupFrames: {s},
  activeFrames: {a},
  recoveryFrames: {r},
  cooldownFrames: 0,
  specialLandingLagFrames: 38,
  animation: {{ startupFrames: 1, activeFrames: 4, recoveryFrames: 3 }},
  multiHitRising: {{
    riseImpulse: -4.5,
    driftImpulse: 0, // Flight profile preserves entry momentum instead.
    sustainedRise: {{ gravityFrames: 43, gravity: 0.02975, airAcceleration: 0.25, maxAirSpeed: 8.5 }},
    hitCount: {len(aerial_windows)},
    hitInterval: 3,
    hitFrames: [{', '.join(str(h) for h in hitFrames)}],
    activeFramesPerHit: [{', '.join(str(h) for h in activePer)}],
    damagePerHit: [{', '.join(str(d) for d in dmg)}],
    hitlagMultiplierPerHit: [{', '.join(str(h) for h in hitlagPer)}],
    sdiMultiplierPerHit: [{', '.join(str(h) for h in sdiPer)}],
    knockbackPerHit: [
      {(','+chr(10)+'      ').join(kbs)},
    ],
    linkDamage: 1,
    linkKnockback: {kb(367, 55, 20)},
    launcherDamage: 2,
    launcherKnockback: {kb(361, 72, 80)},
  }},
  groundedVariant: {{
    id: 'donkeykong.up_special', type: 'upSpecial', damage: 5,
    knockback: {kb(95, 0, 90, fkb=30)},
    hitlagMultiplier: 1,
    sdiMultiplier: 1,
    launchAwayFromSource: true,
    hitbox: {rect(-50, 150, -75, 25)},
    startupFrames: 18, activeFrames: 44, recoveryFrames: 42, cooldownFrames: 0,
    armorWindows: [{{ startFrame: 4, endFrame: 17 }}],
    hitWindows: [
      {{ startFrame: 18, endFrame: 20, group: 'first', damage: 5,
        collisionHits: [{hit(0, 40, -10, pr(6))}, {hit(1, 10, -10, pr(5), knock=kb(80, 0, 90, fkb=30))}] }},
      {{ startFrame: 24, endFrame: 27, group: 'rung1', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: {kb(367, 0, 55, fkb=90)},
        collisionHits: [{hit(0, px(25), py(7), pr(4), px(25), py(12))}, {hit(1, px(12.5), py(12), pr(5), knock=kb(20, 0, 100, fkb=65))}] }},
      {{ startFrame: 31, endFrame: 33, group: 'rung2', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: {kb(367, 0, 55, fkb=80)},
        collisionHits: [{hit(0, px(25), py(7), pr(4), px(25), py(12))}, {hit(1, px(12.5), py(12), pr(5), knock=kb(20, 0, 100, fkb=65))}] }},
      {{ startFrame: 39, endFrame: 42, group: 'rung3', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: {kb(367, 0, 55, fkb=90)},
        collisionHits: [{hit(0, px(25), py(7), pr(4), px(25), py(12))}, {hit(1, px(12.5), py(12), pr(5), knock=kb(20, 0, 100, fkb=65))}] }},
      {{ startFrame: 48, endFrame: 50, group: 'rung4', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: {kb(367, 0, 55, fkb=90)},
        collisionHits: [{hit(0, px(25), py(7), pr(4), px(25), py(12))}, {hit(1, px(12.5), py(12), pr(5), knock=kb(20, 0, 100, fkb=65))}] }},
      {{ startFrame: 54, endFrame: 58, group: 'rung5', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: {kb(367, 0, 55, fkb=90)},
        collisionHits: [{hit(0, px(25), py(7), pr(4), px(25), py(12))}, {hit(1, px(12.5), py(12), pr(5), knock=kb(20, 0, 100, fkb=65))}] }},
      {{ startFrame: 61, endFrame: 62, group: 'finish', damage: 4, hitlagMultiplier: 2,
        knockback: {kb(361, 60, 157)},
        collisionHits: [{hit(0, px(20), py(11), pr(8), px(-4), py(11))}] }},
    ],
    animation: {{ startupFrames: 3, activeFrames: 4, recoveryFrames: 1 }},
  }},
}};
''')

# ---------------- HAND SLAP (SpecialLwLoop / SpecialAirLw) ----------------
W(f'''
/**
 * Hand Slap (SpecialLwStart/Loop/End, SpecialAirLw) — `shockwave` kind.
 *
 * Grounded: two ground slaps per activation at frames 12–13 and 23–24 of 46;
 * each 14 %, 78° / 84°, BKB 85 / KBG 30, hitlag ×0.5, on a `top` sphere of
 * radius 10.3 units centred at the feet — it only reaches grounded targets
 * (`situation: 'ground'`). Mashing B queues another 26-frame loop: the
 * repeat window closes at elapsed 26 and rewinds to 0, so the next slaps
 * land 26 frames after the previous ones (UFD: "each additional rep takes
 * another 26 frames").
 *
 * Aerial: two claps — 19–21 (5 %, 90°, fixed KB 36) and 28–30 (6 %, 270°
 * meteor, BKB 30 / KBG 100) of 49; landing lag 10. "Transcendent priority"
 * is a recorded gap.
 */
export const DONKEYKONG_DOWN_SPECIAL: ShockwaveDownSpecialMove = {{
  id: 'donkeykong.down_special',
  type: 'downSpecial',
  downSpecialKind: 'shockwave',
  damage: 14,
  knockback: {kb(78, 85, 30)},
  hitlagMultiplier: 0.5,
  sdiMultiplier: 1,
  launchAwayFromSource: true,
  hitbox: {rect(-pr(10.3), pr(10.3), FEET-pr(10.3), FEET+pr(10.3))},
  startupFrames: 11,
  activeFrames: 13,
  recoveryFrames: 22,
  cooldownFrames: 0,
  hitWindows: [
    {{ startFrame: 11, endFrame: 13, group: 'slap1', damage: 14,
      collisionHits: [{hit(0, 0, FEET, pr(10.3), situation='ground')}] }},
    {{ startFrame: 22, endFrame: 24, group: 'slap2', damage: 14,
      knockback: {kb(84, 85, 30)},
      collisionHits: [{hit(0, 0, FEET, pr(10.3), situation='ground')}] }},
  ],
  animation: {{ startupFrames: 4, activeFrames: 2, recoveryFrames: 1 }},
  shockwave: {{
    repeat: {{ windowStart: 13, windowEnd: 26, entryFrame: 0, maxRepeats: 8 }},
    aerialVariant: {{
      id: 'donkeykong.down_special', type: 'downSpecial', damage: 5,
      knockback: {kb(90, 0, 100, fkb=36)},
      hitlagMultiplier: 1,
      sdiMultiplier: 1,
      launchAwayFromSource: true,
      hitbox: {rect(-25, 65, -40, 50)},
      startupFrames: 18, activeFrames: 12, recoveryFrames: 19, cooldownFrames: 0,
      specialLandingLagFrames: 10,
      hitWindows: [
        {{ startFrame: 18, endFrame: 21, group: 'clap1', damage: 5,
          collisionHits: [{hit(0, 20, 0, pr(7))}] }},
        {{ startFrame: 27, endFrame: 30, group: 'clap2', damage: 6,
          knockback: {kb(270, 30, 100)},
          collisionHits: [{hit(0, 20, 10, pr(8))}] }},
      ],
      animation: {{ startupFrames: 2, activeFrames: 4, recoveryFrames: 2 }},
    }},
  }},
}};
''')

# ---------------- GRAB / THROWS ----------------
W(f'''
/**
 * Grab (Catch): frames 8–10 of 38; the standing catch capsule runs z 4 →
 * 13.7 at y 7 with radius 5.8 (a 19.5-unit reach, matching the UFD grab-range
 * table). Dash grab reaches one unit further (11–13 of 46). Pummel 1.6 %,
 * 21 frames including hitlag. Throws use the script records; Ultimate's
 * forward throw is the Cargo carry, which this engine cannot represent, so
 * the Cargo forward throw's launch (12 %, 60°, BKB 90 / KBG 46, release
 * frame 15 of 45) stands in for the forward throw. Back 11 % (40°, BKB 60 /
 * KBG 65, release 15 of 39); up 9 % (90°, BKB 70 / KBG 50, release 14 of 43);
 * down 7 % (Sakurai, BKB 60 / KBG 50, release 19 of 54). `animationFrames`
 * is the release frame; the per-throw remainder is approximated by one
 * `throwRecoveryFrames`.
 */
export const DONKEYKONG_GRAB: GrabSpec = {{
  id: 'donkeykong.grab',
  hitbox: {rect(-9, 97.5, py(7)-pr(5.8), py(7)+pr(5.8))},
  startupFrames: 7,
  activeFrames: 3,
  whiffRecoveryFrames: 28,
  holdFramesMax: 90,
  throwRecoveryFrames: 29,
  pummel: {{ damage: 1.6, cooldownFrames: 21 }},
  dashGrab: {{ rangeBonusX: 5, momentumRetain: 0.5 }},
  throws: {{
    forward: {{ damage: 12, knockback: {kb(60, 90, 46)}, animationFrames: 15 }},
    back:    {{ damage: 11, knockback: {kb(40, 60, 65)}, animationFrames: 15 }},
    up:      {{ damage: 9,  knockback: {kb(90, 70, 50)}, animationFrames: 14 }},
    down:    {{ damage: 7,  knockback: {kb(361, 60, 50)}, animationFrames: 19 }},
  }},
}};

/** DK's full 10-slot uniform moveset — canonical {{@link FighterMoveset}} shape. */
export const DONKEYKONG_MOVESET: FighterMoveset = Object.freeze({{
  jab: DONKEYKONG_JAB,
  tilt: DONKEYKONG_TILT,
  smash: DONKEYKONG_SMASH,
  fair: DONKEYKONG_FAIR,
  neutralSpecial: DONKEYKONG_NEUTRAL_SPECIAL,
  sideSpecial: DONKEYKONG_SIDE_SPECIAL,
  upSpecial: DONKEYKONG_UP_SPECIAL,
  downSpecial: DONKEYKONG_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
}});

/** DK's full {{@link FighterContract}} declaration. */
export const DONKEYKONG_FIGHTER_CONTRACT: FighterContract = Object.freeze({{
  id: 'donkeykong',
  moveset: DONKEYKONG_MOVESET,
  movementProfile: DONKEYKONG_MOVEMENT_PROFILE,
}});

/** DK-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface DonkeyKongOptions extends CharacterTuning {{
  readonly spawnX: number;
  readonly spawnY: number;
}}

/**
 * Donkey Kong fighter. Inherits all base movement / jump physics from
 * `Character` via {{@link ContractFighter}}; the kit wires through the same
 * `registerFighterAttack` + `setGrabSpec` path as the rest of the cast.
 */
export class DonkeyKong extends ContractFighter {{
  readonly moveset: FighterMoveset = DONKEYKONG_MOVESET;
  readonly movementProfile: FighterMovementProfile = DONKEYKONG_MOVEMENT_PROFILE;
  readonly contract: FighterContract = DONKEYKONG_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: DonkeyKongOptions) {{
    super(scene, {{
      id: 'donkeykong',
      ...DONKEYKONG_TUNING,
      ...options,
    }});
    registerFighterAttack(this, DONKEYKONG_JAB);
    registerFighterAttack(this, DONKEYKONG_JAB2);
    registerFighterAttack(this, DONKEYKONG_TILT);
    registerFighterAttack(this, DONKEYKONG_SMASH);
    registerFighterAttack(this, DONKEYKONG_NAIR);
    registerFighterAttack(this, DONKEYKONG_FAIR);
    registerFighterAttack(this, DONKEYKONG_BAIR);
    registerFighterAttack(this, DONKEYKONG_UAIR);
    registerFighterAttack(this, DONKEYKONG_DAIR);
    registerFighterAttack(this, DONKEYKONG_UTILT);
    registerFighterAttack(this, DONKEYKONG_USMASH);
    this.setUpTilt(DONKEYKONG_UTILT.id);
    this.setUpSmash(DONKEYKONG_USMASH.id);
    registerFighterAttack(this, DONKEYKONG_DTILT);
    registerFighterAttack(this, DONKEYKONG_DSMASH);
    registerFighterAttack(this, DONKEYKONG_DASHATTACK);
    this.setDownTilt(DONKEYKONG_DTILT.id);
    this.setDownSmash(DONKEYKONG_DSMASH.id);
    this.setDashAttack(DONKEYKONG_DASHATTACK.id);
    registerFighterAttack(this, DONKEYKONG_NEUTRAL_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_SIDE_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_UP_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_DOWN_SPECIAL);

    this.setGrabSpec(DONKEYKONG_GRAB);
  }}

  /**
   * Getup attack (DownAttackU / DownAttackD): 7 %, 48°, BKB 80 / KBG 48, a
   * `top` capsule sweeping z ±19 with radius 6.5 — one side at 18–19, the
   * other at 23–24. The engine fires one two-sided window, so both sides are
   * live for the whole 18–24 span (approximation).
   */
  protected getUpAttackParams(): {{
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  }} {{
    return {{
      damage: 7,
      knockback: {kb(48, 80, 48)},
      hitbox: {rect(-px(25.5), px(25.5), py(13), py(0))},
      activeFrames: 7,
    }};
  }}

  /**
   * Ledge attack (CliffAttack): 10 %, 45°, BKB 90 / KBG 20, frames 23–25 of
   * 55 (intangible 1–25 per the UFD ledge table); a `top` capsule z 12 → −5.5
   * at y 5.5, radius 5.5.
   */
  protected ledgeAttackParams(): {{
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  }} {{
    return {{
      damage: 10,
      knockback: {kb(45, 90, 20)},
      hitbox: {rect(px(-5.5)-pr(5.5), px(12)+pr(5.5), py(5.5)-pr(5.5), py(5.5)+pr(5.5))},
      activeFrames: 3,
    }};
  }}
}}
''')
import sys, os
_dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'characters', 'DonkeyKong.ts')
open(_dest, 'w').write("".join(out))
print("written", sum(len(x) for x in out), "chars")
