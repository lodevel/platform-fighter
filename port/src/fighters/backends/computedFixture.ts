/** Explicit qualification fixture. Never registered in production roster profiles. */
import * as THREE from 'three';
import type { AppearanceRequest, PresentationProfile, PresentationRoute } from '../../../../src/characterPresentation/contracts';
import { createLegacyPresentationRegistry, LEGACY_SPRITE_CAPABILITY } from '../../../../src/characterPresentation/legacy/profiles';
import { ManagedGeometry, type PresentationTarget } from '../../engine/presentation/submission';
import { PX_PER_UNIT, toWorldX, toWorldY } from '../../engine/space';
import { AppearanceSystem } from '../appearance';
import type { AppearanceBackend, AppearanceBackendFactory, BackendPreparation } from './types';
import { legacySpriteBackend } from './legacySprite';

export const COMPUTED_FIXTURE_CAPABILITY = 'test-computed-geometry';
export const COMPUTED_FIXTURE_PROFILE: PresentationProfile = {
  id: 'fixture.mixed-link', revision: 'geometry-v1', characterId: 'link',
  routes: [
    { id: 'stored', action: '*', layer: 'body', capability: LEGACY_SPRITE_CAPABILITY, resources: ['fighter:link'] },
    { id: 'computed', action: 'idle', phase: 'computed', layer: 'body', capability: COMPUTED_FIXTURE_CAPABILITY, resources: [] },
    { id: 'mixed-accent', action: 'idle', phase: 'mixed', layer: 'accent', capability: COMPUTED_FIXTURE_CAPABILITY, resources: [] },
  ],
};

export class ComputedFixtureAppearance implements AppearanceBackend {
  readonly group = new THREE.Group();
  readonly body = new THREE.Mesh(new THREE.PlaneGeometry(38, 68), new THREE.MeshBasicMaterial({ color: 0x39ced2, side: THREE.DoubleSide }));
  readonly hand = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: 0xffd74f, side: THREE.DoubleSide }));
  readonly geometry: ManagedGeometry;
  private request: AppearanceRequest | null = null;
  private age = 0;
  private disposed = false;
  constructor(private readonly route: PresentationRoute) {
    this.group.name = `fixture:${route.id}`;
    this.body.name = 'computed-body'; this.hand.name = 'computed-attachment';
    this.body.position.y = -34;
    this.group.add(this.body, this.hand);
    this.geometry = new ManagedGeometry(this.group);
  }
  async prepare(context: BackendPreparation) {
    if (context.signal.aborted || !context.isCurrent()) throw new Error('Appearance preparation cancelled');
    if (!context.host) throw new Error('Computed geometry needs a preparation host');
    await context.host.prepareGeometry(this.geometry, context.signal);
    if (!context.isCurrent()) throw new Error('Appearance preparation cancelled');
    return { resourcesAvailable: true, shadersReady: true, warmedBytes: 0 };
  }
  update(request: AppearanceRequest): void {
    if (this.disposed) throw new Error('Fixture already disposed');
    if (!this.request || !request.action.frozen && !request.action.hitlag) this.age = request.action.clock.age;
    this.request = request;
    const root = request.transform.root ?? request.transform.position;
    this.group.position.set(toWorldX(root.x), toWorldY(root.y), 0);
    this.group.rotation.z = -request.transform.rotation;
    this.group.scale.set(request.transform.facing * request.transform.scale.x / PX_PER_UNIT, -request.transform.scale.y / PX_PER_UNIT, 1);
    this.body.rotation.z = Math.sin(this.age / 12) * .15;
    this.body.visible = this.route.layer === 'body';
    const attachment = request.attachments.find(value => value.id === 'hand') ?? request.attachments.find(value => value.id === 'item-grip');
    const point = attachment?.position ?? { x: 28, y: -44 };
    this.group.updateMatrixWorld(true);
    if (attachment?.space === 'world') this.hand.position.copy(this.group.worldToLocal(new THREE.Vector3(toWorldX(point.x), toWorldY(point.y), 0)));
    else if (attachment?.space === 'body') {
      const body = this.group.worldToLocal(new THREE.Vector3(toWorldX(request.transform.position.x), toWorldY(request.transform.position.y), 0));
      this.hand.position.set(body.x + point.x, body.y + point.y, 0);
    } else this.hand.position.set(point.x, point.y, 0);
    this.hand.rotation.z = attachment?.rotation ?? 0;
    const tint = new THREE.Color(request.palette.tint ?? 0xffffff);
    this.body.material.color.setHex(request.palette.index % 2 ? 0xf176cf : 0x39ced2).multiply(tint);
    this.hand.material.color.setHex(0xffd74f).multiply(tint);
    this.body.material.opacity = this.hand.material.opacity = request.visibility.alpha;
    this.group.updateMatrixWorld(true);
  }
  submit(target: PresentationTarget): void {
    if (!this.disposed && this.request) {
      if (target.tint !== undefined) {
        const tint = new THREE.Color(target.tint);
        this.body.material.color.setHex(this.request.palette.index % 2 ? 0xf176cf : 0x39ced2).multiply(tint);
        this.hand.material.color.setHex(0xffd74f).multiply(tint);
      }
      target.geometry(this.geometry, this.request.order + (this.route.layer === 'body' ? 0 : .005));
    }
  }
  reset(): void { this.request = null; this.age = 0; }
  diagnostics() {
    const hand = this.hand.getWorldPosition(new THREE.Vector3());
    return { capability: COMPUTED_FIXTURE_CAPABILITY, route: this.route.id, age: this.age, root: this.request?.transform.root,
      facing: this.request?.transform.facing, attachmentId: this.request?.attachments.find(value => value.id === 'hand' || value.id === 'item-grip')?.id ?? null, handWorld: hand.toArray(), disposed: this.disposed };
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.geometry.dispose(); this.request = null; }
}

export const computedFixtureBackend: AppearanceBackendFactory = {
  capability: COMPUTED_FIXTURE_CAPABILITY,
  preparation: 'instance',
  create: route => new ComputedFixtureAppearance(route),
};

export function createComputedFixtureSystem(): AppearanceSystem {
  const registry = createLegacyPresentationRegistry();
  registry.registerCapability({ id: COMPUTED_FIXTURE_CAPABILITY });
  registry.registerProfile(COMPUTED_FIXTURE_PROFILE);
  const system = new AppearanceSystem(registry);
  system.registerBackend(legacySpriteBackend);
  system.registerBackend(computedFixtureBackend);
  return system;
}
