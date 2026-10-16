# Defense audit, 2026-09-22

Link now authors separate fresh neutral/directional air dodges and forward/backward rolls. Intangibility starts after vulnerable startup. The input direction and backward classification are captured at entry, so subsequent stick movement cannot shorten the action. Source frame 1 corresponds to elapsed step 0; total N means N locked integrations and freedom on the following input step.

| Fresh action | Locked steps | Intangible source frames |
| --- | ---: | --- |
| Spot dodge | 26 | 3–17 |
| Forward roll | 30 | 4–15 |
| Backward roll | 35 | 5–16 |
| Neutral air dodge | 49 | 3–30 |
| Directional down / diagonal down / side / diagonal up / up | 69 / 74 / 82 / 95 / 108 | 3–21 |

These are [UFD's current measured Link counts](https://ultimateframedata.com/link). The older pinned calculator data disagrees on several air recovery totals and is not used for those totals. Analog angles between measured cardinal/diagonal points use a documented local interpolation, not a reconstructed native motion clock. Other fighters retain their existing dodge profiles.

Link's forward roll reverses facing at elapsed19, following native `EscapeF`'s frame20 `REVERSE_LR`; backward rolls retain entry facing. Their translation distance is still the existing local slide, not native animation root motion. [Pinned vanilla script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/EscapeF.txt).

Shield must remain raised for three steps before ordinary release. Release owns eleven steps of commitment, with a five-step parry window; releasing within three free steps after ordinary blockstun cannot parry. Raising never parries. Jump, upward smash and upward special can cancel GuardOff. Successful parry clears GuardOff and instead locks/protects through hit-stop plus ordinary shieldstun. Zero-damage contacts block without triggering parry. Shared-combat work supplies category stun and distinct direct/projectile freeze. [Original parry measurements](https://w.atwiki.jp/smashsp_kensyou/pages/71.html), [native GuardOff translation notes](sources/README.md).

Shield/parry geometry still uses the project's current collision abstraction; shield shifting/poking and native multi-parry buffering are not reproduced by these timing changes.

Default ledge hang protection is now absent from the second airborne catch. Ground contact or a damaging launch refreshes the catch count; zero-launch damage does not. Custom depletion tuning remains supported. Option intangibility is separate and remains locally calibrated. Other identified gaps include airtime/percent-dependent fresh protection, catch-transition timing, variable snap vulnerability, six-catch limit, release cooldown, option timing and invulnerability reduction. These are explicitly unfinished. [Original ledge measurements](https://w.atwiki.jp/smashsp_kensyou/pages/34.html).

## Authoring and verification

Optional `movement.dodge` survives JSON, Lab editing, saved tunes and factory construction. Omitted profiles retain defaults. Added fields are `iframeStartFrame`, `reverseFacingFrame`, `backwardRoll`, `directionalAir`, and directional recovery knots for up/down/up-diagonal/down-diagonal. Frame values are nonnegative integers and iframe windows must fit active duration. Lab exposes their numeric leaves.

- [Initial defense regressions: 517 tests](focused-tests.txt), including the updated shield-drop and charge-bank expectations.
- [Ground dodge extension: 577 tests](ground-defense-tests.txt), including mirrored roll classification/facing and exact fresh windows.
- [Ledge correction: 562 tests](ledge-tests.txt), including actual Matter catch/drop/regrab, ground refresh and launch/no-launch discrimination.
- [Final shield state: 611 tests](final-defense-tests.txt), including hold minimum, post-block parry gate, freeze/stun protection, zero damage, audio and charge-bank behavior.
- [Final production run](browser.txt), completed September 23: **24 scenarios / 884 traced steps passed** on `index-DN4pX3Za.js`, with zero page/request errors. The [report](production/results.json) covers normal resolver defense inputs, all measured knots, both mirrored rolls, actual landing commitment, world/input/rules clocks and unrelated Matter gravity; MatchScene callback checks cover ordinary shield categories and direct/projectile parry freeze using the pinned independent calculator. Maximum clock/gravity-witness errors are below 2e-13. Desktop and narrow Lab save/reload checks pass; the narrow view remains a scaled fixed canvas.
- Reproduce with `PF_DEFENSE_EXPECT_ARTIFACT=index-DN4pX3Za.js node tools/link-defense-parity.mjs` after building the matching source.

## Travel, landing, staling and remaining defense limits

Native ACMD enables neutral FALL at motion19 and directional gravity at14/control+ledge checks at24. The available translation's landing rule interpolates by **motion progress**, and stiffness changes motion rate. The motion list identifies `b02escapeair.nuanmb` but provides neither its end frame nor the native stiffness/backslide parameters. A lerp over elapsed action time would therefore invent a different curve. Existing burst travel and fixed19 directional landing remain provisional; neutral landing10 is retained. [Source audit and rejected modified data](sources/README.md).

Current geometric ledge detection also does not enforce the directional slide's native cliff-check event before accepting a catch. Air-dodge resource refresh remains tied to ground/ledge/reset, rather than a separately verified damage-reset rule. These limitations remain visible in the implementation backlog.

Original dodge research confirms shared history, delayed recovery, ground duration penalties and reduced air intangibility/travel. It also explicitly reports unresolved mixed-dodge and air-penalty mapping. The retrieved native-comment hook exposes history increments, but not enough vanilla parameters to reproduce every penalty stage. No invented staling curve is installed. Spot-dodge's attack-only early cancel, native travel/wall behavior, timing-dependent11–19 landing, and remaining tech/ledge mechanisms need further implementation and measurements. [Original dodge research](https://w.atwiki.jp/smashsp_kensyou/pages/32.html).
