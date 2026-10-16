import type { StagePresenter } from '../arena/presenter';
import type { SpriteDraw } from '../engine/sprites/spriteLayer';
import { type CombatSfxSink, emitCombatSfx } from '../../../src/audio/combatAudio';
import { AppearanceCollection, type AppearanceSubmission } from '../fighters/appearance';
import { createLegacyAppearanceBridge, createLegacyFlightAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import type { SimView } from '../../../src/sim/view';
import { ShapeLayer } from '../engine/shapes/shapeLayer';
import { CameraRig } from './cameraRig';
import { drawDamageAreas } from './effects/damageAreas';
import { drawChargeIndicator, drawShieldBubble } from './effects/fighterOverlays';
import { ExplosionArt } from './effects/explosionArt';
import { HitSparks } from './effects/hitSparks';
import { SpriteLayer } from '../engine/sprites/spriteLayer';
import { ASSET_KEYS } from '../../../src/assets/manifest';
import type { AudioManager } from '../../../src/audio/AudioManager';
import { drawProjectile, drawRemoteBomb, projectileSprite } from './effects/linkArticles';
import { drawSpecialEffects } from './effects/specialEffects';
import { prepareSceneShaders } from '../engine/prepareShaders';
import { geometryPreparationHost } from '../engine/presentation/submission';

/**
 * Draws a SimView on a stage presenter: the match camera, fighters (from
 * body centre, in the arena's light, in costume), items at their display
 * size and angle, explosions/projectiles at their real damage areas, shield
 * bubbles, charge bars and hit sparks (the game's formatters), and voices
 * sfx events. Game state comes from the view each frame; only the sparks'
 * birth frames are kept (they are one-shot events).
 */
export class MatchView {
  private readonly rig: CameraRig;
  /** Additive light (damage areas), then covering shapes above it. */
  private readonly glow = new ShapeLayer(1000, true);
  private readonly shapes = new ShapeLayer(2000);
  private readonly sparks = new HitSparks();
  private readonly blasts = new ExplosionArt();
  /** Effect sprites above the effect shapes (explosion bursts). */
  private readonly overlay: SpriteLayer;
  private readonly appearances = new AppearanceCollection();
  private readonly appearanceBridge = createLegacyAppearanceBridge();
  private submittedAppearances: AppearanceSubmission[] = [];
  private readonly appearanceSource = () => this.submittedAppearances;
  private view: SimView | null = null;
  private flashes: Array<{ frame: number; x: number; y: number; width: number; height: number; color: number }> = [];
  private charging = false;
  private shaderPreparation: Promise<void> | null = null;
  private readonly shaderPreparationAbort = new AbortController();
  private disposed = false;
  private readonly spriteSource = () => (this.view ? this.sprites(this.view) : []);
  private readonly screenSpriteSource = () => this.view?.presentationSprites?.filter((sprite) => sprite.space === 'screen') ?? [];
  debug = false;

  /** `sound` voices the frame's sfx events (the game's AudioManager). */
  constructor(private readonly presenter: StagePresenter,
    private readonly sound: (CombatSfxSink & Partial<Pick<AudioManager, 'playSfxLoop' | 'stopSfx'>>) | null = null) {
    this.rig = new CameraRig(presenter.runtime.layout);
    this.overlay = new SpriteLayer(presenter.sprites.textures, 3000);
    presenter.sprites.scene.add(this.overlay.scene);
    presenter.sprites.scene.add(this.glow.group, this.shapes.group);
    presenter.appearanceSource = this.appearanceSource;
    presenter.spriteSource = this.spriteSource;
    presenter.screenSpriteSource = this.screenSpriteSource;
  }

  /** Prepare the same normal/additive effect materials that gameplay reuses.
   * Hidden meshes compile without a dummy draw or texture upload. Completion
   * and first-use validation finish during loading, with bounded own polling. */
  prepareShaders(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.shaderPreparation) return this.shaderPreparation;
    this.glow.prepare();
    this.shapes.prepare();
    const effects = prepareSceneShaders(this.presenter.renderer, this.presenter.sprites.scene,
      this.presenter.camera, this.shaderPreparationAbort.signal);
    this.shaderPreparation = Promise.all([effects, this.prepareAppearances()]).then(() => undefined);
    return this.shaderPreparation;
  }

  prepareAppearances(): Promise<unknown> {
    return this.appearances.prepare(this.shaderPreparationAbort.signal,
      geometryPreparationHost(this.presenter.renderer, this.presenter.sprites.scene, this.presenter.camera));
  }

  /** Stop readiness polling when the host faults, even before it leaves. */
  cancelShaderPreparation(): void { this.shaderPreparationAbort.abort(); }

  /** Show `view`; call once per simulation frame with the time since the last. */
  show(view: SimView, deltaMs: number): void {
    if (!this.view) this.rig.snap(view);
    this.view = view;
    this.presenter.viewRect = this.rig.update(view, deltaMs);
    for (const e of view.events) if (e.kind === 'sfx') emitCombatSfx(this.sound ?? undefined, e.key);
    const charging = view.fighters.some((fighter) => !fighter.eliminated && fighter.animation.chargingMove !== null);
    if (charging && !this.charging) this.sound?.playSfxLoop?.(ASSET_KEYS.sfxCharge);
    else if (!charging && this.charging) this.sound?.stopSfx?.(ASSET_KEYS.sfxCharge);
    this.charging = charging;
    this.sparks.add(view.events, view.frame);
    this.blasts.add(view.events, view.frame);
    for (const event of view.events) if (event.kind === 'damageFlash') this.flashes.push(event);
    this.flashes = this.flashes.filter((flash) => view.frame >= flash.frame && view.frame - flash.frame < 6);
    const tint = this.presenter.runtime.view.theme.spriteTint.getHex();
    this.submittedAppearances = [];
    const retained: string[] = [];
    for (const [depth, fighter] of view.fighters.entries()) {
      const request = this.appearanceBridge.match(fighter, { tint, depth, displayTick: view.frame, profile: this.appearances.system.profileFor(fighter.characterId) });
      retained.push(request.actorId);
      const appearance = this.appearances.update(request);
      if (!fighter.eliminated && !view.knockoutFlights?.some(flight => flight.playerIndex === fighter.playerIndex)) this.submittedAppearances.push(appearance);
    }
    for (const flight of view.knockoutFlights ?? []) {
      const request = createLegacyFlightAppearanceRequest(flight, { tint, profile: this.appearances.system.profileFor(flight.characterId) });
      retained.push(request.actorId);
      this.submittedAppearances.push(this.appearances.update(request));
    }
    this.appearances.retain(retained);
    drawDamageAreas(this.glow, view.explosions, this.debug ? view.projectiles : []);
    if (this.debug) for (const area of view.debugAreas ?? []) {
      const capsule = area.capsule;
      if (capsule) {
        this.glow.line({ x1: capsule.start.x, y1: capsule.start.y, x2: capsule.end.x, y2: capsule.end.y,
          width: capsule.radius * 2, color: area.color, alpha: area.fillAlpha });
        for (const end of [capsule.start, capsule.end]) this.glow.circle({ ...end, radius: capsule.radius,
          fill: area.color, fillAlpha: area.fillAlpha, stroke: area.strokeColor, strokeAlpha: area.strokeAlpha, strokeWidth: area.strokeWidth });
      } else this.glow.rect({ ...area, alpha: area.fillAlpha });
    }
    if (this.debug) for (const flash of this.flashes)
      this.glow.rect({ ...flash, alpha: .55 * (1 - (view.frame - flash.frame) / 6) });
    for (const p of view.projectiles) drawProjectile(this.shapes, p, view.frame);
    for (const item of view.items) drawRemoteBomb(this.shapes, item);
    drawSpecialEffects(this.shapes, view.specialEffects ?? []);
    for (const trap of view.traps ?? []) {
      if (trap.detonated) continue;
      this.shapes.circle({ x: trap.x, y: trap.y, radius: 8, fill: 0x16161e, stroke: 0x000000, strokeWidth: 1.5 });
      this.shapes.circle({ x: trap.x - 2.4, y: trap.y - 2.6, radius: 2.4, fill: 0x5b5f71 });
      this.shapes.rect({ x: trap.x, y: trap.y - 8.3, width: 2.6, height: 3.4, color: 0x8b6f47 });
      const progress = trap.armDelay > 0 ? Math.min(1, trap.framesSinceSpawn / trap.armDelay) : 1;
      const period = Math.max(3, Math.round(16 * (1 - progress)) + 3);
      if (!trap.fused || Math.floor(trap.framesSinceSpawn / period) % 2 === 0)
        this.shapes.circle({ x: trap.x, y: trap.y - 10.8, radius: 2.1, fill: progress > .66 ? 0xff3030 : progress > .33 ? 0xffaa20 : 0xffe060 });
    }
    for (const platform of view.spawnPlatforms ?? []) this.shapes.rect({ ...platform, color: 0x98e6ff });
    if (view.smashBall) {
      const ball = view.smashBall;
      this.glow.circle({ x: ball.x, y: ball.y, radius: ball.radius * 1.4, fill: 0xffd65a, fillAlpha: .25 });
      this.shapes.circle({ x: ball.x, y: ball.y, radius: ball.radius, fill: ball.heavy ? 0x504e69 : 0xfce99a, stroke: 0xffb637, strokeWidth: 2 });
      this.shapes.line({ x1: ball.x - ball.radius * .92, x2: ball.x + ball.radius * .92, y1: ball.y + ball.radius * .22, y2: ball.y + ball.radius * .22, width: ball.radius * .19, color: 0x151823 });
      this.shapes.line({ x1: ball.x - ball.radius * .24, x2: ball.x - ball.radius * .24, y1: ball.y - ball.radius * .95, y2: ball.y + ball.radius * .95, width: ball.radius * .2, color: 0x151823 });
      if (this.debug) this.glow.circle({ x: ball.x, y: ball.y, radius: ball.receivingRadius, stroke: 0xff3b30 });
    }
    for (const f of view.fighters) {
      if (f.eliminated) continue;
      drawShieldBubble(this.shapes, f, view.frame);
      drawChargeIndicator(this.shapes, f, view.frame);
    }
    this.sparks.draw(this.shapes, view.frame);
    this.blasts.draw(this.shapes, this.overlay, view.frame);
    this.overlay.flush();
    this.glow.flush();
    this.shapes.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelShaderPreparation();
    if (this.charging) this.sound?.stopSfx?.(ASSET_KEYS.sfxCharge);
    if (this.presenter.appearanceSource === this.appearanceSource) this.presenter.appearanceSource = null;
    if (this.presenter.spriteSource === this.spriteSource) this.presenter.spriteSource = null;
    if (this.presenter.screenSpriteSource === this.screenSpriteSource) this.presenter.screenSpriteSource = null;
    this.glow.group.removeFromParent();
    this.shapes.group.removeFromParent();
    this.overlay.scene.removeFromParent();
    this.glow.dispose();
    this.shapes.dispose();
    this.overlay.dispose();
    this.appearances.dispose();
    this.appearanceBridge.dispose();
    this.submittedAppearances = [];
  }

  /** Actual submitted fighter drawing and decoded frame metrics for probes. */
  presentation(playerIndex: number) {
    const actorId = this.view?.knockoutFlights?.some(flight => flight.playerIndex === playerIndex)
      ? `knockout:${playerIndex}` : `fighter:${playerIndex}`;
    return this.appearances.diagnostics(actorId, this.presenter.sprites, this.presenter.runtime.view.theme.spriteTint.getHex());
  }

  /** Selected presentation effects versus quads submitted by the last draw. */
  presentationSprites() {
    return (this.view?.presentationSprites ?? []).map(sprite => {
      const layer = sprite.space === 'screen' ? this.presenter.screenSprites : this.presenter.sprites;
      const submitted = layer.submittedDraws().find(draw => draw.key === sprite.key && draw.frame === sprite.frame && draw.x === sprite.x && draw.y === sprite.y);
      const sheet = layer.textures.resident(sprite.key);
      const image = sheet?.texture.image as { width?: number; height?: number } | undefined;
      return { ...sprite, textureResident: Boolean(sheet), submitted: Boolean(submitted),
        visible: Boolean(submitted && (submitted.alpha ?? 1) > 0),
        frameWidth: sheet?.frameWidth, frameHeight: sheet?.frameHeight,
        textureWidth: image?.width, textureHeight: image?.height };
    });
  }

  private sprites(view: SimView): SpriteDraw[] {
    const tint = this.presenter.runtime.view.theme.spriteTint.getHex();
    const items = view.items.filter((it) => it.visible !== false && !it.generatedKind && it.type !== 'linkRemoteBomb' && it.spriteKey).map((it): SpriteDraw => ({
      key: it.spriteKey, frame: it.frame, x: it.position.x, y: it.position.y,
      displayWidth: it.width * Math.abs(it.scaleX ?? 1), displayHeight: it.height * Math.abs(it.scaleY ?? 1),
      originX: it.originX, originY: it.originY, flipX: it.flipX ?? (it.scaleX ?? 1) < 0, alpha: it.alpha,
      rotation: it.angle, depth: 10, tint,
    }));
    const projectiles = view.projectiles.flatMap((p) => { const sprite = projectileSprite(p); return sprite ? [sprite] : []; });
    return [...items, ...projectiles, ...(view.presentationSprites?.filter((sprite) => sprite.space !== 'screen') ?? [])];
  }
}
