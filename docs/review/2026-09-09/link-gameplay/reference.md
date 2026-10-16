# Link normal and aerial calibration

Checked 2026-09-09. Target: Ultimate's player-facing uncharged timings, using [Ultimate Frame Data: Link](https://ultimateframedata.com/link). Cross-check hit groups, clear commands, damage changes and landing flags against [WuBoytH's vanilla script dump](https://github.com/WuBoytH/SSBU-Dumped-Scripts/tree/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link). The latter is a vanilla-data dump, not the separate gameplay mods bearing similar names. `tools/link-reference-audit.py` reads that pinned revision and the author's pinned [motion list](https://github.com/WuBoytH/SSBU-Dumped-Motion-Lists/blob/3f14a9d46b69eb9e7cd622bddde459192848580e/fighter/link/motion/body/c00/motion_list.yml).

Our convention: **elapsed 0 = human frame 1**. Human inclusive `a–b` becomes elapsed half-open `[a−1,b)`. `S/A/R` below means startup / active-envelope length / recovery. The envelope includes gaps; a gap must have **no sensor**. Use `cooldownFrames: 0`: recovery already accounts for the full action commitment, so adding an attack cooldown would lengthen these timings.

| Move | Human active frames | Total | Engine S/A/R | Elapsed hit windows |
|---|---|---:|---|---|
| Jab 1 | 7–8 | 23 | 6/2/15 | [6,8) |
| Jab 2 | 5–6 | 25 | 4/2/19 | [4,6) |
| Jab 3 | 6–7 | 34 | 5/2/27 | [5,7) |
| Forward tilt | 15–19 | 39 | 14/5/20 | [14,19) |
| Up tilt | 8–12 | 35 | 7/5/23 | [7,12) |
| Down tilt | 10–11 | 30 | 9/2/19 | [9,11) |
| Dash attack | 20–23 | 56 | 19/4/33 | [19,23) |
| Forward smash 1 | 17–18 | 50 | 16/2/32 | [16,18) |
| Forward smash 2 | 10–11 | 60 | 9/2/49 | [9,11) |
| Up smash | 10–15;25–30;41–45 | 77 | 9/36/32 | [9,15);[24,30);[40,45) |
| Down smash | 12–13;24–25 | 56 | 11/14/31 | [11,13);[23,25) |
| Neutral air | 7–31 | 38 | 6/25/7 | [6,31) |
| Forward air | 16–17;24–25 | 51 | 15/10/26 | [15,17);[23,25) |
| Back air | 6–8;15–17 | 30 | 5/12/13 | [5,8);[14,17) |
| Up air | 11–40 | 59 | 10/30/19 | [10,40) |
| Down air | 14–64 | 79 | 13/51/15 | [13,64) |

These are timing targets, not direct ports of skeletal collision volumes or the Ultimate knockback formula. F-tilt's first frame reaches above Link; the forward tip joins a frame later. Up-smash retains a reduced region on human frames 14–15 and 29–30. A single rectangular sensor spanning each full window is an explicit geometry approximation.

Damage and hit identity, checked from the individual vanilla gameplay scripts:

| Script | Damage / behavior to preserve |
|---|---|
| [Attack11](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack11.txt), [Attack12](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack12.txt), [Attack13](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack13.txt) | 3 / 3 / 4; separate follow-up attacks. |
| [AttackS3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS3.txt), [AttackHi3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi3.txt), [AttackLw3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackLw3.txt) | Forward 13; up 11; down 9. |
| [AttackDash](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackDash.txt) | Tip/middle/hilt 14/13/12. |
| [AttackS4](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS4.txt), [AttackS4S2](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackS4S2.txt) | First swing blade/hilt 7, tip 14; optional second swing far 13, close 12. |
| [AttackHi4](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi4.txt) | 4 then 3 then sword/arm/body 11/10/9. Three fresh hit groups, separated by clear commands. |
| [AttackLw4](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackLw4.txt) | Front middle/tip/body 16/17/14; back sword/arm/body 12/11/10. Opposite sides, fresh hit group. |
| [AttackAirN](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirN.txt) | Human 7–8 foot/legs 11/9; 9–31 damage 6. Updating the hitboxes does not create a second hit against the same target. |
| [AttackAirF](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirF.txt) | 8 then 10. First hit uses different ground/air launch rules to connect the second swing. Fresh hit group after the gap. |
| [AttackAirB](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirB.txt) | 5 then 7; both behind facing. First hit links, second launches. Fresh hit group after the gap. |
| [AttackAirHi](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirHi.txt) | Human 11–13 damage 15; 14–40 damage 13. Same hit group through the damage change. |
| [AttackAirLw](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw.txt) | Human 14–19 damage 18: meteor for airborne victims, upward launch for grounded victims. Human 20–64 damage 15 with upward launch. A damage-stage change alone must not rehit. Pogo/rebound is separate behavior. |

Landing lag / elapsed autocancel: nair **6**, `[0,3)` and `35+`; fair **11**, `52+`; bair **6**, `28+`; uair **14**, `[0,10)` and `42+`; dair **19**, `[0,9)` and `64+`. The script landing flags agree structurally with [UFD's aerial data](https://ultimateframedata.com/link). Fair is actionable after human frame 51 but its landing flag clears at human 53: retaining pending landing state briefly after action completion is necessary if matching that distinction. Do not silently force every finished aerial to autocancel.

Follow-up targets: jab1 may transition at human 12 (elapsed 11); jab2 at human 8 (elapsed 7). Forward-smash2 is optional, beginning no earlier than human 22 of swing1 (elapsed 21); its own contact occurs on its tenth frame. The dump enables f-smash combination at motion 20 and disables it at motion 35. Both follow the same motion-rate segment, so mapping the UFD opening gives a **provisional** human `[22,37)` input interval; the closing edge still needs in-game verification. Jab hit-confirm and no-hit-combo flags differ: do not claim one shared exact whiff/hit input interval from these dumps alone.

Source limits: script motion counters are not automatically gameplay frames. Jab1, dtilt, f-smash1, down-smash and fair contain motion-rate commands; UFD gives observed elapsed gameplay timing. Motion-list cancellation values are useful corroboration but do not replace UFD totals when status logic/rounding differs. This milestone should preserve explicit gaps, hit identities and early/late changes before claiming full collision-volume, combo, charge-hold or knockback parity.
