#!/usr/bin/env bash
# Build the pinned basis_universal encoder that tools/encode-compressed-sheets.py runs
# (.tmp/basisu-src/bin/basisu). Skips the build when bin/ already holds this commit's binary.
# Needs git, cmake and a C++ compiler. Used locally and by the Pages deploy workflow.
set -euo pipefail
COMMIT=323239a6a5ffa57d6570cfc403be99156e33a8b0 # basis_universal v1_60
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tmp/basisu-src"
STAMP="$DIR/bin/basisu.commit"
if [ -x "$DIR/bin/basisu" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$COMMIT" ]; then
  echo "basisu $COMMIT already built"; exit 0
fi
mkdir -p "$DIR"
[ -d "$DIR/.git" ] || git -C "$DIR" init -q
if [ "$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null)" != "$COMMIT" ]; then
  git -C "$DIR" fetch -q --depth 1 https://github.com/BinomialLLC/basis_universal "$COMMIT"
  git -C "$DIR" checkout -q --force FETCH_HEAD
fi
cmake -S "$DIR" -B "$DIR/build" -DCMAKE_BUILD_TYPE=Release
cmake --build "$DIR/build" --target basisu -j "$(nproc)"
echo "$COMMIT" > "$STAMP"
"$DIR/bin/basisu" -version | head -n 1
