# Link full rework

The user requested a complete Ultimate Link rebuild from zero, including a new reference sprite and every applicable animation. The add-character skill defines source, equipment, motion, collision, item compatibility and final running-game acceptance. The old implementation and assets are archived in `baseline/` as historical evidence, not accepted replacement assets.

`inventory.json` is the canonical per-action coverage record owned by the source specialist. `work.json` records scope, agent ownership and dependencies. The preceding DK/Pikachu scoped phase-8 qualification is published on port4199, its publication smoke passed, and temporary4205 is closed. All three specialists have production clearance: source normalization, fresh reference/motion production and runtime integration now proceed. The copied public phase-8 build remains unchanged while this work is underway. See [the publication receipt](../../../2026-10-11/ultimate-items/phase-8/verification/publication-complete.json).

The user explicitly chose one complete verification at the end. Source fidelity, implementation, inspected visuals and exact-build runtime status stay separate throughout. No generated asset, compiled contract or passing data test completes an action by itself.

The user explicitly requires Ultimate Final Smashes for Link, DK and Pikachu. Shared activation/resources and each fighter’s complete Final Smash animation/phase behavior are required implementation dependencies. Previous ordinary-kit-only exclusions do not apply.

The art specialist owns the GPU and the coordinator owns builds and previews. Heavy workloads use the same absolute lowercase `.tmp/dk-heavy.lock` and remain serialized. Static source/image inspection and asset production are allowed now; new runtime tests, typechecks, builds and browser checks wait for the one complete verification stage. DK’s14 current heavy-item clips still require paired posed receiving shapes, which is tracked independently of the qualified controls/grip/sole scope.
