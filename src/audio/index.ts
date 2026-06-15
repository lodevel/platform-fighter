/**
 * Barrel export for the audio module so consumers can write
 * `import { AudioManager } from '@/audio'` rather than reaching into
 * `'@/audio/AudioManager'`.
 */
export {
  AudioManager,
  DEFAULT_AUDIO_CUES,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_CUE_VOLUME,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  DEFAULT_VOICE_LIMIT,
} from './AudioManager';
export type {
  AudioBus,
  AudioClock,
  AudioCueConfig,
  AudioManagerOptions,
  ResolvedAudioCueConfig,
  SoundLike,
  SoundManagerLike,
} from './AudioManager';

// AC 10302 Sub-AC 2 — combat → audio bridge. The {@link CombatSfxSink}
// interface narrows the AudioManager's surface to the single call combat
// code needs (`playSfx`); the {@link mapMoveTypeToSfxKey} helper
// translates a move's `MoveType` bucket into the canonical SFX cache key.
// `emitCombatSfx` wraps the sink call in a defensive try/catch so a
// misbehaving audio backend can never desync the deterministic
// simulation.
// AC 10304 — action-audio expansion. `mapHitConnectToSfxKey` picks the
// light / heavy / clang connect cue from the landed hit's damage +
// held-weapon flag; `mapJumpToSfxKey` picks the ground vs air-jump cue
// from the post-impulse jump count. `HEAVY_HIT_DAMAGE_THRESHOLD` is the
// frozen light↔heavy cut point. All pure / deterministic.
export {
  emitCombatSfx,
  HEAVY_HIT_DAMAGE_THRESHOLD,
  mapHitConnectToSfxKey,
  mapJumpToSfxKey,
  mapMoveTypeToSfxKey,
} from './combatAudio';
export type { CombatSfxSink } from './combatAudio';

// AC 10303 Sub-AC 3 — stage music lifecycle controller. Wraps the
// AudioManager's music-bus calls (playMusic / stopMusic / destroy) into
// a tiny scene-lifecycle façade so MatchScene's create() and SHUTDOWN
// hooks each become a one-liner instead of inlining the lifecycle
// invariants (idempotent start, defensive failure, owned-vs-shared
// destroy semantics) into the scene itself. See StageMusicController.ts
// for the full design rationale.
export {
  DEFAULT_STAGE_MUSIC_KEY,
  StageMusicController,
} from './StageMusicController';
export type {
  StageMusicAudio,
  StageMusicControllerOptions,
} from './StageMusicController';
