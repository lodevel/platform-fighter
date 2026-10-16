import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { bindMenuKey } from './menuKeyboard';

describe('menu keyboard event ownership', () => {
  it('does not reapply a keydown when Phaser revisits its queue after keyup or another key', () => {
    const keyboard = new EventEmitter();
    const focus = vi.fn();
    const quantity = vi.fn();
    bindMenuKey(keyboard as any, 'keydown-DOWN', focus);
    bindMenuKey(keyboard as any, 'keydown-RIGHT', quantity);
    const down = { code: 'ArrowDown', timeStamp: 10 };
    const right = { code: 'ArrowRight', timeStamp: 11 };
    keyboard.emit('keydown-DOWN', down);
    keyboard.emit('keyup-DOWN', down);
    keyboard.emit('keydown-DOWN', down);
    keyboard.emit('keydown-RIGHT', right);
    keyboard.emit('keydown-DOWN', down);
    keyboard.emit('keydown-RIGHT', right);
    expect(focus).toHaveBeenCalledOnce();
    expect(quantity).toHaveBeenCalledOnce();
  });

  it('allows genuinely distinct presses and OS repeat events even with equal timestamps', () => {
    const keyboard = new EventEmitter();
    const handler = vi.fn();
    bindMenuKey(keyboard as any, 'keydown-RIGHT', handler);
    for (let i = 0; i < 3; i++) keyboard.emit('keydown-RIGHT', { code: 'ArrowRight', timeStamp: 10, repeat: i === 2 });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('prevents a consumed confirm leaking into the next scene without disarming its next confirm', () => {
    const first = new EventEmitter();
    const next = new EventEmitter();
    const firstConfirm = vi.fn();
    const nextConfirm = vi.fn();
    bindMenuKey(first as any, 'keydown-ENTER', firstConfirm);
    bindMenuKey(next as any, 'keydown-ENTER', nextConfirm);
    const original = { code: 'Enter' };
    first.emit('keydown-ENTER', original);
    next.emit('keydown-ENTER', original);
    expect(firstConfirm).toHaveBeenCalledOnce();
    expect(nextConfirm).not.toHaveBeenCalled();
    next.emit('keydown-ENTER', { code: 'Enter' });
    expect(nextConfirm).toHaveBeenCalledOnce();
  });

  it('lets an active overlay claim a key ignored by the underlying scene and cleans up its listener', () => {
    const keyboard = new EventEmitter();
    const underlying = vi.fn();
    const modal = vi.fn();
    bindMenuKey(keyboard as any, 'keydown-ESC', underlying, () => false);
    const dispose = bindMenuKey(keyboard as any, 'keydown', modal, () => true);
    const event = { key: 'Escape' };
    keyboard.emit('keydown-ESC', event);
    keyboard.emit('keydown', event);
    keyboard.emit('keydown-ESC', event);
    keyboard.emit('keydown', event);
    expect(underlying).not.toHaveBeenCalled();
    expect(modal).toHaveBeenCalledOnce();
    dispose();
    keyboard.emit('keydown', { key: 'Escape' });
    expect(modal).toHaveBeenCalledOnce();
  });
});
