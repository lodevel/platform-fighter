import type { StageRuntime } from '../arena/runtime';
import type { AppearanceCollection, AppearanceSubmission } from './appearance';
import { GazeHazard } from '../../../src/entities/GazeHazard';
import type { HudView } from '../../../src/sim/hudView';
import type { CharacterId, StageLayout } from '../../../src/types';

function groundTop(layout: StageLayout): number {
  const ground = layout.platforms.reduce((a, b) => (!b.passThrough && b.width > a.width ? b : a));
  return ground.y - ground.height / 2;
}

/**
 * Demo of the Inferno head without a match (viewer): DK crouches when the
 * eyes start to glow, Pikachu and Link don't. Who is KO'd comes from
 * GazeHazard.fightersHitByFlash, the rule the match will use; only the
 * choreography (crouch timing, star-KO flight, respawn) and the HUD's damage
 * numbers are staged. A function of the frame alone, so scrubbing works.
 */
const CAST: ReadonlyArray<{ characterId: CharacterId; crouches: boolean; damage: number }> = [
  { characterId: 'donkeykong', crouches: true, damage: 64 },
  { characterId: 'pikachu', crouches: false, damage: 112 },
  { characterId: 'link', crouches: false, damage: 37 },
];

/** Crouchers duck this many frames before the flash and stand back up after it. */
const CROUCH_LEAD = 70, CROUCH_HOLD = 40;
/** Star KO: blasted up and away into the background, shrinking to a twinkle. */
const KO_FRAMES = 100;
const START_STOCKS = 3;

interface DemoFighter {
  readonly characterId: CharacterId;
  readonly slotIndex: number;
  readonly crouching: boolean;
  readonly crouchAge: number;
  /** Frames since the flash KO'd this fighter, while it is flying away; null otherwise. */
  readonly koAge: number | null;
  /** KO'd and not yet back. */
  readonly out: boolean;
  readonly blinking: boolean;
  readonly stocks: number;
  readonly damage: number;
}

function demoState(runtime: StageRuntime) {
  const gaze = runtime.hazards.gaze;
  if (!gaze) return null;
  const t = gaze.timeline;
  const cycle = Math.floor(runtime.frame / t.cycleFrames);
  const local = runtime.frame % t.cycleFrames;
  const lethal = t.startFrame + t.riseFrames + t.glareFrames;
  const respawn = lethal + t.flashFrames + t.sinkFrames;
  // Ask the hazard who its flash takes, given who is crouching on that frame.
  const probe = new GazeHazard(gaze.id, t);
  probe.reset(lethal);
  const victims = new Set(probe.fightersHitByFlash(CAST.map((c) => ({ crouching: c.crouches, intangible: false, active: true }))));
  const flashesSeen = cycle + (local >= lethal ? 1 : 0);
  const fighters: DemoFighter[] = CAST.map((c, i) => {
    const hit = victims.has(i);
    const sinceFlash = local - lethal;
    const out = hit && sinceFlash >= 0 && local < respawn;
    return {
      characterId: c.characterId, slotIndex: i + 1,
      crouching: c.crouches && local >= lethal - CROUCH_LEAD && local < lethal + CROUCH_HOLD,
      crouchAge: local - (lethal - CROUCH_LEAD),
      koAge: out && sinceFlash < KO_FRAMES ? sinceFlash : null,
      out,
      blinking: hit && local >= respawn && local < respawn + 60 && Math.floor(local / 4) % 2 === 0,
      // Every flash so far cost the victims a stock (the demo loops forever, so it wraps).
      stocks: hit ? START_STOCKS - (flashesSeen % START_STOCKS) : START_STOCKS,
      damage: out || (hit && local >= respawn) ? 0 : c.damage,
    };
  });
  return { fighters };
}

export function gazeDemoAppearances(appearances: AppearanceCollection, runtime: StageRuntime): AppearanceSubmission[] {
  const state = demoState(runtime);
  if (!state) return [];
  const top = groundTop(runtime.layout);
  const tint = runtime.view.theme.spriteTint.getHex();
  return state.fighters.flatMap((f, i) => {
    const at = runtime.layout.spawnPoints[i % runtime.layout.spawnPoints.length]!;
    const facing = at.x < 960 ? 1 : -1;
    const base = { characterId: f.characterId, x: at.x, y: top, facing, depth: i } as const;
    if (f.koAge !== null) {
      const k = f.koAge / KO_FRAMES;
      // Up and away from the stage centre, shrinking into the distance, spinning.
      return [appearances.pose(`gaze:${i}`, { ...base, x: at.x - facing * 520 * k, y: top - 700 * k + 135 * k * k,
        zoom: Math.max(0.02, 1 - k ** 0.7), rotation: facing * f.koAge * 0.35, alpha: Math.min(1, 1.5 - k) },
        'tumble', f.koAge, 0xffffff)];
    }
    if (f.out) return [];
    return [appearances.pose(`gaze:${i}`, { ...base, alpha: f.blinking ? 0.35 : 1 },
      f.crouching ? 'crouch' : 'idle', f.crouching ? f.crouchAge : runtime.frame, tint)];
  });
}

/** The HUD for the same demo: the victims' stocks drop on the flash. */
export function gazeDemoHud(runtime: StageRuntime): HudView | null {
  const state = demoState(runtime);
  if (!state) return null;
  return {
    mode: 'stocks', secondsLeft: null, suddenDeath: false,
    players: state.fighters.map((f, i) => ({
      playerIndex: i, slotIndex: f.slotIndex, characterId: f.characterId, paletteIndex: 0, cpu: false,
      damage: f.damage, stocks: f.stocks, score: 0, eliminated: false, final: null,
    })),
  };
}
