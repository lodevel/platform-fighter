import { describe, expect, it } from 'vitest';
import type { Action, CharacterPackage, SocketWindow } from '../../../../character/package/types';
import { SAMPLE } from '../../../../character/testing/samplePackage';
import type { ActionDisplay } from '../../../../src/characterPresentation/contracts';
import { createLegacySnapshotAppearanceRequest } from '../../../../src/characterPresentation/legacy/bridge';
import { createLegacyArtSelector } from '../../../../src/characterPresentation/legacy/selector';
import { animationSnapshot } from '../../../../src/characters/testing/animationSnapshot';
import type { LoadedPackage, PackageLibrary } from '../packageLibrary';
import { packageItemSocket } from './packageItemSocket';
import { PackageSpriteAppearance } from './packageSprite';

const idle = SAMPLE.actions.idle!;
const socket = (start: number, end: number, x: number, angle: number): SocketWindow => ({ start, end, x, y: -4, angle, length: .8 });
/** `swing`: drawing idle/0 held over ticks 0..7 with its socket, then idle/1. */
const SWING: Action = { ...idle, drawings: { after: 'hold', windows: [{ start: 0, end: 8, drawing: 'idle/0' }, { start: 8, end: 12, drawing: 'idle/1' }] },
  sockets: { item: { space: 'body-centre', schedule: { after: 'hold', windows: [socket(0, 8, 10, 90), socket(8, 12, 30, 150)] } },
    'item-z': { space: 'root', schedule: { after: 'hold', windows: [socket(0, 12, 5, 45)] } } } };
const PKG: CharacterPackage = { ...SAMPLE, actions: { ...SAMPLE.actions, swing: SWING, plain: { ...idle, sockets: {} } } };
const at = (action: string, tick: number, facing: 1 | -1, extra: Partial<ActionDisplay> = {}): ActionDisplay => ({ action, tick, facing, ...extra });

describe('package item socket', () => {
  it('follows the shown drawing: a held drawing keeps its socket, mirrored for facing', () => {
    expect(packageItemSocket(PKG, at('swing', 7, 1), 'y')).toEqual({ x: 10, y: -4, angle: 90, length: .8 });
    expect(packageItemSocket(PKG, at('swing', 8, -1), 'y')).toEqual({ x: -30, y: -4, angle: -150, length: .8 });
  });

  it('reads gun barrels from item-z, measured from the root when the track says so', () => {
    // The root is 20 below the body centre (bodyCentreFromRootY -20), so a root-space y of -4 is 16 below it.
    expect(packageItemSocket(PKG, at('swing', 3, 1), 'z')).toEqual({ x: 5, y: 16, angle: 45, length: .8 });
    // SAMPLE's idle has no item-z: a barrel falls back to the item socket.
    expect(packageItemSocket(PKG, at('idle', 3, 1), 'z')).toEqual({ x: 10, y: -4, angle: 90, length: 1 });
  });

  it('takes the upper-body overlay socket, moved by the overlay offset', () => {
    const overlay = { action: 'swing', tick: 9, offset: { x: 2, y: -6 }, clip: { base: 0, overlay: 0 } };
    expect(packageItemSocket(PKG, at('idle', 0, -1, { overlay }), 'y')).toEqual({ x: -32, y: -10, angle: -150, length: .8 });
  });

  it('has none for an action without one or unknown to the package', () => {
    expect(packageItemSocket(PKG, at('plain', 0, 1), 'y')).toBeNull();
    expect(packageItemSocket(PKG, at('missing', 0, 1), 'y')).toBeNull();
  });
});

describe('package sprite held-item grip', () => {
  const animation = animationSnapshot('link', { frame: 30, facing: -1 });
  const request = () => createLegacySnapshotAppearanceRequest(animation, { actorId: 'fighter:2', position: { x: 400, y: 300 } });
  // The package names the action Link's art selector shows standing.
  const shown = createLegacyArtSelector().select(request())!.display!;
  const pkg: CharacterPackage = { ...PKG, actions: { ...PKG.actions, [shown.action]: SWING } };
  const library = (resident: boolean) => ({ acquire: (id: string) => ({ id, ready: new Promise(() => {}), release() {} }),
    resident: () => resident ? { pkg } as LoadedPackage : undefined }) as unknown as PackageLibrary;

  it('is the package socket of the drawing the backend shows, from the body centre', () => {
    const appearance = new PackageSpriteAppearance(library(true));
    appearance.update(request());
    const expected = packageItemSocket(pkg, shown, 'y')!;
    expect(appearance.heldItemGrip('y')).toEqual({ ...expected, x: 400 + expected.x, y: 300 + expected.y, facing: -1 });
    expect(expected.x).toBeLessThan(0);
  });

  it('is absent while the package loads', () => {
    const appearance = new PackageSpriteAppearance(library(false));
    appearance.update(request());
    expect(appearance.heldItemGrip('y')).toBeNull();
  });
});
