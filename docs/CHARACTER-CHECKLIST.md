# Anatomy of a Complete Fighter

The authoritative list of everything a roster fighter needs in this codebase,
from a multi-agent audit re-verified against the live code. Use it with the
verifier:

```bash
bash .claude/skills/add-character/verify-character.sh <id>
npx tsc --noEmit && npx vitest run && npm run build
```

Three tiers:

- **REQUIRED** — code/playability. Missing ⇒ `tsc` fails, or the fighter is
  unplayable / invisible / absent from the select grid.
- **ART** — sprite sheets. Missing ⇒ the fighter renders as a flat procedural
  rectangle: *playable but visually unfinished* (the "feels unfinished" tier).
- **POLISH** — optional kit, data files, tests. Nice-to-have.

> The single most dangerous class is the **RUNTIME-only** required points: they
> compile clean but silently break the fighter. `tsc` only guards the
> `Record<CharacterId, …>` maps (because the `CharacterId` union in
> `src/types/index.ts` forces them to be filled). Ordered arrays, `as const` id
> lists, and the asset manifest are NOT guarded — the verifier exists for them.

---

## 1 — Identity & registration (~18 files)

**Required**

- `src/types/index.ts` — add the id to the **`CharacterId` union** (the keystone; do this first, it forces every map below to compile).
- `src/characters/fighterMovementProfiles.ts` — `<ID>_MOVEMENT_PROFILE` const + `FIGHTER_MOVEMENT_PROFILES` entry (run/walk/mass/jump/fall/air tuning).
- `src/characters/<Name>.ts` — the class `extends ContractFighter`, exports `<ID>_TUNING/_MOVESET/_FIGHTER_CONTRACT` + all move consts (see §2).
- `src/characters/fighterRegistry.ts` — import + `FIGHTER_REGISTRY` entry **and** append to the ordered `FIGHTER_REGISTRY_IDS` *(runtime-only)*.
- `src/characters/roster.ts` — `<ID>_MOVES` (10 headline) + `<ID>_PLACEHOLDER` + `<ID>_SPEC` (`displayName`, `role`, `playable:true`) + `CHARACTER_ROSTER` entry **and** append `<ID>_SPEC` to `CHARACTER_SPECS_IN_ROSTER_ORDER` *(runtime-only — this is what puts it on the select grid)*.
- `src/characters/visualScale.ts` — entries in all **4** maps (display-size, faces-left, art-offset-x/y).
- `src/characters/handAnchors.ts` — grip/projectile anchor `{x,y}`.
- `src/characters/palettes.ts` — `<ID>_PALETTES` **8-entry** color ladder (index 0 mirrors the placeholder) + `CHARACTER_PALETTES` entry.
- `src/characters/index.ts` — barrel re-export of the class + consts.
- `as const` id arrays *(runtime-only, NOT tsc-guarded)* in: `groundedNormalDriver.ts`, `movesetAnimationDriver.ts` (×2), `movesetAnimationCues.ts` (×2), `defensiveAnimationState.ts`.

**No edit needed:** `characterFactory.ts` and the char-select scene are registry/roster-driven.

## 2 — Moveset (the 10-slot contract + full kit)

Every (button × stick) maps to a **distinct** move — a jab, a directional tilt,
an up-tilt, a down-tilt, a smash, an up-smash, a down-smash, and the four
specials are all different moves. Unfilled directional slots silently cascade to
the base move (still playable).

**Required (the contract — `assertFighterMoveset`):** `jab`, `tilt`, `smash` (with `charge` block), `fair` (the one contract aerial), `neutralSpecial`, `sideSpecial`, `upSpecial` (the recovery — without it you can't recover), `downSpecial`, `shield`, `dodge`. Plus directional wiring in the constructor: `setUpTilt/setDownTilt/setUpSmash/setDownSmash/setDashAttack`, and `setGrabSpec` with **4 throws** (fwd/back/up/down).

**Polish (cast-standard but optional):** `jab2/jab3` chain · `nair/bair` · **`uair/dair`** *(currently MISSING on Cat, Owl, Bear — the only structural move gaps in the cast)* · `pummel` · `dashGrab` · `getUpAttackParams()` / `ledgeAttackParams()` overrides.

**Special "kinds" available** (pick one per slot):
- neutral: `projectile · charge · commandGrab · counter · summon`
- side: `dashStrike · multiHit · reflector · commandDash`
- up: `multiHitRising · teleport · directionalJump · tether`
- down: `groundPound · trap · stallAndFall · counter`

## 3 — Sprite art & animation

The runtime paints exactly **4 PNG strips** per fighter: `idle / run / jump /
attack`. Everything else collapses onto them (`fall→jump`, `hurt→idle`, and
**all** attacks → `attack`).

**Required (for a fully-finished fighter; a *procedural* fighter skips these and renders as a rectangle):**
- `assets/characters/<id>/animations/{idle,run,jump,attack}.png` on disk.
- `src/assets/manifest.ts` — `char<Name>{Idle,Run,Jump,Attack}` keys + `<id>Spritesheets[]` (url/frameWidth/frameHeight/frameCount) + **spread `...<id>Spritesheets` into `ASSET_MANIFEST.spritesheets`** *(runtime-only)*.
- `src/characters/spriteAnimationDriver.ts` — `case '<id>':` *(runtime-only, high danger: `return null` fallthrough means a miss compiles clean and renders no sprite)*.
- `roster.ts` placeholder `spriteKey: ASSET_KEYS.char<Name>Idle` (non-null).

**Polish:** `frames.json` (slice metadata; missing on owl/bear) · `<id>_source_sheet.png` · non-degenerate `attack.png` frame count (owl's is 1 frame → its attack visually does nothing).

## 4 — Palettes

**Required:** the **8-entry color DATA ladder** (§1) — applied at runtime as a
**tint**. **Polish/dead:** the 8 pre-baked palette *texture* PNGs
(`char.<id>.palette.0..7`) are registered only for wolf/cat and never consumed
at runtime — not needed.

## 5 — Sound

SFX are keyed by **move-TYPE or global event, never by fighter id**, so a new
fighter **inherits all action cues for free**.

**Inherited automatically (required, nothing to wire):** jab/tilt/smash/aerial swings · shield/dodge · jump/jump-air · land · hit-light/heavy · clang · shield-break · charge loop · KO.

**Polish (system-wide gaps — same for the whole cast):** specials, grabs, throws, and taunts are **unvoiced** (absent from `MOVE_TYPE_TO_SFX_KEY`) · **no per-fighter voice/grunts** (the one category a complete Smash fighter *would* author per-fighter) · no announcer · no footsteps.

## 6 — Tests that break / go stale

**Break on an 11th fighter (update in lockstep):** `fighterRegistry.test.ts`, `characterSpec.test.ts`, `palettes.test.ts` / `paletteSwapShader.test.ts`, and the animation-driver `*.test.ts` (all hardcode the 10-id roster). Add an own `<Name>.test.ts` with `<ID>_MOVES.toHaveLength(10)`.

**Stale (not breaking, worth fixing):** `perFighterSmoke.test.ts` FIGHTERS list stops at aegis (missing volt/nova/bruno); `palettes.test.ts` deep list is only wolf/cat/owl/bear.

---

## Biggest cast-wide gaps (the "unfinished" feel)

1. **Every move shares one `attack.png`** — jab, tilt, smash, all 5 aerials, and all 4 specials render identically. A projectile looks like a jab. The engine *has* a full per-move/per-phase symbolic key system (`movesetAnimationDriver`/`movesetAnimationCues`) with **zero backing textures**. `0/10`.
2. **All four specials are unvoiced** — signature moves make no sound (only the generic charge hum). `0/10`.
3. **No per-fighter voice/grunts** anywhere — the cast is acoustically identical. `0/10`.
4. **No state art** — hurt/fall/land/shield/dodge/ledge/grab/throw/KO/taunt all collapse to idle/jump or aren't modelled. `0/10`.
5. **uair + dair missing on Cat, Owl, Bear.** `7/10`.
6. **No portrait / stock-icon assets** — the select screen reuses the idle sheet at 0.7× and stocks are text glyphs. `0/10`.
7. Degenerate `attack.png` (owl = 1 frame); `frames.json` missing on owl/bear; baked palette-variant textures are dead code.
