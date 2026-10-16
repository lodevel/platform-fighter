# Sound without Phaser (2026-10-13)

**The gap:** the PLAN had no step for sound, and today it runs on Phaser's
sound manager. The game's `AudioManager` (cues, sfx and music buses, voice
limits, cooldowns) and `StageMusicController` take any `SoundManagerLike`,
so only the backend was missing.

## What was added

- **`port/src/engine/audio/webAudioSoundManager.ts`**:
  - `SoundManagerLike` on Web Audio, with clips from the manifest's audio
    entries, decoded once per key;
  - a gain node per sound, loops, and `complete` when a one-shot ends;
  - a looping clip still decoding starts when ready, and a late one-shot
    is dropped;
  - unlocks on the first key, click or touch (browser autoplay rule).
- **`SimView.events`** (STEP5-DESIGN §4 `SimEvent`): `sfx {key}` and
  `ko {playerIndex}`. `MatchView` voices `sfx` through the game's
  `emitCombatSfx` and `AudioManager`, the sink `Character` already uses.
- **The sandbox** (`port/sandbox.html`):
  - plays the stage music through `StageMusicController`;
  - plays the demo's one-shots, gathered from every frame it steps and never
    replayed while paused.

## Evidence

- `engine/audio/webAudioSoundManager.check.ts`: 4 tests through the real
  `AudioManager` (bus-mixed volume, voice freed on `complete`, music loop
  waiting for decode, mute through the gain).
- `port/scripts/audio-probe.mjs`: headless Chromium over one 600-frame demo
  loop. It started **11 buffers**:
  1. the stage music (110.85 s, loop);
  2. throw swing 0.34 s, blast 0.20 s, KO 1.49 s, landing 0.22 s;
  3. three shots of 0.45 s, each followed by its 0.13 s hit.

  No page errors. This shows playback was scheduled; listening is for the
  user.

## Still to do

- **Step 6:** MatchSim passes its sfx sink as `events` and the match view
  plays them.
- **Step 9:** Results' Link audio and the pause menu's mute and volume move
  to this backend.
