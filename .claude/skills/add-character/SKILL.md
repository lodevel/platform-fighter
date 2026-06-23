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

**`dtilt` vs `dair` are completely different clips** — `dtilt` is a grounded
crouching sweep; `dair` is an aerial spike/plunge. The renderer routes them
independently. Never share art between them.

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
regenerated. Horizontal flip via `pngjs` script (see `docs/ART-PIPELINE.md`).
Delete unwanted extra frames before packing.

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
A SIGNATURE weapon is baked into the frames above. PICKUP weapons (bat/bomb/hammer/
raygun/spear/sword) held organically need held-animation variants = fighters ×
weapons (or × weapon-archetypes by grip). Adding a NEW weapon ⇒ new held-frames for
every fighter; adding a NEW fighter ⇒ held-frames for every weapon. (Not yet built.)

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
