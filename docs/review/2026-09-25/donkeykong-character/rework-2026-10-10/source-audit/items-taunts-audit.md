# DK items and taunts source audit (2026-10-11)

Sources fetched: UFD `https://ultimateframedata.com/donkey_kong` (raw HTML read: Ground/Aerial/Special/Grabs/Dodges/Misc; Misc Info has only stats, OoS options, ledge, getups; no item, heavy-item or taunt rows), SmashWiki raw wikitext for Item_throw, Taunt, Barrel, Crate, Home-Run_Bat, Beam_Sword, Ray_Gun, plus the DK (SSBU) page. No pages denied; `Heavy_item`, `Cargo_Throw`, `Super_Lift` have no SmashWiki page.
Rows: `items-taunts-audit.json` (24 rows).

## Key finding
SmashWiki "Item throw" gives universal Ultimate item-throw totals (24 fwd/back, 23 up and ground drop, 19 down, 29 dash) plus per-character throw-release frames (DK: 10/14/15/8, dash 6, drop 7). The engine matches all of them. The wiki's table lists Smash 4 totals (Mario dash 37, DK 39), contradicting its prose 29; engine follows the Ultimate prose.

## MISMATCH (both low-to-medium confidence)
1. Heavy carry walk cap 1.3246 native (`donkeykongHeavyItems.ts` DONKEYKONG_HEAVY_CARRY_PARAMETERS.maximumSpeedNative, `clampDonkeyKongHeavyWalkVelocity`). Barrel: DK is the exception to carry slowdown; DK walk is 1.365 (UFD). Wiki statement is not Ultimate-scoped. Proposed fix: cap at walk speed 1.365 (x5 px) or keep native value and record as native-derived. Affects: heavy-item carry/walk gait qualification rows (item-carry heavy walk).
2. Bat forward-smash (Home-Run) swing: wiki Ultimate 51 frames for all characters; engine uses the 18-step generic swing for every slot. Fix only if the engine models the home-run smash: separate 51-step swing. Affects: bat swing length row(s) for the smash slot.

## SOURCE_SILENT (keep native values, label as native-derived)
- Light pickup standing 7 / walking 19; heavy get 24
- Heavy throws (fwd/back 39, up/down 29); super_lift jump-squat 6 / turn 12 / landing 18; walk gait thresholds
- Strong-throw flick windows 6/8
- Taunt presentation lengths 80/70/60 (no effect on control)
- Bat swing 18 (non-smash), sword 17, ray gun startup/FAF; item carry loop 140

## MATCH
Light throw totals 24/23/19/23, dash throw 29, release frames, DK toss strength 1.09 (1+(127-100)/300), heavy rules (no dash throw, no Z-drop, four directions, grounded pickup only), taunt cancel (49 -> frame 50), ray gun 25-frame fire rate (note engine damage 10 vs wiki 5%, out of scope).
