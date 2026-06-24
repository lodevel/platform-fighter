---
name: add-spawned-object
description: Rules for any move/effect that spawns a world object — projectile, trap/bomb/mine, summon, item, hazard. Objects obey physics by default, must be rendered, and must show their active damage area.
---

# Spawning a world object

Any move or system that puts an **object into the world** — a projectile, a
trap/bomb/mine, a summon, a thrown item, a stage hazard — must satisfy these
four rules. They are all things the engine will let you skip silently while
tests still pass, then the object is broken in-game.

## 1. Objects obey physics by default — opt OUT, never opt in

A spawned object is subject to the same world rules as a fighter (**gravity,
falling, resting on surfaces, collision**) UNLESS its design explicitly makes it
static. Do not author a static object by accident.

- A bomb/mine dropped in the air **falls** until it lands on the surface below
  it — it does not hang in mid-air where it was placed. (This was the trap bug:
  it was a fixed point. Fixed now via `vy`/`landed` + `trapSurfaceYBelow` in
  `Character.tickTraps`.)
- A projectile that should arc uses gravity; a straight shot (arrow, laser)
  overrides it to 0 — but that override is a deliberate choice, stated in the
  move's tuning.
- Integrate physics in the **deterministic sim** (the `Character`/engine tick),
  not the render loop, or replays desync. Use frame-counter / fixed-step math
  and existing world data (e.g. `ledgeCandidates` for the surface below a point)
  — not `Date`/`Math.random`, not a Matter query that's mocked headless.

When you DO want a static object (a placed mine that sticks to a wall, a
floating hazard), say so in a comment — "static by design, no gravity."

## 2. The object must be RENDERED — mechanics ≠ visuals

The engine ticks the object's hitbox, damage, and lifetime even when nothing is
drawn, so a missing renderer is an **invisible object that "does nothing" on
screen** while still dealing damage. Tests pass on invisible objects.

- Expose the object's world state from the owner with a getter (e.g.
  `Character.getActiveTraps()`), then draw it each frame in `MatchScene` at
  `stageOffset + worldPos * stageScale` — mirror `renderTraps()` / the
  projectile loop.
- After wiring it, **RUN THE GAME** ([run skill]) and confirm the object
  actually appears and moves. A green test suite is not proof it's visible.

## 3. Show the ACTIVE DAMAGE AREA — the player must read the threat

When the object's hitbox is live (a blast detonates, a sweet-spot opens, a
hazard turns on), the visual must occupy the **actual hitbox extent**, so the
player can see how far it reaches.

- Draw the blast/flash at the real `width × height` of the hitbox, centred on
  the hitbox — not a token sparkle, and not the small idle object sprite.
  (Bomb fix: detonation flash is now drawn at `(width, height)` = the damage
  radius; the inert bomb is small.)
- An object whose damage area is invisible is a guess-the-hitbox trap for the
  player. The on-screen danger zone and the real hitbox must match.

## 4. Lifetime + cleanup

- Despawn the hitbox AND its visual on expiry / on hit / on owner death. Leaked
  sensors deal phantom damage; leaked sprites pile up.
- Cap simultaneous instances if the design needs it (`maxActiveTraps`,
  projectile pools) and drop the oldest FIFO.
- Determinism: same inputs → same spawns, positions, and despawns.

## Reference implementations
- **Projectile**: the `this.projectiles` loop in `MatchScene` (position += vel,
  stage-transform sync, AABB hit-check, despawn on hit/lifetime).
- **Trap / bomb**: `Character.placeTrap` / `tickTraps` (gravity + landing,
  fuse/arm, blast sensor) + `MatchScene.renderTraps` (object sprite, fuse
  blink, blast-radius flash).
- Schemas: `downSpecialSchema.ts` (`trap`, `stallAndFall`, `groundPound`),
  `specialSchema.ts` (`projectile`, `summon`).

See also `add-character` §0 (entity-spawning specials need a renderer).
