# Live Pikachu progress

Open http://127.0.0.1:4195/pikachu-motion-preview.html. Start the gallery with
`node tools/pikachu-motion-gallery-build.mjs --serve` if its server is stopped.

The read-only `/pikachu-progress.json` endpoint reads the canonical144-row
inventory, current art metadata and latest production-build record on request.
The browser refreshes every5seconds without reloading the selected move. It
retains the last successful snapshot on temporary failure and visibly marks
updates as paused. Changing evidence does not require rebuilding the gallery.

Completion uses explicit per-row `progress` flags: implemented, accepted visuals,
verified runtime, `complete: true` and an empty required-gap list. Unreconciled
rows stay incomplete. Source fidelity limits remain separate. The percentage
counts action rows, rather than estimating development time or native parity.

[Functional acceptance](acceptance.json) records actual live counts and browser
controls. Automatic refresh and service-failure checks use explicitly simulated
responses without altering character evidence. [Visual review](visual-review.json)
records actual desktop/mobile inspection. Neither record upgrades fighter
behavior acceptance. Prior gallery build records are retained under
`../../motion-gallery-build-history/`; the child move bundles are unchanged.
