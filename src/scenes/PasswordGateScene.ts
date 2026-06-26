/**
 * PasswordGateScene — soft password wall shown after Preload, before the
 * main menu. Manually captures keyboard input (no DOM `<input>` needed) and
 * displays the entry masked. On the correct password it remembers the unlock
 * in localStorage and forwards to the main menu; a prior unlock skips the
 * prompt entirely.
 *
 * Client-side only — see `src/config/accessGate.ts` for the security caveat.
 */
import Phaser from 'phaser';
import { GAME_CONFIG } from '../engine/constants';
import { MENU_FONT } from '../ui/menuTheme';
import { checkPassword, isUnlocked, recordUnlock } from '../config/accessGate';

const NEXT_SCENE_KEY = 'MainMenuScene';
const MAX_LEN = 64;

export class PasswordGateScene extends Phaser.Scene {
  private entered = '';
  private maskedText?: Phaser.GameObjects.Text;
  private errorText?: Phaser.GameObjects.Text;
  private panel?: Phaser.GameObjects.Rectangle;
  private keyHandler?: (event: KeyboardEvent) => void;

  constructor() {
    super({ key: 'PasswordGateScene' });
  }

  create(): void {
    // Already unlocked this browser — skip straight through.
    if (isUnlocked()) {
      this.scene.start(NEXT_SCENE_KEY);
      return;
    }

    const cx = GAME_CONFIG.width / 2;
    const cy = GAME_CONFIG.height / 2;

    this.add.rectangle(cx, cy, GAME_CONFIG.width, GAME_CONFIG.height, 0x0a0a12);

    this.panel = this.add
      .rectangle(cx, cy, 720, 360, 0x14141f, 0.96)
      .setStrokeStyle(2, 0x3a3a52, 1);

    this.add
      .text(cx, cy - 120, 'LOCKED', {
        fontFamily: MENU_FONT,
        fontSize: '52px',
        color: '#f4f4ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 58, 'Enter the password to continue', {
        fontFamily: MENU_FONT,
        fontSize: '20px',
        color: '#9aa0b4',
      })
      .setOrigin(0.5);

    // Masked entry field.
    this.add
      .rectangle(cx, cy + 4, 520, 56, 0x0c0c16)
      .setStrokeStyle(2, 0x4a4a66, 1);
    this.maskedText = this.add
      .text(cx, cy + 4, '', {
        fontFamily: MENU_FONT,
        fontSize: '34px',
        color: '#f4f4ff',
      })
      .setOrigin(0.5);

    this.errorText = this.add
      .text(cx, cy + 70, '', {
        fontFamily: MENU_FONT,
        fontSize: '18px',
        color: '#ff5d6c',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy + 130, 'Type, then press ENTER  ·  BACKSPACE to delete', {
        fontFamily: MENU_FONT,
        fontSize: '15px',
        color: '#6a6f86',
      })
      .setOrigin(0.5);

    this.keyHandler = (event: KeyboardEvent) => this.onKey(event);
    this.input.keyboard?.on('keydown', this.keyHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.keyHandler) this.input.keyboard?.off('keydown', this.keyHandler);
    });

    this.refreshMask();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.submit();
      return;
    }
    if (event.key === 'Backspace') {
      this.entered = this.entered.slice(0, -1);
      this.refreshMask();
      return;
    }
    if (event.key === 'Escape') {
      this.entered = '';
      this.refreshMask();
      return;
    }
    // Accept a single printable character.
    if (event.key.length === 1 && this.entered.length < MAX_LEN) {
      this.entered += event.key;
      this.errorText?.setText('');
      this.refreshMask();
    }
  }

  private refreshMask(): void {
    this.maskedText?.setText('•'.repeat(this.entered.length));
  }

  private submit(): void {
    if (checkPassword(this.entered)) {
      recordUnlock();
      this.scene.start(NEXT_SCENE_KEY);
      return;
    }
    // Wrong — clear, flash an error, and shake the panel.
    this.entered = '';
    this.refreshMask();
    this.errorText?.setText('Incorrect password');
    if (this.panel) {
      const x0 = this.panel.x;
      this.tweens.add({
        targets: this.panel,
        x: { from: x0 - 14, to: x0 },
        ease: 'Elastic',
        duration: 360,
        onComplete: () => this.panel?.setX(x0),
      });
    }
  }
}
