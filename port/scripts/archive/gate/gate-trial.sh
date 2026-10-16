#!/usr/bin/env bash
# Rehearse the gate merge on a scratch copy of the tree (the real tree is not
# touched): copy src/ and port/, record root tsc errors and the affected test
# folders, apply scripts/gate-merge.mjs, then compare and run the port checks.
#   bash port/scripts/gate-trial.sh <scratch-dir>
# Run it right before the real `--apply`, under the heavy-work lock.
set -euo pipefail
R=$(cd "$(dirname "$0")/../.." && pwd)
T=${1:?usage: gate-trial.sh <scratch-dir>}
rm -rf "$T" && mkdir -p "$T/port" "$T/assets"
cp -r "$R/src" "$R/tsconfig.json" "$R/vite.config.ts" "$R/package.json" "$R/package-lock.json" "$T/"
cp -r "$R/port/src" "$R/port/scripts" "$R/port/tsconfig.json" "$R/port/vite.config.ts" "$R/port/package.json" "$R/port/ARCHITECTURE.md" "$R"/port/*.html "$T/port/"
ln -s "$R/node_modules" "$T/node_modules"; ln -s "$R/port/node_modules" "$T/port/node_modules"
for d in "$R"/assets/*; do ln -s "$d" "$T/assets/"; done
for d in data scripts; do [ -d "$R/$d" ] && ln -s "$R/$d" "$T/$d"; done
FOLDERS="src/stages src/scenes src/entities"

cd "$T"
# The game's own vitest config (with its fighter-mask excludes); failures are data here, not a stop.
# Two workers: the default pool is killed for memory on this machine and the lists come out empty.
tests() { { npx vitest run "$@" --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1 2>&1 || true; } | grep -E "^ (FAIL|×)|Tests  " | sed 's/ [0-9]*ms$//' | sort -u || true; }
npx tsc --noEmit --pretty false -p tsconfig.json 2>&1 | grep "error TS" | sort > tsc-before.txt || true
tests $FOLDERS > tests-before.txt
(cd port && node scripts/vendor-matter.mjs --check && node scripts/gate-merge.mjs --apply | tail -1)
npx tsc --noEmit --pretty false -p tsconfig.json 2>&1 | grep "error TS" | sort > tsc-after.txt || true
tests $FOLDERS src/physics src/camera > tests-after.txt

echo "== root tsc errors: before $(wc -l < tsc-before.txt), after $(wc -l < tsc-after.txt)"
diff tsc-before.txt tsc-after.txt && echo "   (identical)"
echo "== tests before:"; cat tests-before.txt
echo "== tests after (adds src/physics, src/camera):"; cat tests-after.txt
echo "== CRLF kept in stageDefinitions.ts: $(grep -c $'\r$' src/stages/stageDefinitions.ts) of $(wc -l < src/stages/stageDefinitions.ts) lines"
[ ! -e port/src/pending ] && echo "== port/src/pending removed"
(cd port && node scripts/typecheck.mjs | tail -1 && node scripts/check-layers.mjs && npx vite build 2>&1 | grep -E "built in|error" )
