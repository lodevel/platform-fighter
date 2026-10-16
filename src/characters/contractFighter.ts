/**
 * ContractFighter — shared execute-hook implementation for every
 * roster fighter that declares the canonical {@link FighterMoveset}
 * contract.
 *
 * Before this class, each per-fighter subclass (Wolf / Cat / Owl /
 * Bear) hand-wrote ten structurally identical `executeXxx` stubs —
 * `executeJab() { return this.attemptAttack(DONKEYKONG_JAB.id); }` and
 * friends — ~110 lines of boilerplate per fighter whose ONLY
 * per-fighter content was which move constant the slot pins. Adding a
 * new slot meant editing four files in lockstep; adding a fifth
 * fighter meant copying the block a fifth time.
 *
 * The insight that collapses the duplication: every fighter already
 * publishes the slot ↔ move mapping as data — its frozen
 * `moveset: FighterMoveset` property (`DONKEYKONG_MOVESET.jab` IS
 * `DONKEYKONG_JAB`). So the execute hooks can be written ONCE against the
 * abstract contract: `executeJab` fires `this.moveset.jab.id`,
 * whatever fighter that happens to be. Per-fighter ownership is
 * preserved — the fighter still authors its `*_MOVESET` table and
 * nothing fighter-specific lives here — but the mechanical
 * "slot → attemptAttack(id)" plumbing exists exactly once.
 *
 * Hook semantics (identical to the per-fighter stubs this replaces):
 *
 *   • A held item's uses are resolved before these hooks run
 *     (Character dispatch + resolveItemInput); the hooks only fire the
 *     fighter's own moves.
 *   • Grounded normals and forward aerial use the resolved runtime slot,
 *     including saved moves with new IDs. Direct calls read the wired slot
 *     and retain the compiled declaration as a fallback.
 *   • `executeUpSpecial` routes through {@link Character.attemptUpSpecial}
 *     so the recovery's vertical physics integrate on the press frame.
 *   • `executeShield` / `executeDodge` remain no-op surface stubs —
 *     the defensive state machines still enter via `applyInput`'s
 *     `tickShield` / `tickDodge` composition (their migration is a
 *     future refactor sub-AC; keeping the public stubs preserves the
 *     contract surface the smoke suite locks down).
 *
 * Determinism: nothing here adds state — the hooks are pure dispatch
 * into the existing attack lifecycle.
 */

import { Character } from './Character';
import type { FighterMoveset } from './movesetContract';

export abstract class ContractFighter extends Character {
  /**
   * The fighter's frozen 10-slot moveset declaration. Each concrete
   * fighter assigns its `*_MOVESET` table (DK → `DONKEYKONG_MOVESET`,
   * etc.); the execute hooks below read the slot ids off it.
   */
  abstract readonly moveset: FighterMoveset;

  /** Fire the declared jab. Returns `true` iff the move started. */
  override executeJab(resolvedId: string | null = this.getLightAttackId()): boolean {
    return this.attemptAttack(resolvedId ?? this.moveset.jab.id);
  }

  /** Fire the declared tilt. */
  override executeTilt(resolvedId: string | null = this.getTiltAttackId()): boolean {
    return this.attemptAttack(resolvedId ?? this.moveset.tilt.id);
  }

  /** Fire the declared smash. */
  override executeSmash(resolvedId: string | null = this.getHeavyAttackId()): boolean {
    return this.attemptAttack(resolvedId ?? this.moveset.smash.id);
  }

  /** Fire the routed forward aerial, including a saved move with a new ID. */
  override executeFair(resolvedId: string | null = this.getAerialForwardId()): boolean {
    return this.attemptAttack(resolvedId ?? this.moveset.fair.id);
  }

  /** Fire the declared neutral special. */
  override executeNeutralSpecial(): boolean {
    return this.attemptAttack(this.moveset.neutralSpecial.id);
  }

  /** Fire the declared side special. */
  override executeSideSpecial(): boolean {
    return this.attemptAttack(this.moveset.sideSpecial.id);
  }

  /**
   * Fire the declared up special via the recovery-physics flow. The
   * optional stick-direction arguments default to "straight up" — the
   * canonical no-stick recovery press.
   */
  override executeUpSpecial(stickX: number = 0, stickY: number = -1): boolean {
    return this.attemptUpSpecial(stickX, stickY);
  }

  /** Fire the declared down special. */
  override executeDownSpecial(): boolean {
    return this.attemptAttack(this.moveset.downSpecial.id);
  }

  /**
   * Shield surface stub. The shield state machine still enters from
   * {@link Character.applyInput}'s `tickShield` composition; a later
   * refactor sub-AC migrates the entry point here.
   */
  executeShield(): void {
    /* state-machine entry remains in Character.applyInput */
  }

  /** Dodge surface stub — see {@link executeShield}. */
  executeDodge(): void {
    /* state-machine entry remains in Character.applyInput */
  }
}
