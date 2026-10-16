# Archived pause checkpoint — resumed and completed 2026-10-06

The user resumed this task with "continue". Final acceptance and evidence
reconciliation are complete in [README.md](README.md): 138 source comparisons,
479 tests, 94 attack/contact scenarios, 56 launch scenarios, real keyboard
routes and Character Lab save/reload/match reconstruction pass. The text below
preserves the original reboot checkpoint and does not describe current status.

User must reboot; stop all task work until they resume. The full DK attack-data correction is implemented but final acceptance and evidence reconciliation are unfinished. Do not claim finished or exact Ultimate physics parity.

## Completed

- add-character skill now defaults to UFD unless explicitly overridden; exhaustive numeric parity gate added. Skill validator previously passed.
- All DK normal/aerial/angled/special/partial/full/ground/air regions overlaid from pinned primary raw scripts. 125 attack-region records, 7 released normal/cargo throws, 6 standing/dash/pivot grab regions.
- Independent `npx tsx tools/dk-attack-data-audit.ts` passed: 42 motions, 138 comparisons, 29 timing comparisons, no mismatches, complete saved-data round trip. Report: comparison.json. Fresh UFD page and 42 parsed rows captured in sources; rerun audit once after reboot against fresh rows (last completed audit used identical earlier timing capture).
- Charge entry7/cancel4/full111, integer partial damage; ground/aerial full variants and armour; Headbutt shield bonus25; ground spin rear3.5 and all masks; aerial spin per-region data; native pummel startup/hitstop; normal/cargo throw routing/recovery; recovery attack records.
- Exact root-bone grab capsules and target ground/air masks integrated through grab schema, serializer, runtime.
- Flat first stage already widened800→1180, blast width2780; geometry is project calibration, not native Battlefield parity.
- Latest Vite production build passed: dist/assets/index-CQB-RR2I.js (357 modules, 3m18s), code-only rebuild preserves public assets. Previous tsc passed before final grab fields; final tsc log empty and process not listed at pause, so confirm exit/rerun.

## Resume here

1. Read add-character skill, relevant source/integration references, and this checkpoint; preserve entire existing dirty/untracked working tree. No reset/clean. User authorized completion without confirmation.
2. Finish public runtime asset copy into dist. A cancelled full build emptied dist and copied only early public directories. Restored sprites and stage tile_0010; last task-specific copy covered sprites/stages/generated/audio/characters/palettes but was interrupted at pause. Do NOT recursively copy assets/gen (huge ignored source files). Prefer importing src/assets/manifest.ts with tsx and copying getAllAssetEntries paths plus palette variants, or selectively copy runtime dirs. Correct fallback-HTML missing assets before browser acceptance. Production preview needs restarting: npm run preview -- --host127.0.0.1 --port4176 (correct spacing), URL http://127.0.0.1:4176/platform-fighter/.
3. Run final typecheck and affected verification. Last final10-file Vitest run interrupted: characterSerializer81 and DonkeyKong46 passed; remaining not yet reported. Command/log preserved dk-verified-final-tests.log. Earlier broad29files774tests had5 failures: 3 obsolete assertions now corrected (mask generator bug, accepting366, charge-entry uncharged test), 2 Link jab serializer failures explicitly documented as pre-existing in September25 canonical DK README. Isolated Link check confirms unchanged expected0 vs actual1 due existing input buffer; do not conflate those with DK changes or alter unrelated behavior. New16 DK actual-physics tests previously passed before grab additions; expanded raw count now138/42.
4. Run tools/dk-all-moves-acceptance.mjs. Latest file now94 scenarios (41 attack family cases +6 grab variants, both facings). Initial failed diagnostic82 report is still present; do not cite it as successful. Fixture previously tried ground attacks only3steps after landing → rejected by landing recovery; now12steps. Air uair/dair/spin/slap fixture spacing30. Browser timeout raised90s. Requires all source routes/contacts, exact throw percent, shield bonus, six grab ground/air/standing/dash/pivot routes. New variants were added while preceding82 run was in progress, so rerun94 on latest index-CQB-RR2I.js. Potential setup failures: overlapping air victims separate before active frames; target-air grab at30px altitude may land before grab hits. Adjust initial fixture positions, not source values. Save successful report/build hash/screenshot; view screenshot.
5. Run tools/dk-lab-acceptance.mjs. Previous attempt could not see DK because roster paginated; file now uses real pointer roster-page-next up to3pages, then selects DONKEY KONG. Save tune through SAVE TUNE, assert full moves23 slots incl grab and all nested data, TEST FIGHT equals canonical kit, Escape/L Return to Lab. Interrupted current run has empty log. Default output dk-all-attack-values/lab. Browser isolated localStorage.
6. Run keyboard probes against same bundle: PF_PROBE_OUT=docs/review/2026-10-06/dk-all-attack-values/keyboard/donkeykong node tools/dk-balance-input-acceptance.mjs donkeykong (and cat). These use real F/G events,120heldframes, actual contact/full35/73. Interrupted logs empty.
7. Optional useful latest launch-growth proof: tools/dk-knockback-acceptance.mjs supports PF_ALL_GROUNDED=1 (14moves), PF_TARGETS=donkeykong, PF_PERCENTS=0,150, PF_FACINGS=1,-1, floor1180. First update its full-charge prep112→120 to account entry7. Earlier historical 96scenarios412checks already verify growth at0/100/150/200 sixmoves, but latest data should be covered.
8. Write README.md for this evidence folder, reconcile September25 README and earlier dk-balance README (link superseding full numeric correction); OPEN-ISSUES already has October6 note. Include exact checks, hashes, known source discrepancies and limits. Final concise response only after authorized correction and verification actually done.

## Source/physics distinctions to retain

- UFD grounded spin links1.3 vs pinned script1.4: UFD wins, raw difference retained in comparison rows. UFD forward tilt total34 vs native motion cancel36 also follows UFD.
- Partial punch UFD62 includes entry7 + release55; full47. getup45/trip49/ledge55 independently confirmed cancel_frame46/50/56 in pinned motion-list.yml; no GIF-count inference required.
- Aerial spin UFD total unknown: runtime commitment63 and sustained rise/motion conversion remain documented project calibration. Per-region values and published windows copied.
- 366 now preserved and explicitly fallback80 instead of wrapping to6; exact native366 transport still unimplemented. 367 transport, native bury, per-bone intangibility/clang and full3D animated geometry remain engine/visual differences. Do not promise identical Smash behavior from numeric agreement. Existing art accepted as-is by user in historical session; this request is attack numeric data, not art regeneration.
- Legacy tools/gen-donkeykong-kit.py now prevents overwriting audited canonical DK; use tools/gen-donkeykong-attack-data.py with verified raw hashes to regenerate125regions.
