/**
 * Entry point for the Platform Fighter game.
 *
 * Boots Phaser 3 with Matter.js physics. The full Phaser game config —
 * renderer, scaling, 60 FPS lock, Matter physics, scene registration —
 * lives in `src/engine/GameConfig.ts` so it has a single importable home.
 */

import Phaser from 'phaser';
import { createPhaserGameConfig } from './engine/GameConfig';

function startGame(): Phaser.Game {
  const game = new Phaser.Game(createPhaserGameConfig());

  // Hide the boot overlay once Phaser takes over the canvas.
  const overlay = document.getElementById('boot-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    window.setTimeout(() => overlay.remove(), 400);
  }

  return game;
}

// Bootstrap on DOM ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    startGame();
  });
} else {
  startGame();
}
