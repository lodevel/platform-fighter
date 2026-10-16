import { describe, expect, it } from 'vitest';
import { computeHitlag } from '../characters/combat';
import { finalPacketBinding, finalRunPacketHit } from './finalPacketBinding';
import type { FinalFighter, FinalRun } from './finalSmashSchema';

const run = (fighter: FinalFighter): FinalRun => ({ id: 1, owner: { playerIndex: 0, fighter, generation: 0 }, resource: 'ball',
  scales: { damage: 1, reaction: 1 }, startedFrame: 100, phase: 'test', phaseAge: 0, captures: [] });

// Pinned Final packet flags must survive the shared combat conversion. The
// previous overnight handoff's generic victim multiplier .3 is not present in
// this pipeline; genuinely disabled packets produce zero freeze. This does
// not claim the unavailable native common victim dispatcher has been recovered.
describe('selected Final disableHitlag reaches shared victim hit-stop', () => {
  for (const [fighter, sheet, label] of [
    ['donkeykong', 'final_start', 'dk-detection'], ['donkeykong', 'final_attack', 'dk-early'],
    ['donkeykong', 'final_attack', 'dk-late'], ['donkeykong', 'final_end', 'dk-finisher'],
    ['link', 'final', 'ancient-flight'], ['link', 'final', 'ancient-fighter'], ['link', 'final', 'ancient-terrain'],
  ] as const) {
    it(`${fighter} ${label} disables victim freeze instead of applying an arbitrary multiplier`, () => {
      const packet = finalPacketBinding(fighter, sheet, label, 0)!;
      expect(packet).not.toBeNull(); expect(packet.native.disableHitlag).toBe(true);
      const hit = finalRunPacketHit(packet, run(fighter), 1, 1);
      expect(hit.hitlagMultiplier).toBe(0);
      expect(computeHitlag({ damage: hit.damage, targetPercent: 75, multiplier: hit.hitlagMultiplier })).toBe(0);
    });
  }
  it('retains Pikachu electric dash .2 and burst .7 because those packets do not disable hitlag', () => {
    for (const [sheet, label, multiplier, id] of [['final_dash', 'pika-dash', .2, 0], ['final2', 'pika-finisher', .7, 1]] as const) {
      const packet = finalPacketBinding('pikachu', sheet, label, id)!;
      expect(packet.native.disableHitlag).toBe(false);
      const hit = finalRunPacketHit(packet, run('pikachu'), 1, 1);
      expect(hit.hitlagMultiplier).toBe(multiplier);
      expect(computeHitlag({ damage: hit.damage, targetPercent: 75, multiplier: hit.hitlagMultiplier, electricCollision: true })).toBeGreaterThan(0);
    }
  });
});
