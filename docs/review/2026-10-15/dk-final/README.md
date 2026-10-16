# DK Final owner completion

The owner bank adds six distinct native motions, not aliases of standing or
ordinary attacks. `owner-art-plan.json` pins the exact motion files, integer
samples, shared canvas/root, and the existing DK scale contract. The renderer
removes each sample's Trans translation; gameplay applies the matching dense
Trans delta independently. No pose gets a new floor or size fit.

`tools/dk-final-geometry.py` exports receiving, outgoing, punch-pocket, waist,
and FX registrations at exactly the same samples as the drawings. Native
one-based frame labels map to elapsed age `label − 1`. The startup window and
all finisher boundary samples are present. End/AirEnd retain their actual
nonzero Trans motion; startup and barrage Trans deltas are zero.

The outgoing roles match `finalPacketBinding`: startup detection (12), early
barrage (1.2), late barrage (1.1), and finisher (14). Selected packet offsets,
ids, joint names and source hashes come from the retained native scripts and
`selectedPackets.json`. HandL/ArmL positions follow the captured integer bone
matrices. Packet radius stays native radius ×5, as in the existing
`tools/native-hit-positions.py` consumer; visual hand squash/stretch does not
change it. TOP is the explicit virtual source-root adapter.

Receiving capsules are the reviewed authored anatomical recipe in
`docs/review/2026-09-25/donkeykong-character/sources/authored-anatomical-capsules.json`,
posed through those same native joints. They are not native hurt_data. The
capture point is also explicitly authored: the centroid of the selected
phase's TOP attack-capsule midpoints. Startup is (90, −50), barrage
(162, −50.2), and finisher (75, −55), in unmirrored world units relative to
source root. The recipient's own paired capture anchor is fitted to this
point by production choreography. It is not a recovered native capture joint.

The native End script contains size-conditional duplicates and a zero-damage
pre-hit in one branch. The existing selected normal-DK phase contract is
retained; the geometry export follows the same first packet branch as the
production binding rather than concatenating conditional script paths.
Native camera, native common capture dispatch and 3D collision parity remain
separate limits. CPU toon materials and visual helper-constraint omission are
recorded in each drawing manifest, separate from the strict mechanics bones.

Run `python3 tools/install-dk-final.py --stage-only` after art generation to
prepare an additive candidate. The installer checks source hashes, clock and
drawing pairing, shared registration, native/world calibration and actual PNG
atlas bounds. After reviewing the staged contact sheets, install with
`--reviewed-art-sha256` set to the exact art-clips manifest SHA. It refuses to
replace any different prior clip and rejects concurrent metadata changes.
The receipt records preservation of all earlier clips and top-level fields.

The coordinator inspected all 346 drawings in twelve body/overlay galleries
and accepted the exact manifest recorded in `owner-visual-review.json`.
The guarded additive installation preserved every earlier bank entry; see
`owner-install.json`. The six RGBA pages decode to 285.984375 MiB before
mipmaps or GPU copies, excluding all other game art.

The production physics suite
`src/finalSmash/donkeykongFinal.physics.test.ts` passes all fifteen cases:
twelve recipient/ground/air/facing combinations, all eighteen early and
thirteen late hits, released finisher contact, six native drawing clocks,
and ground/air misses. Together with the existing debug formatter suite,
29 tests pass; see `production-physics-tests.txt`. F3 reads the actual
analytical capsules queried by Final contacts in that fixed tick, with no
separate reconstruction of active windows. View reads preserve the digest
and inactive ticks clear those capsules.

The first actual browser run exposed a reaction-fit ordering bug: contacts
used the current receiving, then confirmed stagger selection moved its Hip
anchor until the next tick. The choreography now preserves that genuine
contact receipt and immediately fits the newly selected pose to the same
pocket. All 31 linking reactions in each of the twelve production cases
assert same-tick anchor equality. The corrected focused gate passes 52 tests
in five files, including Pikachu's genuine history reconstruction and 281
continuation hashes; see `pocket-fit-tests.txt`. The superseded browser run
is retained under `runtime-before-pocket-fit` as diagnostic evidence.

The corrected production browser probe
`tools/dk-final-match-probe.mjs` passes sixteen matches: twelve hits and four
misses, using the saved real keyboard binding. All runs finish and release
leases without page errors. It verifies 3,332 actual owner drawing/root/scale
selections and 1,656 same-tick anatomical pocket fits (maximum error
2.28e−13 world units). All hit scenarios apply 77.994 percent: 61.9 base ×1.05
fresh bonus ×1.2 items-off one-versus-one damage. Detection, barrage and
uppercut screenshots are retained; four representative corrected scenes were
also actually viewed across all three recipients and both orientations.
`runtime-acceptance.json` binds the report and screenshots to
`game-BYOl1XlT.js` and simulation identity
`platform-fighter-sha256-aedf4dbb82fd1923b83d2bf316a65c22b6839b12d4d82d604606e4f15282af86`.
