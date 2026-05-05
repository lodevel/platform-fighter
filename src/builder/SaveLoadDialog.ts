/**
 * Phaser host for the M3 stage builder's save/load UI surface.
 *
 * AC 20103 Sub-AC 3 — "Wire save/load UI controls in the stage builder
 * to the persistence layer with slot naming, overwrite confirmation,
 * and validation error handling".
 *
 * Why a thin host
 * ---------------
 *
 *   • The state machine, the storage calls, the validation messages, and
 *     the test coverage all live in {@link SaveLoadController}. This
 *     module's only job is to translate the controller's view snapshots
 *     into Phaser GameObjects and to forward gestures (button clicks,
 *     keystrokes) back into the controller.
 *
 *   • Following the same pattern as `CatalogPanel.ts`, the file does NOT
 *     run a per-frame update loop. It paints once at construction
 *     (toolbar buttons + a hidden modal panel) and then mutates the
 *     visible subset whenever the controller emits a new view via the
 *     subscription wired in {@link StageBuilderScene}.
 *
 *   • The host accepts a structurally-typed `SaveLoadDialogSceneLike`
 *     (the same trick `CatalogPanel.ts` uses) so unit tests can assert
 *     paint behaviour against in-memory stubs without booting Phaser.
 *
 * What the player sees
 * --------------------
 *
 *   • A persistent toolbar in the top-right of the builder with two
 *     buttons: "Save" and "Load". Save dims when the registry is
 *     empty; Load dims when no slots exist.
 *
 *   • A modal panel painted when the controller is in any non-`closed`
 *     state. The panel is fixed-size, centred, and contains:
 *
 *       - A title line ("Save Stage" / "Load Stage" / "Confirm
 *         Overwrite" / etc.).
 *       - The state-specific body (text input box, slot list, error
 *         message, success toast).
 *       - Buttons whose labels + click handlers come from the active
 *         view kind.
 *
 *   • The whole thing is read-only when the controller is `closed`; the
 *     toolbar buttons stay clickable so the host is the source of truth
 *     for re-opening the dialog.
 */

import type Phaser from 'phaser';
import {
  SaveLoadController,
  type SaveLoadView,
} from './saveLoadController';

// ---------------------------------------------------------------------------
// Public options + colour palette
// ---------------------------------------------------------------------------

/** Construction options for {@link SaveLoadDialog}. */
export interface SaveLoadDialogOptions {
  /** Render depth (sits above scene chrome so the modal occludes the canvas). */
  readonly depth?: number;
  /**
   * Origin offset for the toolbar's top-right anchor. Defaults to the
   * scene's viewport top-right corner with an inset margin so the
   * toolbar doesn't crowd the title strip the {@link StageBuilderScene}
   * paints at the top of the canvas.
   */
  readonly toolbarPaddingX?: number;
  readonly toolbarPaddingY?: number;
}

/**
 * Palette + sizing constants. Hex literals (no `#`) so they pass straight
 * into Phaser's `Rectangle` / `lineStyle` ctors.
 */
export const SAVE_LOAD_DIALOG_COLORS = Object.freeze({
  toolbarFill: 0x1c2440,
  toolbarBorder: 0x39456b,
  buttonFill: 0x2c3656,
  buttonFillHot: 0x3f4d7c,
  buttonText: 0xe8e8f0,
  buttonTextDisabled: 0x6c7491,
  modalBackdrop: 0x05080f,
  modalFill: 0x141a2c,
  modalBorder: 0xffd166,
  titleText: 0xffd166,
  bodyText: 0xe8e8f0,
  helperText: 0x9aa0b6,
  errorText: 0xff6b8a,
  successText: 0x6cf0c2,
  inputFill: 0x0c1020,
  inputBorder: 0x39456b,
  slotRowFill: 0x1c2440,
  slotRowBorder: 0x39456b,
  slotRowFillHot: 0x2c3656,
});

// ---------------------------------------------------------------------------
// Internal — minimal scene shape so tests / shims can mock without Phaser
// ---------------------------------------------------------------------------

interface DialogTextLike {
  setOrigin(x: number, y?: number): DialogTextLike;
  setDepth(depth: number): DialogTextLike;
  setVisible(visible: boolean): DialogTextLike;
  setColor(color: string): DialogTextLike;
  setText(text: string): DialogTextLike;
  setPosition(x: number, y: number): DialogTextLike;
  destroy(): void;
}

interface DialogRectangleLike {
  setOrigin(x: number, y?: number): DialogRectangleLike;
  setDepth(depth: number): DialogRectangleLike;
  setVisible(visible: boolean): DialogRectangleLike;
  setStrokeStyle(width: number, color: number, alpha?: number): DialogRectangleLike;
  setFillStyle(color: number, alpha?: number): DialogRectangleLike;
  setInteractive(): DialogRectangleLike;
  setSize(width: number, height: number): DialogRectangleLike;
  setPosition(x: number, y: number): DialogRectangleLike;
  on(event: string, handler: (...args: unknown[]) => void): DialogRectangleLike;
  destroy(): void;
}

interface DialogSceneLike {
  scale: { gameSize: { width: number; height: number } };
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      color: number,
      alpha?: number,
    ): DialogRectangleLike;
    text(
      x: number,
      y: number,
      content: string,
      style: Record<string, unknown>,
    ): DialogTextLike;
  };
  input?: {
    keyboard?: {
      on?: (event: string, handler: (...args: unknown[]) => void) => unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// Constants — sizes + layout offsets
// ---------------------------------------------------------------------------

const TOOLBAR_BUTTON_WIDTH = 96;
const TOOLBAR_BUTTON_HEIGHT = 32;
const TOOLBAR_BUTTON_GAP = 8;
const TOOLBAR_PADDING_X = 16;
const TOOLBAR_PADDING_Y = 64;

const MODAL_WIDTH = 560;
const MODAL_HEIGHT = 320;
const MODAL_BORDER_PX = 2;
const MODAL_LINE_HEIGHT = 22;

const SLOT_ROW_HEIGHT = 28;

/** Default depth — sits above scene chrome so the modal occludes the canvas. */
const DEFAULT_DEPTH = 200;

// ---------------------------------------------------------------------------
// SaveLoadDialog
// ---------------------------------------------------------------------------

/**
 * Phaser host that renders + reacts to a {@link SaveLoadController}.
 *
 * Lifecycle:
 *
 *   const dlg = new SaveLoadDialog(scene, controller, opts);
 *   // controller drives state internally; the host repaints on its
 *   // listener subscription. When the scene tears down:
 *   dlg.destroy();
 */
export class SaveLoadDialog {
  private readonly scene: DialogSceneLike;
  private readonly controller: SaveLoadController;
  private readonly depth: number;

  /** All Phaser GameObjects this host owns — destroyed in one pass. */
  private readonly disposables: Array<{ destroy(): void }> = [];

  /** Toolbar elements — kept handy so we can update fill / colour on view changes. */
  private toolbarSaveButton: ToolbarButtonHandles | null = null;
  private toolbarLoadButton: ToolbarButtonHandles | null = null;
  private toolbarLastResultText: DialogTextLike | null = null;

  /** Modal elements — toggled visible based on the active view kind. */
  private modalBackdrop: DialogRectangleLike | null = null;
  private modalPanel: DialogRectangleLike | null = null;
  private modalTitle: DialogTextLike | null = null;
  private modalBody: DialogTextLike[] = [];
  private modalButtons: ModalButtonHandles[] = [];

  /** Active view tracked locally so the host can detach key listeners on transitions. */
  private currentView: SaveLoadView;

  /** Subscription handle returned by the controller. */
  private unsubscribe: (() => void) | null = null;

  /** Subscription cancellation for keyboard input. */
  private keyHandlers: Array<() => void> = [];

  private destroyed = false;

  constructor(
    scene: Phaser.Scene | DialogSceneLike,
    controller: SaveLoadController,
    options: SaveLoadDialogOptions = {},
  ) {
    this.scene = scene as unknown as DialogSceneLike;
    this.controller = controller;
    this.depth = options.depth ?? DEFAULT_DEPTH;
    this.currentView = controller.getView();
    this.buildToolbar(options);
    this.buildModalScaffold();
    this.unsubscribe = controller.addListener((view) => this.handleView(view));
    this.attachKeyboardHandlers();
    this.handleView(this.currentView);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Tear down all GameObjects + listeners. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const dispose of this.keyHandlers) {
      dispose();
    }
    this.keyHandlers = [];
    // Modal body + dynamic buttons live outside `disposables` because
    // they're rebuilt on every view change. Tear them down explicitly
    // before we drop the toolbar + scaffold so a destroy mid-modal
    // doesn't leak the in-flight body content.
    for (const obj of this.modalBody) obj.destroy();
    for (const handles of this.modalButtons) {
      handles.bg.destroy();
      handles.text.destroy();
    }
    for (const obj of this.disposables) {
      obj.destroy();
    }
    this.disposables.length = 0;
    this.toolbarSaveButton = null;
    this.toolbarLoadButton = null;
    this.toolbarLastResultText = null;
    this.modalBackdrop = null;
    this.modalPanel = null;
    this.modalTitle = null;
    this.modalBody = [];
    this.modalButtons = [];
  }

  /**
   * Read the active view kind — useful for tests + the host's own
   * key-handling guard so a global Escape doesn't fire when the modal
   * is closed.
   */
  isModalOpen(): boolean {
    return this.currentView.kind !== 'closed';
  }

  // -------------------------------------------------------------------------
  // Toolbar — persistent buttons in the top-right of the builder
  // -------------------------------------------------------------------------

  private buildToolbar(options: SaveLoadDialogOptions): void {
    const viewW = this.scene.scale.gameSize.width;
    const padX = options.toolbarPaddingX ?? TOOLBAR_PADDING_X;
    const padY = options.toolbarPaddingY ?? TOOLBAR_PADDING_Y;

    // Anchor on the top-right corner. Buttons grow leftward.
    const loadButtonX =
      viewW - padX - TOOLBAR_BUTTON_WIDTH;
    const saveButtonX =
      loadButtonX - TOOLBAR_BUTTON_GAP - TOOLBAR_BUTTON_WIDTH;
    const buttonY = padY;

    this.toolbarSaveButton = this.buildToolbarButton(
      saveButtonX,
      buttonY,
      'SAVE',
      () => this.controller.openSavePrompt(),
    );
    this.toolbarLoadButton = this.buildToolbarButton(
      loadButtonX,
      buttonY,
      'LOAD',
      () => this.controller.openLoadList(),
    );

    // Last-result line under the buttons — only visible once we have a result.
    const lastResultText = this.scene.add
      .text(
        viewW - padX,
        buttonY + TOOLBAR_BUTTON_HEIGHT + 4,
        '',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: hex(SAVE_LOAD_DIALOG_COLORS.helperText),
        },
      )
      .setOrigin(1, 0)
      .setDepth(this.depth)
      .setVisible(false);
    this.toolbarLastResultText = lastResultText;
    this.disposables.push(lastResultText);
  }

  private buildToolbarButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): ToolbarButtonHandles {
    const bg = this.scene.add
      .rectangle(
        x,
        y,
        TOOLBAR_BUTTON_WIDTH,
        TOOLBAR_BUTTON_HEIGHT,
        SAVE_LOAD_DIALOG_COLORS.buttonFill,
        1,
      )
      .setOrigin(0, 0)
      .setDepth(this.depth)
      .setStrokeStyle(1, SAVE_LOAD_DIALOG_COLORS.toolbarBorder, 1)
      .setInteractive();
    bg.on('pointerdown', () => {
      // Disabled buttons short-circuit — see updateToolbarFromView.
      const enabled = (bg as unknown as { __enabled?: boolean }).__enabled;
      if (enabled === false) return;
      onClick();
    });
    bg.on('pointerover', () => {
      const enabled = (bg as unknown as { __enabled?: boolean }).__enabled;
      if (enabled === false) return;
      bg.setFillStyle(SAVE_LOAD_DIALOG_COLORS.buttonFillHot, 1);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(SAVE_LOAD_DIALOG_COLORS.buttonFill, 1);
    });
    const text = this.scene.add
      .text(
        x + TOOLBAR_BUTTON_WIDTH / 2,
        y + TOOLBAR_BUTTON_HEIGHT / 2,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: hex(SAVE_LOAD_DIALOG_COLORS.buttonText),
        },
      )
      .setOrigin(0.5, 0.5)
      .setDepth(this.depth);
    this.disposables.push(bg, text);
    return { bg, text, enabled: true };
  }

  // -------------------------------------------------------------------------
  // Modal — container painted on top of the toolbar / canvas when open
  // -------------------------------------------------------------------------

  private buildModalScaffold(): void {
    const viewW = this.scene.scale.gameSize.width;
    const viewH = this.scene.scale.gameSize.height;
    const cx = viewW / 2;
    const cy = viewH / 2;

    // Backdrop — full-viewport semi-opaque rect that blocks pointer
    // events from leaking to the canvas. Built but hidden by default.
    const backdrop = this.scene.add
      .rectangle(viewW / 2, viewH / 2, viewW, viewH, SAVE_LOAD_DIALOG_COLORS.modalBackdrop, 0.7)
      .setOrigin(0.5, 0.5)
      .setDepth(this.depth + 1)
      .setVisible(false)
      .setInteractive();
    this.modalBackdrop = backdrop;
    this.disposables.push(backdrop);

    // Modal panel.
    const panel = this.scene.add
      .rectangle(
        cx,
        cy,
        MODAL_WIDTH,
        MODAL_HEIGHT,
        SAVE_LOAD_DIALOG_COLORS.modalFill,
        1,
      )
      .setOrigin(0.5, 0.5)
      .setDepth(this.depth + 2)
      .setStrokeStyle(MODAL_BORDER_PX, SAVE_LOAD_DIALOG_COLORS.modalBorder, 1)
      .setVisible(false);
    this.modalPanel = panel;
    this.disposables.push(panel);

    // Title text.
    const title = this.scene.add
      .text(cx, cy - MODAL_HEIGHT / 2 + 24, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: hex(SAVE_LOAD_DIALOG_COLORS.titleText),
      })
      .setOrigin(0.5, 0)
      .setDepth(this.depth + 3)
      .setVisible(false);
    this.modalTitle = title;
    this.disposables.push(title);
  }

  // -------------------------------------------------------------------------
  // View handler — repaints from the controller's snapshot
  // -------------------------------------------------------------------------

  private handleView(view: SaveLoadView): void {
    if (this.destroyed) return;
    this.currentView = view;
    this.clearModalBody();
    this.updateToolbarFromView(view);
    if (view.kind === 'closed') {
      this.setModalVisible(false);
      return;
    }
    this.setModalVisible(true);
    this.setTitle(this.titleForView(view));
    switch (view.kind) {
      case 'save-prompt':
        this.renderSavePrompt(view);
        break;
      case 'save-confirm-overwrite':
        this.renderConfirmOverwrite(view);
        break;
      case 'save-success':
        this.renderSaveSuccess(view);
        break;
      case 'save-error':
        this.renderSaveError(view);
        break;
      case 'load-list':
        this.renderLoadList(view);
        break;
      case 'load-success':
        this.renderLoadSuccess(view);
        break;
      case 'load-error':
        this.renderLoadError(view);
        break;
      default:
        break;
    }
  }

  private titleForView(view: SaveLoadView): string {
    switch (view.kind) {
      case 'save-prompt':
        return 'Save Stage';
      case 'save-confirm-overwrite':
        return 'Confirm Overwrite';
      case 'save-success':
        return 'Stage Saved';
      case 'save-error':
        return 'Cannot Save';
      case 'load-list':
        return 'Load Stage';
      case 'load-success':
        return 'Stage Loaded';
      case 'load-error':
        return 'Cannot Load';
      case 'closed':
      default:
        return '';
    }
  }

  private updateToolbarFromView(view: SaveLoadView): void {
    let canSave = true;
    let canLoad = true;
    if (view.kind === 'closed') {
      canSave = view.canSave;
      canLoad = view.canLoad;
    }
    this.setToolbarButtonEnabled(this.toolbarSaveButton, canSave);
    this.setToolbarButtonEnabled(this.toolbarLoadButton, canLoad);

    // Last-result line. Reads through the controller because view kinds
    // other than 'closed' don't carry it.
    const lastText = this.toolbarLastResultText;
    if (lastText) {
      const last = this.controller.getLastResult();
      if (!last) {
        lastText.setVisible(false);
      } else {
        lastText.setText(
          last.kind === 'saved'
            ? `Saved as '${last.name}'`
            : `Loaded '${last.name}'`,
        );
        lastText.setVisible(true);
      }
    }
  }

  private setToolbarButtonEnabled(
    handles: ToolbarButtonHandles | null,
    enabled: boolean,
  ): void {
    if (!handles) return;
    handles.enabled = enabled;
    (handles.bg as unknown as { __enabled?: boolean }).__enabled = enabled;
    handles.text.setColor(
      hex(
        enabled
          ? SAVE_LOAD_DIALOG_COLORS.buttonText
          : SAVE_LOAD_DIALOG_COLORS.buttonTextDisabled,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Modal body painters — one per view kind
  // -------------------------------------------------------------------------

  private renderSavePrompt(view: SaveLoadView): void {
    if (view.kind !== 'save-prompt') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const topY = this.scene.scale.gameSize.height / 2 - MODAL_HEIGHT / 2;
    const inputY = topY + 80;

    this.addBodyText(
      cx,
      topY + 56,
      'Stage name',
      SAVE_LOAD_DIALOG_COLORS.helperText,
      'center',
    );
    // Input box visual (a dark fill rect with a border).
    const input = this.scene.add
      .rectangle(
        cx,
        inputY,
        MODAL_WIDTH - 96,
        36,
        SAVE_LOAD_DIALOG_COLORS.inputFill,
        1,
      )
      .setOrigin(0.5, 0)
      .setDepth(this.depth + 3)
      .setStrokeStyle(1, SAVE_LOAD_DIALOG_COLORS.inputBorder, 1);
    this.modalBody.push(input as unknown as DialogTextLike);
    // Echo the draft + a simulated cursor caret.
    const draft = view.nameDraft;
    const echo = draft.length > 0 ? draft : 'Type a name…';
    this.addBodyText(
      cx - (MODAL_WIDTH - 96) / 2 + 12,
      inputY + 18,
      echo,
      draft.length > 0
        ? SAVE_LOAD_DIALOG_COLORS.bodyText
        : SAVE_LOAD_DIALOG_COLORS.helperText,
      'left',
    );

    // Inline error / collision warning.
    const helperY = inputY + 60;
    if (view.error) {
      this.addBodyText(
        cx,
        helperY,
        view.error.message,
        SAVE_LOAD_DIALOG_COLORS.errorText,
        'center',
      );
    } else if (view.overwritesExistingName) {
      this.addBodyText(
        cx,
        helperY,
        `Will overwrite '${view.overwritesExistingName}'.`,
        SAVE_LOAD_DIALOG_COLORS.helperText,
        'center',
      );
    } else {
      this.addBodyText(
        cx,
        helperY,
        `1–64 characters, letters/numbers/spaces.`,
        SAVE_LOAD_DIALOG_COLORS.helperText,
        'center',
      );
    }

    this.renderModalButtons([
      {
        label: 'SAVE',
        onClick: () => this.controller.submitSavePrompt(),
        primary: true,
      },
      {
        label: 'CANCEL',
        onClick: () => this.controller.cancel(),
      },
    ]);
  }

  private renderConfirmOverwrite(view: SaveLoadView): void {
    if (view.kind !== 'save-confirm-overwrite') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const topY = this.scene.scale.gameSize.height / 2 - MODAL_HEIGHT / 2;
    this.addBodyText(
      cx,
      topY + 80,
      `An existing stage '${view.existingName}' will be replaced.`,
      SAVE_LOAD_DIALOG_COLORS.bodyText,
      'center',
    );
    this.addBodyText(
      cx,
      topY + 80 + MODAL_LINE_HEIGHT,
      `Slot id: ${view.slotId}`,
      SAVE_LOAD_DIALOG_COLORS.helperText,
      'center',
    );
    this.renderModalButtons([
      {
        label: 'OVERWRITE',
        onClick: () => this.controller.confirmOverwrite(),
        primary: true,
      },
      {
        label: 'BACK',
        onClick: () => this.controller.cancelOverwrite(),
      },
    ]);
  }

  private renderSaveSuccess(view: SaveLoadView): void {
    if (view.kind !== 'save-success') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const cy = this.scene.scale.gameSize.height / 2;
    this.addBodyText(
      cx,
      cy - 16,
      view.overwritten
        ? `Replaced '${view.name}'.`
        : `Saved '${view.name}'.`,
      SAVE_LOAD_DIALOG_COLORS.successText,
      'center',
    );
    this.renderModalButtons([
      {
        label: 'OK',
        onClick: () => this.controller.dismiss(),
        primary: true,
      },
    ]);
  }

  private renderSaveError(view: SaveLoadView): void {
    if (view.kind !== 'save-error') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const cy = this.scene.scale.gameSize.height / 2;
    this.addBodyText(
      cx,
      cy - 16,
      view.failure.message,
      SAVE_LOAD_DIALOG_COLORS.errorText,
      'center',
    );
    this.renderModalButtons([
      {
        label: 'BACK',
        onClick: () => this.controller.dismiss(),
        primary: true,
      },
      {
        label: 'CLOSE',
        onClick: () => this.controller.cancel(),
      },
    ]);
  }

  private renderLoadList(view: SaveLoadView): void {
    if (view.kind !== 'load-list') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const topY = this.scene.scale.gameSize.height / 2 - MODAL_HEIGHT / 2;
    const listTop = topY + 64;

    if (view.slots.length === 0) {
      this.addBodyText(
        cx,
        listTop + 40,
        'No saved stages yet.',
        SAVE_LOAD_DIALOG_COLORS.helperText,
        'center',
      );
    } else {
      const listX = cx - (MODAL_WIDTH - 96) / 2;
      const listW = MODAL_WIDTH - 96;
      const maxRows = Math.min(6, view.slots.length);
      for (let i = 0; i < maxRows; i += 1) {
        const slot = view.slots[i];
        if (!slot) continue;
        const rowY = listTop + i * (SLOT_ROW_HEIGHT + 4);
        const row = this.scene.add
          .rectangle(
            listX,
            rowY,
            listW,
            SLOT_ROW_HEIGHT,
            SAVE_LOAD_DIALOG_COLORS.slotRowFill,
            1,
          )
          .setOrigin(0, 0)
          .setDepth(this.depth + 3)
          .setStrokeStyle(1, SAVE_LOAD_DIALOG_COLORS.slotRowBorder, 1)
          .setInteractive();
        row.on('pointerover', () =>
          row.setFillStyle(SAVE_LOAD_DIALOG_COLORS.slotRowFillHot, 1),
        );
        row.on('pointerout', () =>
          row.setFillStyle(SAVE_LOAD_DIALOG_COLORS.slotRowFill, 1),
        );
        row.on('pointerdown', () => {
          this.controller.pickLoadSlot(slot.id);
        });
        this.modalBody.push(row as unknown as DialogTextLike);

        this.addBodyText(
          listX + 12,
          rowY + SLOT_ROW_HEIGHT / 2,
          slot.name,
          SAVE_LOAD_DIALOG_COLORS.bodyText,
          'left',
          'middle',
        );
        this.addBodyText(
          listX + listW - 56,
          rowY + SLOT_ROW_HEIGHT / 2,
          'DELETE',
          SAVE_LOAD_DIALOG_COLORS.errorText,
          'right',
          'middle',
        );
        // Wire a separate hit-rect for delete.
        const delHit = this.scene.add
          .rectangle(
            listX + listW - 64,
            rowY,
            56,
            SLOT_ROW_HEIGHT,
            0x000000,
            0,
          )
          .setOrigin(0, 0)
          .setDepth(this.depth + 4)
          .setInteractive();
        delHit.on('pointerdown', (...args: unknown[]) => {
          // Guard against the row's own pointerdown firing too —
          // Phaser's event ordering: the topmost z hit gets it first.
          this.controller.deleteLoadSlot(slot.id);
          // Suppress the row click that would otherwise fire after this.
          // (Phaser's default behaviour cancels propagation when stopPropagation is called.)
          const evt = args[0] as { stopPropagation?: () => void } | undefined;
          if (evt && typeof evt.stopPropagation === 'function') {
            evt.stopPropagation();
          }
        });
        this.modalBody.push(delHit as unknown as DialogTextLike);
      }
    }

    if (view.error) {
      this.addBodyText(
        cx,
        topY + MODAL_HEIGHT - 80,
        view.error.message,
        SAVE_LOAD_DIALOG_COLORS.errorText,
        'center',
      );
    }

    this.renderModalButtons([
      {
        label: 'CLOSE',
        onClick: () => this.controller.cancel(),
      },
    ]);
  }

  private renderLoadSuccess(view: SaveLoadView): void {
    if (view.kind !== 'load-success') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const cy = this.scene.scale.gameSize.height / 2;
    this.addBodyText(
      cx,
      cy - 24,
      `Loaded '${view.name}'.`,
      SAVE_LOAD_DIALOG_COLORS.successText,
      'center',
    );
    if (view.rejected > 0) {
      this.addBodyText(
        cx,
        cy + 4,
        `${view.accepted} pieces loaded · ${view.rejected} rejected by validator.`,
        SAVE_LOAD_DIALOG_COLORS.helperText,
        'center',
      );
    } else {
      this.addBodyText(
        cx,
        cy + 4,
        `${view.accepted} pieces loaded.`,
        SAVE_LOAD_DIALOG_COLORS.helperText,
        'center',
      );
    }
    this.renderModalButtons([
      {
        label: 'OK',
        onClick: () => this.controller.dismiss(),
        primary: true,
      },
    ]);
  }

  private renderLoadError(view: SaveLoadView): void {
    if (view.kind !== 'load-error') return;
    const cx = this.scene.scale.gameSize.width / 2;
    const cy = this.scene.scale.gameSize.height / 2;
    this.addBodyText(
      cx,
      cy - 24,
      view.failure.message,
      SAVE_LOAD_DIALOG_COLORS.errorText,
      'center',
    );
    const buttons: ModalButtonSpec[] = [
      {
        label: 'BACK',
        onClick: () => this.controller.dismiss(),
        primary: true,
      },
    ];
    if (view.failure.code === 'corrupted' || view.failure.code === 'missing') {
      buttons.unshift({
        label: 'DELETE SLOT',
        onClick: () => this.controller.deleteLoadSlot(view.slotId),
      });
    }
    this.renderModalButtons(buttons);
  }

  // -------------------------------------------------------------------------
  // Modal body helpers
  // -------------------------------------------------------------------------

  private setModalVisible(visible: boolean): void {
    if (this.modalBackdrop) this.modalBackdrop.setVisible(visible);
    if (this.modalPanel) this.modalPanel.setVisible(visible);
    if (this.modalTitle) this.modalTitle.setVisible(visible);
  }

  private setTitle(text: string): void {
    if (this.modalTitle) this.modalTitle.setText(text);
  }

  private clearModalBody(): void {
    for (const obj of this.modalBody) {
      obj.destroy();
    }
    this.modalBody = [];
    for (const handles of this.modalButtons) {
      handles.bg.destroy();
      handles.text.destroy();
    }
    this.modalButtons = [];
  }

  private addBodyText(
    x: number,
    y: number,
    content: string,
    color: number,
    align: 'left' | 'center' | 'right' = 'center',
    valign: 'top' | 'middle' | 'bottom' = 'top',
  ): DialogTextLike {
    const originX = align === 'left' ? 0 : align === 'center' ? 0.5 : 1;
    const originY = valign === 'top' ? 0 : valign === 'middle' ? 0.5 : 1;
    const text = this.scene.add
      .text(x, y, content, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: hex(color),
      })
      .setOrigin(originX, originY)
      .setDepth(this.depth + 3);
    this.modalBody.push(text);
    return text;
  }

  private renderModalButtons(specs: ModalButtonSpec[]): void {
    if (specs.length === 0) return;
    const cx = this.scene.scale.gameSize.width / 2;
    const buttonY =
      this.scene.scale.gameSize.height / 2 + MODAL_HEIGHT / 2 - 56;
    const buttonW = 144;
    const buttonH = 36;
    const gap = 16;
    const totalW = specs.length * buttonW + (specs.length - 1) * gap;
    const startX = cx - totalW / 2;
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      if (!spec) continue;
      const x = startX + i * (buttonW + gap);
      const fill = spec.primary
        ? SAVE_LOAD_DIALOG_COLORS.buttonFillHot
        : SAVE_LOAD_DIALOG_COLORS.buttonFill;
      const bg = this.scene.add
        .rectangle(x, buttonY, buttonW, buttonH, fill, 1)
        .setOrigin(0, 0)
        .setDepth(this.depth + 3)
        .setStrokeStyle(1, SAVE_LOAD_DIALOG_COLORS.toolbarBorder, 1)
        .setInteractive();
      bg.on('pointerover', () =>
        bg.setFillStyle(SAVE_LOAD_DIALOG_COLORS.buttonFillHot, 1),
      );
      bg.on('pointerout', () => bg.setFillStyle(fill, 1));
      bg.on('pointerdown', () => spec.onClick());
      const text = this.scene.add
        .text(x + buttonW / 2, buttonY + buttonH / 2, spec.label, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: hex(SAVE_LOAD_DIALOG_COLORS.buttonText),
        })
        .setOrigin(0.5, 0.5)
        .setDepth(this.depth + 4);
      this.modalButtons.push({ bg, text });
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard — wires typing into the save-prompt and Enter / Escape into
  // the controller's submit / cancel paths.
  // -------------------------------------------------------------------------

  private attachKeyboardHandlers(): void {
    const kb = this.scene.input?.keyboard;
    if (!kb || typeof kb.on !== 'function') return;
    const keydown = (...args: unknown[]): void => {
      if (this.destroyed) return;
      const evt = args[0] as { key?: string; preventDefault?: () => void } | undefined;
      if (!evt || typeof evt.key !== 'string') return;
      const view = this.controller.getView();
      if (view.kind === 'closed') return;
      const key = evt.key;
      if (key === 'Escape') {
        this.controller.cancel();
        evt.preventDefault?.();
        return;
      }
      if (key === 'Enter') {
        if (view.kind === 'save-prompt') {
          this.controller.submitSavePrompt();
          evt.preventDefault?.();
          return;
        }
        if (view.kind === 'save-confirm-overwrite') {
          this.controller.confirmOverwrite();
          evt.preventDefault?.();
          return;
        }
        if (view.kind === 'save-success' || view.kind === 'load-success') {
          this.controller.dismiss();
          evt.preventDefault?.();
          return;
        }
        if (view.kind === 'save-error' || view.kind === 'load-error') {
          this.controller.dismiss();
          evt.preventDefault?.();
          return;
        }
        return;
      }
      if (view.kind !== 'save-prompt') return;
      if (key === 'Backspace') {
        this.controller.backspaceNameDraft();
        evt.preventDefault?.();
        return;
      }
      // Single-character keys go straight into the draft.
      if (key.length === 1) {
        this.controller.insertIntoNameDraft(key);
        evt.preventDefault?.();
      }
    };
    const result = kb.on('keydown', keydown);
    // Phaser's event emitter returns the emitter itself; retain a
    // disposer that detaches the same listener at teardown.
    if (result && typeof (result as { off?: unknown }).off === 'function') {
      this.keyHandlers.push(() => {
        (result as { off: (event: string, handler: (...a: unknown[]) => void) => void }).off(
          'keydown',
          keydown,
        );
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ToolbarButtonHandles {
  bg: DialogRectangleLike;
  text: DialogTextLike;
  enabled: boolean;
}

interface ModalButtonHandles {
  bg: DialogRectangleLike;
  text: DialogTextLike;
}

interface ModalButtonSpec {
  readonly label: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a 0xRRGGBB number into the `#rrggbb` string Phaser's text style wants. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
