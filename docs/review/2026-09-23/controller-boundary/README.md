# Connected-controller handling and reconnect refactor

Follow-up to the [playtest repair](../playtest-input-repair/README.md), after the user explicitly encouraged refactoring fragile code.

The sparse-array cleanup crash is in the installed Phaser 3.90.0 implementation: its cleanup loops dereference every array position even though controller indices can leave holes. The existing compatibility shim remains isolated and unchanged. Review of the installed methods found synchronous cleanup without callbacks; its `finally` restores the original array and physical indices. Tests execute those real Phaser methods.

Cleanup deliberately includes disconnected wrappers because their listeners still need removal. The new connected-controller helper is for reading input, where those wrappers must be excluded.

The application had a separate structural weakness: character selection, lobby actions, menu navigation and match pause each interpreted the controller collection themselves. Some skipped empty entries but still read disconnected wrappers with stale buttons. This refactor gives those paths one shared implementation.

## Changes

- `connectedGamepads` filters holes, invalid indices and explicitly disconnected wrappers. It returns the original controller objects, preserving their physical indices. `connectedGamepad` looks up a physical index and rejects an absent keyboard/CPU controller index immediately.
- Character-selection polling, reconnect claiming and confirmation, lobby joins/actions/device display, menu navigation and match START handling use that shared read path. A disconnected wrapper cannot join, ready, navigate or trigger START through these paths.
- Menu navigation prunes button history against the connected snapshot, even when a disconnect event was missed. A controller first observed through polling primes its current confirm/back buttons; an explicit connection event retains the existing first-press behavior.

Player slots, reusable binding profiles and physical controller identities remain separate. No controller is renumbered and no profile or skin data is changed by this refactor.

## Verification

The [affected input, scene, binding capture and ownership suite](tests.txt) passes **65 files / 2,079 tests**. This includes four collection tests, nine real menu-poller regressions, the actual lobby disconnect/reconnect journey, and the existing native Phaser cleanup tests. The previous complete-suite baseline was **369 files / 11,254 tests**; that historical total is not a new all-files run for this refactor.

TypeScript and the [production build](build.txt) pass on **`index-CiXJE12M.js`**. All **276 runtime source-map entries** match the workspace ([verification](artifact-verification.json)); whitespace checks pass. Both production browser probes pass on this same artifact with **zero page errors**:

- [Controls and named profiles](profiles/results.json): **15/15 checks**, including capture, Confirm, profile reuse, main-menu library context, restart and rematch.
- [Sparse player/controller journeys](sparse/results.json): **6/6 checks**, including P1 empty/CPU, P2 arrows/P3 controller, physical controller indices 0/1, mouse isolation and tested preview colours through restart/rematch.

The browser probes ran sequentially after the build and test processes exited. The preview at <http://127.0.0.1:4173/platform-fighter/> responds with HTTP 200 and serves the verified artifact.

The original reported skin mismatch remains unreproduced, as documented in the playtest handoff. Synthetic-controller checks do not replace physical-controller acceptance.
