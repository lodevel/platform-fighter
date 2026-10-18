import { evaluate } from '../../../../character/evaluator/evaluate';
import type { CharacterPackage } from '../../../../character/package/types';
import type { ActionDisplay } from '../../../../src/characterPresentation/contracts';
import type { HeldItemSocket, ItemSocketAxis } from '../../../../src/characters/heldItemSocket';

/** The package socket an item pointing along `axis` is held at: `item` (bone Y), `item-z` (bone Z, gun barrels; absent when equal to `item`). */
const SOCKET_NAMES: Readonly<Record<ItemSocketAxis, readonly string[]>> = { y: ['item'], z: ['item-z', 'item'] };

/**
 * Where the drawing `display` shows holds an item, from the body centre with facing applied, or null when the
 * shown action has no such socket. A package holds a drawing's socket with the drawing. The upper-body overlay
 * (shooting while walking) holds the item when it is drawn, moved by its offset as the overlay drawing is.
 * Rotation and squash are not applied, as for the gameplay grip.
 */
export function packageItemSocket(pkg: CharacterPackage, display: ActionDisplay, axis: ItemSocketAxis): HeldItemSocket | null {
  const overlay = display.overlay && pkg.actions[display.overlay.action] ? display.overlay : null;
  const layer = overlay ?? display;
  if (!pkg.actions[layer.action]) return null;
  const pose = evaluate(pkg, { action: layer.action, tick: layer.tick, facing: display.facing });
  const socket = SOCKET_NAMES[axis].map(name => pose.sockets[name]).find(found => found !== undefined);
  if (!socket || socket.angle === undefined) return null;
  // A root-space socket sits bodyCentreFromRootY lower relative to the body centre.
  const y = socket.y - (socket.space === 'root' ? pose.bodyCentreFromRootY : 0);
  return { x: socket.x + (overlay?.offset.x ?? 0) * display.facing, y: y + (overlay?.offset.y ?? 0),
    angle: socket.angle, length: socket.length ?? 1 };
}
