#!/usr/bin/env bash
# Stop hook — autonomous sprite-generation driver.
# While .claude/sprite-roster.json has autonomous=true AND characters still pending
# (in queue, not in done/blocked), block the stop and inject a continue-prompt for
# the next character. When the queue is exhausted (or autonomous=false), allow the
# stop. The roster file is the loop guard + kill switch (set autonomous=false to stop).
set -euo pipefail
ROSTER="${CLAUDE_PROJECT_DIR:-.}/.claude/sprite-roster.json"
[ -f "$ROSTER" ] || exit 0

python3 - "$ROSTER" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
if not r.get("autonomous"):
    sys.exit(0)
done = set(r.get("done", [])) | set(r.get("blocked", []))
remaining = [c for c in r.get("queue", []) if c not in done]
if not remaining:
    sys.exit(0)
nxt = remaining[0]
reason = (
    "AUTONOMOUS SPRITE MODE (do not pause, do not ask). Next character to fully "
    f"build: '{nxt}'. Steps: (1) write its clip spec (locomotion idle/run/jump + a "
    "real ducking/crouch clip + EVERY per-move attack jab/tilt/smash/nair/fair/bair "
    "and the 4 specials, each with a mechanically-correct pose — ranged/projectile = "
    "firing pose, not a generic swing — plus its weapon held organically in frame); "
    "(2) build the canny library with enforced right-facing; (3) gen-frames-cn; "
    "(4) pack strips + frames.json (incl. per-move keys + crouch); (5) wire basic + "
    "per-move + crouch paths; (6) keep `node.exe node_modules/typescript/bin/tsc "
    "--noEmit` and `node.exe node_modules/vitest/vitest.mjs run` GREEN; (7) verify "
    f"in-engine via tools/_drive-link.cjs style probe. Then append '{nxt}' to done[] "
    "in .claude/sprite-roster.json and continue to the next. If a character fails "
    "gates after maxAttemptsPerChar attempts, add it to blocked[] and move on. When "
    "the queue is exhausted, set autonomous=false and stop with a summary report."
)
print(json.dumps({"decision": "block", "reason": reason}))
PY
