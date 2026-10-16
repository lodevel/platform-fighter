import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuInput, type MenuEvent } from './input';

function pad(index: number, pressed: number[] = [], axes = [0, 0]): Gamepad {
  return { index, connected: true, id: `pad ${index}`, axes,
    buttons: Array.from({ length: 16 }, (_, button) => ({ pressed: pressed.includes(button), touched: false, value: pressed.includes(button) ? 1 : 0 })),
  } as unknown as Gamepad;
}

function fixture() {
  let pads: Gamepad[] = [];
  const events: MenuEvent[] = [];
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const input = new MenuInput();
  input.on(event => events.push(event));
  return { input, events, setPads: (next: Gamepad[]) => { pads = next; } };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('menu gamepad sources', () => {
  it('distinguishes repeated stick navigation from button snapping', () => {
    const f = fixture();
    f.setPads([pad(2, [], [0.8, 0])]);
    f.input.poll(0); f.input.poll(321);
    expect(f.events).toEqual([{ device: 'pad2', action: 'right', source: 'stick' }, { device: 'pad2', action: 'right', source: 'stick' }]);
    expect(f.input.stick('pad2')).toEqual({ x: 0.8, y: 0 });
    f.setPads([pad(2)]); f.input.poll(330);
    f.setPads([pad(2, [15])]); f.input.poll(340);
    expect(f.events.at(-1)).toEqual({ device: 'pad2', action: 'right', source: 'button' });
    expect(f.input.stick('pad2')).toEqual({ x: 0, y: 0 });
  });

  it('gives d-pad input precedence over the same held analog direction', () => {
    const f = fixture();
    f.setPads([pad(0, [15], [0.8, 0])]); f.input.poll(0);
    expect(f.events).toEqual([{ device: 'pad0', action: 'right', source: 'button' }]);
  });

  it('does not replay A/Y presses made inside the controls editor on closing it', () => {
    const f = fixture();
    f.input.suspended = true;
    f.setPads([pad(0, [0, 3])]); f.input.poll(0);
    f.input.suspended = false; f.input.poll(1000);
    expect(f.events).toEqual([]);
    f.setPads([pad(0)]); f.input.poll(1001);
    f.setPads([pad(0, [3])]); f.input.poll(1002);
    expect(f.events).toEqual([{ device: 'pad0', action: 'y', source: 'button' }]);
  });

  it('clears a disconnected pad hold so a returning device can issue a fresh press', () => {
    const f = fixture();
    f.setPads([pad(0, [0])]); f.input.poll(0);
    f.setPads([]); f.input.poll(10);
    f.setPads([pad(0, [0])]); f.input.poll(20);
    expect(f.events).toHaveLength(2);
  });
});
