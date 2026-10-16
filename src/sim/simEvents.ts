/**
 * One-shot effects the simulation produces for the view (STEP5-DESIGN §4,
 * 5.5): a hit spark, a sound cue, an explosion's art, a damage-area flash.
 * They carry no simulation state of their own — the view drains them once
 * per render frame and draws from them; a headless run just drops them.
 * Everything long-lived (items, projectiles, explosions' damage areas, the
 * Smash Ball) is drawn from simulation state instead, so a re-simulated
 * rewind redraws correctly without replaying events.
 */
export type SimEvent =
  /** A landed hit: spark at the contact point; the seed is deterministic (frame + attacker slot). */
  | { readonly kind: 'hit'; readonly frame: number; readonly x: number; readonly y: number;
    readonly damage: number; readonly seed: number }
  /** A sound cue (combat connect, KO, the fighters' own cues). */
  | { readonly kind: 'sfx'; readonly key: string }
  /** Explosion art (sprite, embers, smoke) sized to the blast radius at a world point. */
  | { readonly kind: 'explosion'; readonly frame: number; readonly x: number; readonly y: number;
    readonly radius: number }
  /** A short-lived damage-area flash (battering swing hitbox, a trap's blast box). */
  | { readonly kind: 'damageFlash'; readonly frame: number; readonly x: number; readonly y: number;
    readonly width: number; readonly height: number; readonly color: number };

/** FIFO of {@link SimEvent}s between the simulation step and the view. */
export class SimEventQueue {
  private events: SimEvent[] = [];

  push(event: SimEvent): void {
    this.events.push(event);
  }

  /** Every event since the last drain, oldest first. */
  drain(): SimEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }
}
