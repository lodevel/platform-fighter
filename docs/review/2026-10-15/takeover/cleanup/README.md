# Reviewed cleanup candidate

The original 17,692 MiB list contains 111,572 paths and predates this takeover.
It has not been executed. Source captures, reviewed artwork, frozen comparators
and current work remain in place.

`duplicate-build-assets.json` is a narrower dry-run plan: 7,897 obsolete scratch
build assets, 1,324,197,432 bytes (about 1.23 GiB), refreshed after the final
production build and asset installs. Each entry names an identical
retained original under `assets/` and records its SHA-256. It excludes all
`docs/review` material, native/art inputs, current live galleries, the frozen
comparator and this takeover's work. The plan may shrink as asset banks change.

`tools/cleanup-duplicate-build-assets.py` defaults to a fresh dry run. Its
explicit `--apply` mode validates the entire plan and both copies' hashes before
the first deletion. It removes only obsolete scratch copies; historical build
snapshots containing those copies would no longer be complete runnable builds.
No cleanup deletion has been performed. The user's cleanup preference remains
pending; this plan is separate from the Phaser source removal required by the
completed port.
