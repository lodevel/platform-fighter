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

  // Diagnostic handle — lets headless-browser test harnesses (and quick
  // console debugging) reach the live game instance. Exposed in dev AND
  // in `vite preview` builds so balance/physics probes can run against a
  // stable, HMR-immune production bundle. A fully-published deploy can
  // strip this by building with `DEPLOY=1` (the env flag below).
  if (import.meta.env.DEV || import.meta.env.MODE !== 'deploy') {
    (window as unknown as { __game?: Phaser.Game }).__game = game;
  }

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
