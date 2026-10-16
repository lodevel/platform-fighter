# Production automatic Pikachu landing contacts

Checked2026-10-06: **38 scenarios passed, zero page errors** on the immutable
shared-engine production snapshot at `http://127.0.0.1:4179/platform-fighter/`.
Bundle `index-v5AbW1PH.js` SHA256:
`d065d3ec1d06f17296b2d9db22ecc0170a1b9fec04102c4e7643ff58767b2d3a`.
The tool enforces this bundle filename and records the served bytes' hash.
Runtime source and `dist` were not changed for this acceptance.

The source builder exported back/down-air and their nested landing records to
[source-built-moves.json](source-built-moves.json). Only the fixture aerial
routing IDs become `donkeykong.bair`/`donkeykong.dair`; the nested Pikachu IDs and
numeric records stay intact. The saved JSON transport is parsed locally, then
passed through production MatchScene's character override and fighter factory.
The registered aerial must equal that saved record, and the landing record must
not be separately registered. See [saved-dk-fixture.json](saved-dk-fixture.json).

The actor lands on the actual solid stage floor. Mirrored outer-floor segments
keep the fixture clear of floating-platform assist and ledge interactions.
The real production damage handler resolves a stationary one-pixel hurtbox probe.
That probe represents player2 while its real DK body stands on the opposite
floor segment, providing actual grounded classification for down-air's native
ground-only landing region. This avoids the large fixture bodies' jostle rule;
no target launch or percentage accumulation is claimed. Resolver injection
exercises directional back/down aerial dispatch rather than invoking attacks
directly.

| Checked behavior | Measured result | Scenarios |
| --- | --- | --- |
| Both-facing first contact |4 damage at landing elapsed0/native game1; one confirmed strike|4|
| Target enters final active step |4 damage at elapsed1/native game2|4|
| Target enters after clear |No contact at elapsed2/native game3|4|
| Beyond regional edge |Back circle misses at41px; down capsule misses at51px|4|
| Late autocancel |No landing attack at aerial elapsed37, both actions/facings|4|
| Early back-air autocancel |No landing attack at aerial elapsed2, both facings|2|
| Attacker hitlag3 |Landing elapsed/contact and recovery pause together; one strike; free step delayed3|4|
| Damage before landing recovery |Route interrupted; no landing contact/replay|4|
| One step after aerial total |Context retired; no landing contact or move-specific lag|4|
| Five steps after aerial total |Context retired; no landing contact or move-specific lag|4|

Outside autocancel, back-air remains committed for18 landing steps and accepts
shield on step19; down-air remains committed for22 and accepts shield on step23.
Active sensor snapshots at elapsed0/1 share one strike group. Elapsed2 clears
the sensor. Airborne sensors are removed. The before-input item gate opens for
the next free step. Autocancel/post-animation landing retains ordinary DK
fixture landing recovery (soft2, or hard4 after the down-air fixture's fast-fall
input); it does not produce a Pikachu landing contact or18/22-frame aerial lag.

The suspected completed-animation stale-context defect was not reproduced in
eight measurements. Production matches the current `isAutoCancelFrame` contract:
after commitment, autocancel remains effective unless an explicitly authored
late window begins later. Both source contexts were null before touchdown at
total+1/+5. This supports keeping the accepted runtime unchanged.

The root landing projection preserves captured native contacts: back-air
`top(0,4,0), radius8`, down-air `top(0,4,-6)→(0,4,6), radius4`, active game1–2,
clear3. The source helper uses authored scale5/root offset25. Non-root airborne
pose projection is explicitly test-only and places those regions away from the
probe. DK fixture body/art, simulation input, and unit/frame conversions do not
constitute native Pikachu anatomy, visual acceptance, physical keyboard/gamepad
input, or a complete registered Pikachu fighter.

[report.json](report.json) contains every frame/contact, saved-record equality,
grounded classification, action gates, contexts, engine metadata, source export
hashes, source-file hashes and the immutable production bundle hash.

```sh
node tools/pikachu-landing-acceptance.mjs
```

Chromium initially failed under the restricted sandbox. The final command ran
with its explicitly approved scoped escalation. Earlier fixture-only failures
were corrected in the tool; no runtime behavior was changed to accommodate it.
