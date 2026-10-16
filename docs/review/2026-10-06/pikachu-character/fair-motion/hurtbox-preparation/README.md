# Authored forward-air damage geometry

All16reviewed drawing holds have12damage capsules. Captured bone endpoints use orthographic native z/y projection at5world pixels per unit, root25below the movement-body centre. Radius uses captured size times maximum world-matrix column norm times5. Native nonuniform scaling semantics are unresolved, so this is an explicit authored calibration. The12-region historical layout excludes separate ears and the outer tail tip; rounded capsules extend beyond some drawn contours.

[Candidates](candidates.json) and [root review](visual-review.json) pin geometry/art hashes and observations. The source module is src/characters/pikachuFairHurtboxes.ts; build validation requires exact equality with the reviewed candidate rows. Shared move hurtbox modifiers now support frameWindow [startFrame,endFrame), intersecting optional phase and frozen on the Character attack clock. Serializer/Lab/factory transport has104focused checks including six new boundary/save/freeze tests.

[Posed browser acceptance](../posed-browser/acceptance.json) passes16outgoing cases,384incoming capsule-centre contacts,32beyond-envelope misses,2manual freezes, pause,17servedPNG hashes and2synthetic5damage interruption/queued-launch cases. Launch follows the shared engine freeze and then hitstun; it does not establish sourced Pikachu launch values. [Visual review](../posed-browser/visual-review.json) covers all32runtime pose screenshots.

Only the in-flight fair is posed. Waiting/reset/end/interruption restore the shared fixture's body hurtbox. Full-fighter neutral/locomotion/defense geometry, native radius/status semantics, exact electric hit-stop, roster/Lab and complete match acceptance remain required. Prior preview/build records and the main game are preserved.
