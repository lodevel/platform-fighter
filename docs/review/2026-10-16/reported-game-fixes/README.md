# Reported gameplay and animation fixes — 2026-10-16

The reported fixes are implemented and qualified in actual Windows Edge matches. Character work follows the targeted add-character workflow with retained Ultimate-derived native source and existing art direction.

- [Pikachu recovery](../pikachu-quick-attack-gravity/README.md): clears stale launch ownership when the special takes velocity; falling resumes after Quick Attack in both directions.
- [Link visibility](../link-visibility/README.md): retains source identity for saved aerial landings and supplies five omitted native footstool clips.
- [DK ground support](../donkeykong-ground-support/README.md): registers prone anatomical support instead of the hanging tie.
- [Inferno and FPS](../inferno-shipped-head/README.md): ships the head image as a manifest asset and displays actual rendered FPS in menus and matches.
- [Link Final](../link-final-visuals/README.md): adds a loaded arrow, charge light, release flash and actual-travel tracer. Authored attachment/light mappings are explicit.
- [Pikachu Final](../pikachu-final-density/README.md): adds 236 native display poses in a separate bank while preserving all authoritative pose data.
- [First-use pacing](../final-visual-pacing/README.md): compares cold and repeated real-time activations independently of screenshot probes.

## Delivery checks

A clean export of the selected Git index passed **571 test files / 12,162 tests**, including genuine input-history Final replay. Its standalone build passed TypeScript/layer checks and copied **743 runtime assets**. Source identity is `platform-fighter-sha256-e236b17191fa7db98aa7d508f28193b773b06ffa7632a37ea0ea5570b51cd1d9`.

The clean standalone artifact was then served directly, without source/private middleware, and qualified in a real browser: shipped image bytes and MIME, former private routes absent, visible stage photo, normal match playback, and independent FPS counting all passed. See [browser receipt](clean-checkout-browser.json), [full tests](clean-checkout-tests.txt), and [build output](clean-checkout-build.txt).

The earlier deterministic Final checks used `game-_LoddHLw.js`; their source identity is identical. A stale local `port/node_modules` cache contained font version 5.1.0 while the root lockfile installs 5.3.0. The obsolete nested cache was removed from resolution so local and clean builds use the root dependencies. The clean artifact is `game-BL2B4bsg.js`, SHA-256 `48155e265aac9c771902acdd733b5c219583c9bac30c84c54454bc5c3a16bea5`. Every runtime file in the final local build is byte-identical to the clean artifact. One debug source map records a different relative dependency path; see [artifact comparison](artifact-comparison.json).

Disposable screenshots, raw traces, intermediate art and cached build copies are removed after acceptance. Compact measurements, source inputs/recipes, live tools, test fixtures and installed runtime assets remain. Historical source/reference data is outside this bounded cleanup.
