# Ordinary landing and input commitment

Link now has two steps of soft landing recovery and five steps of hard landing recovery. The move-specific penalty replaces ordinary recovery: a non-autocancelled neutral air still takes six steps, while an autocancelled neutral air uses the ordinary landing pause. Other movement profiles retain their previous behavior until they receive explicit ordinary landing values.

[Ultimate Frame Data](https://ultimateframedata.com/stats) supplies Link's 2/5-frame targets. The reference game distinguishes normal landings using time at terminal fall speed; the reverse-engineered [fighter parameter structure](https://ultimate-research.github.io/skyline-rs-template/doc/smash/params/fighter_param/struct.FighterParamTable.html) exposes `landing_heavy_frame` separately from the two recovery durations. This implementation uses **four consecutive physics integrations entering at normal terminal speed**, including touchdown, as its current calibration. That threshold has not been verified against Link's original parameter value and is not claimed as exact Ultimate parity. The [landing description](https://www.ssbwiki.com/Lag#Normal_landing) provides additional context for the terminal-speed distinction.

The runtime records the fall history before Matter cancels impact velocity. An air jump or slower descent breaks the streak. Hitlag freezes its history, and the release integration resumes the same gravity and terminal-speed contract. Teleports clear both the history and pending landing result.

Ordinary recovery has an independent timer, so it cannot turn an unrelated attack cooldown into a longer shield or movement lock. Landing resolves before normal action dispatch. Attacks, jumps, item slot overrides, and charged specials keep their buffered press through the last locked step; a held shield can rise on the first free step. Special, dodge, ledge, hitstun and knockdown state transitions retain their own commitments.

The character editor and JSON serializer preserve the optional fields `softLandingFrames`, `hardLandingFrames`, and `hardLandingSpeedFrames`, as well as the new air-jump tuning fields. Landing values reject fractional, negative and non-finite steps on import.

## Evidence

- `landing/failing-before.txt`: real Matter tests reproduce absent ordinary recovery and the held-shield landing boundary before the runtime fix.
- `Character.ordinaryLanding.physics.test.ts`: exact 2/5-step commitment, threshold boundary, buffered attack/jump/special/item callbacks, held shield, drop-through lock, autocancel replacement, independent cooldown, hitlag and round reset.
- `Character.airMovement.physics.test.ts`: terminal fall and gravity remain correct across attacker hitlag.
- `landing/tests.txt`: focused simulation, serializer and editor checks.
- `physics/production/physics-sep14.json`: final MatchScene acceptance, including visible landing pose and first actionable input step.

This is an automated simulation and browser acceptance pass. Human gamepad feel, landing sound review, the exact terminal-duration parameter, special/air-dodge landing parity, and the remaining roster calibration are still open.
