# DK work paused for shutdown

All three specialist agents were interrupted at the user’s request. No build, browser verification or GPU generation is running. The DK preview server is stopped. Changes and generated assets remain on disk.

Resume checkpoint: `PAUSED-RESUME.json`. It records the published app08 bundle, frozen sources, failed and passing scopes, art state and exact next actions.

Restart preview from repository root:

```sh
node tools/dk-serve-review.mjs
```

Then open http://localhost:4196/dk-motion-preview.html. The latest app08 build is present under `.tmp/dk-live-gallery/platform-fighter`; do not rebuild just to restore the preview.

The latest actual vertical probe completed25cases/86checks with9 failed assertions and no page errors. Initial findings identify pre-takeoff root measurement, first landing-step timing and a stale directional input fixture. These are pending corrections and reruns, not accepted behavior. Complete Character Lab verification and whole-action art qualification remain pending.
