# Grounded DK contact audit at 200%

The current local production match produces substantial ejection at 200%.
All three smashes, a full Giant Punch and grounded Spinning Kong KO DK, Link
and Bear. Weak jabs, Hand Slap and grounded Headbutt have different purposes;
a lack of KO from those does not establish a global percent-scaling failure.

The deterministic match uses the actual registered move, normal input dispatch,
real hitbox contact, damage handler, Matter integration and stock loss. The
fixture controls starting position, percent and input sampling. It does not
inject a hit or resize the game. Physical keyboard ergonomics, a human player's
feel, other stages and the user's saved fighter are not established here.

- URL: `http://127.0.0.1:4175/platform-fighter/`
- Bundle: `index-B4ia6NWm.js`
- SHA256: `4ffde095b044c0d6f57b60a02df2bd8f4d7feb6698bfac364d9f97d938a890f2`
- Game: 1920 x 1080; flat main floor x560..1360, top930.
- Blast zone: x-240..2160, y-30..1630.
- Grounded matrix: 42 scenarios, 42 real contacts, 84/84 contact/selection checks,
  zero page errors. Facing right only; earlier strong/spin acceptance covers both.

`stun` means blast-zone crossing before control returns. `free` means crossing
after hitstun; a bottom KO with no recovery input is an idle fall, not an
inescapable launch. All observations use a fresh defender at 200%, default
fighter data, no items and a 400-frame post-attack horizon.

| Move | DK recipient | Link recipient | Bear recipient |
| --- | --- | --- | --- |
| jab | survives | survives | survives |
| jab2 | survives | bottom KO, free | bottom KO, free |
| forward-tilt | bottom KO, free | right KO, free | right KO, free |
| up-tilt | top KO, stun | top KO, stun | top KO, stun |
| down-tilt | survives | bottom KO, free | bottom KO, free |
| dash-attack | bottom KO, free | bottom KO, free | bottom KO, free |
| forward-smash | top KO, stun | top KO, stun | top KO, stun |
| up-smash | top KO, stun | top KO, stun | top KO, stun |
| down-smash | top KO, stun | top KO, stun | top KO, stun |
| giant-punch-uncharged | bottom KO, free | right KO, free | right KO, free |
| giant-punch-full | right KO, stun | right KO, stun | right KO, stun |
| grounded-spinning-kong | right KO, stun | right KO, stun | right KO, stun |
| side-special | survives | survives | survives |
| down-special | survives | survives | survives |

The up-tilt fixture stays one pixel beyond touching body widths: 61px for DK,
54px for Link and 58.5px for Bear. An initial shared 65px spacing legitimately
missed narrower bodies; it was a probe setup issue. Jab 2 isolates the second
jab after a deliberate first-jab miss. Dash attack uses a real 22-frame run-up,
then places its opponent for contact. Exact setup and selected move IDs are
recorded in [the report](dk-knockback-acceptance.json).

Grounded Headbutt uses the source downward angle270. The floor suppresses the
resulting downward motion; bury is still unsupported. This is a contextual
mechanic gap, not grounds to give Headbutt an invented upward launch. Hand Slap
is a low-growth upward juggle with narrow current authored reach. Its complete
source region coverage remains a separate gap.

## Defender actions after stun

Four deterministic input profiles cover forward tilt and uncharged Giant Punch
at 200% against DK, Link and Bear: 24 scenarios, 48/48 real-contact and move-
selection checks, zero page errors.

| Defender behavior | DK | Link | Bear |
| --- | --- | --- | --- |
| Inward DI, then inward drift | falls below stage | falls below stage | falls below stage |
| Inward DI, earliest legal aerial attack | falls below stage | falls below stage | falls below stage |
| Inward DI, earliest legal directional air dodge | falls below stage | falls below stage | falls below stage |
| Inward DI, earliest legal air jump, up-special 10 frames later | returns to main floor | falls below stage | returns to main floor |

These outcomes are the same for both sampled attacks. DK regains control far
offstage (x1805.6 / x1829.6). Its air jump replaces vy about +2.2 with -12.07,
clears reference-launch ownership, and preserves horizontal body motion. DK
then returns to x667.8 / x688.4 on the floor with all five stocks. Bear also
returns to the floor. The aerial-attack case selects the actual forward aerial
and preserves DK/Link reference launch; it does not cancel damage travel.
The air-dodge case cuts further travel but still requires recovery.

DK and Link have native reference-launch profiles (respectively gravity0.085,
fall speed1.63 and gravity0.096, fall speed1.6); Bear has none. Bear's different
motion and longer ordinary stun are recorded, but it still gets ejected and
strong moves still KO it. These calibrated engine trajectories are not a claim
of exact Ultimate launch distances or KO thresholds.

[Compact measurements](compact-measurements.json) contain contact launch data,
first launch, first actionable state, before/after action state, trajectory
extent and stock-loss edge/phase. Full defender timelines are stored under
[the defender evidence folder](../browser-defender-200/).

## Reproduce

From WSL at the repository root:

```sh
PF_REWORK_URL=http://127.0.0.1:4175/platform-fighter/ \
PF_PROBE_OUT=docs/review/2026-10-05/damage-knockback/browser-all-moves-200 \
PF_TARGETS=donkeykong,link,bear PF_PERCENTS=200 PF_ALL_GROUNDED=1 \
node tools/dk-knockback-acceptance.mjs
```

Defender profiles use `PF_MOVES=forward-tilt,giant-punch-uncharged` and
`PF_DEFENDER_BEHAVIOR=inward-di|jump-recovery|attack-escape|dodge-escape`, with
`PF_PROBE_OUT` pointing to their own evidence directory.

The harness also accepts `PF_DK_SPEC` for a raw or `.spec`-wrapped saved DK
fighter JSON and passes that spec through MatchScene's slot override. No saved
user fighter was supplied or verified in this audit; the report records null
for the override. Do not infer the user's loaded tuning from this clean match.

## Hosted build compatibility attempt

The public URL currently returns `index-CYzz3DGq.js`, SHA256
`4a5f457c9d769a6469438d863bb34dba36d6e53ec7c373c570c7c04c7059061b`.
The modern probe reached the old build but could not run because the old
Character lacks `applyHitDetailed`. Its
[failed compatibility report](../browser-public-200/dk-knockback-acceptance.json)
contains zero verified scenarios and must not be reported as public gameplay
acceptance. Separately captured hosted source proves different move/stage data.
