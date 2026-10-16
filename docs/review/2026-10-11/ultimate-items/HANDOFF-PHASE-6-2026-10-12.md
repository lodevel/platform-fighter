# Continuation after the phase-6 milestone

Work in `/mnt/c/Workspace/platform-fighter`, branch `rework/gameplay`.
The interrupted Codex session was recovered on 2026-10-12. Stop at the phase-6
milestone as previously requested; phase 7 has not been dispatched.

Read `PLAN.md`, `phase-6/qualification.json`, then the earlier
`HANDOFF-2026-10-12.md` for architecture, phase acceptance, and binding rules.
The older handoff's pending phase-5 choices were approved; do not ask again.

The current playable application and dashboard share one server:

- Game: <http://localhost:4199/platform-fighter/>
- Dashboard: <http://localhost:4199/dk-motion-preview.html>
- Bundle: `index-BQo4ngJ3.js`
- SHA256: `d9803a9c7229ec01e19f78d3bd4df8d8a8fc532fb38d33b2a041575e5f6ed15d`
- Engine: `platform-fighter-sha256-04983ab6004edfc6ee20bf692f73d425cc63ec3e667cb8577087fc5b55087596`
- Guarded build: `.tmp/attack-rings-production-assets-staged.json`
- Publication: `.tmp/dk-live-gallery/publication.json`

The user explicitly asked to close duplicate running game instances. Nineteen
old previews were stopped; the temporary recovery preview is closed after
verification. Use the current server rather than reviving old ports. The
phase-5 directory and publication are preserved beside the current copy.

Phase 6 replaces the test Hammer with Ultimate's locked auto-swing state and
adds Golden Hammer. DK and Pikachu use dedicated wait/move/jump drawings,
paired receiving and registered grips. Golden loops twice as fast. Hitbox
outlines are **off by default**; F3 toggles them. This explicit user choice
overrides any skill rule requiring continuously visible damage areas.

The previous session fixed owner-clock rehit deadlines, the first-pickup render
ordering, Pikachu's captured ledge facing, and DK's knockdown support loss.
Recovery verified the actual visible Hammer head movement, both facings and
both fighters, rather than counting selected body frames alone. Ledge checks
use normal detection on flat and lava stages. The exact build played in the
latest complaint is unknown: stale previews and the phase-5 dashboard were
found, but do not claim to have proven which caused that specific play report.
The original DK midair-prone event remains unconfirmed without its replay;
the separately reproduced support-loss defect has its own scoped acceptance.

Evidence for this unchanged build includes 40 Hammer scenarios, 20 earlier
item regressions, two contacted 2,400-frame deterministic replays and the
frozen plain suite: 12 baseline failures, 12,529 passing tests. Recovery checked
all 1,566 frozen inputs remained identical. Keep historical broad probes tied
to their original bundles; the full same-build family sweep belongs to phase 9.
Read qualification.json for authored parameters, sparse art, placeholder item
sprites, native-status and cosmetic gaps. Rough-beta qualification is not a
claim of exhaustive native Ultimate parity.

DK is 219/221 applicable actions qualified after the four re-scoped Hammer
rows. Only slow/fast heavy-carry gait rows remain, for phase 8. Items are 10/16.

Next phases, when resumed:

1. Phase 7: Food, Heart Container and Maxim Tomato; install both fighters' eat
   clips and verify healing, including damage during gradual healing.
2. Phase 8: Crate, Barrel and Capsule; container contents/explosion rules,
   Pikachu heavy carry and DK's two heavy-carry walk gaits.
3. Phase 9: full same-build DK/Pikachu family sweep, stale tool/API cleanup,
   two-fighter menu tests, Pikachu's existing roster test failures, superseded
   socket/sprite cleanup and item-skill updates. Ask before editing skill files,
   as already required by the user's project instructions.

Only DK and Pikachu count. SmashWiki wins disagreements with UFD; silence
uses labelled native-derived values, then explicitly labelled authored values.
Keep source and runtime evidence separate. All remaining item art was already
generated; inspect existing assets before scheduling more GPU work.

Never reset/stash/clean/checkout/restore/commit/push. Preserve docs, evidence,
assets and scratch; delete only explicitly replaced code paths. Use the shared
`flock .tmp/dk-heavy.lock` for heavy work. The full suite is plain
`npx vitest run`; `--dir src` bypasses the roster mask. Retain the 12 known
baseline failures, add none. Delegate one phase to one implementation agent
and retain coordinator visual acceptance. No agent may kill/signal processes
or use `nohup`/shell backgrounding; duplicate cleanup here was a root action
explicitly authorized by the user. Do not repeat it without relevant scope.

Update PLAN.md, the canonical inventory, qualification receipts and the stable
dashboard at each accepted milestone. Preserve the old published copy, stage
the exact guarded build and verify the browser-loaded bundle before publishing
qualified status. Stop at the next milestone and write a fresh handoff.

Late cosmetic request completed: the user also removed all decorative attack rings, hit core disks and charge auras. Impact streaks, charge bars, real projectile art and shields remain. See `docs/review/2026-10-12/attack-rings/qualification.json` for the current build and full-suite/browser acceptance. Original phase6 mechanical reports remain tied to X2; no same-build reinterpretation.
