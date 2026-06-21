#!/usr/bin/env bash
#
# verify-character.sh <id>
#
# Completeness check for a roster fighter, derived from the authoritative
# "Anatomy of a complete fighter" audit (docs/CHARACTER-CHECKLIST.md).
# Three tiers:
#   REQUIRED  (✓/✗) — code/playability. A ✗ means the fighter is broken,
#                     unplayable, or absent from the select grid. Must be 0.
#   ART       (○/◌) — sprite sheets. A ◌ means the fighter renders as a
#                     flat procedural rectangle: PLAYABLE but visually
#                     unfinished. This is the "feels unfinished" tier.
#   POLISH    (○/◌) — optional moves, data files, tests. Nice-to-have.
# Plus SYSTEM-WIDE notes for gaps shared by the whole cast (specials
# unvoiced, no per-fighter voice, every move shares one attack sheet).
#
# tsc catches every exhaustive Record<CharacterId> omission; this script
# catches the RUNTIME-only points tsc cannot see, and reports art/sound.
#
# Usage:  bash .claude/skills/add-character/verify-character.sh link

set -u
id="${1:-}"
if [ -z "$id" ]; then echo "usage: verify-character.sh <id>   (lowercase, e.g. link)"; exit 2; fi
Name="$(tr '[:lower:]' '[:upper:]' <<<"${id:0:1}")${id:1}"   # Link
ID="$(tr '[:lower:]' '[:upper:]' <<<"$id")"                   # LINK

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"; cd "$root" || exit 2

reqfail=0
# row: tier|mode|label|file|needle|min   (mode: grep=substring count, file=exists)
# placeholders <id> <Name> <ID> are substituted per row.
CHECKS=(
# ── REQUIRED: code & playability ─────────────────────────────────────────
"req|grep|CharacterId union|src/types/index.ts|'<id>'|1"
"req|grep|movement profile const|src/characters/fighterMovementProfiles.ts|<ID>_MOVEMENT_PROFILE|1"
"req|grep|movement profile map entry|src/characters/fighterMovementProfiles.ts|<id>:|1"
"req|file|fighter class file|src/characters/<Name>.ts||1"
"req|grep|class extends ContractFighter|src/characters/<Name>.ts|extends ContractFighter|1"
"req|grep|FighterContract export|src/characters/<Name>.ts|<ID>_FIGHTER_CONTRACT|1"
"req|grep|fighterRegistry entry|src/characters/fighterRegistry.ts|<id>: Object.freeze|1"
"req|grep|FIGHTER_REGISTRY_IDS|src/characters/fighterRegistry.ts|'<id>'|1"
"req|grep|visualScale (4 maps)|src/characters/visualScale.ts|<id>:|4"
"req|grep|handAnchors entry|src/characters/handAnchors.ts|<id>:|1"
"req|grep|palette DATA ladder (8)|src/characters/palettes.ts|<ID>_PALETTES|1"
"req|grep|palette registry entry|src/characters/palettes.ts|<id>: <ID>_PALETTES|1"
"req|grep|roster CHARACTER_ROSTER entry|src/characters/roster.ts|<id>: <ID>_SPEC|1"
"req|grep|roster order array|src/characters/roster.ts|<ID>_SPEC,|1"
"req|grep|roster playable flag|src/characters/roster.ts|playable: true|1"
"req|grep|barrel re-export|src/characters/index.ts|<Name>|1"
"req|grep|groundedNormalDriver id|src/characters/groundedNormalDriver.ts|'<id>'|1"
"req|grep|movesetAnimationDriver ids|src/characters/movesetAnimationDriver.ts|'<id>'|2"
"req|grep|movesetAnimationCues ids|src/characters/movesetAnimationCues.ts|'<id>'|2"
"req|grep|defensiveAnimationState id|src/characters/defensiveAnimationState.ts|'<id>'|1"
# ── REQUIRED: the 10-slot moveset contract (in the class file) ────────────
"req|grep|jab slot|src/characters/<Name>.ts|type: 'jab'|1"
"req|grep|tilt slot (directional)|src/characters/<Name>.ts|type: 'tilt'|1"
"req|grep|smash slot|src/characters/<Name>.ts|type: 'smash'|1"
"req|grep|fair (forward aerial)|src/characters/<Name>.ts|aerialDirection: 'forward'|1"
"req|grep|neutral special|src/characters/<Name>.ts|specialKind: '|1"
"req|grep|side special|src/characters/<Name>.ts|sideSpecialKind: '|1"
"req|grep|up special (recovery)|src/characters/<Name>.ts|upSpecialKind: '|1"
"req|grep|down special|src/characters/<Name>.ts|downSpecialKind: '|1"
"req|grep|up-tilt wired|src/characters/<Name>.ts|setUpTilt(|1"
"req|grep|down-tilt wired|src/characters/<Name>.ts|setDownTilt(|1"
"req|grep|up-smash wired|src/characters/<Name>.ts|setUpSmash(|1"
"req|grep|down-smash wired|src/characters/<Name>.ts|setDownSmash(|1"
"req|grep|dash-attack wired|src/characters/<Name>.ts|setDashAttack(|1"
"req|grep|grab wired|src/characters/<Name>.ts|setGrabSpec(|1"
"req|grep|4 throws|src/characters/<Name>.ts|throws:|1"
# ── ART: sprite sheets (◌ = procedural rectangle, playable but unfinished)─
"art|grep|roster spriteKey non-null|src/characters/roster.ts|spriteKey: ASSET_KEYS.char<Name>Idle|1"
"art|grep|manifest idle/run/jump/attack keys|src/assets/manifest.ts|char<Name>Idle:|1"
"art|grep|manifest <id>Spritesheets array|src/assets/manifest.ts|<id>Spritesheets|1"
"art|grep|manifest spritesheet spread|src/assets/manifest.ts|...<id>Spritesheets|1"
"art|grep|spriteAnimationDriver case|src/characters/spriteAnimationDriver.ts|case '<id>':|1"
"art|file|idle.png strip|assets/characters/<id>/animations/idle.png||1"
"art|file|run.png strip|assets/characters/<id>/animations/run.png||1"
"art|file|jump.png strip|assets/characters/<id>/animations/jump.png||1"
"art|file|attack.png strip|assets/characters/<id>/animations/attack.png||1"
# ── POLISH: optional kit, data, tests (○/◌) ──────────────────────────────
"pol|grep|jab2/jab3 chain|src/characters/<Name>.ts|.jab2'|1"
"pol|grep|nair (neutral aerial)|src/characters/<Name>.ts|aerialDirection: 'neutral'|1"
"pol|grep|bair (back aerial)|src/characters/<Name>.ts|aerialDirection: 'back'|1"
"pol|grep|uair (up aerial — missing cat/owl/bear)|src/characters/<Name>.ts|aerialDirection: 'up'|1"
"pol|grep|dair (down aerial — missing cat/owl/bear)|src/characters/<Name>.ts|aerialDirection: 'down'|1"
"pol|grep|pummel|src/characters/<Name>.ts|pummel:|1"
"pol|grep|dashGrab|src/characters/<Name>.ts|dashGrab:|1"
"pol|grep|getUpAttackParams override|src/characters/<Name>.ts|getUpAttackParams()|1"
"pol|grep|ledgeAttackParams override|src/characters/<Name>.ts|ledgeAttackParams()|1"
"pol|file|data/characters/<id>.json|data/characters/<id>.json||1"
"pol|file|frames.json (missing owl/bear)|assets/characters/<id>/frames.json||1"
"pol|grep|own *.test.ts 10-move assert|src/characters/<Name>.test.ts|toHaveLength(10)|1"
"pol|grep|perFighterSmoke coverage (stale list)|src/characters/perFighterSmoke.test.ts|id: '<id>'|1"
)

run() { # tier mode label file needle min
  local tier="$1" mode="$2" label="$3" file="$4" needle="$5" min="$6" ok mark color
  if [ "$mode" = "file" ]; then
    [ -f "$file" ] && ok=1 || ok=0
  else
    if [ ! -f "$file" ]; then ok=0; else
      local n; n="$(grep -cF "$needle" "$file" 2>/dev/null || true)"; [ "${n:-0}" -ge "$min" ] && ok=1 || ok=0
    fi
  fi
  if [ "$tier" = "req" ]; then
    if [ "$ok" = 1 ]; then printf '  \033[32m✓\033[0m %s\n' "$label"; else printf '  \033[31m✗\033[0m %-44s (need %s× "%s" in %s)\n' "$label" "$min" "$needle" "$file"; reqfail=$((reqfail+1)); fi
  else
    if [ "$ok" = 1 ]; then printf '  \033[36m○\033[0m %s\n' "$label"; else printf '  \033[33m◌\033[0m %-44s TODO\n' "$label"; fi
  fi
}

sub() { local s="$1"; s="${s//<Name>/$Name}"; s="${s//<ID>/$ID}"; s="${s//<id>/$id}"; printf '%s' "$s"; }

echo "Verifying fighter '$id'  (class $Name, const ${ID}_*)"
echo "Legend: ✓/✗ REQUIRED (playability)   ○/◌ optional (present / TODO)"
cur=""
for row in "${CHECKS[@]}"; do
  IFS='|' read -r tier mode label file needle min <<<"$row"
  if [ "$tier" != "$cur" ]; then
    case "$tier" in
      req) echo "── REQUIRED: code & playability (✗ = broken) ──";;
      art) echo "── ART: sprite sheets (◌ = procedural rectangle — playable, unfinished) ──";;
      pol) echo "── POLISH: optional kit / data / tests ──";;
    esac
    cur="$tier"
  fi
  run "$tier" "$mode" "$(sub "$label")" "$(sub "$file")" "$(sub "$needle")" "$min"
done

echo "── SYSTEM-WIDE gaps (same for ALL fighters — not per-fighter wiring) ──"
printf '  \033[36mℹ\033[0m %s\n' "action SFX (jab/tilt/smash/aerial/shield/dodge/jump/land/hit) — inherited automatically"
printf '  \033[33m◌\033[0m %s\n' "specials/grab/throw SFX unvoiced for the whole cast (combatAudio.ts MOVE_TYPE_TO_SFX_KEY)"
printf '  \033[33m◌\033[0m %s\n' "no per-fighter voice/grunts; no announcer; no footsteps"
printf '  \033[33m◌\033[0m %s\n' "every move shares ONE attack.png (jab=tilt=smash=special visually) — engine collapses per-move keys"

echo
if [ "$reqfail" -eq 0 ]; then echo -e "\033[32mREQUIRED: all present — fighter is code-complete & playable.\033[0m"
else echo -e "\033[31mREQUIRED: $reqfail missing — fighter is broken/incomplete.\033[0m"; fi
echo "Then run the gates:  npx tsc --noEmit  &&  npx vitest run  &&  npm run build"
exit $([ "$reqfail" -eq 0 ] && echo 0 || echo 1)
