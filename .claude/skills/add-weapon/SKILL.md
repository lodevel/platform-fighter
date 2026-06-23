---
name: add-weapon
description: Add a new pickup weapon to the game end-to-end — ItemDefinition, MatchScene visual, asset, rotation arc, and per-character grip animations for every fighter in the roster.
---

# Add a weapon

End-to-end playbook for a new pickup weapon. A weapon is a spawnable item
any character can hold, swing, and throw. Adding one has two parts:

1. **Engine + visual** — the item definition, spawn visual, asset, and attack arc
2. **Per-character grip animations** — one animation set per fighter so each
   character's hands visually match the weapon they're holding

Part 1 is self-contained. Part 2 calls the **`add-character` skill §3c** for
every fighter in the roster.

---

## 1 — Define the weapon `src/items/<Name>.ts`

Model on an existing weapon (`Sword.ts` for a melee blade, `Bat.ts` for a
blunt weapon, `RayGun.ts` for ranged, `Bomb.ts` for throwable).

Every weapon needs:

```ts
export const MY_WEAPON_MOVE: AttackMove = Object.freeze({
  id: 'item.<name>.<action>',    // e.g. 'item.axe.chop'
  type: 'jab' | 'tilt' | 'smash',
  damage: ...,
  knockback: { x, y, scaling },
  hitbox: {
    offsetX: ...,  // must reach OUTSIDE the character body — see §1a below
    offsetY: ...,
    width: ...,
    height: ...,
  },
  startupFrames, activeFrames, recoveryFrames, cooldownFrames,
});

export const MY_WEAPON_DEFINITION: ItemDefinition = Object.freeze({
  type: '<name>',                // unique string key
  category: 'melee-weapon' | 'ranged-weapon' | 'throwable',
  durability: ...,               // hits before the item breaks
  throwBehavior: { ... },
  buildSlotOverride: (item, ctx) => { ... },
});
```

### §1a — Hitbox must reach outside the character body

The character body is ~52 px wide (half-width ≈ 26 px). A hitbox centered on
the character never touches an opponent. The hitbox **far edge** must clear the
body:

```
far edge = offsetX + width/2   (forward attacks)
```

For a standard melee swing: `offsetX ≥ 38`, `width ≥ 40` → far edge ≥ 58 px.
See `add-character` §1 hitbox table for full reference.

---

## 2 — Register in `src/items/index.ts`

```ts
export { MY_WEAPON_DEFINITION, MY_WEAPON_MOVE } from './MyWeapon';
```

---

## 3 — Add the asset

Place the weapon sprite PNG at `assets/sprites/items/<name>.png`.
Register in `src/assets/manifest.ts`:

```ts
// ASSET_KEYS
itemMyWeapon: 'item.<name>.sprite',

// preload entries
{ key: ASSET_KEYS.itemMyWeapon, kind: 'image', url: `${ITEM_SPRITES_ROOT}/<name>.png` },
```

---

## 4 — Add the ground-pickup visual in `MatchScene.ts`

Find the item-spawn visual block (search for `itemVisuals.set`). Add a branch
for your weapon type.

**Ground-anchoring rule — the container's y=0 IS the ground contact point.**
The weapon sprite bottom must sit at y=0. There are exactly two correct patterns:

```ts
// Bottom-anchored: setOrigin y=1 → position at y=0 so bottom = ground.
this.add.image(0, 0, ASSET_KEYS.itemMyWeapon)
  .setOrigin(0.5, 1)
  .setDisplaySize(w, h)

// Center-anchored: setOrigin default → position at y=-(h/2) so bottom = ground.
this.add.image(0, -(h / 2), ASSET_KEYS.itemMyWeapon)
  .setOrigin(0.5, 0.5)
  .setDisplaySize(w, h)
```

**Never** use `setOrigin(0.5, 1)` with a negative y — that lifts the bottom
above the ground and the weapon floats. Do NOT add a text label; the sprite
must be readable on its own.

---

## 5 — Add the swing rotation arc in `computeWeaponAngle` (`MatchScene.ts`)

`computeWeaponAngle` drives the weapon container rotation during attacks.
Add a case for the new weapon's move id:

```ts
case 'item.<name>.<action>':
  // 0° = blade pointing up, 90° = pointing right (facing right).
  // setScale(-1,1) mirrors left-facing automatically.
  return lerp(startAngle, endAngle, t);
```

Reference angles for common weapon types:
| Motion | Start → End |
|---|---|
| Overhead chop (axe/hammer) | −110° → +130° |
| Side slash (sword) | −70° → +100° |
| Forward thrust (spear/lance) | 80° → 90° |
| Wide swing (bat/club) | −60° → +110° |

Also add a held-idle angle in the `switch (itemType)` block below for when the
weapon is carried but no attack is active.

---

## 6 — Per-character grip animations (one per fighter in the roster)

**This is the largest part.** Every character currently in the roster needs
their own animation sprites showing their hands gripping THIS weapon. The grip
must look natural for that character — hand shape, finger placement, and body
posture must match the weapon type.

Current roster (check `FIGHTER_REGISTRY_IDS` in `src/characters/fighterRegistry.ts`
for the live list — it will grow):

```
wolf · cat · owl · bear · blaze · puff · aegis · volt · nova · bruno
link · kirby · donkeykong
```

For each character, follow **`add-character` skill §3c** (weapon grip and pose
reference table). Generate grip animation sprites via the ComfyUI pipeline
(`gen-frames-cn.ts`) using the character's existing `identity` and `draftBody`
from their `assets/gen/<id>-clips.json`.

Grip clip naming convention: `<weaponName>_held` (e.g. `axe_held`).

**After generating art:**
1. Pack the new clip into the character's animation strips:
   ```bash
   node.exe tools/pack-clips.cjs <id>
   ```
2. Run the cascade check — repacking ANY clip regenerates ALL 28 strips.
   Visually verify `idle`, `run`, `crouch`, `hurt` and the new weapon clip.
   See `add-character` skill repack cascade checklist.
3. Register the new sheet key in `spriteAnimationDriver.ts`'s `MOVE_SHEET_KEYS`
   for that character: `axe_held: ASSET_KEYS.charWolfAxeHeld`.
4. Add the manifest key + preload entry (same pattern as other move sheets).

Repeat steps for every character in the roster.

**Engine routing** (wire once all character art exists):
Add the `heldWeapon` override layer in `MatchScene.ts` that checks
`inventory.getHeldItem()?.definition.type` and routes to the `<weapon>_held`
sheet when the character is holding the weapon but not attacking.

---

## 7 — Verify

```bash
npx tsc --noEmit     # no type errors
npx vitest run       # item framework tests pass
npm run build        # production bundle
```

Smoke-test in the game:
- Item spawns on the platform and sits on the ground (not floating)
- Character can pick it up
- Swing animation rotates the weapon container correctly
- Weapon breaks after the authored durability count
- Each character's grip art shows the correct hand position for this weapon
