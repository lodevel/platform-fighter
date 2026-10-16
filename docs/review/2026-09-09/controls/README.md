# CPU-first keyboard ownership

Reported case: P1 is a CPU and P2 is human. The character-select screen chose
the first unused keyboard layout, so it assigned P1's unused keys to P2. The
match then correctly preserved that incorrect lobby assignment. The previous
production build reproduced this through an actual click on P2's empty card;
see `cpu-first-controls-before.json`.

P1 and P2 now join using their respective keyboard profiles through card,
portrait and Space selection. An occupied layout blocks joining rather than
silently assigning the other player's keys. Extra slots still use available
keyboard layouts. Restoring an old lobby repairs the wrong P2 layout when doing
so does not take a layout owned by another human. Gamepads and custom key
bindings remain intact.

Verification passed: 155 focused tests across menu/state/participant suites,
TypeScript and production build, and all four browser scenarios with zero page
errors. Logs are in `tests.txt`, `build.txt` and `cpu-first-controls.json`.
The participant cases press every P1 action key and confirm P2 stays neutral,
then exercise P2's keys, custom profile-2 rebinding, reordered/sparse runtime
slots and restart. The browser harness checks actual P2 input and motion after
each of the three join paths and restoration, through stage handoff and restart.

Run with Node 20:

```sh
npx vitest run src/scenes/handCursorState.test.ts src/scenes/CharacterSelectScene.test.ts src/scenes/menuJourneys.test.ts src/match/matchParticipants.test.ts
npm run build
node tools/cpu-first-controls-acceptance.mjs
```

The browser harness defaults to the local production preview at
`http://127.0.0.1:4173/platform-fighter/`; `PF_REWORK_URL` can override it.
