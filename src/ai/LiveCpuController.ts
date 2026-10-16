import type { AiDifficulty, BlastZone } from '../types';
import type { CharacterInput } from '../characters/Character';
import type { LedgeCandidate } from '../characters/ledgeDetection';
import type { LedgeReleaseAction } from '../characters/ledgeHangState';
import { closeCharacterInput, NEUTRAL_INPUT_SNAPSHOT, type PlayerSlotIndex } from '../input/InputProvider';
import { Rng } from '../utils/Rng';
import { EasyTierAI } from './EasyTierAI';
import { MediumTierAI } from './MediumTierAI';
import { HardTierAI } from './HardTierAI';
import { buildWorldSnapshot, type PerceivedMoveState, type PerceivedOpponentStateLabel, type WorldSnapshot } from './perception/WorldSnapshot';
import type { AttackKind } from './offensive/types';

export interface LiveCpuFighter {
  readonly playerIndex: PlayerSlotIndex;
  readonly position: { readonly x: number; readonly y: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly facing: 1 | -1;
  readonly feetY: number;
  readonly halfWidth: number;
  readonly damagePercent: number;
  readonly stocksRemaining: number;
  readonly active: boolean;
  readonly grounded: boolean;
  readonly hitstun: boolean;
  readonly hitlag: boolean;
  readonly grabbed: boolean;
  readonly holdingGrab: boolean;
  readonly onLedge: boolean;
  readonly invincible: boolean;
  readonly canAttack: boolean;
  readonly jumpsRemaining: number;
  readonly upSpecialAvailable: boolean;
  readonly currentMove: PerceivedMoveState | null;
  readonly stateLabel: PerceivedOpponentStateLabel;
}

export interface LiveCpuPlatform {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly passThrough: boolean;
}

export interface LiveCpuWorld {
  readonly fighters: ReadonlyArray<LiveCpuFighter>;
  readonly platforms: ReadonlyArray<LiveCpuPlatform>;
  readonly ledges: ReadonlyArray<LedgeCandidate>;
  readonly blastZone: BlastZone;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Choose an actual landing surface, rather than treating gaps between platforms as ground. */
export function cpuLandingSurface(self: LiveCpuFighter, platforms: ReadonlyArray<LiveCpuPlatform>): LiveCpuPlatform | null {
  let best: LiveCpuPlatform | null = null;
  let bestCost = Infinity;
  for (const platform of platforms) {
    const dx = self.position.x - clamp(self.position.x, platform.left + 10, platform.right - 10);
    const dy = self.feetY - platform.top;
    const supported = self.grounded && Math.abs(dx) < self.halfWidth && Math.abs(dy) < 18;
    const canLand = dx === 0 && dy <= 12;
    const cost = supported ? -1e9 : canLand ? -1e6 + Math.abs(dy) : dx * dx + dy * dy * 0.5;
    if (cost < bestCost) { best = platform; bestCost = cost; }
  }
  return best;
}

export function buildLiveCpuPerception(frame: number, playerIndex: PlayerSlotIndex, world: LiveCpuWorld): WorldSnapshot {
  const self = world.fighters.find((fighter) => fighter.playerIndex === playerIndex);
  if (!self) throw new Error(`Missing CPU fighter ${playerIndex}`);
  const surface = cpuLandingSurface(self, world.platforms);
  const left = surface?.left ?? (world.blastZone.left + world.blastZone.right) / 2;
  const right = surface?.right ?? left;
  const top = surface?.top ?? (world.blastZone.top + world.blastZone.bottom) / 2;
  const ledges = world.ledges.filter((ledge) => Math.abs(ledge.y - top) < 2
    && (Math.abs(ledge.x - left) < 2 || Math.abs(ledge.x - right) < 2));
  const ledge = ledges.slice().sort((a, b) => Math.abs(a.x - self.position.x) - Math.abs(b.x - self.position.x))[0];
  return buildWorldSnapshot({ tickIndex: frame,
    self: { slotIndex: playerIndex, position: { ...self.position },
      velocity: { vx: self.velocity.x, vy: self.velocity.y }, facing: self.facing,
      damagePercent: self.damagePercent, stocksRemaining: self.stocksRemaining,
      isAirborne: !self.grounded, isInHitstun: self.hitstun, isOnLedge: self.onLedge,
      jumpsRemaining: self.jumpsRemaining, upSpecialAvailable: self.upSpecialAvailable,
      currentMove: self.canAttack ? self.currentMove : self.currentMove ?? { kind: 'unavailable', phase: 'recovery', framesRemaining: 1 },
    },
    opponents: world.fighters.filter((fighter) => fighter.active && fighter.playerIndex !== playerIndex).map((fighter) => ({
      slotIndex: fighter.playerIndex, position: { ...fighter.position },
      velocity: { vx: fighter.velocity.x, vy: fighter.velocity.y }, facing: fighter.facing,
      damagePercent: fighter.damagePercent, stocksRemaining: fighter.stocksRemaining,
      stateLabel: fighter.stateLabel, isAirborne: !fighter.grounded, isInvincible: fighter.invincible,
    })),
    stage: { stageLeft: left, stageRight: right, stageTop: top, blastZone: { ...world.blastZone },
      nearestLedge: ledge ? { x: ledge.x, y: ledge.y, side: ledge.side } : null },
  });
}

/** Match-scoped CPU: tier decisions with current physical recovery and navigation constraints. */
export class LiveCpuController {
  readonly provider: EasyTierAI | MediumTierAI | HardTierAI;
  private readonly rng: Rng;
  private lastFrame = -1;
  private previous: CharacterInput = NEUTRAL_INPUT_SNAPSHOT;
  private nextJumpFrame = 0;
  private nextSpecialFrame = 0;
  private jumpHoldUntil = -1;
  private ledgeStart = -1;
  private ledgeAction: LedgeReleaseAction = 'getUp';

  constructor(readonly playerIndex: PlayerSlotIndex, readonly difficulty: AiDifficulty, seed: number) {
    this.rng = new Rng(seed);
    const options = { slotIndex: playerIndex, rng: this.rng, label: `cpu.${difficulty}.slot${playerIndex}` };
    this.provider = difficulty === 'easy' ? new EasyTierAI(options)
      : difficulty === 'hard' ? new HardTierAI(options) : new MediumTierAI(options);
  }

  getHistoryEvidence(){return {playerIndex:this.playerIndex,difficulty:this.difficulty,rngState:this.rng.getState(),
    lastFrame:this.lastFrame,previous:this.previous,nextJumpFrame:this.nextJumpFrame,nextSpecialFrame:this.nextSpecialFrame,
    jumpHoldUntil:this.jumpHoldUntil,ledgeStart:this.ledgeStart,ledgeAction:this.ledgeAction,provider:this.provider.snapshot()};}
  reset(): void {
    this.provider.reset();
    this.lastFrame = -1;
    this.previous = NEUTRAL_INPUT_SNAPSHOT;
    this.nextJumpFrame = 0;
    this.nextSpecialFrame = 0;
    this.jumpHoldUntil = -1;
    this.ledgeStart = -1;
  }

  registerLandedHit(moveKind: string, opponentPercent: number): void {
    if (this.provider instanceof EasyTierAI) return;
    const landed: AttackKind = moveKind === 'jab' ? 'jab' : /smash/i.test(moveKind) ? 'smash'
      : /special/i.test(moveKind) ? 'special' : 'tilt';
    this.provider.registerLandedHit({ landed, opponentPercent,
      landedTick: Math.max(0, this.provider.snapshot().offensiveTickCount - 1) });
  }

  sample(frame: number, world: LiveCpuWorld): CharacterInput {
    if (frame === this.lastFrame) return this.previous;
    if (frame < this.lastFrame) throw new Error('Reset CPU before rewinding frames');
    const self = world.fighters.find((fighter) => fighter.playerIndex === this.playerIndex);
    if (!self || !self.active) { this.jumpHoldUntil = -1; return this.finish(frame, {}); }
    const perception = buildLiveCpuPerception(frame, this.playerIndex, world);
    this.provider.setLiveSelfPerception(perception);
    this.provider.pushPerception(frame, perception);
    const proposed = this.provider.sample(frame);
    const surface = cpuLandingSurface(self, world.platforms);
    const stage = perception.stage;
    const inward = Math.sign(clamp(self.position.x, stage.stageLeft + 25, stage.stageRight - 25) - self.position.x);

    if (self.hitlag || self.grabbed) { this.jumpHoldUntil = -1; return this.finish(frame, {}); }
    if (self.hitstun) {
      this.jumpHoldUntil = -1;
      return this.finish(frame, { moveX: this.difficulty === 'easy' ? 0 : inward, moveY: 0 });
    }
    if (self.onLedge) {
      this.jumpHoldUntil = -1;
      if (this.ledgeStart < 0) {
        this.ledgeStart = frame;
        this.ledgeAction = this.difficulty === 'hard' ? (['getUp', 'roll', 'jump'] as const)[this.rng.range(0, 2)]! : 'getUp';
      }
      const wait = this.difficulty === 'easy' ? 36 : this.difficulty === 'medium' ? 22 : 12;
      return this.finish(frame, frame - this.ledgeStart >= wait ? { ledgeRelease: this.ledgeAction } : {});
    }
    this.ledgeStart = -1;
    if (self.holdingGrab) return this.finish(frame, { moveX: self.facing });

    const offstage = !self.grounded && (self.position.x < stage.stageLeft || self.position.x > stage.stageRight
      || self.feetY > stage.stageTop + 18);
    if (offstage) {
      const targetX = clamp(self.position.x, stage.stageLeft + 28, stage.stageRight - 28);
      const movement = Math.sign(targetX - self.position.x);
      const falling = self.velocity.y >= -0.5;
      const jump = self.jumpsRemaining > 0 && frame >= this.nextJumpFrame && falling;
      const special = !jump && self.upSpecialAvailable && self.canAttack && frame >= this.nextSpecialFrame
        && (self.jumpsRemaining === 0 || self.feetY > stage.stageTop + 160) && falling;
      if (jump) this.holdNavigationJump(frame);
      if (special) this.nextSpecialFrame = frame + 40;
      return this.finish(frame, { moveX: movement, jump, special, moveY: special ? -1 : 0 });
    }

    const delayed = this.provider.getLatestSnapshot();
    const target = delayed?.opponents.find((opponent) => opponent.slotIndex === this.provider.getLastTargetSlot())
      ?? delayed?.opponents[0];
    if (!target) return this.finish(frame, {});
    const dx = target.position.x - self.position.x;
    const dy = target.position.y - self.position.y;
    let input = { ...proposed };
    if (!self.canAttack) input = { ...input, attack: false, attackHeavy: false, special: false, grab: false };
    if (self.canAttack && Math.abs(dx) < 100 && (input.attack || input.attackHeavy || input.special)) {
      input.moveX = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
      if (!input.special) input.moveY = Math.abs(dy) > 40 ? Math.sign(dy) : 0;
    }
    if (self.canAttack && this.difficulty !== 'easy' && target.stateLabel === 'shielding' && Math.abs(dx) < 48 && Math.abs(dy) < 50) {
      input = { ...input, moveX: Math.sign(dx), grab: true, attack: false, attackHeavy: false, special: false, shield: false };
    }
    if (self.grounded && self.jumpsRemaining > 0 && frame >= this.nextJumpFrame && dy < -55 && Math.abs(dx) < 260) {
      input = { ...input, jump: true, moveX: Math.sign(dx), attack: false, attackHeavy: false, special: false, moveY: 0 };
      this.holdNavigationJump(frame);
      this.nextJumpFrame = frame + 45;
    }
    if (self.grounded && surface?.passThrough && dy > 60 && Math.abs(dx) < 160) {
      input = { ...input, dropThrough: true, jump: false, attack: false, attackHeavy: false };
    }
    if (self.grounded && surface && input.moveX !== 0) {
      const ahead = self.position.x + input.moveX * (Math.abs(self.velocity.x) * 4 + self.halfWidth + 14);
      if (ahead < surface.left || ahead > surface.right) {
        const nextSurface = world.platforms.find((platform) => platform !== surface
          && (input.moveX > 0 ? platform.left >= surface.right && platform.left - surface.right < 180
            : platform.right <= surface.left && surface.left - platform.right < 180)
          && Math.abs(platform.top - surface.top) < 90);
        if (nextSurface && self.jumpsRemaining > 0 && frame >= this.nextJumpFrame) {
          input.jump = true; this.holdNavigationJump(frame);
        } else input.moveX = 0;
      }
    }
    if (self.grounded && frame < this.jumpHoldUntil) {
      // An attack during squat requests the engine's short-hop aerial macro.
      // Navigation needs the full jump; wait until takeoff before choosing an aerial.
      input = { ...input, moveY: 0, attack: false, attackHeavy: false, special: false,
        grab: false, shield: false, dodge: false };
    }
    return this.finish(frame, input);
  }

  private finish(frame: number, input: Partial<CharacterInput>): CharacterInput {
    if (input.special || input.dropThrough) this.jumpHoldUntil = -1;
    // Attack commands are presses, shield and axes are holds. Re-emitted presses must release between attempts.
    const closed = closeCharacterInput({ ...NEUTRAL_INPUT_SNAPSHOT, ...input });
    const next = closeCharacterInput({ ...closed,
      attack: closed.attack && !this.previous.attack,
      attackHeavy: closed.attackHeavy && !this.previous.attackHeavy,
      special: closed.special && !this.previous.special,
      grab: closed.grab && !this.previous.grab,
      jump: frame < this.jumpHoldUntil || (closed.jump && !this.previous.jump),
      dodge: closed.dodge && !this.previous.dodge,
    });
    this.lastFrame = frame; this.previous = next;
    return next;
  }

  private holdNavigationJump(frame: number): void {
    // Keep jump held through the 3-frame squat and ascent; release before the next air jump.
    this.jumpHoldUntil = frame + 32;
    this.nextJumpFrame = frame + 34;
  }
}
