# Ultimate items: DK + Pikachu item body art (prepared, not generated)

Prepared 2026-10-11: plan, material renders and packed GPU job inputs. **No GPU run yet.** The root runs `run`, reviews each job, then runs `finalize` and `sheets`.

Scope: the required body motions in `../spec/art-needs.md` (optional hand poses and optional `*4` strong-throw strips are skipped). Items: Home-Run Bat, Beam Sword, Hammer, Golden Hammer, Star Rod, Ray Gun, Super Scope, Fire Flower, Bob-omb, Banana Peel, Food, Heart Container, Maxim Tomato, Crate, Barrel, Capsule.

## One clip per native animation file

Ultimate plays several item motions from the same `.nuanmb` (motion lists in `art-needs.md` sources). The body pose is then identical, and only the held item differs; the item is drawn separately at the hand socket. So each distinct animation file gets **one** clip, and the other motion names are its `aliases`:

- `item_bat_swing_1/_3/_dash` = `item_sword_swing_*` = `item_starrod_swing_*` (`h04swing1/3/dash`).
- `item_sword_swing_4/_4_hold` = `item_starrod_swing_4/_4_hold`. The bat's `_4` is its own file (`h06swing4bat`).
- `item_hammer_*` = `item_golden_hammer_*` (`h05itemhammer{wait,move,air}`).
- `item_lgun_shoot{,_upper,_air}` = `item_fflower_shoot{,_upper,_air}`; `item_fflower_shoot_aerial` = `_air`.
- `item_scope_air_*_aerial` = `item_scope_air_*`.
- `item_heavy_throw_*4` = `item_heavy_throw_*`.

Correction to `art-needs.md`: DK's "3 own sword strips to replace the bat alias" and its 5 Star Rod strips need **no new art**. They are the same native animation files as DK's installed `item_bat_swing_1/_3/_dash` and `item_sword_swing_4/_4_hold`. The same applies to `item_fflower_shoot` / `_air` / `_aerial` (installed `item_lgun_shoot` / `_air`). The engine only needs the alias routing. `item-clips.json` lists these as `already_installed_aliases`.

| Fighter | Required motions (art-needs) | Clips (= distinct files) | Cells | Jobs (2048x1536, <= 4 cells) | Family dir |
|---|---|---|---|---|---|
| DK | 45 (34 new + 11 aliases of installed clips) | 26 | 128 | 50 | `docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art/families/items-2/` |
| Pikachu | 68 | 45 | 251 | 64 | `docs/review/2026-10-11/ultimate-items/art/pikachu/families/items/` |

DK `items-2` clips: hammer wait/move/jump, `item_lgun_shoot_upper`, the three fire-flower loops, 15 scope clips, `item_light_eat`, `item_light_walk_eat`, `squat_wait_item`, `landing_heavy`.
Pikachu `items` clips: 6 swing clips, hammer wait/move/jump, Ray Gun shoot/upper/air, the three fire-flower loops, 15 scope clips, 4 shoot-legs clips, `squat_wait_item`, `item_throw_dash`, 2 eat clips, `item_heavy_get`, 4 heavy throws, `item_heavy_walk`, `landing_heavy`.

`_upper` motions are upper-body layers. Ultimate blends them over `item_shoot_legs_*` while walking. They are rendered full-body, as the native file poses them, and the engine composes them with the legs.

## Files

- `item-clips.json`: per-fighter clip spec (key, the native motions sharing one file, grounded).
- `item-clip-plan.py FIGHTER`: turns the spec into clip-plan entries in the DK `clip-plan.json` schema, with the DK sample rule. That rule is reproduced exactly for every uncapped DK item/locomotion/defense clip. `native_total_frames` comes from the nuanmb, and loop and cancel_frame come from the motion list. It refuses to overwrite an existing family.
  - DK: appended family `items-2` to `rework-2026-10-10/clip-plan.json`. Backup: `.tmp/clip-plan.json.2026-10-11.bak`. The formatting is kept (`json.dumps(indent=1)`, ASCII, no trailing newline), the 156 original clips and meta are unchanged, and `totals` is untouched, as with extras/extras2.
  - Pikachu: new `pikachu/clip-plan.json` (same schema).
- `pikachu/fighter.json`, `pikachu/scale-contract.json`: Pikachu pipeline config and frozen scale.
- DK config: `docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art/fighter.json`.

## How to run (root)

```bash
PY="$HOME/ComfyUI/.venv/bin/python -I"
DKA=docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/art
PIKA="--fighter docs/review/2026-10-11/ultimate-items/art/pikachu/fighter.json"
# DK (default fighter)
$PY $DKA/dk-family-batch.py items-2 run          # every job without an attempt; flock .tmp/dk-heavy.lock
$PY $DKA/dk-family-batch.py items-2 finalize && $PY $DKA/dk-family-batch.py items-2 sheets
# Pikachu
$PY $DKA/dk-family-batch.py $PIKA items run
$PY $DKA/dk-family-batch.py $PIKA items finalize && $PY $DKA/dk-family-batch.py $PIKA items sheets
```
`plan`, `render` and `pack` are done. A re-`pack` keeps jobs that already ran. Ledgers: DK `art/generation-ledger.json`, Pikachu `pikachu/generation-ledger.json` (created on the first run).

## Generalisation (no duplicated pipeline)

The DK scripts are now fighter-parameterised in place, with one implementation per step:

- `tools/dk-material-guide.py --fighter CONFIG`. The default is the DK config, which is also loaded on import, so `tools/dk-native-receiving.py` keeps DK. The config supplies:
  - the native pose evaluator (`pose_module` / `pose_class`: `dk_native_pose.DonkeyKongNativePose` or `pikachu_native_pose.PikachuNativePose`), the mesh dir, the scale contract and the expression layer;
  - the material classes (order = class id, palette), the small-island-exempt classes, and attached classes (DK: tie lettering only next to the tie);
  - per-material colour sources: a classified texture with optional alpha test, an eye decal, or a constant class.
  - The classifiers stay in the tool: `donkeykong_body` (unchanged DK rules + DK badge) and `pikachu_body` / `pikachu_facial`. The Pikachu rules are the seed palette rules of `tools/pikachu-native-guide.py`, authored from the accepted registered reference, applied once in texture space.
  - DK-only rendering stays behind config/flags: the `--eyes` small-brow-eye refinement is in DK `render_args`, the fur-shell material is `alp`, and the tie badge comes from the DK classifier.
- `dk-family-batch.py [--fighter CONFIG] FAMILY STEP`: the clip plan, families dir, prompt, seed, pose evaluator for `plan` travel and material-guide flags all come from the config. The GPU lock is shared, because there is one GPU.
- `dk-run-job.py [--fighter CONFIG]`: ledger, negative, default prompt and seed, and the ComfyUI name prefix (`pf-dk` / `pf-pikachu`). The graph and recipe are otherwise identical (z-image-turbo int8 + Fun ControlNet union, 8 steps, denoise 0.65, strength 1.0).
- `build-tiled-pilot.py` (packer) and `dk-cutout.py` were already fighter-neutral (same magenta key), and are unchanged.
- Pre-change copies: `.tmp/art-generalise-2026-10-11/*.2026-10-11.bak`.

### DK byte-identity proof

The two existing DK poses `families/extras/poses/parry-02-native5` (captured root) and `families/locomotion/poses/run-02-native8` (`--remove-trans`) were re-rendered into a scratch dir. Both had been rendered by the pre-change tool (sha `973260ef...`). Re-rendering with the pre-change tool reproduced them exactly, and so did the generalised tool (`--fighter .../art/fighter.json`):

| pose | seed | guide | render-mask | anatomy-mask | texture-classes |
|---|---|---|---|---|---|
| parry-02-native5 | c71d449b4992d02c = | 1391e18fd5166cb4 = | 5e10898796f5b859 = | c0da4057a333c32c = | f680d603a5bbabad = |
| run-02-native8 | 01b8ffbdebf82438 = | f3d6390bb4f47474 = | d2dcbe97532afc35 = | 81b40de12cda87ae = | f680d603a5bbabad = |

(sha256 prefixes; "=" means identical to the original file.) In `-material.json`, only `tool_sha256` differs, plus the new `fighter_config` / `fighter_config_sha256` provenance fields.

The other two scripts were checked as well:
- 400/400 existing DK family `*.workflow.json` graphs rebuilt by the generalised `dk-run-job.py` `graph()` are byte-identical, and match the ledger `graph_sha256`.
- The new `items-2` `prompt.txt` is byte-identical to the existing DK family prompts (`cmp` against `extras-01/prompt.txt`).

### Pikachu specifics

- Native source: `assets/gen/pikachu-native-reference/` (skeleton/helper/motions in `raw-*`; mesh + decoded textures in `geometry-reference/`). The same camera as DK is used: orthographic along native x, right-facing.
- Scale: `pikachu/scale-contract.json` sets 42.857 art px per native unit (= `5/(70/600)`, the ppu of every accepted Pikachu native guide), i.e. 0.1167 world px per art px. The accepted rough-beta tiled bodies used the same guides downscaled by 0.5. Family jobs generate at full guide scale, so Pikachu is about 600 px tall in the atlas, like DK.
- Identity/palette: fur (240,207,45), brown stripes/tail base (148,62,18), cheek (200,52,32), ink (22,17,16), eye white (251,250,241). The eye/mouth decals (`face*-reference.png`) are alpha-tested, as in `pikachu-native-guide.py`. There is no DK eye refinement: the native eye decal already gives the accepted black eye with highlight.
- Prompt/negative: the accepted Pikachu recipe wording ("Canonical Pikachu in the accepted clean outlined 2D cartoon identity and actual colored pose seed palette ... black-tipped ears ... one attached lightning tail with a brown base ... two brown back stripes only where visible ... no eyes through the back of the head"), adapted to the multi-pose atlas like DK's prompt. The negative is used verbatim (1128 accepted Pikachu workflows), and the seed is 2026100601 (the Pikachu recipe seed).
- Sockets: every new Pikachu strip still needs `Have` socket samples (`art-needs.md` section 3). This is not part of the art prep.

## Checks

- `render`: canvas-margin violations are empty for both fighters (DK 128/128 cells; Pikachu 251/251). No pose needed headroom re-rendering, and `poses/clipped/` is empty.
- `plan` travel: DK `items-2` needs no remove-trans. Pikachu removes Trans for `item_bat_swing_4`, `item_bat_swing_dash`, `item_heavy_walk`, `item_shoot_legs_walk_f/_b` and `item_throw_dash` (the simulation owns travel).
- Packed jobs: an automated check over every job confirmed the following for both fighters (DK 50 jobs / 128 cells, Pikachu 64 jobs / 251 cells), with no problems found:
  - every cell's figure stays at least 8 px clear of its cell edge;
  - there are no pure-black crop-fill pixels in the seed;
  - there are no figure pixels outside the cells.
- Visual review of `input-view.png`: DK `items-2-08` (4 fire-flower-loop cells) and Pikachu `items-59` (4 heavy-throw-hi cells, incl. overhead and turned poses). Every cell shows the full figure, with no clipping and no black strips. The Pikachu seed palette matches the accepted native seeds (`sources/item-native-review/*-palette-seed.png`).
- DK jobs often hold 2 cells, because the scope, flower and eat poses are wide at DK's scale. The packer keeps clip order and the 2048x1536 atlas. Pikachu packs 4 cells in almost every job.
