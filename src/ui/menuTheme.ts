/**
 * menuTheme — shared visual language for every menu scene.
 *
 * Centralises the colours, fonts, and decorative painters the menu
 * scenes (MainMenu, ModeSelect, CharacterSelect, StageSelect, Results)
 * previously each hard-coded as bare monospace text on a flat
 * background. One module means one place to retune the whole menu
 * suite's look.
 *
 * Everything here is presentation-only and deterministic:
 *
 *   • No `Math.random()` — decorative scatter uses a fixed-seed LCG so
 *     two boots paint byte-identical backgrounds.
 *   • No wall-clock reads for layout — tweens animate on Phaser's
 *     clock but never feed gameplay state.
 *   • Pure helpers + thin Phaser painters; the colour/format constants
 *     are importable from plain-Node tests without touching Phaser.
 */
import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const MENU_COLORS = Object.freeze({
  /** Deep background gradient — top / bottom. */
  bgTop: 0x101022,
  bgBottom: 0x07070d,
  /** Decorative scatter dots / grid lines on the background. */
  bgDot: 0x232338,
  /** Panel fill / border. */
  panel: 0x161624,
  panelBorder: 0x2e2e44,
  panelHighlight: 0x20203255,
  /** Brand accent (teal) — selected items, calls to action. */
  accent: 0x6cf0c2,
  /** Secondary accent (gold) — highlights, hovers, banners. */
  gold: 0xffd166,
  /** Danger / destructive (leave, errors). */
  danger: 0xff5a3c,
  /** Text ladder. */
  textPrimary: 0xe8e8f0,
  textSecondary: 0xa0a0b8,
  textDim: 0x666677,
});

/** CSS string forms for Phaser text styles. */
export const MENU_COLORS_CSS = Object.freeze({
  accent: '#6cf0c2',
  gold: '#ffd166',
  danger: '#ff5a3c',
  textPrimary: '#e8e8f0',
  textSecondary: '#a0a0b8',
  textDim: '#666677',
  panelDark: '#0a0a14',
});

/**
 * Per-player accent colours (P1 red, P2 blue, P3 green, P4 yellow).
 * Single source of truth — the character-select hand cursors, slot
 * cards, and results banners all read from here.
 */
export const PLAYER_COLORS: Readonly<Record<1 | 2 | 3 | 4, number>> = Object.freeze({
  1: 0xff5a5a,
  2: 0x5a8cff,
  3: 0x6cf0a8,
  4: 0xffd166,
});

export function playerColorCss(slotIndex: 1 | 2 | 3 | 4): string {
  return `#${PLAYER_COLORS[slotIndex].toString(16).padStart(6, '0')}`;
}

/** Shared font stack — falls back to monospace everywhere. */
export const MENU_FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const MENU_FONT_MONO = 'monospace';

// ---------------------------------------------------------------------------
// Background painter
// ---------------------------------------------------------------------------

/**
 * Paint the standard menu background: vertical gradient, a sparse
 * deterministic dot-field, and a soft vignette. Returns the created
 * game objects (depth ≤ -10) so callers can ignore or destroy them.
 */
export function paintMenuBackground(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
  const { width, height } = scene.scale.gameSize;
  const out: Phaser.GameObjects.GameObject[] = [];

  const g = scene.add.graphics().setDepth(-20);
  g.fillGradientStyle(
    MENU_COLORS.bgTop,
    MENU_COLORS.bgTop,
    MENU_COLORS.bgBottom,
    MENU_COLORS.bgBottom,
    1,
  );
  g.fillRect(0, 0, width, height);

  // Deterministic decorative scatter — fixed-seed LCG, never Math.random.
  let seed = 0x9e3779b9;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  g.fillStyle(MENU_COLORS.bgDot, 0.5);
  for (let i = 0; i < 90; i += 1) {
    const x = nextRand() * width;
    const y = nextRand() * height;
    const r = 1 + nextRand() * 2;
    g.fillCircle(x, y, r);
  }

  // Faint diagonal accent beams for depth.
  g.fillStyle(MENU_COLORS.accent, 0.025);
  g.beginPath();
  g.moveTo(width * 0.62, 0);
  g.lineTo(width * 0.78, 0);
  g.lineTo(width * 0.38, height);
  g.lineTo(width * 0.22, height);
  g.closePath();
  g.fillPath();
  g.fillStyle(MENU_COLORS.gold, 0.018);
  g.beginPath();
  g.moveTo(width * 0.82, 0);
  g.lineTo(width * 0.9, 0);
  g.lineTo(width * 0.5, height);
  g.lineTo(width * 0.42, height);
  g.closePath();
  g.fillPath();

  out.push(g);
  return out;
}

// ---------------------------------------------------------------------------
// Title / panel / footer painters
// ---------------------------------------------------------------------------

export interface MenuTitleObjects {
  readonly title: Phaser.GameObjects.Text;
  readonly underline: Phaser.GameObjects.Rectangle;
  readonly subtitle: Phaser.GameObjects.Text | null;
}

/**
 * Standard screen title: bold uppercase heading with a drop shadow and
 * an accent underline bar, plus an optional dimmer subtitle below.
 */
export function paintMenuTitle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options?: { readonly subtitle?: string; readonly fontSize?: number },
): MenuTitleObjects {
  const fontSize = options?.fontSize ?? 52;
  const title = scene.add
    .text(x, y, text.toUpperCase(), {
      fontFamily: MENU_FONT,
      fontSize: `${fontSize}px`,
      fontStyle: 'bold',
      color: MENU_COLORS_CSS.textPrimary,
    })
    .setOrigin(0.5)
    .setShadow(0, Math.max(2, fontSize * 0.07), '#000000', Math.max(4, fontSize * 0.16), true, true);
  const underline = scene.add
    .rectangle(x, y + fontSize * 0.72, Math.max(120, title.width * 0.55), 4, MENU_COLORS.accent)
    .setOrigin(0.5);
  let subtitle: Phaser.GameObjects.Text | null = null;
  if (options?.subtitle) {
    subtitle = scene.add
      .text(x, y + fontSize * 1.18, options.subtitle, {
        fontFamily: MENU_FONT,
        fontSize: `${Math.round(fontSize * 0.34)}px`,
        color: MENU_COLORS_CSS.textSecondary,
      })
      .setOrigin(0.5);
  }
  return { title, underline, subtitle };
}

/**
 * Rounded panel with border + subtle top highlight. Drawn into a fresh
 * Graphics object positioned in world space (NOT inside a container) —
 * callers layer their own content above it.
 */
export function paintPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: {
    readonly borderColor?: number;
    readonly borderAlpha?: number;
    readonly fillColor?: number;
    readonly fillAlpha?: number;
    readonly radius?: number;
  },
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const radius = options?.radius ?? 10;
  const fill = options?.fillColor ?? MENU_COLORS.panel;
  const fillAlpha = options?.fillAlpha ?? 0.92;
  const border = options?.borderColor ?? MENU_COLORS.panelBorder;
  const borderAlpha = options?.borderAlpha ?? 1;
  g.fillStyle(fill, fillAlpha);
  g.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius);
  g.lineStyle(2, border, borderAlpha);
  g.strokeRoundedRect(x - width / 2, y - height / 2, width, height, radius);
  // Subtle top-edge highlight so panels read as raised surfaces.
  g.fillStyle(0xffffff, 0.03);
  g.fillRoundedRect(
    x - width / 2 + 2,
    y - height / 2 + 2,
    width - 4,
    Math.min(14, height * 0.18),
    { tl: radius - 2, tr: radius - 2, bl: 0, br: 0 },
  );
  return g;
}

/**
 * Footer hint bar — the "[ENTER] start · [ESC] back" line every menu
 * shows. Pass segments so spacing stays consistent across scenes.
 */
export function paintFooterHints(
  scene: Phaser.Scene,
  y: number,
  segments: ReadonlyArray<string>,
): Phaser.GameObjects.Text {
  const { width } = scene.scale.gameSize;
  return scene.add
    .text(width / 2, y, segments.join('      '), {
      fontFamily: MENU_FONT,
      fontSize: '16px',
      color: MENU_COLORS_CSS.textDim,
    })
    .setOrigin(0.5);
}

/** Soft pulsing tween used for "press X" prompts — one consistent rhythm. */
export function addPulse(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  options?: { readonly minAlpha?: number; readonly duration?: number },
): Phaser.Tweens.Tween {
  return scene.tweens.add({
    targets: target,
    alpha: options?.minAlpha ?? 0.45,
    duration: options?.duration ?? 700,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}
