# Production fair clock acceptance

This scoped check uses the source-built opted-in Pikachu forward-air record in
the shared production MatchScene with DK fixture bodies. It does not register
Pikachu, accept combat art, reconstruct native posed hurtboxes or claim native
hit-stop timer parity. The repeat interval3 is sourced; attack-elapsed clock
policy is explicitly authored and retained on the move.

`tools/pikachu-fair-acceptance.mjs` exports the actual source builder result to
`browser/source-built-move.json` and injects it into the fixture Character.
DK's canonical `executeFair` hook owns the `donkeykong.fair` routing ID, so the
injected record changes only that ID; all sourced move fields and the explicit
policy remain unchanged. The original `pikachu.forward-air` export/hash and
adapted fixture ID remain recorded. DK's ordinary fair is not used in these
scenarios.
Eight scenarios cover both facings, target first contact at elapsed10 or11, and
with/without attacker freeze5. Five freeze frames are a test stimulus, not a
sourced Pikachu constant. Injected input-resolver values exercise directional
aerial dispatch; this is not physical keyboard/gamepad acceptance.

The actual production handler and Matter sensors must produce five linker
contacts and one finisher, preserve the continuous strike through physical
sensor replacement, leave elapsed25 empty and start a new final strike at26.
Clock freeze must extend physical time without extra contacts. A temporarily
detached sensor must fail its attempt to borrow the actor clock and is restored
in `finally`. One-pixel target hurtboxes and stationary fixture bodies isolate
this mechanism; callbacks confirm contact data without target launch.

Production execution **passed8/8 scenarios with zero page errors** on
`http://127.0.0.1:4179/platform-fighter/`, bundle `index-v5AbW1PH.js`, SHA256
`d065d3ec1d06f17296b2d9db22ecc0170a1b9fec04102c4e7643ff58767b2d3a`.
The engine identifies itself as
`platform-fighter-sha256-b574bd6fd79cb03ee4e396256dfd0f37bdf24dd5369c1ae51b073832a42fe40b`.
The bundle lives in `/tmp/platform-fighter-pikachu-engine-20261006`; the earlier
accepted jab preview and restored main-game DK snapshot remain separate.

```
node tools/pikachu-fair-acceptance.mjs URL OUTPUT_DIRECTORY
```

[Browser measurements](browser/report.json) record bundle URL/hash, engine identity, source move
hash, physical/gameplay frames, hit data, sensor/group identities and errors.
The earlier accepted jab-only preview and immutable DK verification snapshot
remain separate artifacts.
