# Overnight log (started 2026-10-14 ~23:00)

The user said "do everything, don't stop", then "I'm going to sleep, work".
Order of work, each package starting as soon as the files it needs are free:

1. Running at start: Link gameplay fixes (sword beam, bomb launch, dair return, fair hit 2, bair falling);
   port step 4 (delete the 11 dropped fighters + legacy Link); A4.1 (shared packed-body presentation);
   Link art pass 2 (bow, articles, `*upper` overlays, edge-texel flags).
2. A4.2: install `link-takeover/final-staging/` into `assets/characters/link/`, wire Link to the shared
   presentation, delete the old Link presentation/runtime, un-mask Link from the roster.
3. B3 (Character.ts Link collapse + defence/ledge), B4 (held items), B5 (Final Smash), B7 (green bar).
4. Combined check: build, full vitest, goldens re-record + verify, Link playable probe, preview.
5. Port step 5 (headless MatchSim), then 6 (Three.js match view), then 9 (remove Phaser).

## Done before the log started (2026-10-14 evening)
- Link art set staged: 217 clips, 1552 drawings, one renderer; schema/floor (≤3 px)/determinism pass;
  220 MiB decoded, 55 MiB BC7, frames.json 0.57 MiB. Sheets: `docs/review/2026-10-14/link-takeover/final-staging/sheets/`.
- Small fixes: replay version test (7→8), `finalSmashMeter.ts` and `FinalSmashChoreography.ts` tsc errors.
- Smoke test on the 20:58 build: DK vs Pikachu plays (hard AI, 1800 frames, no errors); Link fights but is invisible
  (new art not installed yet).
- Vitest OOM: likely cause is the 55 MB `assets/characters/link/frames.json` imported by 5 modules; the A4 install replaces it.

## Entries
- **Art pass 2 done.** The bow is drawn in the 8 bow clips (Ancient Bow in d04final*). New article sheets:
  `fx__link_bowarrow`, `fx__link_ancientbowarrow` and `fx__link_boomerang` (16-drawing spin, 22°/frame).
  The 7 `*upper` shooting overlays are re-rendered with the legs hidden; the waist cut needs `WAIST_Y.link ≈ -6`
  in upperBodyLayer.ts at install. The 28 edge-texel flags are fixed (LANCZOS ringing clamp + a check false
  positive); pack exits 0.
  Totals: 1570 drawings, schema/floor/determinism pass. **No native source** for the bomb, sword beam, explosion
  or Final FX (Ultimate keeps the bomb under item/, beam/FX are effect files; neither is in the inputs), so the
  game keeps procedural/hit-area drawings for them. **Decision for you:** draw the bomb and sword beam
  procedurally, or leave them as is. Not drawn but available natively: the parasail (entry) and Navi (taunt).
  Sheets: `docs/review/2026-10-14/link-takeover/final-staging/sheets/` (articles.png, specials.png, final.png).
- **Link gameplay fixes done (all 5).** Masked Link physics suites 327/327 (13 failed before); fresh-Link
  suites 296/296; tsc 45 → 38.
  - Sword beam: spawned through the shared projectile path (`linkArticles.linkSwordBeamSpawn`), snapshotted,
    drawn as its damage capsule; values in `linkSwordBeam.ts` (SmashWiki + UFD, 0% only, 5 + 8·charge/60).
  - Remote Bomb is launched by attacks: shared `MatchScene.itemStrikes()`, `itemAttackLaunchVelocity()` calls
    `combat.computeKnockback`, flag `ItemDefinition.launchedByAttacks`. Open: bomb weight/percent are not on
    SmashWiki (launched as weight 100, 0%); projectiles hitting a bomb are not covered.
  - Dair return now launches by position (`lr:'position'` carried through `aerialSchema`/serializer).
  - Fair hit 2: the cause was the 367 autolink angle ignoring the attacker's momentum (`Character.ts` recorded
    it only for a legacy flag). Fixed per SmashWiki Autolink_angle. **This also changes DK/Pikachu 367 moves →
    goldens may shift** (checked in the combined pass).
  - Bair: 2 hits when kick 1 starts rising/at apex, 1 when already falling (SmashWiki/UFD frames 6–8, 15–17).
  - Leftover failing tests outside these files: referenceAutolink (3), legacy-Link serializer/collision
    tests, `DonkeyKong.attackValues` (×1.05 damage), `RemoteBombAdapter.physics` → B7 triage.
- **A4.1 done.** New shared `src/characters/packedBodyPresentation.ts` (profiles: `donkeykongBodyProfile.ts`,
  draft `linkPackedBodyProfile.ts`); `donkeykongBodyPresentation.ts` deleted; snapshot field `donkeykongBody` →
  `packedBody`. 64 DK/presentation test files: no new failures (47 pre-existing failures unchanged). Pikachu keeps
  its own parallel presentation (could become a profile later). → Started **A4.2** (install + wire Link + un-mask)
  and **B5** (Final Smash).
- **Port step 4 done.** `CHARACTER_IDS = ['link','donkeykong','pikachu']`; 11 fighters + LegacyLink deleted (27 source
  files / 18k lines, ~17 MB art, palette pipeline, `data/`, 10 tools); one `ANIMATED_MOVESET_IDS` list replaces 5;
  ~85 probes switched to kept opponents; replays/Lab saves of removed fighters and legacy Link are rejected.
  `package.json` drops prebuild/palette scripts. Remaining failures are pre-existing (freshness 1.05 bonus, taunt
  entryFrame, replay v8, combatSfx, Rebinding) → **B7 triage agent started**. Open: near-dead code
  (`specialFramework`, `moveResolver`, teleport/tether up-specials) to delete later.
- **B5 Final Smash done.** The cause of "Final does nothing": the arrow origin came from a drawn-pose socket, which
  returned null with no Final art. Now the origin comes from data (`linkAttackData` `ancientArrow`, bow hand at frame 60).
  Values match SmashWiki (flight 0% → explosion 35% @60 BKB102 KBG46 r25 on a fighter, 20% @50 on a wall; meter
  ×0.7 dmg / ×0.9 KB). SmashWiki shows no cinematic: it's a straight arrow + explosion. The arrows live in `LinkArticles`
  (snapshotted); MatchScene lost its own copy. New `linkAncientArrow.physics.test.ts` 6/6 (fresh match, no
  resetForRound). Open: Link Final FX cue bank; victim hitlag ×0.3 vs native `disableHitlag` (shared DK/Pikachu code).
- **B7 triage done (9/10 groups green; manifest left to A4.2).** Source fixes: `TauntPresentationState.entryFrame`
  type, replay `linkIntroPolicy` round-trip (always written), Lab empty `collisionHits` could not reload (serializer
  `allowEmpty`), Rebinding screen rows 38→32 px (16 rows overflowed). Test fixes: freshness ×1.05 on throws/pummels
  (SmashWiki stale-move negation; DK pummel 1.6 → 1.68), replay v8, Pikachu single-stage jab, landing-free fixtures.
  Open: PlayerControlsPanel (3), moveFramePreview (4), Link jab chain + 2 Link contact tests (A4.2/B3 area).
- **B3 diagnosis done** (`docs/review/2026-10-15/b3-diagnosis.md`, test `src/characters/linkDefenceLedge.physics.test.ts`
  37 pass / 12 red by design). Link's rolls/spot dodge were fine: the triage probe overrode `isActionHeld`, so `dodge`
  never fired. Real Link defects: no ledge tuning (get-up 28 vs 34 f, ledge roll 36 vs 45 f), ledge-jump
  intangibility off by one, ledge attack drops him off-stage (no root motion), trip stand wrong for DK and Link.
  Shared-path gaps (Link's own modules right, DK wrong): shield-break pop-up, trip intangibility 1–5. 9 Link-only
  receiving modules can go. My call: wall/ceiling tech becomes ONE shared path for all 3 fighters (DK/Pikachu
  currently each have their own). Phase B part 1 (ledge data, ledge-attack motion, probe fix) started; part 2
  (Character.ts collapse, shared trip/shield-break/tech) after A4.2. Goldens with a trip or shield break will shift.
- **B7 follow-up done:** PlayerControlsPanel (tests now derive from `LOGICAL_ACTIONS`) and moveFramePreview (synthetic fixtures instead of changing Link data) green; test-only.
- **B3 part 1 done.** Link ledge data (UFD: get-up 34, roll 45, jump intangible 12); one Link movement profile
  (duplicate deleted → Link's fast-fall 2.56 → 3.04, landing 4/6 → 2/5 f, dash-dance 14 → 12, all UFD/SmashWiki);
  Link's ledge attack now climbs on stage via a shared `projectCornerAnchoredLedgeRoot` (DK unchanged); probes now
  drive the real input resolver. Parity test 42/50 (8 wait for part 2). Pre-existing failures to triage: airMovement
  bair facing, landing run speed, landing/knockback serializer tests (old-kit data).
- **A4.2 done: Link is visible and selectable.** Installed 220 PNGs (42 MB), frames.json 0.6 MB, item-axes.json;
  deleted the old Link art (539 + 507 files, ~272 MB incl. the 52 MB frames.json). Link is on the shared packed-body
  path (registered profile), un-masked (`ACTIVE_FIGHTER_IDS` = DK, Pikachu, Link), Link test suites now run in `npm test`.
  One `packedFighterSpritesheets()` manifest builder serves DK and Link. ~20 old Link presentation/equipment modules
  deleted. Arrow sprite rotates with flight; boomerang spins through its 16 drawings. Invisible by design (no clip):
  `special_s1_blank`, footstool sheets, `camera_hit`.
- **Combined check #1 (01:30):** `npm run build` fails at `tsc --noEmit` (29 errors, mostly pre-existing Matter typing
  in MatchScene and test fixtures); Vite alone builds in 28 s (was 1 min 18 s). Browser smoke (hard-AI, 1800 frames,
  simulated): DK vs Pikachu, Link vs DK, Link vs Pikachu all fight with no page errors; **Link is drawn** (feet on
  the floor, aerials, sword swings). Screenshots: session scratchpad `smoke2/`. Full vitest running.
- **Step 5 prep:** new Phaser-free `src/stages/stageViewport.ts` (3 copies → 1) and `src/stages/hazardBodies.ts`
  (lava/wind sim bodies), lava factory moved to `entities/LavaHazard.ts` (removes the port's last Phaser path),
  `PhysicsWorld.world.engine`; dead `src/creatures/` deleted (planned in 5.2). Found: the other AI built a
  re-simulate history checkpoint — proposal to make it the single golden digest. Estimate ~10 days left for step 5.
  One auto-mode denial (a comment edit right after the `rm -r src/creatures`); not retried.
- Started **B3 part 2** (Character.ts collapse + shared trip/shield-break/surface tech).
- **Full vitest (01:35): 12,692 / 12,839 pass, 147 fail, in 82 s with 6 threads — no OOM** (the 55 MB frames.json
  was the cause). Failures are mostly legacy-Link-kit fixtures → **B7 final** agent; Link defence/landing ones → B3.
- **Step 5 design refreshed** (STEP5-DESIGN.md §8, ~10.5 days left). Proposals accepted by me (both remove a
  duplicate): A = one golden digest from `captureMatchHistoryEvidence()` (+explosions); B = one recorded-input
  contract (CPU always sampled, recorded input overrides). New golden scenarios: link-dk, link-pikachu-items,
  final-ball. Lands after B3. Art pass 3 started (paraglider in the entry, Navi in the taunt).
- **~02:00–08:40: all 3 agents (B3 part 2, B7 final, art pass 3) died on an API error** ("Unable to read managed policy settings"); the session restarted and the preview servers stopped. 08:43: servers restarted, all 3 agents resumed from their transcripts.
- **Art pass 3 done (installed).** Paraglider drawn in the entry (`j00entryr`, first 6 drawings; native scale-hide after frame 60) and Navi in the taunt (`j01appealsr`, all 12 drawings — Navi's show/hide frames are in game code we lack). Same renderer path as the bow; pack/schema/floor/determinism pass; 3 files installed, all 222 installed files match staging sha256.
- **B7 final done.** Input tests (gamepad walk unbound by design; shield+special is the shift modifier), legacy-Link
  serializer/geometry/collision tests retargeted to the fresh data (+ a synthetic `chargedBowFixture.ts`), healing,
  DK freshness, cues, catalog, cursor, factory fixed. Source fixes: smash-binding vote ignores `walk`;
  `AttackCollisionHit.unblockable`; `pikachuPresentation` crash guard (Final FX strips have no root). Deleted 13 dead
  Link proof tools; `link-playable-probe.mjs` updated to `getPackedBodyState()`. Handed to B3: 12 Character.*
  failures, LINK_TAUNTS single source, dead legacy RemoteBomb path, pikachuSurfaceTech test after the shared tech refactor.
- **B4 diagnosis done** (`docs/review/2026-10-15/b4-diagnosis.md`, `src/items/linkHeldItems.physics.test.ts` 72/81,
  9 red by design; screenshots `docs/review/2026-10-15/b4/`). Link uses items like DK almost everywhere. The Bat
  "0 contacts" was the probe's 110 px spacing (the bat reaches 64 px — same for DK). Real issues: the Ray Gun/Scope
  are drawn in Link's right hand behind him (sockets all taken from HaveR; shooting poses use the left hand); Link's
  own Ray Gun 25-frame admission rule (separate from the shared session); shots start at a fixed body offset, not the
  drawn muzzle (all fighters). B4 phase B part 1 started (profile move, muzzle helper, per-clip hand, probe).
- **B4 part 1 done.** Link item profile moved into `FIGHTER_ITEM_PROFILES` (`linkItemProfile.ts` deleted); shared `heldItemMuzzle()` helper; shooting/scope clips now take the socket from the left hand (native pose evidence: the right hand keeps the Master Sword) → Ray Gun in his front hand, barrel forward (re-pack only, installed, sha-checked); probe uses the bat's real reach (80 px → 1 hit). Tests 74/81; part 2 (shots from the drawn muzzle for all fighters, delete Link Ray admission rule, shared heavy-item profile) waits for B3.
- **B3 part 2 done (09:45).** Link runtime revision collapsed (36 branches, field removed); 24 files / ~2,600 lines
  deleted (unreachable Link receivers, prone food, passive-shield SDI, legacy remote bomb); new shared modules
  `groundRecovery.ts`, `surfaceTech.ts` + profiles, `shieldBreak.ts` (~320 lines) for all 3 fighters; Link passive
  shield = one capsule per state; every fighter can be footstooled. Parity test 50/50; 99 Link/DK/Pikachu/Character
  files (2,006 tests) green; tsc 29 → 5. **DK/Pikachu behaviour changes** (goldens re-record): DK ledge jump clears
  the corner; trips intangible 1–5 and trip stand 21/16; shield break = pop → land → stun → 33 f wake; Pikachu tech
  window 11/40 and gains wall-jump tech. My call on the open question: pre-rebuild Link Lab saves stay dropped (user
  decision 2026-10-13) via a write-only format marker → small cleanup agent. B4 part 2 started.
- **Cleanup done: `tsc --noEmit` = 0 errors** (first time). Write-only `linkFormat` marker on saved Link specs and replay slots keeps pre-rebuild Link saves/replays dropped (`persistedFormatMarker.ts`); dead Final Smash fields removed. CLAUDE.md: Link no longer described as masked.
- **B4 part 2 done.** Every fighter's item shots now leave from the drawn muzzle; Link's own Ray Gun admission rule
  deleted; one per-fighter heavy-item table (`FIGHTER_HEAVY_ITEM_PROFILES`) replaces 3 copies (Link now drops heavy
  items when airborne, like Pikachu). linkHeldItems 81/81, item suites 569/569.
- **Combined check #2 (~10:00): `npm run build` PASSES (tsc 0 + vite, 1 min 6 s). Full vitest 12,847 / 12,854**
  (7 failures: shared shield-break stun reads 0 [real regression from B3], 2 referenceAutolink, Link jab chain) →
  final-fix agent, also re-deriving the Spin/bow/bomb specials probe expectations from UFD/SmashWiki. Browser smoke
  (simulated, hard AI): 3 matchups fight, 0 page errors, Link drawn.
- **Port step 5 part 1 done (~10:40).** One recorded-input contract (CPU always sampled, recorded input wins); one
  golden digest = `simDigest(captureMatchHistoryEvidence())` (old `buildSimRecord`/`canonicalJson` deleted);
  `Character.ts` is Phaser-free (PhysicsHost; 37 casts + HitboxScene gone); MatchScene runs on its own vendored
  Matter world (Phaser engine-clear/autoUpdate/setBounds deleted). Browser smoke on the new build: all 3 matchups'
  damage at frames 120/400/900/1800 **identical** to before the swap. All old goldens are void (schema change).
  → Step 5 part 2 (5.4 stage bodies vs render, 5.5 visuals out of the step, 5.6 `src/sim/MatchSim.ts`) started.
- **Final fixes done (10:45). All planned Link packages are now complete.** Two game fixes: Link's jab/fsmash chain
  steps were one frame late (now jab hits 7-8 / 14-15 / 22-23, SmashWiki "quickest loop"); grounded 367 hits now report
  their real 80° angle (SmashWiki Autolink_angle). Shield-break, Spin, bow, bomb were correct — stale tests/probes
  (shield-break stun applies after pop+land per SmashWiki Shield/Stun; probes now include the 1v1 ×1.2). Probes:
  link-specials-parity 22/22, link-bomb-charge PASS. tsc 0. Open: item throw pressed during the 7-frame pickup is
  dropped not buffered; DK's three 366 rows treated as 80° on the ground; a likely-dead old shield-break stun path.
- **Goldens (10:50), frozen build index-D7YjsyBX on :4300:** `link-dk` recorded and verifies **IDENTICAL**. All
  item scenarios fail to record: `Opaque engine object in match evidence container` (a Phaser object in item sim
  state — the new single digest is strict). Handed to step 5 part 2 (5.5 moves visuals out of the step); goldens get
  recorded after it, and link-dk must stay IDENTICAL across the refactor.

## PAUSED by the user (11:05, 2026-10-15)
- Step 5 part 2 agent stopped mid-task (it had finished 5.4 and built index-Bs1aXe7a at 11:01; it was fixing the
  AST-extract tests' fakes for 5.5/5.6). Source tree: **8 tsc errors, all in `src/scenes/MatchScene.ts`** (half-done
  5.5/5.6 edits) → `npm run build` fails until finished or reverted.
- **Playable:** the served build on :4173 (index-Bs1aXe7a, 11:01, includes 5.4) — smoke: DK–Pikachu, Link–DK,
  Link–Pikachu play with 0 page errors and damage identical to every earlier run. Frozen pre-5.4 build on :4300.
- Resume: finish 5.5/5.6 from the step-5-part-2 brief (fix the 8 MatchScene errors first), then record the goldens
  (item scenarios blocked on "Opaque engine object in match evidence container"; link-dk recorded, IDENTICAL).
- Open user questions: commit checkpoint (nothing committed, ~1,800 files); bomb/sword-beam art; cleanup list.


## RESUMED in Codex (2026-10-15, afternoon)

The user authorized finishing the paused step 5, then explicitly expanded this
into taking over all remaining work. They explicitly requested agents and chose
procedural code art first for the Remote Bomb and sword beam.

- Recovered the eight interrupted MatchScene errors. `npm run build` passed
  (`index-BhZkdx1t.js`), then completed the render-handle separation: ordinary
  projectiles carry a plain display transform, thrown items and explosion damage
  records contain no renderer handles, and `ItemEntity.attachedRender` is gone.
  Live drawings are reconciled from ids/state in the render callback. Build and
  typecheck passed (`index-CoE_sk-F.js`).
- Recovered nine full baseline recordings from frozen pre-5.4 `index-D7YjsyBX.js`
  on :4300. The baseline reader omits only accidentally embedded thrown-item
  containers and explicitly encodes the intentionally infinite item speed caps.
  The canonical production evidence reader now supports those same speed caps;
  corrupt nonfinite geometry is still rejected. Every scenario has zero page
  errors and the full requested frame count. Recordings and the frozen-reader
  adapter are retained under `takeover/` and `.tmp/takeover-2026-10-15/`.
- **5.4/5.5 comparison: 9/9 full scenarios IDENTICAL**, including 2,400-frame
  four-player items and 3,600-frame Final Smash. Log:
  `.tmp/takeover-2026-10-15/verify-all-visuals.log`. Three AI matchups also play
  with zero page/console errors; inspected Link/Pikachu screenshot under
  `takeover/smoke-visuals/`. Warmup/144 Hz and Node parity are still pending.
- Recovery full suite: 12,842 pass / 6 fail, in 580 files. Failures were two
  AST fixture hosts missing the new SimEventQueue. Fixture fixes are in progress;
  a focused rerun found only two obsolete immediate-render-cleanup expectations,
  now removed (entity retirement/ownership/flight assertions remain).
- Agent `matchsim` owns new `src/sim/MatchSim.ts`, headless runner and view.
  First 60 Link-DK Node hashes match the browser; a full comparison exposed
  Node22 vs default Chromium148 libm trig arithmetic at the last bit, rather
  than a physics difference. An explicit Node host compatibility adapter is
  being prepared. The browser simulation and evidence must not be rounded.
  Since the user requested the entire port, the temporary duplicated Phaser
  host will be deleted at step 9 after Node/Three acceptance, rather than rebuilt
  as a throwaway delegation layer.
- Agent `port_live` owns real Three.js match/input/pause/results integration and
  procedural article art (`src/fx/proceduralLinkArticles.ts`).
- Agent `pikachu_final` found a genuine unfinished package: the installed
  DK/Pikachu banks have no Final owner body clips or cinematic victim profiles;
  the production contact resolver requires those profiles. Prior phase logic
  does not establish a functional damaging Final. The older WORK_HANDOFF also
  explicitly records these as never installed. The user was told and the earlier
  optimistic provisional answer was corrected. Reconstructing Pikachu Final
  owner art (187 selected native samples), geometry, profiles and actual runtime
  acceptance. Root is producing owner drawings with
  `tools/render-pikachu-final-art.py`; the agent exports independent guarded
  native geometry. Custom CPU toon palette/light/ink, helper omission for art
  only, actor source ROOT and no per-pose floor snapping are explicit.
- Matter types vendored to `src/physics/matter/types.d.ts`; renderer gameObject
  references become unknown. Package removal and source/test import rewiring
  remain pending. Old 17.7 GB cleanup list is stale and must not delete current
  regeneration sources, frozen comparators or active evidence.
- No git commit, push, publishing or cleanup deletion has been performed by
  this takeover. Existing uncommitted work remains in place.

### Headless gate and live cutover (afternoon continuation)

- All nine complete frozen-browser recordings also replayed IDENTICAL in the
  renderer-free Node MatchSim: 18,600 frames. The explicit Node math adapter
  vendors the pinned Chromium V8 glibc trig implementation (license retained);
  the browser math, physics and evidence are neither rounded nor substituted.
  See `takeover/headless/` and `.tmp/matchsim-node-goldens-pinned.log`.
- A same-process check exposed Link's raw `previousSupportBodyId` in canonical
  evidence. Normalize that field against the match body-id base while keeping
  the frozen first-match numeric representation. The focused same-process
  replay checks pass. Actual match state was already correct.
- MatchSim now preserves fractional clock residue through menu pause/resume
  and single-step. The checkpoint tests cover the residue and restored state.
  Pure import-graph/view/read/headless and retained physics checks: 304 tests
  pass in 13 files. Full warmup-600 / 144 Hz checks are running separately.
- The digest's FNV-1a 64 implementation now uses two exact 32-bit words. Its
  bytes and 16-character checksum are unchanged; independent BigInt reference
  tests cover arbitrary UTF-16 code units and a long Unicode evidence payload.
- The Three live-host qualification passes 20 checks with zero page errors:
  real keyboard/gamepad movement and attacks; pause; saved Attack=K controls
  driving the same match; byte-exact checkpoint reconstruction; real Link
  down-special bomb and full-health forward-smash beam; CPU matches on all six
  stages; ordinary time-limit results from actual stats. Evidence:
  `takeover/port-live/report.json`. Root inspected the bomb/beam screenshots.
  A full 1,800-frame Three browser Link/Pikachu item replay is IDENTICAL to
  frozen Phaser. Root entry/build cutover and Phaser removal are underway.
- Pikachu's 187 owner drawings and all 36 new cinematic recipient drawings
  have been visually inspected. New recipient art is explicitly authored
  cinematic art with paired receiving geometry and capture anchors, not a
  claimed native victim-dispatcher reconstruction. The guarded additive owner
  and recipient installs are recorded under `pikachu-final/`. Runtime
  qualification and source-supported miss/cliff corrections are in progress.
- The old 17,692 MiB cleanup list still contains all 111,572 original paths;
  it is not safe to execute wholesale now. It includes native/review material
  used by the character work. No cleanup deletion has been run.

### Combined port and Final completion gate

- Warmup/144 Hz completion: all 18 extended variants passed, adding 37,200
  exact frames to the original 18,600. Durable evidence is in
  `takeover/headless/extended-node-goldens.jsonl`.
- Root now builds/previews the actual Three.js/HTML game on :4173. Phaser
  dependency/imports and retired editor/render glue were removed. Retained
  gameplay tests now use vendored Matter. Historical probes have an explicit
  archive/replacement map. `takeover/THREE-CUTOVER.md` records the cutover.
- Actual side-by-side replay view checks: 18/18 hashes match at frames
  120/400/900 across Link/DK, Link/Pikachu with items and four-player items.
  Screenshots and the report are under `takeover/visual-parity/`. Stage/HUD art
  intentionally differs; fighter poses and gameplay match.
- All seven Pikachu owner sheets now resolve in the actual renderer. The
  previous fixed registry silently retained idle/fall despite valid contact
  geometry; this was caught by browser pixel/texture qualification and fixed.
  Eight arranged real-key hit/miss cases pass with all owner/recipient art
  visible. Source-supported miss kinetics, motion rate, air gravity and
  grounded cliff policy are bound. Source hitlag flags have focused tests.
- Six missing DK owner clips are now installed: 346 new CPU toon drawings,
  native outgoing packets, reviewed authored receiving, source-root travel
  and explicit authored punch pockets. All 346 body/overlay pairs were
  visually reviewed and the exact manifest SHA pins the guarded additive
  install. Twelve Jungle recipient profiles add 36 reviewed drawings.
- The real DK browser probe exposed one-tick victim fitting after a reaction
  pose switch. Corrected by fitting the new pose immediately. Post-fix: all
  16 browser cases pass; 3,332 owner draw checks and 1,656 current-Hip/pocket
  checks pass (maximum error 2.27e-13). See `dk-final/runtime-acceptance.json`.
- Link Final owner selection now uses its actual retained d04final/air clips
  with an explicit raw-age/one-based-frame boundary. Ancient Arrow remains
  the real article/combat route; it is not relabeled as new ROOT geometry.
- Genuine whole-history Pikachu checkpoint: passive meter earned at frame
  30,060; recorded special captures; checkpoint at 30,127 reconstructs exact
  whole-world evidence and all 281 continuation hashes through release.
  This exposed/fixed frame-zero recorded-position generation synchronization
  with the Final controller. No resource/contact injection qualifies this test.
- Full suite before the last DK fit-order fix: 548 files / 12,027 tests pass.
  Post-fix focused suites: 52/52 pass. Corrected production build:
  `game-BYOl1XlT.js`, simulation identity
  `platform-fighter-sha256-aedf4dbb82fd1923b83d2bf316a65c22b6839b12d4d82d604606e4f15282af86`.
  Strict typecheck/layers, build and static copy of 723 runtime files pass.
  Final broader browser/replay/full-suite checks are running on that build.
- Build identity now includes actual vendored Matter JavaScript and the Three
  host source, while excluding test/check files. The Node runner derives that
  identity instead of using an unversioned placeholder. Six identity tests pass.
- The user-requested agent policy is now explicit in `AGENTS.md`. Removed the
  broken local Stop-hook reference to missing `git-autocommit.sh`; the existing
  sprite hook remains disabled by its existing autonomous=false setting.
- Cleanup remains a dry run. A narrow 1.23 GiB exact-duplicate scratch-build
  plan with retained originals is under `takeover/cleanup/`; deletion awaits
  the user's cleanup choice. No commit, push or publishing has been performed.

### Final takeover qualification

- The corrected source passes the complete suite again: 548 files / 12,027
  tests in 108.75 seconds. Durable full output is `takeover/final-tests.txt`;
  strict typecheck/layers/build and the 723-file runtime static copy are in
  `takeover/final-build.txt`. No application source changed after this gate.
- The final-source replay matrix passes all 11 checks / 36,600 exact frames:
  eight ordinary frozen scenarios plus a new 7,200-frame current Final
  recording at normal timing, after 600-frame warmup and at 144 Hz. Evidence:
  `takeover/headless/final-replay-matrix.jsonl`. The longer browser recording
  contains three actual Final activations and no page errors; sampled canonical
  evidence shows Pikachu starting at frame 3,903 and finishing at 4,200.
- Coverage correction: both old and current 3,600-frame Final-enabled recordings
  stop before any activation (controller sequence zero). They qualify meter/ball
  state, not Final choreography. The old frozen extraction gate remains 55,800
  identical comparisons; actual repaired Finals have separate production and
  browser evidence, and current browser/Node hashes now match through activation.
- Corrected browser acceptance is green on `game-BYOl1XlT.js`: 24 live-host
  checks, actual audio (600 frames / 39 starts / one music loop), all six arenas,
  Pikachu's eight routes plus two additional recipient cases, DK's 16 routes
  and Link's eight routes. Their reports record no page errors.
- The full menu journey passes and preserves the genuine UI-launched roster,
  rules and canonical result: one-stock Lava match, DK winner, stocks [1,0,0],
  both rivals lost through actual boundary falls. Saved controls and phone
  overflow checks also pass. `takeover/final-menus/report.json` retains the
  result, build identity and journey. Root inspected the actual result screenshot.
- Final independent source identity and HTTP checks agree: current :4173 serves
  BYOl/aedf4dbb; frozen :4300 still serves index-D7YjsyBX with HTTP 200.
- The duplicate cleanup dry run was refreshed after the final art installs:
  7,897 identical scratch-build copies / 1,324,197,432 bytes. No cleanup deletion
  occurred. The old 17.7 GB plan remains unexecuted and user choice is pending.
- `takeover/README.md` and `takeover/qualification.json` are the current outcome
  and evidence index. Implementation and automated gates are complete. Human
  controller/visual acceptance and exact native engine parity are not claimed.
  Work remains local and uncommitted; nothing was pushed or published.

### Reopened after user play: repair candidate in qualification

The blanket completion statement above is superseded by
`../user-bugs/PLAN-AUDIT.md`. User play exposed returning controller ownership,
unusable Y controls, cursor/palette conflicts, missing Link routes, Inferno
presentation, intro/Final motion and freeze/performance defects. The current
repair status and exact-candidate evidence are indexed by
`../user-bugs/README.md`; acceptance is not closed.

- The user's independent pre-repair snapshot is served on **4301** from
  `.tmp/pre-user-bugs-2026-10-15/platform-fighter/`. Keep its copied assets and
  Python server intact. It serves BYOl/aedf4dbb even when the main build changes.
- Main **4173** now serves `game-rdv3pg8d.js`, source identity
  `platform-fighter-sha256-b242558db2524371b13e21af73a9b1032a7f783d9ced183983d1bcb25b5a72f9`.
  Strict type/layers, production/static build and **554 files / 12,062 tests**
  pass. Production menu, default-meter/item/scenic visuals, eight recovery
  cases and last-stock Inferno flight reports are recorded separately.
- Stress completed 15,126 frames and 16 Finals without an unrecovered fault,
  but exposed long timing spikes. Do not equate liveness with smooth playback.
  Targeted phase timing and natural-RAF launch checks remain active work.
- The user explicitly approved lossless DK/Pikachu packing. It preserves all
  2,495 logical drawings, visible pixels, anchors and timing, and reduces their
  combined decoded sheets to 876.60 MiB. Nearest-filter GPU comparison is exact;
  linear-filter raster edges have bounded differences, documented separately.
  Approval does not extend to thinning/rescaling/lossy compression or settle a
  general roster memory budget. Both prior memory-policy files record it.
- The art-budget audit found the previously approved Link KTX2 runtime path
  unfinished. New Link-only pilot tools exist; the first quality-2 idle pilot
  fails the visual gate. Runtime is still PNG/ImageBitmap. See MEMORY-AUDIT.md;
  do not claim that installing the encoder implemented GPU compression.
- Three agents remain assigned: matchsim for fault/performance/intro/KO,
  pikachu_final for Link/art/packing and final drawing evidence, port_live for
  menus and the separate Link-only KTX pilot. Heavy jobs serialize on
  `.tmp/dk-heavy.lock`. No commit/push/cleanup deletion has occurred.

### PAUSED — user restarting the reference PC, 2026-10-15 ~18:05 Brussels

The user explicitly requested pausing all work. All diagnostics and queued heavy
jobs are stopped; no agent is to continue without a user resume. Work is saved,
uncommitted. Current source/build is B95Fcp5p / 74c2fec…0101, not the earlier rdv
candidate mentioned above. Current PC is confirmed as the reference machine.

Read **[the complete pause/resume notes](../user-bugs/PAUSED.md)** first. They
include exact current identity, passed checks, real RTX versus SwiftShader
findings, the unresolved first-use gap, approval boundaries and restart commands
for both repaired4173 and independent pre-fix4301. The next same-browser second
Final activation control was NOT started; no application optimization was made
after the last production gate. Overall plan acceptance remains open.

### Continued — 2026-10-16 loading-time shader preparation

The latest user “continue” resumed the Edge first-use shader investigation.
The earlier Edge profile located a 30 ms native `getProgramInfoLog` call in
Link Final's first shooting callback. The coordinator completed the saved
effect-material preparation, added fault-time cancellation and integrated the
match readiness gate. A read-only specialist reviewed installed Three r170
semantics and lifecycle ownership; another specialist owns the dedicated
pending-compilation browser acceptance tool. Heavy jobs continue to serialize
with `.tmp/dk-heavy.lock`.

Current preview serves **game-CICNsKxD.js / 65ef0281…87aa**. All 557 files /
12,075 tests, type/layer checks, build and standalone 723-asset copy pass.
The exact candidate passes the eight existing production recovery scenarios.
Two actual Windows Edge Finals reuse the effect program prepared during
loading, with no first-use query during activation and no missing owner draws.
First age61 host callback is 7.5 ms versus 35.5 ms in the previous profile;
separate launches and persistent driver caches prevent treating that difference
alone as controlled performance attribution.

The [new record](../../2026-10-16/shader-preparation/README.md) contains current
scope, receipts and limitations; earlier B95 reports remain historical rather
than being relabeled. The existing texture preparation cap, art and simulation
data are unchanged. Pre-repair server 4301 stays stopped. No commit, push,
cleanup deletion or broader compression/policy change occurred. Original freeze
trigger, human acceptance and the separate Link KTX2 decision remain open.
