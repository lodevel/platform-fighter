import * as THREE from 'three';
import { createRenderer, fitToHost } from '../engine/renderer';
import { FULL_DESIGN_RECT, PlaneCamera, toWorldX, toWorldY, type DesignRect } from '../engine/space';
import { SpriteLayer, type SpriteDraw } from '../engine/sprites/spriteLayer';
import { TextureStore } from '../engine/sprites/textureStore';
import { geometryPreparationHost, presentationTarget, type AppearanceSubmission } from '../engine/presentation/submission';
import { createStageRuntime, type StageRuntime } from './runtime';

const FRAME_MS = 1000 / 60;

/**
 * Draws a stage plus a sprite layer into a host element and runs the stage
 * clock at the simulation's fixed 60 Hz. Shared by the stage viewer and the
 * menu backdrop; MatchSim takes over the clock in step 6.
 */
export class StagePresenter {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new PlaneCamera();
  readonly sprites = new SpriteLayer(new TextureStore());
  readonly screenSprites = new SpriteLayer(this.sprites.textures);
  private readonly screenCamera = new PlaneCamera();
  runtime!: StageRuntime;
  paused = false;
  /** Sprites to draw each frame (fighters, items...), in submission order. */
  spriteSource: ((runtime: StageRuntime) => SpriteDraw[]) | null = null;
  screenSpriteSource: (() => readonly SpriteDraw[]) | null = null;
  /** Character capabilities submit into the same ordered world/screen queues. */
  appearanceSource: ((runtime: StageRuntime) => readonly AppearanceSubmission[]) | null = null;
  screenAppearanceSource: (() => readonly AppearanceSubmission[]) | null = null;
  /** Called every animation frame before rendering (camera moves etc.). */
  beforeRender: ((elapsed: number) => void) | null = null;
  /** Design rectangle to frame (a match camera); null frames the fitted default. */
  viewRect: DesignRect | null = null;
  private fitRect: DesignRect = FULL_DESIGN_RECT;
  private readonly cache = new Map<string, StageRuntime>();
  private last = performance.now();
  private acc = 0;
  private elapsed = 0;
  private readonly preparingAppearances = new WeakMap<AppearanceSubmission, Promise<unknown>>();
  private appearanceError: Error | null = null;

  constructor(private readonly host: HTMLElement, private readonly fit: 'contain' | 'cover' = 'contain') {
    this.renderer = createRenderer(host);
    this.renderer.info.autoReset = false;
    this.sprites.textures.attachRenderer(this.renderer);
    addEventListener('resize', () => this.refit());
    this.refit();
  }

  /** Switch stage; each stage is built once and kept, so switching back is instant. */
  setStage(id: string): StageRuntime {
    let runtime = this.cache.get(id);
    if (!runtime) {
      runtime = createStageRuntime(id);
      this.cache.set(id, runtime);
    }
    this.runtime = runtime;
    return runtime;
  }

  /** Advance the fixed-step clock to `now` and render one frame. */
  frame(now: number): void {
    if (this.appearanceError) { const error = this.appearanceError; this.appearanceError = null; throw error; }
    this.renderer.info.reset();
    const dtMs = Math.min(now - this.last, 100);
    this.last = now;
    this.elapsed += dtMs / 1000;
    if (this.paused) this.acc = 0;
    else {
      this.acc += dtMs;
      for (let i = 0; this.acc >= FRAME_MS && i < 8; i++) { this.runtime.step(); this.acc -= FRAME_MS; }
    }
    this.beforeRender?.(this.elapsed);
    this.camera.frame(this.viewRect ?? this.fitRect);
    const { view } = this.runtime;
    view.update({ frame: this.runtime.frame, elapsed: this.elapsed, dt: dtMs / 1000 });
    this.renderer.clear();
    this.renderer.render(view.scene, this.camera);
    // Gameplay layer: drawn over the stage like Phaser's display list.
    this.appearanceSource?.(this.runtime).forEach(submission => {
      const screen = submission.pass === 'screen';
      this.prepareAppearance(submission, screen);
      submission.submit(presentationTarget(screen ? this.screenSprites : this.sprites, screen ? undefined : view.theme.spriteTint.getHex()));
    });
    this.spriteSource?.(this.runtime).forEach((d) => this.sprites.draw(d));
    this.sprites.flush();
    this.renderer.clearDepth();
    this.renderer.render(this.sprites.scene, this.camera);
    this.screenAppearanceSource?.().forEach(submission => { this.prepareAppearance(submission, true); submission.submit(presentationTarget(this.screenSprites)); });
    this.screenSpriteSource?.().forEach((draw) => this.screenSprites.draw(draw));
    this.screenSprites.flush();
    this.screenCamera.frame(this.fitRect);
    this.renderer.clearDepth();
    this.renderer.render(this.screenSprites.scene, this.screenCamera);
  }

  private prepareAppearance(submission: AppearanceSubmission, screen: boolean): void {
    if (!submission.prepare) return;
    const layer = screen ? this.screenSprites : this.sprites;
    const generation = submission.preparationGeneration;
    const pending = submission.prepare(undefined, geometryPreparationHost(this.renderer, layer.scene, screen ? this.screenCamera : this.camera));
    if (this.preparingAppearances.get(submission) === pending) return;
    this.preparingAppearances.set(submission, pending);
    void pending.catch(error => {
      if (submission.active !== false && submission.preparationGeneration === generation && this.preparingAppearances.get(submission) === pending) this.appearanceError = error instanceof Error ? error : new Error(String(error));
    });
  }

  /** Canvas pixel where a design-plane point lands (camera acceptance check). */
  project(designX: number, designY: number): { x: number; y: number } {
    const v = new THREE.Vector3(toWorldX(designX), toWorldY(designY), 0).project(this.camera);
    const c = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * c.clientWidth, y: ((1 - v.y) / 2) * c.clientHeight };
  }

  /** Re-fit after the host changes size outside a window resize. */
  refit(): void {
    this.fitRect = fitToHost(this.renderer, this.host, this.fit);
    this.camera.frame(this.viewRect ?? this.fitRect);
  }
}
