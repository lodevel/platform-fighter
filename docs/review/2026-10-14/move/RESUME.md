# Resume after the WSL restart (2026-10-14 ~21:45)

Project now lives in `~/Workspace/platform-fighter`; `/mnt/c/Workspace/platform-fighter` is a stale backup.
Start the new Claude session from `~/Workspace/platform-fighter` (its memory folder was copied).

## Paused work (both agents stopped mid-task by the restart)
1. **Unified Link art build** — brief in `art-prompt.txt` (here), plus: renders use `--jobs 8` (up to 12
   if `free -g` shows > 3 GB available). Output: `docs/review/2026-10-14/link-takeover/final-staging/`.
   It was stopped while editing tools/link-render-clip.py to add a flat process pool for --jobs: check that
   file runs (`--help`, one-clip test render) before the batch. Partial final-staging must be rebuilt clean.
2. **Link gameplay fixes** — sword beam restore (fsmash swing 1, SmashWiki), bomb launched by attacks,
   `dairReturnHit()` `lr:'position'`, fair hit 2 not connecting (11 tests), bair falling 1 vs 2 hits ruling.
   Files: src/match/linkArticles.ts, src/characters/linkFresh{Specials,Normals}.ts, linkAttackData.{json,ts}.
   Some src edits may be half done: run the targeted tests first to see where it stands.

## Then
- Combined pass #1: build (1m18s now), full vitest (`--poolOptions.threads.maxThreads=4`), re-record +
  verify goldens (digest schema changed), `tools/link-playable-probe.mjs --only "-B "`.
- Investigate why one vitest process reaches 6–10 GB (OOM kills in dmesg) — likely Link's 55 MB frames.json.
- Restart servers: `npx vite preview --base /platform-fighter/ --port 4173 --strictPort` (root),
  `npx vite preview` in port/ (:4211), `DK_REVIEW_PORT=4199 node tools/dk-serve-review.mjs`.

## Measured after the move
- game build 1m18s (was ~8 min); tsc 52 s, 45 errors (no missing modules); port build 22 s; npm ci 5 s.

## Cleanup (user approved; classifier blocks bulk rm from Claude, the user runs it)
- List: `docs/review/2026-10-14/cleanup/delete-list.txt` (17.7 GB), from `tools/cleanup-plan.py`.
