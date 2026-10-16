# Isolated Pikachu jab preview

Live local URL: [Pikachu jab preview](http://127.0.0.1:4178/pikachu-preview.html).
This is a stationary, jab-only preparation scene with the accepted static
identity sprite. It is not the completed fighter, a roster entry or a Lab export.
The green40×50 body is an authored movement collider; it does not claim native
ear/tail hurtbox coverage. The neutral drawing does not depict the jab pose.

The scene uses the actual shared Character attack lifecycle and
HitboxDamageHandler, native three-region jab capsules at authored scale5/root25,
UFD total17/restart7, and a one-pixel target probe. Source frame2 begins contact;
frame4 clears it. Same-jab re-press restarts the source action without jab2/3.
An existing profile ID supplies stationary fixture physics defaults, but no
Wolf or Volt moveset is copied. No source locomotion, launch recovery, held-jab
repeat, victim hitlag/SDI or full special behavior is validated here.

[Acceptance measurements](acceptance.json) cover simulated browser keyboard
J/N input, six near/outer/miss cases in both facings, startup/clear boundaries,
one-hit dedup and one repeated jab. Native region0 deals1.4 and outer region2
deals1.0; a probe beyond the actual circle receives no damage. Measurements
come from real Matter sensors and the damage callback; the probe does not
exercise a complete victim Character launch.

[Right-facing screenshot](jab-right.png) and [left-facing screenshot](jab-left.png)
were inspected after capture. Orange/pink circles are the live attack regions,
blue marks the target probe. Their separation from the neutral sprite is the
explicitly unfinished action art, not evidence that native contact followed
the static drawing.

[Snapshot identity and artifact hashes](../preview-build.json) identify the
tested isolated production build. The build helper writes only the temporary
preview output and evidence manifest; the verified main-game `dist` is untouched.
The local server remains session76578 on port4178.

```bash
python3 tools/pikachu-source-compile.py
node tools/pikachu-preview-build.mjs --serve
node tools/pikachu-preview-acceptance.mjs
```

Starting the localhost server and Chromium require scoped sandbox permissions;
approved prefixes were recorded. No external messages, publishing or deployment
were performed.
