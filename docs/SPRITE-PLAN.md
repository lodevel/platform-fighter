# Sprite Plan — every animation a fighter needs (and how to handle grabs)

Companion to `docs/CHARACTER-CHECKLIST.md`. The checklist says *what wiring* a
fighter needs; this says *what art* a fully-animated fighter needs, and how to
handle the hard case: moves where one fighter manipulates another (DK's
grab-slam, cargo throws, etc.).

**Current reality:** the runtime paints only **4 sheets** (idle/run/jump/attack)
and collapses every attack onto `attack.png`. But the engine already has a
**per-move/per-phase/per-frame symbolic key layer** (`{char}.{move}.{phase}.{idx}`
in `movesetAnimationCues`/`movesetAnimationDriver`) with no textures behind it.
So "full animation" is mostly an **art + texture-wiring** job, not new systems.

---

## A. The full per-fighter animation list (~50 clips)

Frame counts are rough targets for a pixel fighter (each clip is a short strip).

**Locomotion / state**
- idle (4–6, loop) · walk (6–8, loop) · run/dash (6–8, loop) · dash-start · skid/brake (2–3)
- jumpsquat (2–3) · jump-rise (2–3) · double-jump (3–4) · fall (2–3, loop) · special-fall · land (2–3)
- crouch (enter 2 + hold 1) · turn/pivot (2)

**Defensive / reaction**
- shield (1, scales with HP) · shield-break/stun (3–4)
- spotdodge (3–4) · roll forward (4–6) · roll back (4–6) · air-dodge (3–4)
- hurt/hitstun (1–2) · tumble (2, loop) · knockdown/prone (1) · getup (3–4) · getup-attack (4–6)
- ledge-hang (1–2) · ledge-climb (4–6) · ledge-roll (4–6) · ledge-attack (4–6) · ledge-jump
- KO/star-spin (1–2) · respawn/idle-blink

**Attacks — each its OWN clip, split startup → active → recovery**
- jab1 · jab2 · jab3 (or rapid-jab loop + finisher)
- ftilt · utilt · dtilt
- fsmash (charge-hold loop + release) · usmash (charge + release) · dsmash (charge + release)
- dash-attack
- nair · fair · bair · uair · dair (each + a landing-lag frame)
- neutral-special · side-special · up-special · down-special — each may be **several** clips (e.g. a projectile = wind-up + throw + recover; a charge move = charge-loop + release)

**Grab side (grabber)**
- grab-reach/whiff (3–4) · grab-hold (holding a victim, 2–4 loop) · pummel (2–3)
- throw-forward · throw-back · throw-up · throw-down — each its own clip

That's **~45–55 clips** for a fully-animated fighter (Smash characters have ~50+). Multiply by 2–8 frames each → a few hundred frames per fighter.

---

## B. The hard case — moves that MOVE the grabbed character

This is your DK example: he grabs a fighter and slams them into the ground
left and right. The naive fear is "I need bespoke sprites of *every* victim
being slammed by *every* grabber" — that's a combinatorial explosion. **You
don't.** Here's the standard fighting-game solution, which this engine is
already 90% set up for:

### The grab-anchor / throw-point model
1. **The grabber owns the motion.** DK plays *his own* slam animation (his
   sprites). The move data defines a **per-frame grab-anchor** — the point in
   DK's animation where the victim is held (his hand). For the slam it swings
   down-left → up → down-right.
2. **The victim is attached, not redrawn.** Each frame, the runtime sets the
   victim's body to the grabber's current grab-anchor. **The engine already
   does exactly this** — `Character.ts:2474` pins the grabbed body via
   `setPosition` while held; `handAnchors.ts` already defines a per-fighter grip
   point (`HandAnchor {x,y}`, facing-aware). We just animate that anchor
   per-frame-of-the-move instead of holding it static.
3. **The victim uses GENERIC "captured" poses — authored once per fighter, not
   per grabber:**
   - `grabbed` (limp/held pose)
   - `thrown` (tumbling) — can reuse `hurt`/`tumble`
   - optionally `held-inverted` — or just **runtime-rotate/flip** the `grabbed`
     pose (slammed = rotate the held sprite head-down).
4. **Damage comes from the move's hitboxes, not the victim art.** Each ground
   contact in DK's slam is a hitbox in DK's move data that hits the pinned
   victim. The victim sprite is purely cosmetic — positioned + rotated.

### So DK's grab-slam needs:
- **DK side:** the slam animation clip(s) + a per-frame grab-anchor track + the slam hitboxes (move data). *(art: DK only)*
- **Victim side:** the shared `grabbed` pose (every fighter already needs one), positioned at DK's anchor and rotated to read as "being slammed." *(no new art)*

**Net:** the victim cost is **constant** (1–2 generic poses per fighter), and
only the **grabber** needs the move's animation. Cargo-throws, suplexes,
spinning-throws, Bowser's flying-slam — all follow the same pattern. That's why
the combinatorial explosion never happens.

---

## C. Engine work to make this real (small, mostly already there)
1. **Stop collapsing attacks to `attack.png`.** Make `spriteAnimationDriver`
   read the existing per-move/per-phase keys (`movesetAnimationCues`) and pick
   the matching strip, instead of `collapseStateToSheet → 'attack'`.
2. **Per-frame grab-anchor.** Extend `handAnchors` / the grab move data with an
   anchor track (a list of `{x,y,rot}` per move-frame) the grabber exposes and
   the victim-pin reads (the pin write already exists).
3. **Victim render state.** Add a `grabbed` (and reuse `hurt`/`tumble`) pose to
   the per-fighter sheet set; let the runtime set victim facing/rotation from
   the grab.
None of these are new subsystems — they extend code that already exists.

---

## D. Phased rollout (don't try to draw 50 clips at once)
- **Phase 0 (now):** idle / run / jump / attack (4 sheets, all attacks shared).
- **Phase 1 — cheap, high-impact:** add `hurt`, `shield`, `crouch`, `fall`,
  `land`. Kills most of the "lifeless" feel for little art.
- **Phase 2 — distinct attacks:** real clips for jab/tilts/smashes/aerials/
  specials; wire the driver to the per-move keys (engine task C.1).
- **Phase 3 — grabs/throws + interaction:** grabber throw clips + grab-anchor
  track + the shared `grabbed` victim pose (engine tasks C.2/C.3). This is where
  DK's slam lands.
- **Phase 4 — polish:** ledge set, KO spin, taunt, per-fighter voice/SFX.

## E. Generation notes (ComfyUI)
- Lock ONE style + a fixed seed + img2img so a fighter is identical across the
  frames of a clip (the consistency problem, not the count, is the hard part).
- The **generic victim poses are shared** → generate once per fighter, big save.
- Palette-lock (PixelArt-Detector) so all of a fighter's clips + the 8 palette
  swaps share one color set.
- Suggested art order mirrors the phases above; for the *whole game*, backgrounds
  + item sprites are an even cheaper first win than character clips.
