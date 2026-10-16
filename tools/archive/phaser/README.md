# Historical Phaser probes

These probes target the retired Phaser host, Character Lab, Stage Forge or
fighter previews. They are retained as evidence of the earlier implementation
and are excluded from active app validation. Their original browser and source
paths belong to the frozen builds; they do not run against the Three.js app.

[INDEX.json](INDEX.json) records every original path and its maintained
replacement. Replacements keep their stated scope; an earlier specialized
visual qualification is not automatically transferred to the new renderer.

Maintained validation now uses `tools/browser-match-host.mjs` and the real
`window.__sim` browser host. Gameplay rules remain covered by the retained
physics suites in `src/characters`, `src/items`, `src/match` and `src/finalSmash`.
