# Vendored Matter

`source/` preserves the CommonJS Matter 0.20.0 fork shipped with Phaser 3.90.0,
including its MIT notices. The Phaser runtime/package is no longer used.
The source was copied unchanged before removal; `source-sha256.json` records
every retained source file, the package marker and license notice.

`matter.js` is the generated ESM bundle imported by the game, Node probes and
tests. Its behavior passed the frozen build's 55,800-frame deterministic
comparison before intentional later gameplay fixes.

Run `node port/scripts/vendor-matter.mjs --check` from the repository root to
verify both source hashes and the generated bundle (normalizing only esbuild
module path labels from the source folder's relocation). Run without
`--check` to rebuild it from those verified sources.
