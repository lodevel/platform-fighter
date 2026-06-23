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
`clips` MUST cover idle + run + jump + attack(collapsed fallback) + crouch + EVERY
per-move slot: `jab, tilt, smash, nair, fair, bair, neutral_special, side_special,
up_special, down_special`. Rules that matter:
- **Every move is its OWN multi-frame clip with a mechanically-correct pose.** A
  ranged/projectile special is a FIRING pose (bow draw→release, gun recoil), NOT a
  recycled swing. "One animation for all attacks" is the legacy default and is wrong.
- **Lock ONE facing.** The pipeline enforces right-facing in the draft; frames that
  face different directions make the sprite "spin" in-engine and NO engine flag fixes
  inconsistent art.
- **`draftBody`** matches the silhouette + signature weapon so it's drawn organically
  into every frame (Link's sword; Kirby's hammer for side-B). Pickup weapons → §3c.
- ~4 idle, 6–8 run, 3–4 per attack.

```bash
node.exe node_modules/tsx/dist/cli.mjs tools/build-canny-library.ts assets/gen/<id>-clips.json
cp assets/gen/canny-library/<id>__*.png ~/ComfyUI/input/   # WSL cp; Windows node can't write the WSL path
node.exe node_modules/tsx/dist/cli.mjs tools/gen-frames-cn.ts assets/gen/<id>-clips.json
node.exe tools/pack-clips.cjs <id>                          # -> assets/characters/<id>/animations/*.png + frames.json
```
Canny library is namespaced per fighter (`<id>__<pose>`) — different bodies must not
share cannys. Cells are a FIXED 64×64 so manifest frame dims never drift.

### 3b — Wire (ALL of these — miss one and the sprite is frozen or invisible)
1. **manifest.ts** `ASSET_KEYS`: 15 keys `char<Id>{Idle,Run,Jump,Attack,Crouch,Jab,
   Tilt,Smash,Nair,Fair,Bair,NeutralSpecial,SideSpecial,UpSpecial,DownSpecial}`.
2. **manifest.ts**: `const <id>Spritesheets = charSheetEntries('<id>', [...])` (counts
   straight from `frames.json`) + spread into `ASSET_MANIFEST.spritesheets`.
3. **roster.ts**: `<ID>_PLACEHOLDER.spriteKey: ASSET_KEYS.char<Id>Idle` (not null).
4. **spriteAnimationDriver.ts**: `case '<id>':` in `getCharacterSpritesheetKey`
   (idle/run/jump/attack) AND an `<id>: {...}` entry in `MOVE_SHEET_KEYS` (crouch +
   the 10 moves). Anim REGISTRATION is automatic — it iterates `CHARACTER_IDS`, so do
   NOT hand-add to any per-fighter list (that hand-list was the footgun that froze
   sprites; `CharacterId` is now derived from `CHARACTER_IDS`).
5. **visualScale.ts** `CHARACTER_SPRITE_FACES_LEFT['<id>'] = false` (right-facing art;
   trust the in-game playtest over eyeballing — this call has been wrong before).
6. **<Name>.test.ts**: flip the `spriteKey).toBeNull()` assertion to `.not.toBeNull()`.

The MatchScene render loop already plays `<char>.<move>.anim` for the active move
(`attackMoveToSheet` maps `move.type` + `aerialDirection`) and plays the crouch clip
INSTEAD of the procedural squash — no render-loop change needed once sheets/keys exist.

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
