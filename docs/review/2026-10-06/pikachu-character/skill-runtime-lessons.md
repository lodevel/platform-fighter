# Runtime lessons promoted during continuation

These additions apply to the relevant runtime, not to a particular image model
or LoRA. Original observed quantities remain scoped to their recorded builds.

## WebGL atlas upload and padded frames

- Failure: linear sheets above the measured WebGL8192 texture limit displayed
  black bodies despite valid PNGs, keys, frames and successful numeric contacts.
- Change: row-major atlases below the project's4096 packing ceiling, unchanged
  per-cell RGBA/root/order; Phaser endFrame excludes padded final-row cells.
- Outcome: integration actually inspected26 first/last GPU samples and30 legal
  normal contact screenshots on immutable B6QSxu9C. All25sheets/277cell extraction
  and declared counts passed; art's independent cell-hash/layout review passed.
- Evidence: [texture observations](integration/textures/texture-match-observations.json),
  [runtime visual review](integration/textures/visual-review.json),
  [unchanged-cell/layout review](art/texture-atlas-repack/visual-review.json).
- Promotion: `references/comfyui-generation.md`, packing step. The observed8192
  limit is not a universal GPU guarantee; inspect the actual running renderer.

## Moving sensor root and overlapping receiving states

- Quick Attack actual sprite/current receiving matched but its attack sensor
  lagged55px. Source-opt-in owner-root/reanchoring and narrow real8x8 receivers
  separated current hits from stale-position false hits in both facings.
- Evidence: [Quick observations](integration/quick-bodies-contact-fixed/quick-kinetic-match-observations.json),
  [actual reviewed bodies](integration/quick-bodies-contact-fixed/visual-review.json).
- Tumble actual body selected correctly while a fall receiving shortcut won.
  The unified selector correction passed its fresh production check; that run
  exposed an independent postzero landing-origin bug. The corrected incoming
  sign now passes8 actual reaction cases/40 inspected captures on iCJVgD04.
  Late tumble tail/floor overlap remains a separate failed visual check.
- Fresh evidence: [reaction observations](integration/reaction-origins-qualified/reaction-body-match-observations.json),
  [actual visual review](integration/reaction-origins-qualified/visual-review.json).
- Promotion: `references/integration-verification.md`, current-versus-stale
  physical contact and visible-body/receiving selection agreement.

## Explicit live progress and stale action scope

- Status prose mixed missing routes, source fidelity limits and historical
  failures; parsing it would have produced misleading completion counters.
  Actual dashboard review also found stale backthrow transport and an unrelated
  grounded jump failure copied into the airjump row.
- Change: canonical per-row implementation/visual/runtime flags, explicit
  completion and required gaps, with source fidelity limits separate. The live
  view reads those flags without inferring readiness from wording or art counts.
- Outcome:6 functional browser cases pass, including simulated automatic-update
  and503 retention cases; actual desktop/mobile review passes and the two stale
  scope statements are corrected. This does not independently qualify every
  action or estimate remaining development time.
- Evidence: [functional acceptance](motion-gallery/live-progress/acceptance.json),
  [actual visual review](motion-gallery/live-progress/visual-review.json).
- Scope/promotion: local character evidence consumers;
  `references/specialists-feedback.md`, live-progress checkpoint maintenance.

## Published captive-state mechanics before native common gaps

- [Captured Grab/Grab release revisions](sources/grab-common-wiki/captures.json)
  provide entry-percent duration, mash reductions, postrelease grab protection
  and Ultimate release-lag data absent from the earlier acquisition inventory.
- Minimum-duration/mash frequency semantics, release trajectory and disputed
  simultaneous-grab damage remain unresolved; acquisition is not implementation.
- Scope/promotion: source-research procedure only, selected-game semantics;
  `references/ufd-smashwiki.md`, captive states and published mechanic coverage.

No promotion changes source fidelity, image-provider qualification or fighter
completion status. All applicable rows still need their actual acceptance.


2026-10-08 preview first-sprite regression (observed): workspace recompilation reused preview constants512×384/root288 after the registered idle strip changed to512×512/root416. Texture readiness and frame-step assertions passed while the neutral body appeared below the movement box. Preview loaders and texture switches now consume shared per-sheet render metrics. Twenty-eight both-facing idle/attack browser cases pass, the before/after Canvas montage is actually inspected, and the jab contact image is pixel-identical. Evidence: `integration/preview-registration/after-observations.json`. Applies to these packed Phaser Canvas previews; verify the ready/reset body as well as attack poses when restoring a compiled preview. Existing root-registration skill requirements already cover this; no new universal generation rule is needed.

- October 8 preview availability (observed): a playable special was absent from the gallery even though its app runtime was qualified. The live gallery now copies the verified application bundle and assets byte-for-byte into a same-origin subtree and exposes the real MatchScene through preview-controlled inputs. Thunder cloud/bolt/conditional burst, all four special starts, all three smash selectors, pause/reset/frame controls and idle registration are checked in `integration/specials-gallery/observations.json`. Switching special menu entries reuses the loaded game. Inspect the canvas after scrolling an embedded preview into view; offscreen frames can retain stale paint despite correct simulation state. Preview input is simulated and does not qualify hardware bindings or upgrade canonical fighter completion.

- October 8 missing charge preview (observed): the newly exposed legacy smash viewer had C/R controls but loaded only idle and released-smash strips, using a Donkey Kong presentation alias on a Wolf fixture. It could advance charge power while showing startup art. The current menu now runs the exact app MatchScene with its charge body/receiving/effects; Hold charge autoplays and Release plays the strike. Synthetic smash input must feed `InputResolver.getSmash().buttonHeld`, which the normal input builder consumes; overriding only `isActionHeld` does not start a smash. Six both-facing charge/contact scenarios and browser C/R/button controls pass; images were inspected. Camera smoothing is render-time behavior and can continue while the action clock is paused, so pause checks compare simulation/body state separately. An extended Quick Attack check beyond the previously checked60 steps found an existing finite end-pose gap; preserve that failure and keep the end qualification partial rather than enlarging the art clock.

October 8 Quick END touchdown: Phaser/Matter may report the new grounded situation after physics before the next Character input commits landing. For Pikachu SpecialHiEnd, the pinned main_loop selects its entered motion kind; latch that END situation and share it between body drawing and receiving selection. Dynamic grounded-sheet selection grafted local aerial frame49 into a ground clip ending33 and crashed the preview. The corrected production bundle retains the aerial clip through touchdown, then uses the existing24-step special landing clock. Evidence: integration/touchdown-thunder/observations.json and gallery-observations.json. Scope: Pikachu Quick END and this fixed-step observation boundary; native common groundSTOP remains unqualified.

October 8 detached Thunder overlay: in the Phaser/Matter MatchScene, collecting only Character.activeAttack.hitboxBody omitted damaging detached Thunder/Jolt sensors. The shared overlay now collects live hitbox.attack bodies from the world, recovers article origins from plugin hitbox offsets/facing, and uses live owner origins for owner-anchored contacts. Exact collisionHits capsules are rendered instead of broadphase rectangles. Four real-checkbox both-facing ground/air-start cases,12 inspected screenshots and contact regressions pass on index-LsB5K_Tf.js; see integration/thunder-overlay/observations.json. Scope: live Matter attack sensors; decorative FX do not define damage, and non-sensor projectile systems are separate.
