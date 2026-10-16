# Link transient disappearance

The current production build reproduced two independent presentation gaps. Link's simulation remained present; only its selected drawing disappeared. The previous repeated-boomerang alias fix was already installed.

- A renamed authored aerial retained `sourcePoseId: link.nair` but landing selected art only from its gameplay `moveId`. The uninstalled generic `landing_aerial` key hid Link for all six landing-lag ticks, then ordinary idle returned. Real saved DOM jump/attack input reproduced this in both facings (palettes 0 and 3); the renamed attack registration is an explicit fixture, not editor UI coverage.
- A real saved player-2 jump onto default Link's head selected uninstalled `footstool_pose`, `footstool_air_pose`, and `footstool_fall` drawings. Ground recipients disappeared for nine ticks; the airborne fixture disappeared for 31 ticks before landing into visible knockdown. Both facings reproduced this. Head/feet alignment is explicit setup; the normal jump and combined participant resolver admit the actual reaction.

The retained `qualification.json` contexts-before summary records 958 measured ticks, 92 absent-body ticks, with missing/recovered screenshots inspected before acceptance cleanup. Its two `air-bow` rows actually selected aerial Spin Attack, visible in the trace, and do not qualify Bow. The narrower candidate harness removes this mislabeled duplicate.

The retained `qualification.json` before summary records 3,240 measured ticks across 26 ordinary/special/aerial sequences, with zero missing Link draws, page errors, or decoded-resource failures. It includes actual floating-platform contacts in both facings/palettes. Its `uair` rows autocancel into hard landing; the second baseline's `uair-lag` rows separately show the correct dedicated landing strip. Baseline URL: `http://127.0.0.1:4173/platform-fighter/`, loaded `assets/game-CDiv0wP3.js`, Windows Edge on Intel Iris Xe / Direct3D11 with parallel shader compilation. This does not identify which exact situation the user encountered or constitute a full fighter audit.

The correction selects saved aerial landing art by retained source identity. Link's existing source footstool owner supplies front/back/air/performer motion and phase age to presentation; the same runtime owner, contact, and movement clocks remain authoritative. Five previously omitted native clips were rendered with the existing native/cel pipeline and added to the installed bank: `a06steppose`, `a06stepback`, `a06stepairpose`, `a06stepfall`, `a06stepjump`. Forty-nine drawings sample every second native frame plus endpoints. These are actual native motions, with no idle substitution.

Native motion identities and lengths are pinned in `docs/review/2026-10-12/link-character/rework/sources/native/archive-motion-metadata.json`; the existing phase owner is `src/characters/linkFootstool.ts`. `footstool-art/clip-plan.json` records sampling, `packed-checks.json` verifies metadata and body floor alignment, and `install.json` records hashes. Temporary raw renders and duplicate packed output were removed after acceptance. All 227 previous clip records and PNG hashes remain unchanged. New item sockets and axes follow the same rendered drawings. Native render: 22.8 seconds with four workers; pack/check: zero failures, zero schema problems, maximum grounded body sink 2.84 px within the existing 3 px allowance. All five new atlases were visually inspected.

Focused verification passed 16 tests in two files: ten saved/serialized aerial landing cases through actual Matter contacts and selector output (five moves × two facings), two footstool source-route tests covering front/back/air/performer in both facings, and the four existing packed-profile checks. The production after-run below verifies the rebuilt integrated bundle.

Integrated production verification completed on `game-BNZfv5Ng.js` (source `platform-fighter-sha256-0067e47aa8dad11d9fe4e4501c5db226e6d40d5f9dc5ab70e8693fbb2a1bd191`). The retained `qualification.json` contexts-after summary records 18 cases and 1,604 measured ticks, zero missing appearances and zero browser errors. Both facings and palettes 0/3 exercised all five renamed aerial landing routes and all five native footstool clips: ground front/back, air pose/fall, and performer jump. Actual saved DOM jump/attack inputs trigger the interactions; positions and retained-source authored move setup are explicit fixtures, not editor UI coverage. Screenshots of landing, every native footstool sheet and recovery were visually reviewed by the implementing agent; the coordinator also reviewed fair landing and ground-back footstool before the bounded cleanup. The owned Edge profile was removed after the run.


Post-acceptance retention: `qualification.json` preserves case outcomes, build identity, browser/GPU information, complete-trace hashes and visual-review notes. `cleanup-plan.json` records the exact 200 generated files removed (60,375,613 bytes). `footstool-art/` keeps the clip plan, native-source/alpha audit, installation audit and pack/check receipts. Installed runtime PNGs, native extracted motion/model inputs, shared native/cel renderer tools and focused tests remain in place. No historical October12/15 source data or Final-Smash baseline was removed.

Reproduce browser acceptance against a fresh integrated build:

```sh
flock .tmp/dk-heavy.lock node tools/link-landing-visibility-probe.mjs --contexts --expect-fixed --edge --url http://127.0.0.1:4173/platform-fighter/ --out .tmp/link-visibility-recheck
```

Regenerate the five clips into a fresh temporary staging folder using the existing native renderer environment (native assets and accepted palette are retained):

```sh
flock .tmp/dk-heavy.lock /home/lombet/ComfyUI/.venv/bin/python tools/link-build-final.py render --plan docs/review/2026-10-16/link-visibility/footstool-art/clip-plan.json --raw .tmp/link-footstool-rebuild/raw --jobs 4
flock .tmp/dk-heavy.lock /home/lombet/ComfyUI/.venv/bin/python tools/link-build-final.py pack --plan docs/review/2026-10-16/link-visibility/footstool-art/clip-plan.json --raw .tmp/link-footstool-rebuild/raw --out .tmp/link-footstool-rebuild/packed
flock .tmp/dk-heavy.lock /home/lombet/ComfyUI/.venv/bin/python tools/link-build-final.py check --plan docs/review/2026-10-16/link-visibility/footstool-art/clip-plan.json --raw .tmp/link-footstool-rebuild/raw --out .tmp/link-footstool-rebuild/packed
```

These commands stage art; they do not overwrite the installed bank. Compare staged clip records and hashes with the retained audits before any targeted installation.
