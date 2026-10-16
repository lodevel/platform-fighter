/** Source-timeline and independent lease boundaries, prepared final-only. */
import { describe, expect, it } from 'vitest';
import { beginLinkItemContextEquipment, stepLinkItemContextEquipment, selectLinkItemContextEquipment,
  parseLinkItemContextEquipmentState, LINK_ITEM_CONTEXT_EQUIPMENT_FACTS, type LinkItemContextMotion,
  type LinkItemContextEquipmentState, type LinkItemContextEquipmentStep } from './linkItemContextEquipment';
const ordinary = { sword: 'normal' as const, shield: 'normal' as const, bow: 'hidden' as const, heldItemVisible: true, ancientBowVisible: false };
function begin(motion: LinkItemContextMotion = 'item_light_throw_hi', temporaryFood = false) { return beginLinkItemContextEquipment({
  frame: 10, generation: 2, actionId: 'accepted-action-5', itemIdentity: 'entity-9@spawn4', motion,
  facing: -1, nativeMotionFrame: 1, motionRate: 1, temporaryFood, equipmentAtEntry: ordinary }); }
function step(state: LinkItemContextEquipmentState, change: Partial<LinkItemContextEquipmentStep> = {}) { return stepLinkItemContextEquipment(state, {
  frame: state.lastFrame + 1, generation: 2, clockAdvances: true, nativeMotionFrame: state.nativeMotionFrame + 1,
  controlEnded: false, activeActionId: state.actionId, interruption: null, ...change }); }
describe('actual item expression/equipment lease, final preparation', () => {
  it('keeps exact Bat4 sword10/85 separate from shared sword and StarRod source expressions', () => {
    const bat = begin('item_bat_swing_4');
    expect(selectLinkItemContextEquipment(step(bat, { nativeMotionFrame: 9 })!).equipment.sword).toBe('normal');
    const back = step(bat, { nativeMotionFrame: 10 })!;
    expect(selectLinkItemContextEquipment(back).equipment).toMatchObject({ sword: 'back', shield: 'back' });
    expect(selectLinkItemContextEquipment(step(back, { nativeMotionFrame: 84 })!).equipment.sword).toBe('back');
    expect(selectLinkItemContextEquipment(step(back, { nativeMotionFrame: 85 })!).equipment.sword).toBe('normal');
    for (const motion of ['item_sword_swing_4', 'item_starrod_swing_4'] as const)
      expect(selectLinkItemContextEquipment(step(begin(motion), { nativeMotionFrame: 10 })!).equipment.sword).toBe('normal');
    expect(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_sword_swing_1.resource)
      .toBe(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_starrod_swing_1.resource);
    expect(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_sword_swing_1.expressionFunction)
      .not.toBe(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_starrod_swing_1.expressionFunction);
  });
  it('keeps Hammer gear-only at expression entry without borrowing or overriding its wrapping body clock', () => {
    const hammer = begin('item_hammer_wait');
    const selected = selectLinkItemContextEquipment(hammer);
    expect(selected.ownsBodyRoute).toBe(false);
    expect(selected.equipment).toMatchObject({ sword: 'back', shield: 'back' });
    const later = step(hammer, { nativeMotionFrame: 1 })!;
    expect(later.nativeMotionFrame).toBe(1);
    expect(() => step(later, { nativeMotionFrame: 2 })).toThrow();
    expect(step(later, { nativeMotionFrame: null, controlEnded: true, activeActionId: null })).toBeNull();
    expect(() => parseLinkItemContextEquipmentState({ ...hammer, phase: 'tail' })).toThrow();
  });
  it('preserves selected battering natural tail without extending action lock or retaining another owner', () => {
    const active = begin('item_bat_swing_4');
    const tail = step(active, { nativeMotionFrame: 81, controlEnded: true, activeActionId: null })!;
    expect(tail.phase).toBe('tail');
    expect(selectLinkItemContextEquipment(tail).ownsBodyRoute).toBe(true);
    expect(step(tail, { nativeMotionFrame: null, controlEnded: true, activeActionId: null })!.nativeMotionFrame).toBe(82);
    expect(step(tail, { activeActionId: 'another-actual-attack-owner' })).toBeNull();
    expect(step(tail, { interruption: 'stock-reset' })).toBeNull();
  });
  it('keeps source up-throw postrelease11 shieldback until expression22', () => {
    const s = begin();
    const released = step(s, { nativeMotionFrame: 11 })!;
    expect(selectLinkItemContextEquipment(released).equipment.shield).toBe('back');
    expect(selectLinkItemContextEquipment(step(released, { nativeMotionFrame: 21 })!).equipment.shield).toBe('back');
    expect(selectLinkItemContextEquipment(step(released, { nativeMotionFrame: 22 })!).equipment.shield).toBe('normal');
    expect(selectLinkItemContextEquipment(released).itemIdentity).toBe('entity-9@spawn4');
  });
  it('uses captured Food20/24 rather than unrelated drop30, with controlFAF9/11 separate', () => {
    expect(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_light_eat.naturalBodySamples).toBe(20);
    expect(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_light_walk_eat.naturalBodySamples).toBe(24);
    expect(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS.item_light_throw_drop.naturalBodySamples).toBe(30);
    for (const [motion, unlock, last] of [['item_light_eat', 9, 20], ['item_light_walk_eat', 11, 24]] as const) {
      const tail = step(begin(motion, true), { nativeMotionFrame: unlock, controlEnded: true, activeActionId: null })!;
      expect(tail.phase).toBe('tail');
      expect(selectLinkItemContextEquipment(tail).route.rawAge).toBe(unlock - 1);
      expect(step(tail, { nativeMotionFrame: last, controlEnded: true, activeActionId: null })).not.toBeNull();
      expect(step(tail, { nativeMotionFrame: last + 1, controlEnded: true, activeActionId: null })).toBeNull();
    }
  });
  it('preserves real consumed Food transaction identity while prior weapon is hidden and shield19 restores', () => {
    const food = step(begin('item_light_eat', true), { nativeMotionFrame: 19, controlEnded: true, activeActionId: null })!;
    const selected = selectLinkItemContextEquipment(food);
    expect(selected.equipment).toMatchObject({ sword: 'normal', shield: 'normal', heldItemVisible: false });
    expect(selected.itemIdentity).toBe('entity-9@spawn4');
    expect(selected.lastAppliedExpressionNativeFrame).toBe(19);
    // Exit returns no obsolete entrygear. Runtime must reconcile CURRENT
    // inventory, whose heldweapon may have changed or been removed meanwhile.
    expect(step(food, { interruption: 'new-owner' })).toBeNull();
  });
  it('does not advance on stopped or duplicated actor ticks, and preserves selected fractional source rate', () => {
    const s = begin();
    const stopped = step(s, { clockAdvances: false, nativeMotionFrame: 1 })!;
    expect(stopped.nativeMotionFrame).toBe(1);
    expect(step(stopped, { frame: stopped.lastFrame, nativeMotionFrame: 1 })!.nativeMotionFrame).toBe(1);
    const tail = { ...s, motionRate: .92, phase: 'tail' as const };
    expect(step(tail, { nativeMotionFrame: null, controlEnded: true, activeActionId: null })!.nativeMotionFrame).toBe(1.92);
    expect(() => step(s, { clockAdvances: false, nativeMotionFrame: 2 })).toThrow();
  });
  it('cleans generation/capture/hit/Final/new action without adding lock, percent or physics fields', () => {
    const s = begin();
    expect(step(s, { generation: 3 })).toBeNull();
    expect(step(s, { activeActionId: 'new-action-6' })).toBeNull();
    for (const interruption of ['new-owner', 'accepted-hit', 'capture', 'final', 'stock-reset', 'scene-reset'] as const)
      expect(step(s, { interruption })).toBeNull();
    expect(Object.keys(selectLinkItemContextEquipment(s))).not.toContain('controlLocked');
  });
  it('strictly parses owner IDs/source motions/gear/clocks and rejects expired tails', () => {
    const s = begin(); expect(parseLinkItemContextEquipmentState(s)).toEqual(s);
    for (const change of [{ motion: 'fabricated_motion' }, { itemIdentity: '' }, { extra: 1 }, { nativeMotionFrame: Infinity },
      { lastFrame: 9 }, { equipmentAtEntry: { ...ordinary, shield: 'invented' } }, { phase: 'tail', nativeMotionFrame: 29 }])
      expect(() => parseLinkItemContextEquipmentState({ ...s, ...change })).toThrow();
  });
});
