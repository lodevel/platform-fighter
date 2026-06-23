---
name: add-character
description: Add a new playable fighter to the platform-fighter Smash clone end-to-end (class, full moveset, specials, all ~18 registration touch-points, palette, tests) and verify it is complete. Use when creating, finishing, or auditing a roster character.
---

# Add a character

End-to-end playbook for adding a fighter. The exhaustive reference is
`docs/CHARACTER-CHECKLIST.md`; this is the operational sequence.

## 0 — Design the kit

Pick the archetype (weight class, run speed, fall speed), then choose one
**special kind** per slot:

- neutral: `projectile · charge · commandGrab · counter · summon`
- side: `dashStrike · multiHit · reflector · commandDash`
- up (recovery): `multiHitRising · teleport · directionalJump · tether`
- down: `groundPound · trap · stallAndFall · counter`

Schemas: `specialSchema.ts`, `sideSpecialSchema.ts`, `upSpecialSchema.ts`,
`downSpecialSchema.ts`. Model the class file on a recent, complete fighter —
**`Nova.ts`** (projectile + charge + multiHit + trap, full directional kit) or
**`Bruno.ts`** (all-rounder) are the best templates.

## 1 — Author the class file `src/characters/<Name>.ts`

Copy a template fighter and rename. Author every move as a frozen literal (no
`Math.random`/`Date` — deterministic sim). Full kit:

- normals: `jab`/`jab2`/`jab3` (jab chain via `jabChain.nextId`), `tilt`, `utilt`, `dtilt`, `smash`/`usmash`/`dsmash` (each with a `charge` block), `dashAttack`
- aerials: `nair`/`fair`/`bair`/`uair`/`dair` (`type:'aerial'` + `aerialDirection` + `landingLagFrames` + `autoCancelWindows`)
- specials: neutral/side/up/down (chosen kinds)
- `grab` (GrabSpec: range + pummel + dashGrab + **4 throws** fwd/back/up/down)
- overrides: `getUpAttackParams()`, `ledgeAttackParams()`

### Hitbox placement — hitboxes must reach OUTSIDE the character body

The fighter body is ~52 px wide (half-width ≈ 26 px) and ~110 px tall.
A hitbox that sits entirely inside that volume can never touch an opponent —
the soft-separation system keeps bodies from overlapping, so an interior
hitbox is permanently blocked by the attacker's own body.

**Rule:** the hitbox's FAR edge must extend past the body edge in the attack
direction. Far edge = `offsetX + width/2` (forward attacks) or
`|offsetY| + height/2` (vertical attacks).

| Move type | Typical `offsetX` | Typical `width` | Far edge |
|---|---|---|---|
| Jab (short poke) | 35 | 30 | 50 px past centre |
| Tilt / smash (reach) | 50–60 | 40–50 | 75–85 px |
| Aerial (wide arc) | 40–55 | 45–55 | 67–82 px |
| Dtilt (low sweep) | 45, offsetY +30 | 50 | 70 px |
| Uair / utilt (overhead) | 0–10, offsetY −50 | 40–50 | 75 px above |
| Dair / spike (downward) | 0–10, offsetY +50 | 35–45 | 72 px below |

**Bad (hitbox trapped inside body):**
```ts
hitbox: { offsetX: 10, offsetY: 0, width: 20, height: 30 }
// far edge = 10 + 10 = 20 px — still inside the 26 px half-width
```

**Good:**
```ts
hitbox: { offsetX: 40, offsetY: 0, width: 40, height: 50 }
// far edge = 40 + 20 = 60 px — clearly outside the body
```

`offsetX` is automatically mirrored by `facing`, so always author as if
facing RIGHT; negative `offsetX` = hits BEHIND the attacker (bair).

---

**Constructor wiring order matters** — register the forward `jab/tilt/smash`
first (first-registered wins the slot), then wire the directional moves by id:

```ts
registerFighterAttack(this, X_JAB); /* …jab2/jab3/tilt/smash/aerials… */
this.setUpTilt(X_UTILT.id); this.setUpSmash(X_USMASH.id);
this.setDownTilt(X_DTILT.id); this.setDownSmash(X_DSMASH.id);
this.setDashAttack(X_DASHATTACK.id);
this.setGrabSpec(X_GRAB);
```

Up/down **aerials** auto-route from `aerialDirection` — no `set*` call.
Skipping a `set*` call = that input silently does nothing.

## 2 — Register across the codebase

Do this FIRST so `tsc` guides you: add the id to the **`CharacterId` union**
(`src/types/index.ts`). Every `Record<CharacterId,…>` then fails to compile
until filled — that's your checklist. Fill: `fighterMovementProfiles.ts`,
`fighterRegistry.ts` (+ `FIGHTER_REGISTRY_IDS`), `roster.ts` (+
`CHARACTER_SPECS_IN_ROSTER_ORDER`), `visualScale.ts` (4 maps),
`handAnchors.ts`, `palettes.ts` (8-entry ladder), `index.ts`, and the `as const`
id arrays in `groundedNormalDriver.ts` / `movesetAnimationDriver.ts` /
`movesetAnimationCues.ts` / `defensiveAnimationState.ts`.

⚠️ The arrays and id lists are **runtime-only** (not tsc-guarded) — a miss
compiles clean but the fighter is invisible/absent. The verifier catches these.

## 3 — Art: full AI sprite pack (the real deliverable)

`placeholder.spriteKey: null` ships a procedural rectangle (playable, ugly). To ship
REAL art, generate a full **per-move** pack with the AI pipeline. Full recipe +
GPU/WSL safety in `docs/ART-PIPELINE.md`; the rules below are hard-won.

### 3a — Generate

Write `assets/gen/<id>-clips.json` = `{fighter, identity, draftBody, idSeed, clips}`.
`clips` MUST cover **all 26 slots** below. Missing any means that character state
has NO animation — the engine does not fall back gracefully.

#### Base motion (4 slots — SM-driven, always playing)
| Clip | When it plays | Frame count |
|------|--------------|-------------|
| `idle` | standing still | 4 |
| `run` | moving on ground | 6–8 |
| `jump` | airborne, rising (velocityY < 0) | 4–5 |
| `attack` | generic fallback for moves without a dedicated clip | 4 |

#### Status overrides (3 slots — interrupt the base motion)
| Clip | Trigger | Frame count |
|------|---------|-------------|
| `crouch` | `isCrouching()` | 1 (single locked pose — multi-frame generates inconsistent facing) |
| `hurt` | `hitstunRemaining > 0` | 2 (flinch + stumble) |
| `shield` | `isShielding()` | 1 (single braced pose) |

#### Grab system (6 slots — play during grab states)
| Clip | Trigger | Frame count |
|------|---------|-------------|
| `grab` | grab state `whiffStartup` or `whiffActive` | 3 (reach → extend → retract) |
| `pummel` | grab state `holding` | 2 (wind-up → strike) |
| `fthrow` | throwing forward | 3 (grip → heave → release) |
| `bthrow` | throwing backward | 3 (pivot → swing → settle) |
| `uthrow` | throwing upward | 3 (coil → drive up → release) |
| `dthrow` | throwing downward | 3 (pin → slam → rise) |

Override priority in MatchScene (highest first):
`hurt` → `active attack` → `grab/pummel/throw` → `shield` → `crouch` → (base SM)

#### Per-move attacks (15 slots — each active move gets its own clip)
| Clip | How the renderer routes to it | Frame count |
|------|-------------------------------|-------------|
| `jab` | `type:'jab'`, id ends `.jab` | 3 |
| `jab2` | `type:'jab'`, id ends `.jab2` | 3–4 |
| `jab3` | `type:'jab'`, id ends `.jab3` | 4 (finisher — visually distinct) |
| `tilt` | `type:'tilt'`, id does NOT end `.dtilt` | 3 |
| `dtilt` | `type:'tilt'`, id ends `.dtilt` | 4 (crouching sweep LOW — grounded only) |
| `smash` | `type:'smash'` (utilt/dsmash share — see NOTE below) | 4 |
| `nair` | `type:'aerial'`, aerialDirection `neutral` | 3 |
| `fair` | `type:'aerial'`, aerialDirection `forward` | 3 |
| `bair` | `type:'aerial'`, aerialDirection `back` | 3 |
| `uair` | `type:'aerial'`, aerialDirection `up` | 3 (upward overhead arc) |
| `dair` | `type:'aerial'`, aerialDirection `down` | 3 (downward spike) |
| `neutral_special` | `type:'special'` or `'neutralSpecial'` | 3 |
| `side_special` | `type:'sideSpecial'` | 3 |
| `up_special` | `type:'upSpecial'` | 3 |
| `down_special` | `type:'downSpecial'` | 3 |

**`dtilt` is the crouching attack clip** — the character is visibly low
(crouched/bent) while attacking. It is completely distinct from the `crouch`
idle (which is passive) and from `dair` (which is airborne). Three separate
clips, three separate triggers:
- `crouch` = passive idle duck, no attack. Loops while holding down.
- `dtilt` = active grounded attack FROM the crouched position (down+attack input).
- `dair` = aerial downward spike/plunge (airborne, not grounded).
Never share art between them — they have different hurtbox states and the
renderer routes them independently.

**NOTE — remaining routing gaps (engine limitation, not a skip in art):**
`attackMoveToSheet` in `spriteAnimationDriver.ts` still collapses:
- `utilt` → `'tilt'` sheet (shares art with forward tilt)
- `usmash` / `dsmash` → `'smash'` sheet (all three smashes share art)
- `dashAttack` → base `'attack'` sheet
These moves still need unique clip designs in the class file; they just share
rendered art for now. Add dedicated sheets by extending `attackMoveToSheet`.

**Hard rules for all clips:**
- **Every move is its OWN multi-frame clip with a mechanically-correct pose.** A
  ranged/projectile special is a FIRING pose (bow draw→release, gun recoil), NOT a
  recycled swing. "One animation for all attacks" is wrong.
- **Lock ONE facing — right.** Add "facing right" to every pose description. The
  pipeline enforces right-facing in the draft; inconsistent frames make the sprite
  "spin" in-engine and no engine flag fixes it.
- **`draftBody`** matches the silhouette + signature weapon so it's drawn organically
  into every frame. Pickup weapons → §3c.
- **Jab chains need 3 separate clips** (`jab`, `jab2`, `jab3`). Each must feel
  distinct: jab1 = quick poke, jab2 = follow-up angle, jab3 = finisher/spinner.
  Do NOT recycle jab1 art for jab2/3.
- **`dtilt` is a dedicated crouching attack clip**, distinct from the standing `tilt`.
  No forward movement — the character sweeps/kicks/swipes LOW from a crouched
  position.
- **1-frame poses for crouch and shield** — AI multi-frame for static holds generates
  inconsistent facing. Use a single locked pose.
- More frames = more fluidity. Prefer 4 over 3 for any attack with a visible
  windup→active→recovery arc.

```bash
node.exe node_modules/tsx/dist/cli.mjs tools/build-canny-library.ts assets/gen/<id>-clips.json
cp assets/gen/canny-library/<id>__*.png ~/ComfyUI/input/   # WSL cp; Windows node can't write the WSL path
node.exe node_modules/tsx/dist/cli.mjs tools/gen-frames-cn.ts assets/gen/<id>-clips.json
node.exe tools/pack-clips.cjs <id>                          # -> assets/characters/<id>/animations/*.png + frames.json
```
Canny library is namespaced per fighter (`<id>__<pose>`) — different bodies must not
share cannys. Cells are a FIXED 128×128 so manifest frame dims never drift.

**After packing, run the facing audit:**
```bash
node.exe node_modules/tsx/dist/cli.mjs tools/audit-facing.ts <id>
```
Any frame with a negative L/R mass bias (faces left) needs to be flipped or
regenerated. Horizontal flip via `npx tsx tools/flip-h.ts <file.png>`.
Delete unwanted extra frames before packing.

### ⚠️ Repack cascade — regenerating ANY frame affects ALL 28 strips

`pack-clips.cjs` computes a **single global bounding box** across every raw
frame for the character before outputting any strip. Regenerating even one
frame (e.g. fixing the crouch) changes that bbox, which shifts the crop and
scale of all 28 output strips. After any repack you MUST visually verify the
full set, not just the changed clip.

**Cascade checklist after repack:**
1. Open `idle`, `run`, `crouch`, `hurt` — confirm character is centred and
   not clipped. These are the base states seen most often.
2. Open the clip you changed — confirm the pose is correct and facing right.
3. Spot-check at least 3 attack clips (`jab`, `smash`, one aerial) — confirm
   the character isn't shifted or cut off.
4. Re-run the facing audit (`audit-facing.ts`) — a repack can introduce new
   facing-left frames if raw frames were inconsistent.
5. If the bbox shifted visibly (character is smaller or repositioned vs.
   before), re-run the FULL pipeline for this fighter to lock in a clean bbox
   from all frames together.

**Safe single-frame fix (avoids cascade):** instead of repacking, write the
corrected 128×128 cell directly to `assets/characters/<id>/animations/<clip>.png`
(bypassing pack-clips). Only do this when the frame count and cell size are
identical to the existing strip — the manifest frame count must not change.

### 3b — Wire (ALL of these — miss one and the sprite is frozen or invisible)
1. **manifest.ts** `ASSET_KEYS`: **28 keys** for `char<Id>` —
   `{Idle, Run, Jump, Attack, Crouch, Hurt, Shield, Grab, Pummel, Fthrow, Bthrow,
   Uthrow, Dthrow, Jab, Jab2, Jab3, Tilt, Dtilt, Smash, Nair, Fair, Bair, Uair,
   Dair, NeutralSpecial, SideSpecial, UpSpecial, DownSpecial}`.
2. **manifest.ts**: `const <id>Spritesheets = charSheetEntries('<id>', [...])` (counts
   straight from `frames.json`) + spread into `ASSET_MANIFEST.spritesheets`.
3. **roster.ts**: `<ID>_PLACEHOLDER.spriteKey: ASSET_KEYS.char<Id>Idle` (not null).
4. **spriteAnimationDriver.ts**: `case '<id>':` in `getCharacterSpritesheetKey`
   (idle/run/jump/attack) AND an `<id>: {...}` entry in `MOVE_SHEET_KEYS` covering
   **all 24 move sheets**: `crouch, hurt, shield, grab, pummel, fthrow, bthrow,
   uthrow, dthrow, jab, jab2, jab3, tilt, dtilt, smash, nair, fair, bair, uair,
   dair, neutral_special, side_special, up_special, down_special`.
   Anim REGISTRATION is automatic — iterates `CHARACTER_IDS`, do NOT hand-add to
   any per-fighter list.
5. **visualScale.ts** `CHARACTER_SPRITE_FACES_LEFT['<id>'] = false` (right-facing art;
   trust the in-game playtest over eyeballing — this call has been wrong before).
6. **<Name>.test.ts**: flip the `spriteKey).toBeNull()` assertion to `.not.toBeNull()`.

The MatchScene render loop already plays the per-move clip for the active move
(`attackMoveToSheet` maps `move.type` + `aerialDirection`) and plays all grab/hurt/
shield/crouch overrides — no render-loop changes needed once sheets/keys exist.

### 3c — Character × weapon matrix (pickup items)

A SIGNATURE weapon is baked into the frames above. PICKUP weapons
(bat / hammer / sword / spear / rayGun / bomb) are separate items any
character can hold. **Each character needs its own body animations for each
weapon** — the way a heavy bruiser swings a bat looks different from the way
a nimble swordfighter does. Adding a NEW character ⇒ body animations for
every weapon. Adding a NEW weapon ⇒ body animations for every character.

**Required per-weapon animation clips for each character:**

| Weapon | Body animation needed | Key visual difference |
|---|---|---|
| Bat | Two-handed baseball swing — wide arc, follow-through | Weight and momentum in the swing |
| Hammer | Two-phase: windup overhead, then slam down | Slow, heavy — body leans into it |
| Sword | One-hand side slash — blade leads, off-hand trails | Precise, controlled arc |
| Spear | Forward lunge — body extends fully in thrust direction | Linear, not rotational |
| Ray gun | Point-and-fire stance — one arm extended, recoil on fire | Body braces, minimal movement |
| Bomb | Underhand lob — body coils then releases upward | Throwing motion, not a strike |

These are the body poses; the weapon SPRITE overlaid via the container handles
the rotation arc automatically (see below). You only need to produce frames
that show the character's arms, posture, and weight transfer correctly.

**Weapon sprite rotation (what IS already implemented):**
`computeWeaponAngle` in `MatchScene.ts` rotates the weapon container through
an attack-type-specific arc:
- Bat: -60° → +110° (baseball swing)
- Sword: -70° → +100° (slash)
- Spear: 80° → 90° (stays horizontal, thrust)
- Hammer: 25° → -110° → +130° (windup → slam)

**The rotation arc and hitbox are identical for every character — do NOT
change per-character ranges or damage.** Weapons are balanced independently
of who holds them. Only the body animation differs.

**Current engine state — body overrides not yet wired:**
The body clip routing for held weapons is not yet implemented. Until it is,
the character plays their own attack animation (jab/tilt/smash) regardless
of what they're holding. Ensure the arc peak of the weapon container aligns
with when the character's arm extends in their existing attack art — that is
the minimum for visual coherence. Do NOT change damage or knockback to
compensate; fix the body animation instead when the system is built.

**Grabs/throws that MOVE the grabbed character (DK-slam etc.) → `docs/SPRITE-PLAN.md`:**
the grabber owns the move anim + a per-frame grab-anchor; the victim reuses ONE shared
`grabbed` pose pinned via `setPosition`, so victim art cost is constant, not per-grabber.

## 4 — Update roster-cardinality tests

`fighterRegistry.test.ts`, `characterSpec.test.ts`, `palettes.test.ts`, and the
animation-driver `*.test.ts` hardcode the 10-id roster and will fail on the 11th
— append the new id. Add a `<Name>.test.ts` with `<ID>_MOVES.toHaveLength(10)`.

## 5 — Verify (definition of done)

```bash
bash .claude/skills/add-character/verify-character.sh <id>   # all REQUIRED ✓
npx tsc --noEmit          # exhaustive Record<CharacterId> + types
npx vitest run            # roster-cardinality + per-fighter tests
npm run build             # production bundle
```

`verify-character.sh` reports three tiers: **REQUIRED** (✓/✗ — must be all ✓),
**ART** (○/◌ — ◌ = procedural rectangle), **POLISH** (○/◌). All ✓ on REQUIRED +
green gates = the fighter is code-complete and playable. Commit and push.
