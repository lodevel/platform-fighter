# Donkey Kong balance and first-stage room

Pipeline: UFD-based, Ultimate Donkey Kong, existing appearance and art.
Delivery: targeted neutral-special launch correction and flat-stage gameplay
calibration following the user's hunch that specials felt too strong and the
earlier stage reduction left too little room. This is not a full fighter rebuild.

Superseded for attack numbers and variants by the [complete attack-value correction](../dk-all-attack-values/README.md). The stage calibration and historical launch observations below remain useful. Integer partial charge, aerial/full variants, waist regions and full-charge endlag are now implemented; Character Lab persistence and use after reload are now verified.

## Findings and changes

Opponent percent already drives ordinary reference knockback. Attacker rage is
a separate 1.0–1.1 launch modifier; neither is a special-only damage bonus.
Normals should not all have the same launch as finishers or fixed linking hits.

Giant Punch retained SpecialN's BKB45/KBG70 at every charge. SpecialNMax instead
uses BKB35/KBG73. Added an optional fullChargeKnockback to damage-only charges:
only completed charge switches records; partial charge and unaffected fighters
retain existing behavior. Parsing, saved fighter construction and the generator
preserve the field. No extra charge multiplier is applied to reference launch.
The damage range remains 10–28, with full charge at 111 gameplay frames.

The default flat floor is widened from 800 to 1180 design pixels; each side
platform moves 100 pixels outward. The 800-pixel ledge-to-side-blast margin,
vertical platform heights and vertical blast distances remain unchanged.
Side blast width consequently increases from 2400 to 2780 pixels. This is an
explicit project gameplay calibration, not native Battlefield parity. The native
floor is about 800 pixels at the project's 5 px/unit physics conversion; that
number alone cannot validate subjective room or exact native body proportions.
Other stage layouts retain their authored dimensions.

The four idle frames have alpha silhouettes 75.25 px wide and 81.375–85.75 px
high at the existing 224 px sprite display size (alpha threshold 16, 256 px cells).
The floor therefore changes from 10.63 to 15.68 idle widths and from about 9.52
to 14.05 nominal 84 px body heights. Fighter art, movement and collision are not
rescaled. Startup screenshot shows a broader floor with all three platforms
visible: [production stage](browser/battlefield-scale-match-start.png).

## Source evidence

Checked 2026-10-06:

- [UFD Donkey Kong](https://ultimateframedata.com/donkey_kong): 4/6 jab damage,
  8/9 forward tilt, 21/22 forward smash, 10–27 partial punch, 28/18 grounded
  full punch, 25 aerial full punch, 111-frame full charge.
- [Pinned extracted SpecialNMax script](https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Scripts/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_donkey/donkey/SpecialNMax.txt):
  full grounded punch strong regions damage28/angle361/KBG73/BKB35.
  Ordinary and normal attack records remain in the existing
  [script digest](../../2026-09-25/donkeykong-character/sources/dk-scripts-digest.txt).
- Native stage geometry and physics formula sources remain in the
  [previous scale investigation](../../2026-10-05/damage-knockback/README.md).

## Observed production behavior

Built with `npm run build` (palette prebuild, TypeScript and Vite pass).
Loaded `http://127.0.0.1:4176/platform-fighter/`, bundle `index-CsHoGG0O.js`,
SHA-256 `6a27405712856021c4507ddab8dbf51f62e7e2648f2a17f20d0ceea67b7d606e`,
engine `platform-fighter-sha256-a875a1dcc39c1eccd79ed479c6bc559ae5daef4b5a954e5992914f1560a35efd`.
The user's served URL and selected saved tune are still unconfirmed; these
measurements establish the local production build, not a deployed update.

[Match report](browser/dk-knockback-acceptance.json): **96 scenarios, 412/412
assertions**, DK/Link recipients, both facings, 0/100/150/200%, real sensors,
damage delivery, Matter stepping and stock-loss handling. Zero page errors,
console errors or failed requests. No simulation resizing or direct hit injection.
Fixture-controlled input sampling is distinguished from the real keyboard checks
below. All scenarios contact; all 16 full-punch contacts use BKB35/KBG73.
[Launch-growth comparisons](launch-growth.json) verify increasing launch across
all four percentages for each of six moves, both facings and both recipients.

Representative DK-recipient results, facing right, neutral defender, fresh moves:

| Move | Launch speed at 0% | Launch speed at 150% | Travel at 100% | 150% stock loss |
| --- | ---: | ---: | ---: | --- |
| Jab 1 | 3.82 | 6.18 | 55.8 px | none |
| Jab 2 | 9.17 | 20.40 | 183.8 px | none |
| Forward tilt | 10.22 | 21.33 | 466.5 px | after control returns, neutral recovery |
| Forward smash | 10.10 | 39.99 | 1236.1 px | during hitstun |
| Uncharged punch | 9.47 | 21.42 | 455.5 px | after control returns, neutral recovery |
| Full punch | 13.42 | 44.23 | 1287.6 px | during hitstun |

Speeds are pixels per simulation step at contact, including match freshness and
ordinary gravity adjustment. Travel is observed maximum horizontal displacement,
not an unconstrained knockback formula output. Stock losses after control returns
with neutral input do not imply the defender could not recover. The full punch
and forward smash survive at 0% and produce direct KOs at 150/200% in both facings.
At 100%, the uncharged punch stays inside the enlarged floor against DK; it
does not force an offstage situation simply because the stage was narrowed.

[DK keyboard report](keyboard/donkeykong/report.json) and
[Cat keyboard report](keyboard/cat/report.json): actual browser F and G events
through ordinary input routing; jab starts, held G reaches 111 frames, release
contacts with BKB35/KBG73. Cat covers a recipient without reference launch physics.
Cat's first 140 px spacing fixture missed its smaller hurtbox; the corrected
110 px fixture contacts. A diagnostic root keyboard report retains that miss.
These checks do not establish human controller feel. The match harness's earlier
auto-bank wording was incorrect: holding keeps charge at the cap, release fires,
and shield banks. Its measured contact trace was valid; wording is corrected in
the harness, while the saved initial report retains the old descriptive note.

**234/234 focused tests pass** across chargeSchema, reference serializer,
DonkeyKong, DK knockback physics, stage definitions and actual-scene pass-through
physics. Generator syntax parses without running it or regenerating the kit.
The sandbox blocks build/test/browser sockets; those commands were rerun with
approved escalation. The unrelated broad suite was not rerun.

## Remaining approximations

No exact Ultimate KO-threshold or complete balance-parity claim. Giant Punch
still uses a continuous partial damage ramp, the existing hold-to-charge input,
one 35-frame endlag and common collision geometry. The aerial 6/25 damage and
distinct launch records, grounded full-charge 18-damage waist region and native
full-charge 27-frame endlag remain existing gaps. Art and native body-proportion
parity were not rebuilt. Old saved tunes retain their authored move snapshots;
BASE changes do not silently replace them. Browser Character Lab interaction
was not rerun; save/load/factory preservation is covered by the focused test.

Reproduce with a production preview on port 4176:

```bash
PF_REWORK_URL=http://127.0.0.1:4176/platform-fighter/ \
PF_PROBE_OUT=docs/review/2026-10-06/dk-balance/browser \
PF_MOVES=jab,jab2,forward-tilt,forward-smash,giant-punch-uncharged,giant-punch-full \
PF_PERCENTS=0,100,150,200 PF_FACINGS=1,-1 \
PF_EXPECT_CORRECTED_SCALE=1 PF_EXPECT_FLOOR_WIDTH=1180 PF_SCREENSHOTS=1 \
node tools/dk-knockback-acceptance.mjs
node tools/dk-balance-input-acceptance.mjs
node tools/dk-balance-input-acceptance.mjs cat
```
