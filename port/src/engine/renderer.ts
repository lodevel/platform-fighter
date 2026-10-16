import * as THREE from 'three';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../src/stages/stageDefinitions';
import { FULL_DESIGN_RECT, type DesignRect } from './space';

/**
 * WebGL renderer in the demos' colour pipeline: no colour management and a
 * linear output, so hex colours and sprite pixels reach the screen as
 * authored (see `LEGACY_LIGHT`).
 */
export function createRenderer(host: HTMLElement): THREE.WebGLRenderer {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  host.appendChild(renderer.domElement);
  return renderer;
}

/**
 * Size the canvas to the host and return the design rectangle to frame.
 * `contain` letterboxes the full 16:9 design space like Phaser's FIT mode;
 * `cover` fills the host and frames the central part of the design space.
 */
export function fitToHost(renderer: THREE.WebGLRenderer, host: HTMLElement, fit: 'contain' | 'cover' = 'contain'): DesignRect {
  const aspect = STAGE_DESIGN_WIDTH / STAGE_DESIGN_HEIGHT;
  const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
  if (fit === 'contain') {
    const width = Math.min(w, h * aspect), height = width / aspect;
    renderer.setSize(Math.round(width), Math.round(height), true);
    return FULL_DESIGN_RECT;
  }
  renderer.setSize(w, h, true);
  const hostAspect = w / h;
  const width = hostAspect > aspect ? STAGE_DESIGN_WIDTH : STAGE_DESIGN_HEIGHT * hostAspect;
  const height = width / hostAspect;
  return { x: (STAGE_DESIGN_WIDTH - width) / 2, y: (STAGE_DESIGN_HEIGHT - height) / 2, width, height };
}
