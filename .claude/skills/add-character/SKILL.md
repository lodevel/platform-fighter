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

## 3 — Art (optional — procedural fallback works)

Set `placeholder.spriteKey: null` to ship a **procedural rectangle** (playable,
unfinished). For real art, add the 4 sprite strips
(`assets/characters/<id>/animations/{idle,run,jump,attack}.png`), the manifest
keys + `<id>Spritesheets[]` + **spread into `ASSET_MANIFEST.spritesheets`**, and
a `case '<id>':` in `spriteAnimationDriver.ts`. See checklist §3.

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
