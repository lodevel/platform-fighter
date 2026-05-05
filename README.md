# Platform Fighter

A Smash Bros-style 2D platform fighter built with **Phaser 3 + Matter.js** in
TypeScript. Local multiplayer for up to 4 players (any mix of human + AI),
4 hazard stages, a stage builder, and an input-replay system with VCR controls.

## Stack

- **Engine**: Phaser 3 (`phaser` 3.80+)
- **Physics**: Matter.js (via Phaser's matter plugin) — fixed 60 Hz timestep
- **Language**: TypeScript (strict mode)
- **Build**: Vite
- **Tests**: Vitest

## Quick start

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview production build
npm run typecheck
npm test
```

## Repository layout

```
.
├── index.html              # Vite entry
├── vite.config.ts          # Build config + path aliases
├── tsconfig.json           # TS strict mode + path aliases
├── package.json
├── src/
│   ├── main.ts             # Phaser bootstrap
│   ├── engine/             # GameConfig, PhysicsEngine (fixed-step wrapper)
│   ├── scenes/             # Boot / Preload / MainMenu / Match
│   ├── characters/         # Wolf, Cat, Owl, Bear + movesets (M2)
│   ├── stages/             # Built-in hazard stages + custom-stage runtime
│   ├── input/              # Keyboard, gamepad, rebinding, input recording
│   ├── ai/                 # Deterministic seeded AI controllers
│   ├── replay/             # Input-log + 300-frame snapshot system (M4)
│   ├── builder/            # Drag-and-drop stage builder (M3)
│   ├── ui/                 # HUD, menus, VCR overlay
│   ├── utils/              # Rng (Mulberry32) + helpers
│   └── types/              # Shared domain types matching the Seed ontology
└── assets/                 # Sprites, audio, stage backgrounds
```

## Determinism

All gameplay logic must:

1. Pull random numbers from a seeded `Rng` (see `src/utils/Rng.ts`) — never
   `Math.random()`.
2. Step physics through `PhysicsEngine.advance()` so the simulation runs in
   fixed `1/60 s` increments regardless of wall-clock jitter.
3. Express timing in **frames**, not milliseconds.

This is what lets the replay system replay a recorded match identically.

## Milestones

| ID | Scope |
|----|-------|
| M1 | Core fighter — scaffold, physics, one character, one stage, 1v1 |
| M2 | Full roster (4) + 4 hazard stages + AI |
| M3 | Stage builder |
| M4 | Replay system with VCR controls |
| M5 | Full input rebinding |
