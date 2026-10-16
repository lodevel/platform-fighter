# Final Smash previews

Requested viewing artifacts for Link, Pikachu and Donkey Kong, captured from the running game at commit `19b1dd9`. Open `index.html` directly, or while the existing local preview is running use:

http://localhost:4173/platform-fighter/final-smash-previews/index.html

The gallery offers normal, half and quarter speed, individual frame stepping, looping and MP4 downloads. Clips are silent. These requested viewing artifacts are retained independently of disposable QA captures.

Individual videos: [Link](link.mp4), [Pikachu](pikachu.mp4), [Donkey Kong](donkeykong.mp4).

| Fighter | Move | Frames | Playback duration |
| --- | --- | ---: | ---: |
| Link | Ancient Bow and Arrow | 248 | 4.13 s |
| Pikachu | Volt Tackle | 455 | 7.58 s |
| Donkey Kong | Jungle Rush | 377 | 6.28 s |

Each video encodes one actual compositor image per fixed simulation tick at 60 FPS, including buildup, successful contact, complete owner animation tail and aftermath. Resources and initial recipient placement are demonstration fixtures; activation uses the saved keyboard binding. No gameplay or animation timing is altered. Throughput while taking screenshots is unrelated to live game performance, so the FPS meter is hidden only in these recordings.

The source capture is 1280×800. The delivered picture is 1256×674 after removing unused right/bottom compositor area. The retained MP4s decode completely at 60 FPS with the exact captured frame counts; actual decoded action frames were visually reviewed. `recording.json`, `media-validation.json` and `gallery-qualification.json` record capture and playback checks.

Regeneration uses `tools/record-final-smash-previews.mjs` with a full FFmpeg binary supporting MJPEG input and H.264 output, serialized under `.tmp/dk-heavy.lock`. The local binary comes from pinned `imageio-ffmpeg==0.6.0` in `.tmp/final-preview-libs`; pass its path with `--ffmpeg`. This renderer records the raw viewport; the delivered files additionally use FFmpeg's `crop=1256:674:0:0` to remove the unused compositor border. The source clips retain all three original complete timelines.

The optional `dist/final-smash-previews` link points to this folder for the current local server. Rebuilding `dist` removes that link; the self-contained local HTML and MP4 files remain usable.
