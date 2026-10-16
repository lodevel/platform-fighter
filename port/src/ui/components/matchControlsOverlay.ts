import { InputProfileStore } from '../../../../src/input/InputProfileStore';
import { PlayerControlsInput } from '../../../../src/input/PlayerControlsInput';
import { PlayerControlsSession } from '../../../../src/input/PlayerControlsSession';
import { PLAYER_CONTROLS_ROWS } from '../../../../src/input/playerControlsRows';
import { formatActionLabel, formatBindingList } from '../../../../src/ui/rebindingScreenFormat';
import type { PlayerSlot } from '../../../../src/types';
import { el, header } from '../shell/dom';

export interface MatchControlsOverlay {
  readonly node: HTMLElement;
  poll(now: number, pads: readonly Gamepad[]): void;
  dispose(): void;
}

/** Controls editor over a frozen match; saved profiles are handed back without restarting. */
export function createMatchControlsOverlay(players: readonly PlayerSlot[], close: (players: readonly PlayerSlot[]) => void,
  context: { readonly title?: string; readonly backLabel?: string; readonly sharedProfileIds?: readonly string[] } = {}): MatchControlsOverlay {
  const profiles = new InputProfileStore();
  const panel = el('div.controls-panel.panel');
  const held = new Set<number>();
  const humans = players.filter((player) => player.inputType !== 'ai');
  let selected = 0;
  let updated = [...players];
  let editor: PlayerControlsInput | null = null;
  const node = el('section.screen.overlay.controls', {}, header(context.title ?? 'Paused · Settings', 'Controls'),
    el('div.body', {}, el('div.center-card', {},
      el('div.nav-row', {}, ...humans.map((player, index) => el('button.btn', {
        type: 'button', onclick: () => { selected = index; open(); },
      }, `P${player.index}`))), panel,
      el('button.btn', { type: 'button', onclick: finish }, context.backLabel ?? 'Back to pause menu'))));

  function open(): void {
    const player = humans[selected];
    if (!player) { panel.replaceChildren(el('p.note', {}, 'This match has CPU players only.')); return; }
    const current = updated.find((entry) => entry.index === player.index)!;
    editor = new PlayerControlsInput(new PlayerControlsSession(profiles, current), () => [
      ...(context.sharedProfileIds ?? []),
      ...updated.filter(entry => entry.index !== player.index).flatMap(entry => entry.bindingProfileId ? [entry.bindingProfileId] : []),
    ]);
    editor.releaseKeyboard(held);
    render();
  }

  function render(): void {
    if (!editor) return;
    const current = editor;
    const session = current.session;
    const bindings = session.bindings.get(session.index).bindings;
    panel.replaceChildren(...PLAYER_CONTROLS_ROWS.map((row, index) => {
      let label: string, value: string;
      switch (row.kind) {
        case 'profile': label = 'Profile'; value = `‹ ${session.profileName} ›`; break;
        case 'binding': label = formatActionLabel(row.action); value = current.capture === row.action
          ? 'Press an input… (Esc / Start cancels)' : formatBindingList(bindings[row.action] ?? []); break;
        case 'reset': label = 'Reset'; value = 'Profile defaults'; break;
        case 'copy': label = 'Save as new'; value = 'Keep the original'; break;
        case 'done': label = 'Save'; value = 'Save and return'; break;
        default: label = 'Cancel'; value = 'Return without saving';
      }
      return el(`button.controls-row${index === current.focusedRow ? '.is-focused' : ''}${current.capture === (row.kind === 'binding' ? row.action : '') ? '.capturing' : ''}`, {
        type: 'button', onclick: () => { current.activate(index); current.releaseKeyboard(held); render(); },
      }, el('span.label', {}, label), el('span.value', {}, value));
    }), el('p.status', {}, current.feedback));
    panel.querySelector('.is-focused')?.scrollIntoView({ block: 'nearest' });
    if (current.closed) {
      if (current.closed === 'saved') {
        const player = humans[selected]!;
        updated = updated.map((entry) => entry.index === player.index ? { ...entry, bindingProfileId: session.profileId } : entry);
      }
      finish();
    }
  }

  function finish(): void { dispose(); close(updated); }
  const keyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    held.add(event.keyCode);
    editor?.keyDown(event);
    render();
  };
  const keyUp = (event: KeyboardEvent) => { held.delete(event.keyCode); };
  function dispose(): void {
    removeEventListener('keydown', keyDown);
    removeEventListener('keyup', keyUp);
    node.remove();
  }
  addEventListener('keydown', keyDown);
  addEventListener('keyup', keyUp);
  open();
  return {
    node,
    poll(now, pads) {
      if (!editor) return;
      const before = `${editor.focusedRow}|${editor.capture}|${editor.feedback}|${editor.session.profileId}|${editor.closed}`;
      editor.releaseKeyboard(held);
      for (const pad of pads) editor.pollPad({ index: pad.index, buttons: pad.buttons, axes: pad.axes }, now);
      if (`${editor.focusedRow}|${editor.capture}|${editor.feedback}|${editor.session.profileId}|${editor.closed}` !== before) render();
    },
    dispose,
  };
}
