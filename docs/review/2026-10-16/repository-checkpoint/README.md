# Repository checkpoint

2026-10-16. A coherent snapshot of the current Three.js game, installed fighters
and completed character-rendering foundation, prepared for `rework/gameplay`.
The remote previously contained the June game; publishing only the latest
rendering files would omit the engine and fighter work they depend on.

## Contents

The snapshot includes shared simulation and tests, the Three.js/HTML host,
installed runtime artwork, source tools, build configuration, project workflows,
roadmaps, Markdown review summaries and the rendering foundation evidence.
Temporary builds/downloads, Python caches, personal pictures, local agent state
and bulk historical audit captures are outside the checkpoint. Existing local
files are retained; this operation does not delete the audit archive.

Tests read some historical audit data directly. The
[required docs fixture list](required-doc-fixtures.txt) retains 532 such files
(11.68 MiB). The [dependency audit](fixture-audit.json) also records three
explicitly retained native taunt test clips (147,683 bytes), including the
transitive hash pins that require them. These are deliberate exceptions to the
generated-source ignore rule.

## Validation

The Git index was exported to `.tmp/push-checkout` with `git checkout-index`.
The export reused the installed dependencies through a `node_modules` symlink;
all source, runtime assets and test fixtures came from the index.

Its source identity matches the qualified game:
`platform-fighter-sha256-8801bf0c4941c9a7c639cf2e69652ebf398af18acdabbc36bd02a82cb722b757`.
The complete final suite passed **566 files / 12,115 tests** on Node 20.20.2;
see the [test log](tests.log). The default standalone build also passed type and
layer checks and copied all 723 runtime assets; qualification fixture pages are
absent. See the [build log](build.log) and [verification record](verification.json).

The [rendering foundation record](../character-rendering-refactor/README.md)
contains the runtime baseline comparisons and hardware browser qualification.
Repository packaging does not change simulation, character art or appearance
code. `.tmp/` and Python cache files now have explicit ignore rules.
