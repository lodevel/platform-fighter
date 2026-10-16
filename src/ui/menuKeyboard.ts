interface MenuKeyboardEmitter {
  on?: (event: string, listener: (...args: any[]) => void) => unknown;
}

// Phaser can revisit the same DOM event while processing a queue containing
// keydown + keyup before the next rendered frame. Its adjacent-event guard
// does not catch that replay. Share identity tracking across menu scenes so a
// confirm consumed during a scene transition cannot also confirm the next menu.
const handledMenuEvents = new WeakSet<KeyboardEvent>();

/** Handle each actual browser key event once, including separate repeat events. */
export function bindMenuKey(
  keyboard: MenuKeyboardEmitter | null | undefined,
  eventName: string,
  handle: (event: KeyboardEvent) => void,
  when: () => boolean = () => true,
): () => void {
  const listener = (event: KeyboardEvent) => {
    // Ineligible underlying scenes yield the event to their active overlay.
    if (!when()) return;
    // EventEmitter-based scene fixtures may emit a shortcut without a DOM event.
    if (event && typeof event === 'object') {
      if (handledMenuEvents.has(event)) return;
      handledMenuEvents.add(event);
    }
    handle(event);
  };
  const emitter = keyboard?.on?.(eventName, listener) as
    { off?: (event: string, listener: (event: KeyboardEvent) => void) => unknown } | undefined;
  return () => { emitter?.off?.(eventName, listener); };
}
