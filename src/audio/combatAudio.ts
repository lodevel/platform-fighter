/**
 * Combat → audio bridge — AC 10302 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * Sub-AC 1 of AC 10302 stood up the {@link AudioManager} façade and
 * registered the canonical SFX cue table (jab/tilt/smash/aerial/shield/
 * dodge/KO + the music bed). Sub-AC 2 — this module — wires those cues
 * to the *combat events that produce them* so the player actually hears
 * a snap on a connecting jab, a hum on a raised shield, a whoosh on a
 * dodge, and the trademark Smash-style "ka-ching" the moment a fighter
 * crosses the blast zone.
 *
 * Why a separate module (instead of importing AudioManager directly into
 * Character / Fighter)
 * ---------------------------------------------------------------------
 *
 *   • **Test isolation.** Character / Fighter tests run under vitest in
 *     Node, where Phaser's WebAudio backend doesn't exist. The unit
 *     tests build hand-rolled fakes that record `playSfx(key)` calls; we
 *     don't want to drag the full {@link AudioManager} surface (cues,
 *     buses, voice limits, music continuity) into every Character test.
 *
 *   • **Loose coupling.** Combat code shouldn't know that "shield raise"
 *     maps to the cache key `'sfx.shield'` — it should know that "shield
 *     raised" is the event, and the audio layer's responsibility is to
 *     decide which cue voices that event. The {@link CombatSfxSink}
 *     interface narrows to the single call combat code needs (`playSfx`)
 *     so the dependency at the call site is minimal.
 *
 *   • **Substitutability.** Any object with a `playSfx(key: string)`
 *     method satisfies the sink — production passes the
 *     {@link AudioManager}, tests pass a `{ calls: string[]; playSfx(k){
 *     this.calls.push(k); } }` recorder, and a future "stream-friendly
 *     mute toggle" adapter slots in without touching combat code.
 *
 * Determinism
 * -----------
 *
 *   • The sink is deliberately a side-effect-only fire-and-forget
 *     surface. Combat code never reads anything back from the sink, so
 *     a missing or misbehaving audio backend can never desync the
 *     deterministic gameplay simulation. The replay system re-emits
 *     combat events on playback and the sink re-derives SFX from
 *     identical events — no audio state is recorded into the replay.
 *
 *   • Combat events fire from inside the per-frame physics tick (which
 *     is itself deterministic), so the cadence of `playSfx` calls is a
 *     pure function of the input stream. The {@link AudioManager}'s
 *     wall-clock cooldown / voice-limit gates (which ARE non-
 *     deterministic) only decide whether a *given* call produces sound;
 *     they never affect simulation state.
 *
 * Where the events fire
 * ---------------------
 *
 *   • **Attack SFX (jab / tilt / smash / aerial)** — fired from
 *     `Character.tickAttack` on the **startup → active** transition,
 *     i.e. the exact frame the hitbox spawns into the world. This is
 *     the canonical Smash-style "swing connects with the air" cue —
 *     authored to read as the swoosh of the swing, not the impact.
 *     Move type ↦ cue mapping lives in {@link mapMoveTypeToSfxKey}.
 *
 *   • **Shield SFX** — fired from `Character.applyInput` on the rising
 *     edge of the shield-raise (any non-`'active'` state → `'active'`).
 *     The audio cooldown (default 100 ms) prevents a player who jitters
 *     the shield key from spamming the cue.
 *
 *   • **Dodge SFX** — fired from `Character.applyInput` on the dodge's
 *     non-`'active'` → `'active'` transition. This re-uses the existing
 *     `dodgeJustStarted` flag the runtime already computes for facing
 *     latching — no extra state-tracking required.
 *
 *   • **KO SFX** — fired from `Fighter.loseStock` when the call actually
 *     drains a stock (idempotent on already-eliminated fighters). Every
 *     KO — whether it depletes the final stock or not — produces the
 *     same cue; the canonical "ka-ching" is the universal "someone got
 *     KO'd" feedback in Smash-style fighters.
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `strict + noUncheckedIndexedAccess`. The
 * sink is a non-readonly interface so production callers can pass the
 * mutable {@link AudioManager} directly; the move-type → cue-key map is
 * frozen at module load to prevent accidental mutation. The
 * `mapMoveTypeToSfxKey` helper returns `null` for move types that have
 * no canonical SFX (the special / grab / throw / taunt buckets) so the
 * caller's optional-chain (`if (key !== null) sink.playSfx(key)`) gates
 * the fire — type-checked rather than implicit-falsy.
 */

import { ASSET_KEYS } from '../assets/manifest';
import type { MoveType } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimum surface combat code needs from the audio layer. Mirrors the
 * `playSfx(key)` slice of {@link AudioManager} — production passes the
 * full manager, tests pass a recorder fake.
 *
 * The return type is `unknown` (not `boolean`) because combat code never
 * branches on the result — a dropped cue (cooldown not elapsed, voice
 * limit reached, manager destroyed) is the audio layer's call to make,
 * not the gameplay layer's. Returning `unknown` lets a future sink
 * implementation decide whether to surface anything at all (`void` would
 * over-constrain the contract).
 */
export interface CombatSfxSink {
  playSfx(key: string): unknown;
}

// ---------------------------------------------------------------------------
// Move-type → cue mapping
// ---------------------------------------------------------------------------

/**
 * Canonical mapping from a move's {@link MoveType} bucket to the cache
 * key the {@link AudioManager} voices for it. Frozen so a misguided
 * caller can't mutate the table at runtime.
 *
 * Coverage rationale:
 *
 *   • `jab`     → `sfx.jab`     — quick rapid-fire poke cue.
 *   • `tilt`    → `sfx.tilt`    — meatier mid-range cue.
 *   • `smash`   → `sfx.smash`   — big-hit finisher cue.
 *   • `aerial`  → `sfx.aerial`  — airborne swing cue (used by every
 *                                  directional aerial: nair / fair / bair).
 *
 * Move types intentionally NOT mapped here:
 *
 *   • `special` / `sideSpecial` / `upSpecial` / `downSpecial` — every
 *     special is character-specific (Wolf's blaster, Cat's teleport,
 *     Owl's directional jump, Bear's tether). The M1 manifest doesn't
 *     ship per-special cues, so we silently drop the SFX request rather
 *     than mis-mapping a special into the generic `sfx.smash` bucket.
 *     A later AC can extend the table when per-special cues are added.
 *
 *   • `grab` / `throw` / `taunt` — no audio cues registered for these in
 *     the M1 manifest; the grab system is reserved for a later AC.
 *
 *   • `shield` / `dodge` — these ARE in the manifest but they're
 *     defensive STATE transitions, not attack moves. They're voiced
 *     directly at the shield / dodge state-machine transition (not via
 *     this map) so the cue fires on the raise / dodge press, not on a
 *     hypothetical `MoveType === 'shield'` move registration.
 */
const MOVE_TYPE_TO_SFX_KEY: Readonly<Partial<Record<MoveType, string>>> = Object.freeze({
  jab: ASSET_KEYS.sfxJab,
  tilt: ASSET_KEYS.sfxTilt,
  smash: ASSET_KEYS.sfxSmash,
  aerial: ASSET_KEYS.sfxAerial,
});

/**
 * Look up the SFX cache key for a move's {@link MoveType}. Returns
 * `null` for buckets without a canonical cue (special / grab / throw /
 * shield / dodge / taunt) so the caller can branch:
 *
 *   const key = mapMoveTypeToSfxKey(move.type);
 *   if (key !== null) sfxSink.playSfx(key);
 *
 * Pure function — no side effects, no I/O. Safe to call from inside the
 * deterministic physics tick.
 */
export function mapMoveTypeToSfxKey(type: MoveType): string | null {
  return MOVE_TYPE_TO_SFX_KEY[type] ?? null;
}

// ---------------------------------------------------------------------------
// Defensive emit helper
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget helper that swallows any error the sink throws so a
 * misbehaving audio backend can never break the gameplay simulation.
 *
 * Why we wrap every call (rather than trusting the sink):
 *
 *   • {@link AudioManager.playSfx} is defensive (returns `false` on
 *     failure rather than throwing), but a test fake or future custom
 *     sink might not be. The combat path runs inside the deterministic
 *     physics tick — a single throw from the audio layer would corrupt
 *     the simulation state and desync the replay.
 *
 *   • The cost of the try/catch is one extra stack frame per `playSfx`
 *     call (negligible — combat fires <50 SFX events per second across
 *     all 4 fighters at peak combat density).
 *
 * Returns `true` if the sink accepted the call without throwing,
 * `false` if it threw. Used by tests to assert the helper IS firing
 * even when the sink is mocked to throw (defence-in-depth).
 */
export function emitCombatSfx(sink: CombatSfxSink | undefined, key: string): boolean {
  if (!sink) return false;
  try {
    sink.playSfx(key);
    return true;
  } catch {
    // Swallow — audio failures must NEVER corrupt the deterministic
    // gameplay simulation. The sink is responsible for its own
    // error reporting / telemetry.
    return false;
  }
}
