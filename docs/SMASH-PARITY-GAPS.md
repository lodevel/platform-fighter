# Smash Parity Gaps

> Reconstructed, code-verified audit of where this engine deviates from canonical
> Super Smash Bros. mechanics. Every gap below was confirmed by reading the
> actual source in `src/` — speculative gaps are omitted. Citations are
> `file:line` against the tree at the time of writing.

**Scope of this pass:** ledge mechanics, DI/SDI, shield / out-of-shield, hitlag,
knockback/hitstun, staling, rage, dodge/roll, teching, L-cancel/auto-cancel,
recovery/movement tech, grab/throw.

**Severity scale**
- **P0 — exploit / breaks competitive integrity** (infinite, missing punish, soft-lock).
- **P1 — noticeable mechanical divergence** that changes matchup/feel.
- **P2 — minor tuning or missing-niche-mechanic** divergence.
- **P3 — cosmetic / out-of-scope-by-design.**

**Status legend:** ✅ already addressed in this branch · ⬜ open.

---

## Summary

| Domain | Gaps | Highest severity |
|---|---|---|
| Ledge mechanics | 7 | P0 |
| Knockback / hitstun | 5 | P1 |
| DI / SDI | 4 | P1 |
| Shield / out-of-shield | 6 | P1 |
| Dodge / roll / air-dodge | 4 | P1 |
| Teching | 3 | P1 |
| L-cancel / landing lag | 2 | P2 |
| Movement tech | 4 | P2 |
| Grab / throw | 2 | P2 |
| **Total** | **37** | — |

> This is the verified subset. A prior ephemeral audit claimed ~137 gaps across a
> wider net (per-character frame data, projectiles, items, stage hazards, online
> rollback). Those were not re-confirmable from the defensive/neutral systems in
> scope here and are intentionally excluded rather than asserted on faith.

---

## 1. Ledge mechanics

Source: `src/characters/ledgeHangState.ts`, integrated in `src/characters/Character.ts`
(`tickLedgeHang` at `Character.ts:2571`; invincibility composed at `Character.ts:6615`,
absorb path `Character.ts:6719`).

### L-1 — Ledge get-up climb had 0 i-frames ✅ FIXED — was P1
- **Smash:** the get-up climb startup is intangible; only the *tail* of the slow
  get-up is punishable.
- **Was:** `getupIframes: 0` (`LEDGE_HANG_DEFAULTS`), so the entire climb was
  hit-able from frame 0.
- **Fix shipped:** default `getupIframes: 12` — protects the climb startup, drains
  to 0 well before `climbFrames` (28) completes, leaving the tail vulnerable.
  Roster override `getupIframes: 0` restores the old behaviour.
  (`ledgeHangState.ts` `LEDGE_HANG_DEFAULTS.getupIframes`.)

### L-2 — Ledge intangibility never depleted on repeated regrabs ✅ FIXED — was P0
- **Smash:** ledge intangibility shrinks each time you regrab without touching the
  ground, eventually granting *no* intangibility — this is what kills infinite
  ledge-stalling.
- **Was:** every fresh grab armed the full `hangIframeFrames` (24) regardless of
  how many times the fighter had regrabbed since last landing → infinite stall.
- **Fix shipped:** new per-fighter `ledgeGrabsSinceGround` counter on
  `LedgeHangState`, incremented on each fresh latch and reset to 0 the moment the
  state machine sees a grounded tick (`airborne === false`) in the idle/cooldown
  branches. New tuning `regrabIframeThreshold: 2`, `regrabIframePenalty: 8`: grabs
  1–2 latch with full 24 i-frames, #3 → 16, #4 → 8, #5+ → 0.
  (`ledgeHangState.ts` idle branch / `resolveRelease`.)

### L-3 — Ledge grab granted i-frames from frame 0 (no 2-frame punish) ✅ FIXED — was P0
- **Smash:** a ledge grab is *vulnerable on its first 2 frames* — the classic
  "2-frame punish" where a well-timed spike/meteor catches the recovering player
  as they latch.
- **Was:** `isLedgeHangInvincible` returned true the instant the hang armed.
- **Fix shipped:** new `grabVulnerableRemaining` window (default
  `grabVulnerableFrames: 2`). `isLedgeHangInvincible` now returns false while the
  window is open even though i-frames are seeded; the hang i-frame budget only
  begins draining after the window closes (no i-frames burned on the vulnerable
  frames). The runtime's existing `applyHit` path lands the hit cleanly because
  the invincibility query reads false. New `isLedgeGrabVulnerable` query exposed
  for callers/tests. (`ledgeHangState.ts isLedgeHangInvincible`, hanging tick.)

### L-4 — No ledge-trump knock-off tuning is finalized — P2 ⬜
- **Smash:** trumping an occupied ledge launches the prior occupant on a defined
  trajectory; the trumped player gets a brief intangible "ledge-trump jump".
- **Code:** trump *detection* is correct (`resolveLedgeTrumps`,
  `ledgeHangState.ts`), but the knock-off magnitudes are explicitly placeholder
  (`Character.ts:7228` "Knock-off magnitudes are PLACEHOLDER tuning") and the
  trumped fighter gets no compensatory intangibility.
- **Fix sketch:** tune `LEDGE_TRUMP_KNOCKOFF_VX/VY` against real Smash trajectories
  and grant the trumped fighter a short i-frame burst.

### L-5 — No ledge-jump / get-up vary by stale "ledge time" — P2 ⬜
- **Smash:** ledge-getup options speed up below ~100% and slow down above it
  (the high-% slow get-up). Here `climbFrames` is a flat constant regardless of
  damage. (`ledgeHangState.ts` `climbFrames`.)
- **Fix sketch:** scale `climbFrames`/`rollFrames` by the fighter's percent at
  release time (thread percent into `LedgeHangInput`).

### L-6 — Tether-grab range / snap not modeled as a ledge concept — P3 ⬜
- The "tether" here is the post-release regrab cooldown only
  (`ledgeHangState.ts` header). Up-special tethers that *reach* a ledge from
  range are a separate `upSpecialSchema` concept; the two are not unified.
  Out of scope for this pass; noted for completeness.

### L-7 — No "ledge invincibility refresh on landing" was previously possible to abuse via force-release — P2 (mitigated) ⬜
- A force-release (hit/trump/max-hang) now correctly *preserves*
  `ledgeGrabsSinceGround` (only a real ground touch resets it), so a fighter can't
  launder away depletion by getting hit off the ledge and immediately regrabbing.
  Confirmed in the force-release branch. Listed as a watch-item if future edits
  add new exit paths.

---

## 2. Knockback / hitstun

Source: `src/characters/combat.ts`.

### K-1 — Non-canonical knockback formula — P1 ⬜
- **Smash:** `kb = (((p/10 + p·d/20)·(200/(w+100))·1.4 + 18)·s/100 + b)` with the
  hard 1.4 weight factor and base/scaling split.
- **Code:** `kb = base·(1 + scaling·percent·temper·(1+damageGrowth·d/20))·(BASELINE_MASS/mass)`
  with a *global* `KNOCKBACK_PERCENT_TEMPER = 0.06` damping term and
  `BASELINE_MASS = 12` ratio instead of `200/(w+100)·1.4`
  (`combat.ts:43` formula, `combat.ts:132` temper, `combat.ts:94` mass,
  `computeKnockback` `combat.ts:382-441`).
- **Impact:** kill percents drift from Smash; weight scaling curve differs.
- **Fix sketch:** if exact parity is wanted, port the canonical formula and drop
  the temper hack. (Note: this is an explicit design-calibration choice, not a bug.)

### K-2 — Hitstun multiplier is ~5× too high vs Smash — P1 ⬜
- **Smash:** hitstun ≈ `0.4 × knockback`.
- **Code:** `hitstun = clamp(round(magnitude × 2.0), 6, 120)`
  (`HITSTUN_FRAMES_PER_KNOCKBACK_UNIT = 2.0`, `combat.ts:140`, `computeHitstun`
  `combat.ts:477`). Combos/true-combo windows will not match Smash.
- **Fix sketch:** retune the multiplier toward the canonical 0.4 of the *Smash*
  knockback unit (requires K-1 alignment to be meaningful).

### K-3 — No hitstun-cancel / actionable-on-hitstun-end — P2 ⬜
- **Smash:** at low knockback you exit hitstun into actionable frames; aerial
  hitstun can be jumped/air-dodged out of after it drains.
- **Code:** hitstun is a hard lockout with no early-cancel; exit only via natural
  drain or tech/landing (`Character.ts:2013-2035`). This is broadly correct for
  Smash, but there is no "you can act the instant hitstun ends mid-air" nuance vs
  tumble — flagged as low priority.

### K-4 — Hitlag is bucketed, not linear — P2 ⬜
- **Smash:** `hitlag ≈ floor(1 + damage/3)` (roughly linear).
- **Code:** damage-tier buckets (4/8/12 frames) plus sweet-spot / high-% bonuses,
  capped at 18 (`computeHitlag` `combat.ts:523-539`). Feel differs slightly; the
  high-% crunch bonus is a non-canonical addition.

### K-5 — Crouch-cancel exists but no full-game-feel ASDI down — P2 ⬜
- Crouch-cancel knockback reduction is implemented at the canonical-ish 0.82
  (`CROUCH_KNOCKBACK_REDUCTION`, `Character.ts:6816-6831`), but it is not paired
  with ASDI-down, so the combined survival tech from Melee/64 is incomplete (see
  D-4).

---

## 3. DI / SDI

Source: `src/characters/combat.ts`, `src/characters/Character.ts`.

### DI-1 — DI rotates angle only; cannot reduce knockback magnitude — P1 ⬜
- **Smash:** DI both rotates the launch angle *and*, because it shifts the angle
  relative to the launch vector, effectively trades distance — and angled DI into
  the blast line vs away changes survival a lot.
- **Code:** `applyDIToLaunchAngle` rotates by up to `DI_MAX_ROTATION_DEGREES = 18`
  and *preserves magnitude* (`combat.ts:194`, `combat.ts:576-585`). Survival DI is
  weaker/different than Smash.
- **Fix sketch:** keep magnitude but raise max rotation to ~±22–25° and verify
  blast-line survival math, or implement true vector DI.

### DI-2 — DI sampled once at hitlag-end, not continuously — P2 ⬜
- **Code:** DI is read on the single frame hitlag drains to zero
  (`Character.ts:1893-1916`). Smash latches the stick at the last hitlag frame too,
  so this is largely correct; flagged only because there's no smoothing/averaging.

### DI-3 — SDI uses a 3px rising-edge nudge, not per-frame — P1 ⬜
- **Smash:** SDI is applied (roughly) every hitlag frame the stick is held past
  threshold, up to a per-event cap; rapid quarter-circles maximize it.
- **Code:** SDI fires only on a rising edge (`!beyond → beyond`) for a 3px nudge,
  capped at 18px/freeze (`SDI_NUDGE_PX = 3`, `SDI_MAX_TOTAL_PX = 18`,
  `SDI_STICK_THRESHOLD = 0.5`, `Character.ts:626-630`, `1867-1892`). Multishot/
  hitlag-escape SDI behaves differently from Smash.
- **Fix sketch:** apply per-frame while held beyond threshold, with the cap doing
  the limiting, to match Smash's "mash to escape multihits".

### DI-4 — No ASDI (Automatic Smash DI) — P1 ⬜
- **Smash:** the stick's position at the *moment of hit* grants one free ~6px SDI
  step (ASDI), and ASDI-down is a core survival/combo-DI tool.
- **Code:** not found — only deliberate per-flick SDI exists (audited; absent).
- **Fix sketch:** on hit, apply a single ASDI step from the held stick before the
  hitlag SDI loop; add ASDI-down interaction with crouch-cancel.

---

## 4. Shield / out-of-shield

Source: `src/characters/shieldState.ts`, `src/characters/combat.ts`,
`src/characters/Character.ts`.

### SH-1 — No shield-drop lag — P1 ⬜
- **Smash:** dropping shield costs ~7 (Ultimate ~11) frames before non-OOS
  options; this defines what is/isn't a safe-on-shield punish.
- **Code:** shield release is instant; the only lockout is shieldstun
  (`shieldState.ts:366-369`). OOS jump/grab are gated on
  `!inShieldstun` (`Character.ts:2230-2234`), so OOS is *tighter* than Smash and
  there's no "shield-drop then act" cost.
- **Fix sketch:** add `shieldDropLagFrames` that gate non-OOS actions after the
  shield button is released.

### SH-2 — No up-special / up-smash out-of-shield path — P1 ⬜
- **Smash:** the strongest OOS options are jump-cancel up-special and up-smash OOS.
- **Code:** only jump and grab are wired as OOS (`Character.ts:2230-2234`); there's
  no jump-cancelled up-special/up-smash OOS, so the OOS option tree is incomplete.
- **Fix sketch:** allow up-special / up-smash to consume the OOS jump window.

### SH-3 — No shield poke (hurtbox exposure as shield shrinks) — P1 ⬜
- **Smash:** a shrunken shield exposes parts of the body; attacks can "poke"
  through.
- **Code:** shield bubble shrinks *visually* with health (`ShieldBubble.ts:8`) but
  there is no hurtbox-exposure interaction — a raised shield always fully absorbs.
- **Fix sketch:** scale the shield's covering radius with health and let hits that
  fall outside it bypass to the hurtbox.

### SH-4 — No light shield — P2 ⬜
- Shield is binary (raised/not). No light-shield (more pushback, less damage)
  variant (audited; absent in `shieldState.ts`).

### SH-5 — No shield tilt / directional shielding — P2 ⬜
- Explicitly deferred (`shieldState.ts:60`). Affects shield-poke coverage and
  edge-shield mixups.

### SH-6 — Shieldstun is flat-ish, not 1× damage-scaled like Ultimate — P2 ⬜
- **Code:** `shieldstun = base 2 + 0.4·damage`, clamped to [3, 8]
  (`SHIELDSTUN_*`, `combat.ts:197-203`, `computeShieldstun` `combat.ts:658`).
  Ultimate's shieldstun is larger and makes more moves safe; current values make
  shield comparatively weaker/OOS-favored.

---

## 5. Dodge / roll / air-dodge

Source: `src/characters/dodgeState.ts`.

### DG-1 — No dodge staling (repeated dodges don't get worse) — P1 ⬜
- **Smash (Ultimate):** consecutive spotdodges/rolls/air-dodges gain end-lag and
  lose i-frames until you reset by not dodging.
- **Code:** explicitly reserved-but-unimplemented (`dodgeState.ts:68-69`); the
  runtime always reads the full i-frame window. Enables spam-dodge stalling.
- **Fix sketch:** track a recent-dodge counter (mirror the ledge-regrab counter),
  scaling `iframeFrames` down and `recoveryFrames`/`cooldownFrames` up per repeat.

### DG-2 — Air-dodge is neutral-only (no directional air-dodge) — P1 ⬜
- **Smash (Ultimate):** directional air-dodge travels and is a recovery/mixup tool;
  Melee directional air-dodge enables wavedash.
- **Code:** air-dodge always classifies as neutral stall (`slideSpeed: 0`,
  `classifyDodgeKind` `dodgeState.ts:481-488`). No drift, no recovery distance.
- **Fix sketch:** give air-dodge a directional burst vector from the stick.

### DG-3 — No wavedash — P2 ⬜
- Follows from DG-2: no directional-air-dodge-into-ground momentum
  (`dodgeState.ts:62` notes out-of-scope). Melee-style movement absent.

### DG-4 — Air-dodge doesn't go to helpless / can't be edge-canceled — P2 ⬜
- No interaction between air-dodge and the helpless/free-fall state, and no
  edge-cancel of dodge recovery (audited; absent). Affects ledge mixups.

---

## 6. Teching

Source: `src/characters/Character.ts`.

### T-1 — No wall / ceiling tech — P1 ⬜
- **Smash:** you can tech off walls and ceilings, not just the floor.
- **Code:** tech only fires on ground contact (`Character.ts:1942-1996`, gated by
  `isGrounded`). Wall/ceiling tech absent → easier wall-of-pain / ceiling combos.
- **Fix sketch:** extend the tech check to wall/ceiling collision normals with
  matching tech-roll directions.

### T-2 — Missed-tech getup options incomplete — P2 ⬜
- **Code:** neutral getup, getup-roll, and getup-attack exist
  (`GETUP_*` constants, `Character.ts:596-603`), but there's no separation between
  a *teched* getup and a *missed-tech* knockdown getup option set, and no
  getup-jump. Largely present; flagged for the missing getup-jump.

### T-3 — Tech window / lockout values not validated vs Smash — P2 ⬜
- `TECH_WINDOW_FRAMES = 8`, `TECH_LOCKOUT_FRAMES = 24`, `TECH_IFRAME_FRAMES = 20`
  (`Character.ts:582-595`). Plausible but unverified against Smash's 20-frame tech
  window and ~40-frame lockout; tune for parity.

---

## 7. L-cancel / landing lag

Source: `src/characters/aerialSchema.ts`.

### LC-1 — No Melee-style L-cancel (input-driven landing-lag halving) — P2 ⬜
- **Smash (Melee/PM):** pressing shield within ~7 frames of landing halves aerial
  landing lag — a core tech-skill mechanic.
- **Code:** the engine uses Ultimate-style **auto-cancel** windows instead
  (`autoCancelWindows`, `isAutoCancelFrame` `aerialSchema.ts:344-360`); landing lag
  is authored per move, not player-cancelable. This is a deliberate design choice;
  listed as a divergence, not a defect.

### LC-2 — Landing lag is a flat per-move value, no IASA / actionable nuance — P3 ⬜
- `landingLagFrames` is a single number (`aerialSchema.ts:266`); no
  interruptible-as-soon-as (IASA) frames or jump-cancel out of landing lag.

---

## 8. Movement tech

Source: `src/characters/Character.ts`.

### M-1 — Short-hop is release-timing, not a jumpsquat option — P2 ⬜
- **Smash:** short-hop = release jump during the ~3-frame jumpsquat (or a dedicated
  SH macro). There is **no jumpsquat** here — jump leaves the ground immediately
  and short-hop is decided by an early jump-cut release window
  (`jumpCutFactor`/jump-cut window, `Character.ts:2917-2946`). No jumpsquat means
  no jump-cancel grab/up-smash and different OOS timing.
- **Fix sketch:** add a jumpsquat phase to enable jump-cancel actions.

### M-2 — No edge-cancel (slide off platform to cancel landing lag/recovery) — P2 ⬜
- Searched `edgeCancel`/`edge-cancel`: absent. Aerials/specials/landing-lag can't
  be edge-canceled off platform lips.

### M-3 — No platform drop-through buffering nuance / no shield-drop-through — P2 ⬜
- Drop-through exists at the stage level (`platformBehavior.ts`) but there's no
  fast-fall-through-on-down + the Smash "hold down + shield to drop" specifics
  surfaced in the fighter (audited; not found in `Character.ts`).

### M-4 — Fast-fall is a latch with no per-fighter multiplier tuning surfaced — P3 ⬜
- Fast-fall is a single `fastFallSpeed` cap latch (`Character.ts:2962-2980`); fine,
  but no "fast-fall multiplier vs absolute speed" knob like Smash.

---

## 9. Grab / throw

Source: `src/characters/grabSchema.ts`, `src/characters/Character.ts`.

### G-1 — Grab is largely complete; mash-out is capped, not percent-scaled per-throw — P2 ⬜
- Grab beats shield, whiff-grab recovery, pummel with cooldown, and the 4-throw set
  all exist (`grabSchema.ts:7-31`, tick at `Character.ts:2459-2467`). The
  grab-difficulty mash formula is a flat cap (`grabSchema.ts:182` notes Smash uses
  a percent-scaled release formula). Throws don't scale grab-hold duration with the
  victim's percent.
- **Fix sketch:** scale auto-release frames by victim percent.

### G-2 — No grab-release tech / no jump-cancel grab — P2 ⬜
- No ground/air grab-release interactions (jab-reset windows, regrab) and, tied to
  M-1, no jump-cancel grab. Audited; absent.

---

## Already addressed in this branch

| ID | Gap | Fix |
|---|---|---|
| L-1 | Climb get-up had 0 i-frames | `getupIframes` default 12 (startup intangibility) |
| L-2 | Intangibility never depleted on regrab | `ledgeGrabsSinceGround` counter + `regrabIframeThreshold`/`regrabIframePenalty` depletion, reset on landing |
| L-3 | Grab gave i-frames from frame 0 | `grabVulnerableFrames` 2-frame punish window + `isLedgeGrabVulnerable` |

All three are pure, deterministic (no `Math.random`/`Date`), and covered by tests
in `src/characters/ledgeHangState.test.ts` (plus runtime assertions in
`src/characters/Character.test.ts`).
