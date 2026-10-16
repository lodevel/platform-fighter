# Use UFD and SmashWiki together

For a Smash-derived kit, inspect both sources for each action in scope where
pages exist. For a scoped fix, cover its affected fields and dependencies.
Start with SmashWiki for technical mechanics and shared gameplay rules, and
cross-check UFD's numerical summaries and motion evidence. Source priority is
field-dependent; the more detailed page does not automatically win a conflict.
Keep the UFD pipeline and chosen fighter; adding SmashWiki evidence does not
change the donor, authorize adaptations or require copying another game's data.

## Choose sources by field

| Need | Normal research path |
| --- | --- |
| Frame overview, character stats, motion and contact visualization | UFD fighter/stats/legend and actual linked animations; compare overlapping wiki timing |
| Individual hit/throw regions | SmashWiki technical hitbox/throw tables: IDs, bone, radius/offsets, damage, launch, hitlag/SDI, re-hit, masks and interaction flags; compare UFD summaries |
| Protection and defense | Both sources' notes and wiki timing strips/tables: whole body or named parts, intangibility, invincibility, armor, dodge/ledge/tech branches |
| Move-specific movement and state | Wiki Parameters/Timing/Properties sections and move articles: speeds, gravity, steering, charge, landing/ledge transitions; primary state/parameter data for remaining rules |
| Shared systems and game feel | Selected-game sections of wiki Hitlag, Hitstun, Knockback, Buffer, DI/SDI, Shield/Shieldstun, Jump/Short hop, Fast fall and Lag; inspect linked technical/primary research for algorithms and exceptions |
| Engine algorithm, unexplained conflict or missing value | Relevant pinned game data/state code or reproducible source-game measurement |
| Visible effects or motion obscured by overlays | Optional inspected gameplay footage; follow [footage guidance](ufd-motion.md#optional-gameplay-footage) |

SmashWiki is a legitimate secondary technical source. A clearly published
value may enter the specification as `sourced` with SmashWiki attribution;
there is no universal requirement to find a native dump for every wiki field.
Record source kind, version, uncertainty and corroboration separately. An
uncertain claim remains uncertain. A community table does not establish the
underlying engine algorithm or certify exact source-game parity by itself.
Likewise, UFD agreement or a passing local test does not certify native parity.
Respect an explicitly stricter fidelity requirement in the task.

## Research shared systems for game feel

A correct move table cannot reproduce feel if the engine freezes the wrong
objects, consumes buffered input at the wrong time or transports launches using
another game's rules. For applicable character behavior, identify the reviewed
shared consumer and its evidence, or record a concrete capability/source gap.
Reuse a verified profile rather than reimplementing formulas per fighter. Extend
shared behavior when needed within the task; a character source audit alone
does not authorize retuning the entire engine or unrelated fighters.

| System | Read and verify the parts that affect the task |
| --- | --- |
| Hitlag | Formula, rounding/caps, modifiers and exemptions; attacker/victim/projectile ownership; which clocks freeze and input remains available |
| Knockback and hitstun | Damage/weight/growth/base/fixed knockback, special angles, stale/other modifiers, launch integration/decay, tumble and Ultimate speed-up, resulting action availability |
| DI, SDI and LSI/ASDI | Separate trajectory changes, hitlag displacement and launch-speed influence; input sampling, eligibility, rate/angle limits and per-hitbox multipliers |
| Input buffer | Press-history versus held-input buffering, legal-action openings, release/expiry, priority and single consumption through hitlag/landing/charge |
| Jump, short hop, fastfall and landing | Input conditions, jumpsquat exceptions, initial full-hop shaping, rise/fall and drift, fastfall eligibility, ordinary/aerial/special landing and autocancel |
| Defense | Shield health/size, shieldstun/pushback/parry and out-of-shield rules; dodge/ledge/getup/respawn protection and vulnerability transitions |
| Grabs and captive states | Entry-percent hold duration, accepted mash inputs, release reasons and both actors' action restrictions; post-release grab immunity, captive damage and throw transitions |

Capture the selected game's formula **and** its variable definitions, ordering,
rounding/clamps, conditional branches and inputs. Do not take a "Melee onward"
formula without reading Ultimate-specific changes. For example, the Hitstun
article documents launch speed-up, so `floor(knockback * 0.4)` alone is not an
effective Ultimate recovery clock. The Buffer article distinguishes a 9-frame
press window from held-input behavior; one generic timeout is not both systems.
The Jump article lists Kazuya's jumpsquat exception and full-hop initial shaping;
a universal 3-frame rule and constant jump impulse miss those distinctions.

MediaWiki's API/raw wikitext can make acquisition reproducible, but extraction
still needs redirects, section scope, template defaults, icon legends and math
interpretation. Read useful original research cited by the wiki when resolving
algorithm details. Retain openly documented unknowns; prose is not proof of
completeness. Verify shared changes against independent expected trajectories,
freeze/input/contact traces and affected fighters, through the actual match
physics and input routes. Do not claim matching feel from formula unit tests.

Presentation contributes separately: animation, hit effects, sound, camera and
hitstop presentation need actual visual/audio review. Optional gameplay or
Sakurai explanations can inform those choices; a suggested video becomes
evidence only after its relevant sequence has been inspected. Human controller
feel remains untested without a person, even when deterministic checks pass.

## Acquire the relevant pages

1. Open UFD and the selected game's wiki fighter page and move subpages, such as
   `Pikachu (SSBU)/Down special`. Inspect technical sections even if Overview is
   empty. Follow navigation to defense, throws and landing branches in scope;
   UFD's main attack list is not the whole action inventory.
2. Inspect Timing, Hitboxes/Throw Data, Parameters, Properties, notes and useful
   cited sources. General articles such as Thunder or Intangibility can span
   games: select the applicable section and use game-specific technical pages
   for fighter values. Patch history helps identify changed behavior; it does
   not prove an unlabeled table's exact patch.
3. Record check date, game, stated patch or unknown, URL, wiki revision permalink
   (`oldid`), and a retained capture/hash when transcribing data. Page revision
   date is not the game's patch date. If extraction relies on templates, record
   relevant template revisions too; an article permalink alone may render later
   transcluded templates.
4. Inspect rendered legends/tooltips and retain raw wikitext when numeric data
   is hidden in icons or nested templates. Do not copy a text scraper's missing
   angle, mask, boolean or frame-strip image as zero/false. Resolve template
   defaults from the captured template, not an assumed schema. A missing page,
   blank section or maintenance notice means coverage needs assessment per field;
   missing wiki documentation does not prove a mechanic is absent.

## Interpret the technical data

- Preserve region IDs, part/strike identities, re-hit intervals, bone-local
  shape/offsets, ground/air and target masks, hitlag/SDI, shield damage and
  reflect/absorb/direct/clank/rebound flags where supplied. Same damage does not
  imply same launch or interaction. Wiki launch-angle codes such as 361 are
  special engine rules, not literal degrees. Look up the selected game's rule.
- Bone-local source geometry still needs the matching posed transform. A
  3D radius or stretch is not automatically our 2D rectangle; record conversion
  or target-body retargeting separately. Hitbox tables do not supply all posed
  receiving hurtboxes. Follow [animation/collision](animation-art.md).
- Read each timing strip's legend and row label. Strips can describe hitboxes,
  named body parts, charge, armor, autocancel or actionable states separately.
  Count displayed frame slots, not transition markers as extra steps. Cross-check
  the accompanying timing table and flag a strip/table disagreement.
- Identify the clock origin: move entry, release, landing or a conditional
  substate. Thunder's self-hit table starts at bolt contact with Pikachu; its
  ground and air windows are separate. Do not turn local frame 1 into initial
  down-special frame 1 or start a self-hit burst when the bolt misses.
- Keep intangibility (ordinary attacks do not contact affected hurtboxes),
  invincibility (contact can occur without ordinary damage/launch), and armor
  (damage can occur while reaction is suppressed) distinct. Their hitlag,
  grab/exception and threshold rules need the chosen game's evidence. Partial
  head/arm protection never implies whole-body immunity; hurtbox movement alone
  is also different from a protection status. Jostling concerns fighter pushing,
  not attack damage or terrain collision.
  For ordinary direct contacts in Ultimate, [intangibility](https://www.ssbwiki.com/index.php?title=Intangibility&oldid=1997771)
  produces no connected hit or hitlag; [invincibility](https://www.ssbwiki.com/index.php?title=Invincibility&oldid=2056951)
  connects without damage/launch/hitstun and freezes the attacker, while the
  protected fighter remains unaffected. Do not freeze both fighters or cancel
  their current moves merely because protection was touched. Projectiles,
  grabs and special exceptions require their own source-supported contract.
  A legacy boolean named `invincible` may implement suppression instead of true
  invincibility; verify its consumer, including respawn. Neither status grants
  blast-zone immunity or removes ordinary stage collision. Named hazard
  exceptions are stage-specific and do not imply phasing through every floor.
- Parameters can be absolute, additive or multipliers of base character stats.
  Record units, baseline, affected phase and restore/exit rule. Do not use a
  gravity multiplier as an absolute acceleration, or infer the update algorithm
  from a parameter's label alone. Charge damage, charge capacity and post-full
  hold duration are independent facts.

## Reconcile overlapping values

Keep both observations in the field-level ledger before choosing runtime data.
Check game/patch, variant/region order, charge, base versus modified damage
(1v1, stale/fresh, short hop, etc.), inclusive frame numbering, total versus first
actionable frame, animation versus gameplay counter, hitlag inclusion, and clock
origin. Normalize only with an evidenced mapping; do not assume an unexplained
difference is an off-by-one error or average conflicting numbers.

For example, Mario's UFD up-smash total 39 and wiki interruptible frame 40
describe compatible lockout boundaries, while animation length 52 describes
another quantity. Pikachu down throw needs more care: UFD lists 29/51, whereas
the wiki lists release 21/interruptible 44 and explains hitlag plus delayed victim
knockback. That supplies a concrete hypothesis to investigate, not permission
to silently substitute 21 for 29 or manufacture an extra damaging hit.

Prefer evidence that actually establishes the disputed field for the relevant
version. Neither site always wins. Pinned primary data can resolve record values;
raw script frames still need motion-rate/state/hitlag interpretation. If the
conflict remains, mark that field unresolved and continue independent work.
Keep mechanism, number, boundary and source-to-runtime conversion provenance
separate; see [move behavior](move-behavior.md#research-sourced-behavior).

For captive-state gaps, inspect the selected game's [Grab](https://www.ssbwiki.com/Grab)
and [Grab release](https://www.ssbwiki.com/Grab_release) mechanics before treating
an absent native common-status dump as an absent published rule. Keep captured
entry percent separate from later pummel damage, a minimum grab duration separate
from a remaining-time clamp, and release lag separate from resource length.
Post-release grab immunity does not imply immunity to damaging attacks.
Resolve game-specific differences and disputed values per field; do not extend
the ordinary-grab formula to command grabs without supporting evidence.

## Verify the consumed mechanics

Use the affected skill's normal running-game acceptance, with expectations drawn
from captured source evidence rather than the implementation's constants:

- For protection windows, probe before/at/start, last protected step and first
  vulnerable step. For partial protection, aim separately at protected and
  ordinary body parts. Measure contact, damage, hitlag and reaction as applicable;
  an invincibility boolean or a blue overlay alone does not verify these outcomes.
- Exercise applicable armor thresholds, grab interactions, ground/air variants,
  masks, re-hit/clank, reflection/absorption and ledge/pushing behavior. Use only
  source-supported branches; report missing engine capability explicitly.
- Check hitlag/pause clocks and protection cleanup on normal end, applicable
  landing/interruption and reset. A long-lived attack may contact after an
  intangible window ends; do not consume its hit solely for touching absent
  hurtboxes unless the source's rule calls for it.
- For affected protection consumers, verify attacker and defender hitlag
  independently, ongoing move/pose clocks, grab rejection, long-lived contact
  after intangibility expires and strike consumption after invincible contact.
  Also confirm a protected fighter can still lose a stock at a blast boundary.
  Source-specific hazard behavior belongs to the selected stage's coverage.

Record measured behavior, build identity and remaining source-comparison gaps.
Published data, schema support and runtime observation remain separate claims.
