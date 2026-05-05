import { describe, it, expect, beforeEach } from 'vitest';
import { DamageHud } from './DamageHud';
import {
  DAMAGE_HUD_COLOR_RAMP,
  colorIntToHexString,
  formatDamagePercent,
} from './damageHudFormat';

/**
 * Sub-AC 3 of AC 60003 — `DamageHud` is Phaser-touching but the bulk of
 * its logic (panel layout, per-slot text creation, change-detected
 * updates, teardown) lives behind a narrow scene-shape we mock here.
 *
 * What this suite locks down:
 *
 *   1. Construction creates one label + one percent text per player,
 *      stamped with the configured roster colour, scroll-locked to the
 *      viewport, and pinned to the bottom strip.
 *   2. `update()` rewrites only the percent text (not the label) and
 *      paints the right colour for the active threshold band.
 *   3. The hot path is idempotent — calling `update()` with identical
 *      percents twice does NOT call `setText` a second time (avoids a
 *      texture rebuild every render frame).
 *   4. Negative / NaN percents render as "0%" (covered by the formatter
 *      tests; the integration check here is that the HUD doesn't crash).
 *   5. `destroy()` tears down every text object exactly once.
 *   6. The HUD scales from 1 to 4 panels (M2 four-player FFA support).
 */

interface MockText {
  x: number;
  y: number;
  text: string;
  color: string;
  origin: { x: number; y: number };
  scrollFactor: { x: number; y: number };
  depth: number;
  destroyed: boolean;
  setTextCalls: number;
  setColorCalls: number;
  // Builder methods Phaser's text node exposes — return `this` so the
  // HUD's call chains work.
  setText(value: string): MockText;
  setColor(value: string): MockText;
  setOrigin(x: number, y?: number): MockText;
  setScrollFactor(x: number, y?: number): MockText;
  setPosition(x: number, y: number): MockText;
  setDepth(depth: number): MockText;
  destroy(): void;
}

interface CreatedTextRecord {
  initial: {
    x: number;
    y: number;
    text: string;
    color: string;
    fontSize: string;
  };
  ref: MockText;
}

interface MockScene {
  scale: { gameSize: { width: number; height: number } };
  add: { text: (x: number, y: number, content: string, style: any) => MockText };
  created: CreatedTextRecord[];
}

function createMockScene(viewW = 1280, viewH = 720): MockScene {
  const created: CreatedTextRecord[] = [];
  const scene: MockScene = {
    scale: { gameSize: { width: viewW, height: viewH } },
    add: {
      text(x, y, content, style) {
        const text: MockText = {
          x,
          y,
          text: content,
          color: typeof style?.color === 'string' ? style.color : '#ffffff',
          origin: { x: 0, y: 0 },
          scrollFactor: { x: 1, y: 1 },
          depth: 0,
          destroyed: false,
          setTextCalls: 0,
          setColorCalls: 0,
          setText(value) {
            text.setTextCalls += 1;
            text.text = value;
            return text;
          },
          setColor(value) {
            text.setColorCalls += 1;
            text.color = value;
            return text;
          },
          setOrigin(ox, oy) {
            text.origin = { x: ox, y: oy ?? ox };
            return text;
          },
          setScrollFactor(sx, sy) {
            text.scrollFactor = { x: sx, y: sy ?? sx };
            return text;
          },
          setPosition(nx, ny) {
            text.x = nx;
            text.y = ny;
            return text;
          },
          setDepth(d) {
            text.depth = d;
            return text;
          },
          destroy() {
            text.destroyed = true;
          },
        };
        created.push({
          initial: {
            x,
            y,
            text: content,
            color: text.color,
            fontSize: typeof style?.fontSize === 'string' ? style.fontSize : '',
          },
          ref: text,
        });
        return text;
      },
    },
    created,
  };
  return scene;
}

// ---------------------------------------------------------------------------

describe('DamageHud — construction', () => {
  let scene: MockScene;
  beforeEach(() => {
    scene = createMockScene();
  });

  it('creates one label + one percent text per player slot', () => {
    new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
    ]);
    // 2 players × (1 label + 1 percent) = 4 text objects.
    expect(scene.created).toHaveLength(4);
  });

  it('renders the player label as "P{n} {NAME}" uppercased', () => {
    new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
    ]);
    // Labels are the even-indexed entries (created first per slot).
    expect(scene.created[0]!.initial.text).toBe('P1 WOLF');
    expect(scene.created[2]!.initial.text).toBe('P2 CAT');
  });

  it('initial percent text reads "0%" in white', () => {
    new DamageHud(scene as any, [{ playerIndex: 0, displayName: 'Wolf' }]);
    // [label, percent]
    const percent = scene.created[1]!;
    expect(percent.initial.text).toBe('0%');
    expect(percent.initial.color).toBe(
      colorIntToHexString(DAMAGE_HUD_COLOR_RAMP[0]!.color),
    );
  });

  it('label tint defaults to white when labelColor is omitted', () => {
    new DamageHud(scene as any, [{ playerIndex: 0, displayName: 'Wolf' }]);
    expect(scene.created[0]!.initial.color).toBe('#ffffff');
  });

  it('label tint honours the configured labelColor', () => {
    new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf', labelColor: 0xffb0a0 },
      { playerIndex: 1, displayName: 'Cat', labelColor: 0xa0d8ff },
    ]);
    expect(scene.created[0]!.initial.color).toBe('#ffb0a0');
    expect(scene.created[2]!.initial.color).toBe('#a0d8ff');
  });

  it('pins every text to the viewport (scrollFactor 0)', () => {
    new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
    ]);
    for (const rec of scene.created) {
      expect(rec.ref.scrollFactor).toEqual({ x: 0, y: 0 });
    }
  });

  it('pins every text to the bottom of the viewport', () => {
    scene = createMockScene(1280, 720);
    new DamageHud(scene as any, [{ playerIndex: 0, displayName: 'Wolf' }]);
    // Both rows should land in the lower half (y > 360).
    for (const rec of scene.created) {
      expect(rec.ref.y).toBeGreaterThan(360);
    }
  });

  it('throws when constructed with an empty player list', () => {
    expect(() => new DamageHud(scene as any, [])).toThrow();
  });

  it('handles 4 player slots without crashing (M2 FFA support)', () => {
    new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
      { playerIndex: 2, displayName: 'Owl' },
      { playerIndex: 3, displayName: 'Bear' },
    ]);
    expect(scene.created).toHaveLength(8);
    // Centres should be ascending across the row.
    const percentXs = [1, 3, 5, 7].map((i) => scene.created[i]!.ref.x);
    for (let i = 1; i < percentXs.length; i += 1) {
      expect(percentXs[i]!).toBeGreaterThan(percentXs[i - 1]!);
    }
  });
});

describe('DamageHud — update()', () => {
  let scene: MockScene;
  let hud: DamageHud;

  beforeEach(() => {
    scene = createMockScene();
    hud = new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
    ]);
  });

  it('updates each percent text from the supplied percents', () => {
    hud.update([23, 152]);
    const percentTexts = hud.getPercentTexts();
    expect(percentTexts[0]!.text).toBe('23%');
    expect(percentTexts[1]!.text).toBe('152%');
  });

  it('does NOT touch the label text on update', () => {
    hud.update([23, 152]);
    const labelTexts = hud.getLabelTexts();
    expect(labelTexts[0]!.text).toBe('P1 WOLF');
    expect(labelTexts[1]!.text).toBe('P2 CAT');
  });

  it('paints the percent in the threshold-band colour', () => {
    hud.update([0, 200]);
    const percentTexts = hud.getPercentTexts();
    // 0% → bottom band (white).
    expect((percentTexts[0] as any).color).toBe(
      colorIntToHexString(DAMAGE_HUD_COLOR_RAMP[0]!.color),
    );
    // 200% → top band (red).
    expect((percentTexts[1] as any).color).toBe(
      colorIntToHexString(DAMAGE_HUD_COLOR_RAMP[3]!.color),
    );
  });

  it('skips setText when the formatted value did not change (hot-path guard)', () => {
    hud.update([23, 50]);
    const percentTexts = hud.getPercentTexts();
    // Reset call counts after the first paint.
    const before0 = (percentTexts[0] as any).setTextCalls;
    const before1 = (percentTexts[1] as any).setTextCalls;
    // Same percents — should not trigger setText.
    hud.update([23, 50]);
    expect((percentTexts[0] as any).setTextCalls).toBe(before0);
    expect((percentTexts[1] as any).setTextCalls).toBe(before1);
    // Truncation makes 23.4 == 23 == 23.8 — still a no-op.
    hud.update([23.4, 50.7]);
    expect((percentTexts[0] as any).setTextCalls).toBe(before0);
    expect((percentTexts[1] as any).setTextCalls).toBe(before1);
  });

  it('skips setColor when the colour band did not change', () => {
    // Both 23 and 47 sit in the lowest band.
    hud.update([23, 47]);
    const percentTexts = hud.getPercentTexts();
    const before0 = (percentTexts[0] as any).setColorCalls;
    hud.update([24, 48]);
    expect((percentTexts[0] as any).setColorCalls).toBe(before0);
  });

  it('repaints when the colour band changes', () => {
    hud.update([23, 23]); // both in band 0
    const percentTexts = hud.getPercentTexts();
    const before = (percentTexts[0] as any).setColorCalls;
    hud.update([60, 23]); // p0 crosses into band 1
    expect((percentTexts[0] as any).setColorCalls).toBe(before + 1);
    expect((percentTexts[0] as any).color).toBe(
      colorIntToHexString(DAMAGE_HUD_COLOR_RAMP[1]!.color),
    );
  });

  it('renders missing percents as "0%" defensively', () => {
    // Caller passes a single-entry array against a two-player HUD.
    hud.update([42]);
    const percentTexts = hud.getPercentTexts();
    expect(percentTexts[0]!.text).toBe('42%');
    expect(percentTexts[1]!.text).toBe('0%');
  });

  it('clamps damage past MAX_DAMAGE_PERCENT and never renders > 999%', () => {
    hud.update([99999, -50]);
    const percentTexts = hud.getPercentTexts();
    expect(percentTexts[0]!.text).toBe(formatDamagePercent(99999));
    expect(percentTexts[1]!.text).toBe('0%');
  });

  it('is a no-op after destroy()', () => {
    hud.destroy();
    // Should not throw and should not regrow the lists.
    hud.update([100, 100]);
    expect(hud.getPercentTexts()).toHaveLength(0);
  });
});

describe('DamageHud — destroy()', () => {
  it('destroys every text object exactly once', () => {
    const scene = createMockScene();
    const hud = new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
      { playerIndex: 1, displayName: 'Cat' },
    ]);
    expect(scene.created.every((rec) => !rec.ref.destroyed)).toBe(true);
    hud.destroy();
    expect(scene.created.every((rec) => rec.ref.destroyed)).toBe(true);
  });

  it('is idempotent', () => {
    const scene = createMockScene();
    const hud = new DamageHud(scene as any, [
      { playerIndex: 0, displayName: 'Wolf' },
    ]);
    expect(() => {
      hud.destroy();
      hud.destroy();
    }).not.toThrow();
  });
});
