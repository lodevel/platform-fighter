import { describe, expect, it } from 'vitest';
import { LiveCpuController, buildLiveCpuPerception, cpuLandingSurface, type LiveCpuFighter, type LiveCpuWorld } from './LiveCpuController';
import { EasyTierAI } from './EasyTierAI';
import { MediumTierAI } from './MediumTierAI';
import { HardTierAI } from './HardTierAI';

export function fighter(playerIndex: 0 | 1 | 2 | 3, overrides: Partial<LiveCpuFighter> = {}): LiveCpuFighter {
  return { playerIndex, position: { x: playerIndex === 0 ? 200 : 280, y: 270 }, velocity: { x: 0, y: 0 },
    facing: 1, feetY: 300, halfWidth: 20, damagePercent: 0, stocksRemaining: 3, active: true,
    grounded: true, hitstun: false, hitlag: false, grabbed: false, holdingGrab: false, onLedge: false,
    invincible: false, canAttack: true, jumpsRemaining: 2, upSpecialAvailable: true, currentMove: null,
    stateLabel: 'idle', ...overrides };
}

function world(self = fighter(0), opponents = [fighter(1)]): LiveCpuWorld {
  return { fighters: [self, ...opponents], platforms: [{ left: 100, right: 500, top: 300, passThrough: false }],
    ledges: [{ x: 100, y: 300, side: 'left', platformId: 'main' }, { x: 500, y: 300, side: 'right', platformId: 'main' }],
    blastZone: { left: -400, right: 1000, top: -400, bottom: 900 } };
}

describe('live CPU controller', () => {
  it('constructs selected difficulty providers at runtime slot indices', () => {
    expect(new LiveCpuController(2, 'easy', 1).provider).toBeInstanceOf(EasyTierAI);
    expect(new LiveCpuController(1, 'medium', 1).provider).toBeInstanceOf(MediumTierAI);
    expect(new LiveCpuController(3, 'hard', 1).provider).toBeInstanceOf(HardTierAI);
  });

  it('uses unique physical opponent indices, excludes eliminated/respawning fighters and copies positions', () => {
    const input = world(fighter(2), [fighter(0), fighter(1, { active: false }), fighter(3)]);
    const snapshot = buildLiveCpuPerception(12, 2, input);
    expect(snapshot.self.slotIndex).toBe(2);
    expect(snapshot.opponents.map((opponent) => opponent.slotIndex)).toEqual([0, 3]);
    expect(snapshot.self.position).not.toBe(input.fighters[0]?.position);
    expect(snapshot.stage).toMatchObject({ stageLeft: 100, stageRight: 500, stageTop: 300 });
    expect(() => buildLiveCpuPerception(1, 2, world(fighter(2), [fighter(0), fighter(0)]))).toThrow('duplicate opponent');
  });

  it('feeds immediate own resources while preserving delayed opponent reaction', () => {
    const bot = new LiveCpuController(0, 'hard', 14);
    for (let frame = 0; frame < 30; frame++) {
      bot.sample(frame, world(fighter(0, { position: { x: 200 + frame, y: 270 }, jumpsRemaining: frame > 20 ? 0 : 2 }),
        [fighter(1, { position: { x: 280 + frame, y: 270 } })]));
    }
    const perceived = bot.provider.getLatestSnapshot()!;
    expect(perceived.self.position.x).toBe(229);
    expect(perceived.self.jumpsRemaining).toBe(0);
    expect(perceived.opponents[0]?.position.x).toBe(292);
  });

  it.each(['easy', 'medium', 'hard'] as const)('%s recovers using real remaining jumps, then a real upward special', (tier) => {
    const bot = new LiveCpuController(0, tier, 19);
    const offstage = fighter(0, { grounded: false, position: { x: 40, y: 340 }, feetY: 370, jumpsRemaining: 1 });
    expect(bot.sample(0, world(offstage))).toMatchObject({ moveX: 1, jump: true, special: false });
    const spent = { ...offstage, jumpsRemaining: 0 };
    expect(bot.sample(1, world(spent))).toMatchObject({ moveX: 1, moveY: -1, jump: false, special: true, attackHeavy: false });
    expect(bot.sample(2, world({ ...spent, upSpecialAvailable: false }))).toMatchObject({ moveX: 1, special: false, jump: false });
  });

  it('releases ledges and never attacks while hitstunned, frozen or grabbed', () => {
    const bot = new LiveCpuController(0, 'hard', 2);
    for (let frame = 0; frame < 12; frame++) expect(bot.sample(frame, world(fighter(0, { onLedge: true }))).ledgeRelease).toBeNull();
    expect(['getUp', 'roll', 'jump']).toContain(bot.sample(12, world(fighter(0, { onLedge: true }))).ledgeRelease);
    for (const [index, flags] of [{ hitstun: true }, { hitlag: true }, { grabbed: true }].entries()) {
      expect(bot.sample(13 + index, world(fighter(0, flags)))).toMatchObject({ attack: false, special: false, grab: false, jump: false });
    }
  });

  it('recognizes separate surfaces and current movement instead of treating a stage gap as ground', () => {
    const platforms = [{ left: 0, right: 100, top: 300, passThrough: false }, { left: 220, right: 400, top: 320, passThrough: false }];
    const self = fighter(0, { position: { x: 180, y: 330 }, feetY: 360, grounded: false });
    expect(cpuLandingSurface(self, platforms)).toBe(platforms[1]);
    const bot = new LiveCpuController(0, 'medium', 33);
    const input = { ...world(self), platforms };
    expect(bot.sample(0, input)).toMatchObject({ moveX: 1, jump: true });
    expect(buildLiveCpuPerception(0, 0, input).stage.stageLeft).toBe(220);
  });

  it('jumps toward an elevated opponent and drops through a platform to a lower opponent', () => {
    const above = world(fighter(0), [fighter(1, { position: { x: 220, y: 170 } })]);
    const up = new LiveCpuController(0, 'hard', 3);
    const outputs = Array.from({ length: 30 }, (_, frame) => up.sample(frame, above));
    expect(outputs.some((input) => input.jump)).toBe(true);
    const below = { ...world(fighter(0), [fighter(1, { position: { x: 220, y: 390 } })]),
      platforms: [{ left: 100, right: 500, top: 300, passThrough: true }] };
    const down = new LiveCpuController(0, 'medium', 3);
    expect(Array.from({ length: 40 }, (_, frame) => down.sample(frame, below)).some((input) => input.dropThrough)).toBe(true);
  });

  it('uses grab against shields and releases between repeated attack presses', () => {
    const bot = new LiveCpuController(0, 'hard', 4);
    const shields = world(fighter(0), [fighter(1, { position: { x: 235, y: 270 }, stateLabel: 'shielding' })]);
    const outputs = Array.from({ length: 45 }, (_, frame) => bot.sample(frame, shields));
    expect(outputs.some((input) => input.grab)).toBe(true);
    expect(outputs.every((input, index) => !input.grab || index === 0 || !outputs[index - 1]?.grab)).toBe(true);
  });

  it('resets cached presses, recovery and combo state while keeping same-seed sessions reproducible', () => {
    const a = new LiveCpuController(0, 'easy', 555);
    const b = new LiveCpuController(0, 'easy', 555);
    for (let frame = 0; frame < 120; frame++) expect(a.sample(frame, world())).toEqual(b.sample(frame, world()));
    a.reset(); b.reset();
    expect(a.provider.getLatestSnapshot()).toBeNull();
    for (let frame = 0; frame < 60; frame++) expect(a.sample(frame, world())).toEqual(b.sample(frame, world()));
    expect(a.sample(59, world())).toBe(a.sample(59, world()));
    expect(() => a.sample(2, world())).toThrow('Reset CPU');
    const hard = new LiveCpuController(0, 'hard', 2);
    hard.registerLandedHit('jab', 25);
    expect((hard.provider as HardTierAI).getOffensiveBlackboard().get('comboStage')).toBe('jabConnected');
    hard.reset();
    expect((hard.provider as HardTierAI).getOffensiveBlackboard().get('comboStage')).toBe('idle');
  });
});
