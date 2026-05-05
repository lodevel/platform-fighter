/**
 * MediumOffensiveTree — composes the Medium-tier offensive sub-tree
 * authored for AC 10203 Sub-AC 3 (extending the original AC 10204
 * Sub-AC 4 cut with contextual move selection and dodge evasion).
 *
 * The Medium tier sits between Easy ("noticeably weaker, frequently
 * idles, jab-only") and Hard ("competent human, full combo + KO smash
 * recognition"). The AC calls out three properties for Medium:
 *
 *   1. **Moderate reaction timing** — the perception / reaction
 *      window for Medium is the 22-28 frame band, gated at the
 *      controller layer via {@link
 *      import('../perception/reactionWindowPresets').REACTION_WINDOW_PRESETS}.
 *      The tree itself reads its already-delayed snapshot and need
 *      not re-implement the latency band; this factory therefore
 *      re-exports the band as {@link MEDIUM_REACTION_WINDOW_RANGE}
 *      so a controller wiring `buildMediumOffensiveTree` together
 *      with a {@link
 *      import('../perception/ReactionWindow').ReactionWindow} imports
 *      both pieces from one place.
 *
 *   2. **Contextual move selection (close-range vs ranged)** — the
 *      bot picks the appropriate verb for the current distance band.
 *      In melee reach (≤ 50 px) it runs the jab → tilt → smash
 *      pipeline. In mid-range (60-180 px default), where the
 *      opponent is too far to jab but close enough to threaten with
 *      a projectile, the {@link RangedAttackLeaf} fires `special`.
 *      Beyond mid-range the bot walks closer instead. This is the
 *      Medium tier's defining offensive trait — Easy fires random
 *      attacks irrespective of distance, Hard chases predictively
 *      with smash fishing; Medium picks the *contextually correct*
 *      verb at every distance band.
 *
 *   3. **Combo awareness** — the bot recognises the basic
 *      `jab → tilt` chain (and `jab → smash` / `tilt → smash` at KO
 *      percent) using the same {@link RecognizeFollowUpLeaf} and
 *      {@link ExecuteFollowUpLeaf} the Hard tier uses. Medium's
 *      combo follow-up branch is *unchanged* from Hard's — combo
 *      recognition is "competent" behaviour and the AC explicitly
 *      asks for it. What differs is the absence of Hard's *KO smash
 *      fishing* branch (the dedicated "I see they're at KO percent,
 *      let me run in for a smash" Selector slot). Medium will still
 *      smash if a recognised combo hands it that follow-up, but it
 *      won't independently set up a smash mix-up out of neutral.
 *
 *   4. **Basic defensive behavior (shielding/dodging)** — two
 *      complementary defensive branches sit at the head of the tree.
 *      {@link ShieldThreatLeaf} (default 70 % chance) blocks
 *      incoming attacks; {@link DodgeThreatLeaf} (default 20 %
 *      chance) burst-evades them with i-frames. Both are
 *      probabilistic so Medium reads as "blocks reliably and
 *      occasionally evades, but not perfectly" — a crucial
 *      believability property the AC (M2 AI quality bullet) asks
 *      for. With shield=0.70 and dodge=0.20 sequentially, combined
 *      coverage is ~76 % so roughly four out of five attacks get
 *      countered.
 *
 * Tree shape
 * ----------
 *
 *   Selector("mediumOffensive")
 *     ├── DodgeThreatLeaf                 — burst-evade incoming attacks
 *     ├── ShieldThreatLeaf                — block incoming attacks
 *     │
 *     ├── Sequence("comboFollowUp")       — chain off the prior hit
 *     │     ├── RecognizeFollowUpLeaf     — stage plan from blackboard
 *     │     ├── MoveTowardOpponentLeaf    — close to follow-up reach
 *     │     └── ExecuteFollowUpLeaf       — press the planned attack
 *     │
 *     ├── RangedAttackLeaf                — special at mid-range
 *     │
 *     └── Sequence("neutralJab")          — default chain entry
 *           ├── MoveTowardOpponentLeaf    — close to jab reach
 *           └── FireAttackLeaf (jab)      — press the jab
 *
 * Why this shape
 * --------------
 *
 *   1. The Selector ticks branches in priority order and short-
 *      circuits on the first non-Failure status. The dodge branch
 *      sits *first* because a successful evasion is the highest-
 *      value defensive outcome (it grants i-frames AND positions
 *      the bot to punish), and its low fire rate (0.20) means it
 *      naturally yields to the shield branch on most ticks.
 *
 *   2. The shield branch sits *second*. A successful block trumps
 *      any attack decision — a bot that opens with a jab while the
 *      opponent's smash is mid-startup is just trading damage for
 *      damage.
 *
 *   3. Combo follow-up sits third. A recognised chain is the
 *      highest-value *offensive* action available on the tick —
 *      dropping it back to neutral would waste the damage the bot
 *      has already invested. The Hard tier reasoning applies
 *      verbatim (see {@link buildHardOffensiveTree}); Medium and
 *      Hard agree on the combo follow-up policy.
 *
 *   4. Ranged attack sits fourth. When close-range options aren't
 *      productive (no combo staged, opponent out of melee reach),
 *      a mid-range projectile keeps pressure on. The leaf gates on
 *      a *minimum* distance so it never fires at point-blank where
 *      the projectile would whiff over the opponent's head — that
 *      protects the neutral-jab branch's domain.
 *
 *   5. Neutral-jab sits last as the fallback, identical to Hard's
 *      neutral entry. Jab is the safest opener — fast startup, low
 *      cooldown, and a successful jab transitions the Blackboard
 *      into `'jabConnected'` so the *next* tick will pick the
 *      combo branch.
 *
 *   6. **No KO smash branch.** The Hard-tier "fish for finisher at
 *      high %" branch is intentionally absent — Medium does not
 *      independently set up smash mix-ups out of neutral. The bot
 *      will still smash *as a combo follow-up* (jab→smash at KO%),
 *      because that's the recognised chain shape, but it won't dash
 *      across the screen at 90 % to fish for a smash. This is the
 *      single biggest behavioural delta between Medium and Hard,
 *      and matches the "balanced" framing in the AC.
 *
 * Reach numbers
 * -------------
 *
 * Default reaches mirror Hard's neutral-jab and combo-follow-up
 * settings so the two trees produce identical movement intent in
 * shared scenarios. The shield / dodge ranges are wider than the
 * jab range so the bot can pre-emptively defend before the
 * opponent's hitbox is in connection range, accounting for Medium's
 * 22-28 frame perception lag.
 *
 *   neutral jab        50 px   — matches `jab` slot of the default map
 *   combo close (jab)  60 px   — pre-position for tilt or smash
 *                                 follow-up; tilt reach is the median
 *                                 so we use that.
 *   ranged band      60-180 px — between melee reach and "too far
 *                                 to bother". Below this the
 *                                 melee branches own the tick;
 *                                 above this the bot walks closer.
 *   shield              90 px   — slightly wider than longest grounded
 *                                 smash reach so the block fires
 *                                 *before* the opponent's hitbox is
 *                                 actually inside the bot's hurtbox,
 *                                 absorbing the 22-28 frame perception
 *                                 lag.
 *   dodge               70 px   — tighter than shield because the
 *                                 i-frame window is short; the bot
 *                                 wants the attacker close enough
 *                                 that the dodge actually lines up
 *                                 with the active frames.
 *
 * Tunables can be passed via {@link MediumOffensiveTreeOptions} so
 * the controller layer can swap per-character reach without forking
 * the tree shape. Setting `dodgeChance: 0` or `rangedEnabled: false`
 * disables the new branches for backward-compatible tier variants.
 *
 * Determinism
 * -----------
 *
 * Every leaf and decorator used here is deterministic on its inputs.
 * The factory itself reads no Rng / no wall-clock — `buildMediumOffensiveTree`
 * always returns an isomorphic tree given the same options, so the
 * replay system can rebuild the controller from a snapshot by
 * calling the factory and replaying the recorded inputs. The shield
 * and dodge leaves each consume one `Rng.next()` per *gate-open*
 * tick (documented on each leaf); the ranged-attack and combo /
 * neutral branches are RNG-free.
 */

import { SelectorNode, SequenceNode } from '../behaviorTree/composites';
import type { IBehaviorNode } from '../behaviorTree/Node';

import {
  DEFAULT_DODGE_RANGE_PX,
  DEFAULT_DODGE_THREAT_STATE_LABELS,
  DEFAULT_MEDIUM_DODGE_CHANCE,
  DodgeThreatLeaf,
} from './DodgeThreatLeaf';
import { ExecuteFollowUpLeaf } from './ExecuteFollowUpLeaf';
import { FireAttackLeaf } from './FireAttackLeaf';
import { MoveTowardOpponentLeaf } from './MoveTowardOpponentLeaf';
import {
  DEFAULT_RANGED_MAX_RANGE_PX,
  DEFAULT_RANGED_MIN_RANGE_PX,
  DEFAULT_RANGED_SKIP_STATE_LABELS,
  RangedAttackLeaf,
} from './RangedAttackLeaf';
import { RecognizeFollowUpLeaf } from './RecognizeFollowUpLeaf';
import {
  DEFAULT_MEDIUM_SHIELD_CHANCE,
  DEFAULT_SHIELD_RANGE_PX,
  DEFAULT_THREAT_STATE_LABELS,
  ShieldThreatLeaf,
} from './ShieldThreatLeaf';
import type {
  OffensiveContext,
  OpponentStateLabel,
} from './types';

import { REACTION_WINDOW_PRESETS } from '../perception/reactionWindowPresets';
import type { ReactionWindowRange } from '../perception/ReactionWindow';

/**
 * Re-export of the Medium tier's reaction-window range from the
 * central preset table. Surfaced from this module so a controller
 * wiring `buildMediumOffensiveTree` together with a {@link
 * import('../perception/ReactionWindow').ReactionWindow} imports
 * both pieces from one place.
 *
 * Mirrors {@link REACTION_WINDOW_PRESETS.medium} — 22-28 frames. If
 * the preset table is ever retuned, this re-export tracks it
 * automatically (the object is deep-frozen so consumers can rely on
 * identity equality with the table entry).
 */
export const MEDIUM_REACTION_WINDOW_RANGE: ReactionWindowRange =
  REACTION_WINDOW_PRESETS.medium;

/** Construction options for {@link buildMediumOffensiveTree}. */
export interface MediumOffensiveTreeOptions {
  /** Reach for the default neutral jab branch. Default 50 px. */
  readonly neutralJabRangePx?: number;
  /** Reach for the combo follow-up close-the-gap step. Default 60 px. */
  readonly comboFollowUpRangePx?: number;
  /**
   * Maximum opponent distance that counts as a "block-worthy" threat.
   * Defaults to {@link DEFAULT_SHIELD_RANGE_PX} (90 px) so the leaf
   * pre-emptively blocks before the smash hitbox lands.
   */
  readonly shieldRangePx?: number;
  /**
   * Probability the bot blocks a recognised threat on a given tick.
   * Defaults to {@link DEFAULT_MEDIUM_SHIELD_CHANCE} (0.7) — Medium
   * reads as "blocks reliably but not perfectly".
   */
  readonly shieldChance?: number;
  /**
   * Opponent state labels that count as a block-worthy threat.
   * Defaults to {@link DEFAULT_THREAT_STATE_LABELS} (`['attacking']`).
   */
  readonly threatStateLabels?: readonly OpponentStateLabel[];
  /**
   * Maximum opponent distance that counts as a "dodge-worthy" threat.
   * Defaults to {@link DEFAULT_DODGE_RANGE_PX} (70 px) — tighter than
   * shield range because the dodge i-frame window is short.
   */
  readonly dodgeRangePx?: number;
  /**
   * Probability the bot dodges a recognised threat on a given tick.
   * Defaults to {@link DEFAULT_MEDIUM_DODGE_CHANCE} (0.2) — Medium
   * mixes occasional dodges into a primarily shield-based defence.
   * Set to `0` to disable the dodge branch entirely (backward-
   * compatible tier variants).
   */
  readonly dodgeChance?: number;
  /**
   * Opponent state labels that count as a dodge-worthy threat.
   * Defaults to {@link DEFAULT_DODGE_THREAT_STATE_LABELS}
   * (`['attacking']`).
   */
  readonly dodgeThreatStateLabels?: readonly OpponentStateLabel[];
  /**
   * Whether to include the ranged-attack branch. Defaults to `true`.
   * Set to `false` for a melee-only Medium variant (backward-
   * compatible tier variants).
   */
  readonly rangedEnabled?: boolean;
  /**
   * Minimum opponent distance for the ranged-attack branch to fire.
   * Defaults to {@link DEFAULT_RANGED_MIN_RANGE_PX} (60 px).
   */
  readonly rangedMinRangePx?: number;
  /**
   * Maximum opponent distance for the ranged-attack branch to fire.
   * Defaults to {@link DEFAULT_RANGED_MAX_RANGE_PX} (180 px).
   */
  readonly rangedMaxRangePx?: number;
  /**
   * Opponent state labels that *skip* the ranged-attack branch (the
   * projectile would dissipate). Defaults to
   * {@link DEFAULT_RANGED_SKIP_STATE_LABELS} (`['shielding',
   * 'dodging']`).
   */
  readonly rangedSkipStateLabels?: readonly OpponentStateLabel[];
}

/**
 * Resolved option set with defaults filled in. Useful for tests that
 * want to assert the actual tunables in play and for controller
 * integration code that wants to log the configuration.
 */
export interface ResolvedMediumOffensiveTreeOptions {
  readonly neutralJabRangePx: number;
  readonly comboFollowUpRangePx: number;
  readonly shieldRangePx: number;
  readonly shieldChance: number;
  readonly threatStateLabels: readonly OpponentStateLabel[];
  readonly dodgeRangePx: number;
  readonly dodgeChance: number;
  readonly dodgeThreatStateLabels: readonly OpponentStateLabel[];
  readonly rangedEnabled: boolean;
  readonly rangedMinRangePx: number;
  readonly rangedMaxRangePx: number;
  readonly rangedSkipStateLabels: readonly OpponentStateLabel[];
}

/** Apply defaults to the user-supplied options. */
export function resolveMediumOffensiveTreeOptions(
  options: MediumOffensiveTreeOptions = {},
): ResolvedMediumOffensiveTreeOptions {
  return {
    neutralJabRangePx: options.neutralJabRangePx ?? 50,
    comboFollowUpRangePx: options.comboFollowUpRangePx ?? 60,
    shieldRangePx: options.shieldRangePx ?? DEFAULT_SHIELD_RANGE_PX,
    shieldChance: options.shieldChance ?? DEFAULT_MEDIUM_SHIELD_CHANCE,
    threatStateLabels:
      options.threatStateLabels ?? DEFAULT_THREAT_STATE_LABELS,
    dodgeRangePx: options.dodgeRangePx ?? DEFAULT_DODGE_RANGE_PX,
    dodgeChance: options.dodgeChance ?? DEFAULT_MEDIUM_DODGE_CHANCE,
    dodgeThreatStateLabels:
      options.dodgeThreatStateLabels ?? DEFAULT_DODGE_THREAT_STATE_LABELS,
    rangedEnabled: options.rangedEnabled ?? true,
    rangedMinRangePx:
      options.rangedMinRangePx ?? DEFAULT_RANGED_MIN_RANGE_PX,
    rangedMaxRangePx:
      options.rangedMaxRangePx ?? DEFAULT_RANGED_MAX_RANGE_PX,
    rangedSkipStateLabels:
      options.rangedSkipStateLabels ?? DEFAULT_RANGED_SKIP_STATE_LABELS,
  };
}

/**
 * Build the Medium-tier offensive sub-tree. Returns the root
 * `IBehaviorNode` so a controller can plug it into a larger tree
 * (e.g. as a child of a top-level Selector that sits alongside
 * recovery / edge-guard branches).
 *
 * @example
 * ```ts
 * const root = buildMediumOffensiveTree();
 * const tree = new BehaviorTree<OffensiveContext, OffensiveBlackboardSchema>(
 *   root,
 *   { initialBlackboard: { ...DEFAULT_OFFENSIVE_BLACKBOARD } },
 * );
 * tree.tick(ctx);
 * // Tick output:
 * //   • opponent attacking in range → shield (prob ≈ 0.7) or jab fallback
 * //   • prior jab landed            → tilt follow-up
 * //   • neutral                     → jab
 * ```
 */
export function buildMediumOffensiveTree(
  options: MediumOffensiveTreeOptions = {},
): IBehaviorNode<OffensiveContext> {
  const resolved = resolveMediumOffensiveTreeOptions(options);

  // ---- Defensive dodge branch --------------------------------------------
  // Sits FIRST in the Selector so a successful evasion grants i-frames
  // AND positions the bot to punish the whiff. Default 0.20 chance —
  // dodge fires on a small fraction of threats; the remaining 0.80 of
  // ticks fall through to the shield branch. The leaf does NOT
  // consume RNG when its in-range / state gates are closed, so the
  // Selector ordering is RNG-neutral against non-threats.
  const dodge = new DodgeThreatLeaf(
    {
      dodgeRangePx: resolved.dodgeRangePx,
      dodgeChance: resolved.dodgeChance,
      threatStateLabels: resolved.dodgeThreatStateLabels,
    },
    'mediumOffensive.dodge',
  );

  // ---- Defensive shield branch -------------------------------------------
  // Sits SECOND — the primary defensive verb on Medium. Probabilistic
  // — Medium does not block perfectly; mix-ups (delayed attacks /
  // grabs) still beat it. See {@link ShieldThreatLeaf} module
  // docstring for determinism contract on the RNG roll.
  const shield = new ShieldThreatLeaf(
    {
      shieldRangePx: resolved.shieldRangePx,
      shieldChance: resolved.shieldChance,
      threatStateLabels: resolved.threatStateLabels,
    },
    'mediumOffensive.shield',
  );

  // ---- Combo follow-up branch --------------------------------------------
  // Recognises the planned next attack, closes to combo range, then
  // executes it. Sequence order differs from Hard's — Recognize sits
  // FIRST so a Failure (no combo in flight, or window expired)
  // returns Failure from the Sequence WITHOUT emitting movement.
  // This lets the Selector fall through to the ranged-attack branch
  // when there's no combo to chase. Hard tier doesn't need this
  // because it has no ranged branch — its combo branch's leading
  // MoveTowardOpponent emit is harmless because the Selector
  // short-circuits on Running anyway. Medium needs the explicit
  // gate.
  const comboFollowUp = new SequenceNode<OffensiveContext>(
    [
      new RecognizeFollowUpLeaf('comboFollowUp.recognize'),
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.comboFollowUpRangePx },
        'comboFollowUp.move',
      ),
      new ExecuteFollowUpLeaf({}, 'comboFollowUp.execute'),
    ],
    'comboFollowUp',
  );

  // ---- Ranged-attack branch ----------------------------------------------
  // The contextual move-selection branch. Fires `special` when the
  // opponent is in mid-range (60-180 px default) — too far for jab,
  // close enough for a projectile to connect. Sits between combo
  // follow-up and neutral jab so a staged combo always trumps a
  // poke, and the bot still falls back to walking-+-jab when the
  // mid-range conditions don't apply. Disabled when
  // `rangedEnabled: false`.
  const ranged = resolved.rangedEnabled
    ? new RangedAttackLeaf(
        {
          minRangePx: resolved.rangedMinRangePx,
          maxRangePx: resolved.rangedMaxRangePx,
          skipStateLabels: resolved.rangedSkipStateLabels,
        },
        'mediumOffensive.ranged',
      )
    : null;

  // ---- Neutral jab branch -------------------------------------------------
  // Default chain entry. A landed jab transitions `comboStage` to
  // `jabConnected`, so the *next* tick the Selector picks the combo
  // follow-up branch and chains into tilt or smash.
  const neutralJab = new SequenceNode<OffensiveContext>(
    [
      new MoveTowardOpponentLeaf(
        { preferredRangePx: resolved.neutralJabRangePx },
        'neutralJab.move',
      ),
      new FireAttackLeaf(
        {
          attackKind: 'jab',
          maxRangePx: resolved.neutralJabRangePx,
          comboStepId: 'medium.jab',
        },
        'neutralJab.press',
      ),
    ],
    'neutralJab',
  );

  const branches: IBehaviorNode<OffensiveContext>[] = [
    dodge,
    shield,
    comboFollowUp,
  ];
  if (ranged !== null) {
    branches.push(ranged);
  }
  branches.push(neutralJab);

  return new SelectorNode<OffensiveContext>(
    branches,
    'mediumOffensive',
  );
}
