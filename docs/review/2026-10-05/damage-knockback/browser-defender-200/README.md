# Defender recovery after DK contact at 200%

The four input profiles below tested DK forward tilt and uncharged Giant Punch
against DK, Link and Bear in the current default flat stage. Each profile has
six scenarios, six real contacts and 12/12 contact/selected-move checks: 24
scenarios and 48/48 checks total, with zero page errors.

Every report identifies the actual production URL
`http://127.0.0.1:4175/platform-fighter/`, bundle `index-B4ia6NWm.js`, and SHA256
`4ffde095b044c0d6f57b60a02df2bd8f4d7feb6698bfac364d9f97d938a890f2`.
Input sampling is deterministic through the normal match dispatcher. This
does not establish physical keyboard/gamepad ergonomics or human input feel.

| Profile | DK | Link | Bear | Evidence |
| --- | --- | --- | --- | --- |
| Inward DI, then inward drift | bottom KO | bottom KO | bottom KO | [report](inward-di/dk-knockback-acceptance.json) |
| Inward DI, earliest legal aerial attack | bottom KO | bottom KO | bottom KO | [report](attack-escape/dk-knockback-acceptance.json) |
| Inward DI, earliest legal directional air dodge | bottom KO | bottom KO | bottom KO | [report](dodge-escape/dk-knockback-acceptance.json) |
| Inward DI, earliest legal air jump, up-special ten frames later | returns to floor | bottom KO | returns to floor | [report](jump-recovery/dk-knockback-acceptance.json) |

Both sampled attacks give the same outcome per profile. Bottom KOs happen
after hitstun and indicate failed recovery, not an inescapable launch.

DK regains control at x1805.6 after forward tilt and x1829.6 after uncharged
Giant Punch, beyond the main floor's x1360 edge. Its jump replaces downward
vy about +2.2 with upward -12.07 and clears reference-launch ownership while
preserving horizontal body motion. The subsequent up-special and inward drift
return DK to x667.8 / x688.4 on the main floor with all five stocks by the
400-frame horizon. Bear also returns to the floor; Link still falls below it.

Aerial attack selects each defender's forward aerial and preserves DK/Link
reference launch. Directional air dodge cuts further travel, but still does
not reach the floor in this recovery sequence. None of these profiles performs
an action during hitstun. Actions are pressed on the first legal airborne
frame after hitlag, hitstun and pending knockback have ended.

See the [grounded audit](../browser-all-moves-200/README.md) for the complete
42-contact matrix, reproducible commands, stage geometry and limitations.
[Compact measurements](../browser-all-moves-200/compact-measurements.json)
include first-actionable and before/after-action states alongside full stock
loss and launch data; full timelines remain in the linked profile reports.
