export interface IndexedGamepad {
  readonly index: number;
  readonly connected?: boolean;
}

type GamepadList<T> = ReadonlyArray<T | null | undefined> | undefined;

function isConnectedGamepad<T extends IndexedGamepad>(pad: T | null | undefined): pad is T {
  return pad != null && pad.connected !== false && Number.isInteger(pad.index) && pad.index >= 0;
}

/** A dense view for iteration. Each pad keeps its browser index and object identity. */
export function connectedGamepads<T extends IndexedGamepad>(pads: GamepadList<T>): T[] {
  return pads?.filter(isConnectedGamepad) ?? [];
}

/** Look up a physical browser index, never a position in the filtered list. */
export function connectedGamepad<T extends IndexedGamepad>(
  pads: GamepadList<T>, index: number | undefined,
): T | undefined {
  if (index === undefined || !Number.isInteger(index) || index < 0) return undefined;
  return pads?.find(pad => isConnectedGamepad(pad) && pad.index === index) ?? undefined;
}
