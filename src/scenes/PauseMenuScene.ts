import Phaser from 'phaser';
import {
  DEFAULT_PAUSE_MENU_STATE,
  PAUSE_MENU_OPTIONS,
  getOptionByAction,
  getSelectedOption,
  moveSelection,
  setSelection,
  type PauseAction,
  type PauseMenuState,
} from './pauseMenu';
import {
  MENU_COLORS_CSS,
  MENU_FONT,
  paintFooterHints,
  paintMenuTitle,
  paintPanel,
} from '../ui/menuTheme';
import { MenuPadNav } from '../ui/menuPadNav';

/**
 * PauseMenuScene — the M2 in-match pause overlay.
 *
 * When the player taps PAUSE mid-match (ESC on the keyboard, START on a
 * pad) `MatchScene` freezes its deterministic fixed-step loop and
 * `scene.launch`es THIS scene on top of the still-rendered match. The
 * overlay floats a translucent scrim + a themed panel over the frozen
 * frame and offers the five flow actions from `./pauseMenu.ts`: resume,
 * restart the match, drop to character select, bail to the main menu, or
 * open the controls rebinder.
 *
 * Why an overlay (launch) and NOT a normal scene transition
 * ---------------------------------------------------------
 *
 * `MatchScene` calls `scene.launch('PauseMenuScene')`, so this scene runs
 * CONCURRENTLY as a sibling on top of the still-rendering (but logically
 * frozen) match — the freeze is an `isPaused` early-return inside
 * `MatchScene.update()`, NOT a Phaser `scene.pause`. Two consequences
 * shape this file:
 *
 *   • We must NOT clear the screen. There is no opaque background here —
 *     just a semi-transparent scrim so the frozen match shows through.
 *     `paintMenuBackground` (which fills the whole canvas) is deliberately
 *     skipped in favour of a single translucent `rectangle`.
 *
 *   • We must NOT own the freeze/resume or any teardown. The overlay is
 *     pure presentation + a single 5-arm dispatch that hands the chosen
 *     {@link PauseAction} straight back to `MatchScene.handlePauseAction`
 *     via `this.scene.get('MatchScene')`. `MatchScene` owns `autoUpdate`,
 *     the `physicsEngine`, the registry hand-off, and SHUTDOWN cleanup —
 *     the overlay never re-implements them.
 *
 * Thin-scene shape
 * ----------------
 *
 * Per the project's `code_architecture` principle this scene stays thin,
 * mirroring `ModeSelectScene`: it owns the live `PauseMenuState`, maps key
 * / pad / mouse events onto the pure transitions in `./pauseMenu.ts`,
 * caches the option-row `Text[]` (like `ModeSelectScene` caches
 * `modeRow` / `quantityRow`) and repaints their colours in
 * {@link refreshLabels}. All the cursor maths lives in the Phaser-free
 * helper, which is unit-tested under plain Node.
 *
 * Input — all three paths
 * -----------------------
 *
 *   • Keyboard — UP/DOWN or W/S move, ENTER/SPACE select, ESC resumes,
 *     plus the per-option hotkeys ([R] [C] [M] [K]) that jump straight to
 *     an action without first moving the cursor.
 *   • Gamepad — a shared {@link MenuPadNav} polled each `update()`; its
 *     first-sighting latch prime means a START still held from the
 *     open-gesture does NOT confirm a row on the overlay's first frame
 *     (A / START = confirm, B = resume).
 *   • Mouse — routed through a DOM-level `mousedown` listener on the
 *     canvas (the same workaround `CharacterSelectScene` / `ResultsScene`
 *     use because Phaser's per-scene `InputPlugin` pointer events are
 *     unreliable after a `scene.launch`). Hover highlights an option;
 *     click selects it.
 *
 * Determinism note: nothing here reads `Math.random()`, the wall clock,
 * or the match RNG. The overlay is presentation / flow only — the
 * deterministic simulation is frozen on `MatchScene`'s side and resumes
 * byte-identically when this overlay dispatches `resume`.
 */
export class PauseMenuScene extends Phaser.Scene {
  /** Live highlighted-row cursor — every move goes through the pure helper. */
  private state: PauseMenuState = DEFAULT_PAUSE_MENU_STATE;

  /**
   * Cached row text handles, one per `PAUSE_MENU_OPTIONS` entry, in list
   * order. Repainted (accent when selected, secondary otherwise) from the
   * live state on every cursor move — the same caching pattern
   * `ModeSelectScene` uses for `modeRow` / `quantityRow`.
   */
  private rows: Phaser.GameObjects.Text[] = [];

  /**
   * World-space hit rectangles for the option rows, parallel to
   * {@link rows}. Built once in `create()` so the DOM mouse handler can
   * hit-test a canvas-space click against each row without re-measuring.
   */
  private rowBounds: Phaser.Geom.Rectangle[] = [];

  /** Shared gamepad poller so pad-only players can navigate the overlay. */
  private padNav: MenuPadNav | undefined = undefined;

  /**
   * The DOM `mousedown` listener registered on the game canvas. Held so
   * SHUTDOWN can detach it — see the canvas-focus rationale in `create()`.
   */
  private domMouseHandler: ((e: MouseEvent) => void) | undefined = undefined;

  /** The DOM `mousemove` listener (hover highlight); paired with the above. */
  private domMoveHandler: ((e: MouseEvent) => void) | undefined = undefined;

  /** The canvas the DOM handlers hang off; cached for clean teardown. */
  private boundCanvas: HTMLCanvasElement | undefined = undefined;

  constructor() {
    super({ key: 'PauseMenuScene' });
  }

  /**
   * The overlay captures nothing gameplay-affecting. It does NOT receive
   * the `MatchConfig` — `restart` reads `lastMatchConfig` off the registry
   * on the `MatchScene` side, exactly like `ResultsScene.startRematch`.
   * `init` resets the cursor so a re-pause always opens on the safe
   * `resume` no-op even if a previous overlay instance left the field set.
   */
  init(_data?: { readonly returnData?: object }): void {
    this.state = DEFAULT_PAUSE_MENU_STATE;
    this.rows = [];
    this.rowBounds = [];
  }

  create(): void {
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    // ---- Translucent scrim (NOT an opaque background) ----------------------
    // The match scene is still rendering its last (frozen) frame beneath
    // us, so we deliberately DO NOT call `paintMenuBackground` (it fills
    // the whole canvas). A single translucent dark rect dims the match so
    // the panel reads, while the action stays visible underneath. Pinned
    // to the camera (scrollFactor 0) and pushed behind our own UI.
    this.add
      .rectangle(cx, height / 2, width, height, 0x07070d, 0.72)
      .setScrollFactor(0)
      .setDepth(-5);

    // ---- Title + panel -----------------------------------------------------
    paintMenuTitle(this, cx, height * 0.18, 'Paused');
    paintPanel(this, cx, height * 0.52, Math.min(520, width * 0.5), height * 0.5);

    // ---- Option rows -------------------------------------------------------
    // One row per option, laid out vertically inside the panel. Each row
    // pairs the big label with its dim shortcut hint so a player learns
    // the direct hotkeys. We cache the Text handles + a hit rectangle so
    // `refreshLabels` can recolour them and the DOM mouse handler can
    // hit-test clicks without re-measuring.
    const rowSpacing = Math.min(56, height * 0.08);
    const firstRowY = height * 0.52 - ((PAUSE_MENU_OPTIONS.length - 1) * rowSpacing) / 2;
    PAUSE_MENU_OPTIONS.forEach((option, i) => {
      const y = firstRowY + i * rowSpacing;
      const row = this.add
        .text(cx, y, `${option.label}    ${option.shortcutHint}`, {
          fontFamily: MENU_FONT,
          fontSize: '30px',
          fontStyle: 'bold',
          color: MENU_COLORS_CSS.textSecondary,
        })
        .setOrigin(0.5)
        .setDepth(1);
      this.rows.push(row);
      const b = row.getBounds();
      // Widen the hit region a little so a click just off the glyphs still
      // lands on the row (matches the forgiving card hit-tests elsewhere).
      this.rowBounds.push(
        new Phaser.Geom.Rectangle(cx - b.width / 2 - 16, y - rowSpacing / 2, b.width + 32, rowSpacing),
      );
    });

    // ---- Footer hints ------------------------------------------------------
    paintFooterHints(this, height - 16, [
      '˄ / ˅  move',
      '[ENTER] / Ⓐ  select',
      '[ESC] / Ⓑ  resume',
    ]);

    // First paint after the rows exist.
    this.refreshLabels();

    // ---- Keyboard bindings -------------------------------------------------
    // `on` (not `once`) — the overlay is short-lived and re-created each
    // pause, and we want every press while it is open. BootScene already
    // captured the arrow keys so the browser won't scroll the page.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-UP', () => this.move(-1));
      kb.on('keydown-W', () => this.move(-1));
      kb.on('keydown-DOWN', () => this.move(+1));
      kb.on('keydown-S', () => this.move(+1));
      kb.on('keydown-ENTER', () => this.confirm());
      kb.on('keydown-SPACE', () => this.confirm());
      kb.on('keydown-ESC', () => this.dispatch('resume'));
      // Direct hotkeys jump straight to an action without moving the
      // cursor first — the labels render the same glyphs in `shortcutHint`.
      kb.on('keydown-R', () => this.dispatch(getOptionByAction('restart').action));
      kb.on('keydown-C', () => this.dispatch(getOptionByAction('characterSelect').action));
      kb.on('keydown-M', () => this.dispatch(getOptionByAction('mainMenu').action));
      kb.on('keydown-K', () => this.dispatch(getOptionByAction('controls').action));
    }

    // ---- Gamepad poller ----------------------------------------------------
    // MenuPadNav already folds START (buttons[9]) + A into `confirm` and B
    // into `back`, and its first-sighting prime guarantees a START still
    // held from the open-gesture does NOT confirm a row on frame 1.
    this.padNav = new MenuPadNav(this);

    // ---- Mouse: DOM-level mousedown router ---------------------------------
    // Phaser's per-scene InputPlugin pointer events are unreliable after a
    // `scene.launch` (the same bug `CharacterSelectScene` / `RebindingScene`
    // work around), and the game boots with `input.mouse: false`. We force
    // canvas focus + route clicks through a DOM `mousedown` handler that
    // converts client coords to canvas space and hit-tests our row rects.
    if (this.input) {
      this.input.enabled = true;
      this.input.setTopOnly(false);
    }
    const canvas = this.game.canvas;
    this.boundCanvas = canvas ?? undefined;
    if (canvas) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.style.outline = 'none';
      canvas.focus();
      const handler = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        this.handleMouseDownAt(mx, my);
      };
      this.domMouseHandler = handler;
      canvas.addEventListener('mousedown', handler);
      // Hover highlight: re-aim the cursor at whatever row the pointer is
      // over, so a mouse-only player sees the same accent feedback the
      // keyboard/pad navigator gets.
      const moveHandler = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        this.handleMouseHoverAt(mx, my);
      };
      this.domMoveHandler = moveHandler;
      canvas.addEventListener('mousemove', moveHandler);
    }

    // ---- Teardown ----------------------------------------------------------
    // SHUTDOWN runs when this overlay is stopped (resume or a transition).
    // Detach every listener so a re-pause doesn't double-fire and the DOM
    // handlers don't leak onto the next scene's canvas.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardownListeners());
  }

  update(): void {
    const pad = this.padNav?.poll();
    if (!pad) return;
    if (pad.up) this.move(-1);
    if (pad.down) this.move(+1);
    if (pad.confirm) this.confirm();
    else if (pad.back) this.dispatch('resume');
  }

  // -------------------------------------------------------------------------
  // Public test seam
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the live cursor state. Exposed so a future
   * integration test can query the highlighted row without poking private
   * fields — mirrors `ModeSelectScene.getState`.
   */
  getState(): PauseMenuState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Input handlers — every one is a single forward into the pure helper
  // -------------------------------------------------------------------------

  /**
   * Step the cursor by `dir` (±1). Early-outs when the pure helper returns
   * the SAME reference (a no-op) so we skip a redundant repaint — exactly
   * like `ModeSelectScene.handleModeCycle`.
   */
  private move(dir: number): void {
    const next = moveSelection(this.state, dir);
    if (next === this.state) return;
    this.state = next;
    this.refreshLabels();
  }

  /** Confirm the highlighted row — resolves its action and dispatches it. */
  private confirm(): void {
    this.dispatch(getSelectedOption(this.state).action);
  }

  /**
   * The ONLY place that touches `MatchScene`. Closes the overlay FIRST,
   * then calls back into `MatchScene.handlePauseAction`, which owns the
   * freeze-lift + every scene transition. We deliberately do not duplicate
   * `MatchScene`'s teardown/handoff contract here — closing the overlay
   * before the callback also avoids it lingering during a `scene.start`.
   */
  private dispatch(action: PauseAction): void {
    const match = this.scene.get('MatchScene') as unknown as {
      handlePauseAction(action: PauseAction): void;
    };
    this.scene.stop('PauseMenuScene'); // close overlay FIRST
    // Defensive: a direct-nav / dev boot of this overlay without a live
    // MatchScene still tears itself down cleanly rather than throwing.
    if (match && typeof match.handlePauseAction === 'function') {
      match.handlePauseAction(action); // MatchScene owns resume/transition
    }
  }

  // -------------------------------------------------------------------------
  // Mouse handling
  // -------------------------------------------------------------------------

  /**
   * Mouse-down dispatch keyed off raw canvas coords. Called by the
   * DOM-level `mousedown` listener (the only reliable click path after a
   * `scene.launch`). A click on a row selects that option directly.
   */
  private handleMouseDownAt(mx: number, my: number): void {
    for (let i = 0; i < this.rowBounds.length; i += 1) {
      const bounds = this.rowBounds[i];
      const option = PAUSE_MENU_OPTIONS[i];
      if (bounds && option && bounds.contains(mx, my)) {
        this.dispatch(option.action);
        return;
      }
    }
  }

  /**
   * Pointer-move hover. Re-aims the cursor at the row under the pointer so
   * a mouse-only player gets the same accent highlight the keyboard / pad
   * navigator does. `setSelection` returns the SAME reference when the
   * target is unchanged, so hover spam over one row never churns state.
   */
  private handleMouseHoverAt(mx: number, my: number): void {
    for (let i = 0; i < this.rowBounds.length; i += 1) {
      const bounds = this.rowBounds[i];
      if (bounds && bounds.contains(mx, my)) {
        const next = setSelection(this.state, i);
        if (next === this.state) return;
        this.state = next;
        this.refreshLabels();
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Repaint every row's colour from the live cursor: the selected row in
   * the theme accent, the rest in secondary text. The labels themselves
   * are static so we only ever touch the colour — the same cheap-repaint
   * approach `ModeSelectScene.refreshLabels` takes.
   */
  private refreshLabels(): void {
    for (let i = 0; i < this.rows.length; i += 1) {
      const row = this.rows[i];
      if (!row) continue;
      const selected = i === this.state.selectedIndex;
      row.setColor(selected ? MENU_COLORS_CSS.accent : MENU_COLORS_CSS.textSecondary);
    }
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Detach keyboard + DOM mouse + pad listeners. Runs on SHUTDOWN so a
   * re-pause doesn't double-fire and the DOM handlers don't leak onto the
   * next scene's canvas — same belt as `ModeSelectScene`'s SHUTDOWN hook
   * plus the DOM detach `CharacterSelectScene` performs.
   */
  private teardownListeners(): void {
    this.input.keyboard?.removeAllListeners();
    this.padNav?.reset();
    const canvas = this.boundCanvas;
    if (canvas) {
      if (this.domMouseHandler) canvas.removeEventListener('mousedown', this.domMouseHandler);
      if (this.domMoveHandler) canvas.removeEventListener('mousemove', this.domMoveHandler);
    }
    this.domMouseHandler = undefined;
    this.domMoveHandler = undefined;
    this.boundCanvas = undefined;
  }
}
