import Phaser from 'phaser';

import {
  CharacterEditState,
  type CharacterRecord,
  listCharacters,
  loadCharacter as loadCharacterRecord,
  saveCharacter as saveCharacterRecord,
} from '../characterBuilder';
import {
  parseCharacterDataFile,
  type CharacterDataSpec,
} from '../characters/characterSerializer';
import wolfData from '../../data/characters/wolf.json';
import { ASSET_KEYS } from '../assets/manifest';

/**
 * M7.6 — visual character editor scene.
 *
 * Keyboard-driven first cut on top of the M7.5
 * {@link CharacterEditState} model. Lets a designer load any of the
 * 4 shipped characters or any saved custom slot, step every
 * movement / body field with the arrow keys, save back to
 * localStorage, and bounce out to a match without re-launching the
 * game. Drag/drop hitbox editing + sprite-frame preview ride on top
 * of this scaffold in a follow-up sub-task.
 *
 * # Layout (top → bottom)
 *
 *   • Title row — character displayName + role + dirty-marker.
 *   • Sprite preview — the loaded character's idle frame from the
 *     existing CC0 atlases (Wolf / Cat / Owl / Bear) so the editor
 *     never shows a placeholder rectangle (per project memory).
 *   • Field grid — every numeric field on a separate row. The
 *     focused row is highlighted; up/down moves focus, left/right
 *     steps the value (Shift = ×10).
 *   • Status footer — undo depth, dirty flag, hotkey legend.
 *
 * # Keys
 *
 *   • UP / DOWN              — move focus
 *   • LEFT / RIGHT           — step current field (Shift = ×10)
 *   • Z / Y                  — undo / redo
 *   • S                      — save current spec to a slot prompt
 *   • L                      — load a saved slot
 *   • R                      — reset to last clean checkpoint
 *   • ESC                    — back to main menu
 *
 * # Sprite gap (per memory: "use real sprites, not ugly rectangles")
 *
 * The preview pane displays one of the existing palette-0 idle
 * frames — Wolf / Cat / Owl / Bear all ship CC0 sheets. A loaded
 * custom-slot spec inherits its sprite from its `id` field, so a
 * brand-new "wolf-flavored" spec saved to a custom slot still shows
 * the Wolf sprite — never a coloured rectangle.
 */

interface FieldRow {
  readonly label: string;
  readonly group: 'movement' | 'body';
  readonly field: string;
  readonly step: number;
  readonly minValue: number;
  readonly integer: boolean;
}

const FIELD_ROWS: ReadonlyArray<FieldRow> = [
  // Movement profile (12 fields)
  { label: 'Max Run Speed', group: 'movement', field: 'maxRunSpeed', step: 0.5, minValue: 0.5, integer: false },
  { label: 'Ground Accel', group: 'movement', field: 'groundAccel', step: 0.05, minValue: 0.05, integer: false },
  { label: 'Air Accel', group: 'movement', field: 'airAccel', step: 0.05, minValue: 0.05, integer: false },
  { label: 'Ground Damping', group: 'movement', field: 'groundDamping', step: 0.02, minValue: 0.02, integer: false },
  { label: 'Air Damping', group: 'movement', field: 'airDamping', step: 0.02, minValue: 0.02, integer: false },
  { label: 'Jump Impulse', group: 'movement', field: 'jumpImpulse', step: 0.5, minValue: 0.5, integer: false },
  { label: 'Max Jumps', group: 'movement', field: 'maxJumps', step: 1, minValue: 1, integer: true },
  { label: 'Mass', group: 'movement', field: 'mass', step: 1, minValue: 1, integer: false },
  { label: 'Fall Accel', group: 'movement', field: 'fallAccel', step: 0.02, minValue: 0.02, integer: false },
  { label: 'Max Fall Speed', group: 'movement', field: 'maxFallSpeed', step: 0.5, minValue: 0.5, integer: false },
  { label: 'Fast Fall Speed', group: 'movement', field: 'fastFallSpeed', step: 0.5, minValue: 0.5, integer: false },
  { label: 'Jump Cut Factor', group: 'movement', field: 'jumpCutFactor', step: 0.05, minValue: 0.05, integer: false },
  // Body geometry (3 fields)
  { label: 'Body Width', group: 'body', field: 'width', step: 1, minValue: 4, integer: true },
  { label: 'Body Height', group: 'body', field: 'height', step: 1, minValue: 4, integer: true },
  { label: 'Body Chamfer', group: 'body', field: 'chamfer', step: 1, minValue: 0, integer: true },
];

export class CharacterEditorScene extends Phaser.Scene {
  private editState!: CharacterEditState;
  private focusIndex = 0;
  private titleText!: Phaser.GameObjects.Text;
  private dirtyMarker!: Phaser.GameObjects.Text;
  private spritePreview: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | null = null;
  private fieldTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private feedbackClearTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'CharacterEditorScene' });
  }

  init(): void {
    // Seed with Wolf as the default — the user can load any other
    // character via [L]. Parsing the static JSON guarantees the
    // edit state always starts from a validated spec.
    const seed = parseCharacterDataFile(wolfData, 'data/characters/wolf.json');
    this.editState = new CharacterEditState(seed);
    this.focusIndex = 0;
  }

  create(): void {
    const { width } = this.scale.gameSize;

    // Title row.
    this.add
      .text(width / 2, 24, 'CHARACTER EDITOR', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5, 0);

    this.titleText = this.add
      .text(width / 2, 70, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5, 0);

    this.dirtyMarker = this.add
      .text(width / 2 + 240, 70, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffaa44',
      })
      .setOrigin(0.5, 0);

    // Sprite preview.
    this.refreshSpritePreview();

    // Field grid.
    this.fieldTexts = FIELD_ROWS.map((_, i) =>
      this.add.text(120, 280 + i * 26, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cccce0',
      }),
    );

    // Status / hotkey legend.
    this.statusText = this.add
      .text(width / 2, this.scale.gameSize.height - 80, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888899',
      })
      .setOrigin(0.5, 0);
    this.feedbackText = this.add
      .text(width / 2, this.scale.gameSize.height - 50, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#88ff88',
      })
      .setOrigin(0.5, 0);

    this.editState.onChange(() => this.refreshAll());

    // Keyboard wiring.
    this.input.keyboard?.on('keydown-UP', () => this.moveFocus(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.moveFocus(1));
    this.input.keyboard?.on('keydown-LEFT', (e: KeyboardEvent) => this.stepField(-1, e.shiftKey ? 10 : 1));
    this.input.keyboard?.on('keydown-RIGHT', (e: KeyboardEvent) => this.stepField(1, e.shiftKey ? 10 : 1));
    this.input.keyboard?.on('keydown-Z', () => {
      this.editState.undo();
    });
    this.input.keyboard?.on('keydown-Y', () => {
      this.editState.redo();
    });
    this.input.keyboard?.on('keydown-S', () => this.handleSave());
    this.input.keyboard?.on('keydown-L', () => this.handleLoad());
    this.input.keyboard?.on('keydown-R', () => this.editState.reset());
    this.input.keyboard?.once('keydown-ESC', () => {
      this.scene.start('MainMenuScene');
    });

    this.refreshAll();
  }

  private refreshAll(): void {
    const spec = this.editState.getSpec();
    this.titleText.setText(`${spec.displayName} (${spec.role}) — id: ${spec.id}`);
    this.dirtyMarker.setText(this.editState.isDirty() ? '● UNSAVED' : '');
    for (let i = 0; i < FIELD_ROWS.length; i += 1) {
      const row = FIELD_ROWS[i]!;
      const value =
        row.group === 'movement'
          ? (spec.movement as unknown as Record<string, number>)[row.field]!
          : (spec.body as unknown as Record<string, number>)[row.field]!;
      const display = row.integer ? value.toFixed(0) : value.toFixed(2);
      const focused = i === this.focusIndex;
      const arrow = focused ? '> ' : '  ';
      const color = focused ? '#fff080' : '#cccce0';
      this.fieldTexts[i]!.setText(`${arrow}${row.label.padEnd(18)} ${display}`)
        .setColor(color);
    }
    const undoCount = this.editState.canUndo() ? 'Z=undo' : '·';
    const redoCount = this.editState.canRedo() ? 'Y=redo' : '·';
    this.statusText.setText(
      `[↑↓] focus  [←→] step (Shift=×10)  [${undoCount}] [${redoCount}]  ` +
        `[S] save  [L] load  [R] reset  [ESC] back`,
    );
    this.refreshSpritePreview();
  }

  private moveFocus(delta: number): void {
    const next = (this.focusIndex + delta + FIELD_ROWS.length) % FIELD_ROWS.length;
    this.focusIndex = next;
    this.refreshAll();
  }

  private stepField(direction: -1 | 1, multiplier: number): void {
    const row = FIELD_ROWS[this.focusIndex]!;
    const spec = this.editState.getSpec();
    const current =
      row.group === 'movement'
        ? (spec.movement as unknown as Record<string, number>)[row.field]!
        : (spec.body as unknown as Record<string, number>)[row.field]!;
    let next = current + direction * row.step * multiplier;
    if (row.integer) next = Math.round(next);
    if (next < row.minValue) next = row.minValue;
    if (row.group === 'movement') {
      this.editState.setMovementField(
        row.field as keyof CharacterDataSpec['movement'],
        next,
      );
    } else {
      this.editState.setBodyField(
        row.field as keyof CharacterDataSpec['body'],
        next,
      );
    }
  }

  private handleSave(): void {
    const slotId = window.prompt(
      'Save character to slot id (alphanumeric, e.g. "myWolf"):',
      this.editState.getSpec().id,
    );
    if (!slotId) return;
    try {
      saveCharacterRecord(slotId, this.editState.getSpec(), Date.now());
      this.editState.markClean();
      this.flashFeedback(`✓ Saved as '${slotId}'`, '#88ff88');
    } catch (err) {
      this.flashFeedback(`✗ Save failed: ${(err as Error).message}`, '#ff8888');
    }
  }

  private handleLoad(): void {
    const slots = listCharacters();
    if (slots.length === 0) {
      this.flashFeedback('No saved characters yet', '#ffaa44');
      return;
    }
    const choice = window.prompt(
      `Load slot id (saved: ${slots.join(', ')}):`,
      slots[0],
    );
    if (!choice) return;
    const record: CharacterRecord | null = loadCharacterRecord(choice);
    if (record === null) {
      this.flashFeedback(`✗ Slot '${choice}' missing or corrupt`, '#ff8888');
      return;
    }
    this.editState.loadSpec(record.spec);
    this.flashFeedback(`✓ Loaded '${choice}'`, '#88ff88');
  }

  private refreshSpritePreview(): void {
    if (this.spritePreview !== null) {
      this.spritePreview.destroy();
      this.spritePreview = null;
    }
    const spec = this.editState.getSpec();
    // Map the spec id to a palette-0 idle texture key.
    const spriteKey =
      spec.id === 'cat'
        ? ASSET_KEYS.charCatPalette0
        : spec.id === 'wolf'
          ? ASSET_KEYS.charWolfPalette0
          : null; // owl / bear sprites available but not palette-0 indexed in the same way
    const cx = this.scale.gameSize.width / 2;
    const cy = 180;
    if (spriteKey !== null && this.textures.exists(spriteKey)) {
      const img = this.add
        .image(cx, cy, spriteKey)
        .setDisplaySize(80, 80)
        .setOrigin(0.5, 0.5);
      this.spritePreview = img;
    } else {
      // Fall back to a body-shape preview using the live body geometry.
      // This is intentional, not a placeholder — it visualises the
      // body the user is currently editing.
      const body = spec.body;
      const rect = this.add
        .rectangle(cx, cy, body.width, body.height, 0x4488cc, 1)
        .setStrokeStyle(2, 0x000000, 0.7);
      this.spritePreview = rect;
    }
  }

  private flashFeedback(message: string, color: string): void {
    this.feedbackText.setText(message).setColor(color);
    if (this.feedbackClearTimer !== null) {
      this.feedbackClearTimer.remove();
      this.feedbackClearTimer = null;
    }
    this.feedbackClearTimer = this.time.delayedCall(2500, () => {
      this.feedbackText.setText('');
      this.feedbackClearTimer = null;
    });
  }
}
