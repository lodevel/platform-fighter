# Completed migration scripts

These are the historical, one-time gate migration and scratch rehearsal
scripts from the Three.js port. The gate was applied on 2026-10-15. They refer
to the former `port/src/pending` tree and retired Phaser scenes and cannot be
rerun on the finished app. Their original locations were
`port/scripts/gate-merge.mjs` and `port/scripts/gate-trial.sh`.

Current validation uses root `npm run typecheck`, `npm test`, `npm run build`
and the maintained browser probes listed in the root README.
