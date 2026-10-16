import { InputProfileStore } from '../../../../src/input/InputProfileStore';
import { PlayerControlsInput } from '../../../../src/input/PlayerControlsInput';
import { PlayerControlsSession } from '../../../../src/input/PlayerControlsSession';
import { PLAYER_CONTROLS_ROWS } from '../../../../src/input/playerControlsRows';
import type { PlayerSlot } from '../../../../src/types';
import { formatActionLabel, formatBindingList } from '../../../../src/ui/rebindingScreenFormat';
import type { App, Screen } from '../shell/app';
import { el, FocusList, header, hints } from '../shell/dom';

/**
 * Controls (RebindingScene's replacement): pick a device, then edit its
 * profile with the game's own PlayerControlsInput / PlayerControlsSession,
 * which own navigation, input capture, reset, conflicts and saving to the
 * InputProfileStore. This screen only draws their state and feeds them raw
 * keys and pad snapshots while the editor is open.
 */
interface DeviceChoice { readonly label: string; readonly detail: string; readonly player: PlayerSlot | null }

function deviceChoices(pads: readonly Gamepad[]): DeviceChoice[] {
  const keyboard = (index: 1 | 2, layout: 'keyboard_p1' | 'keyboard_p2', profile: string, label: string): DeviceChoice => ({
    label, detail: 'Keyboard',
    player: { index, characterId: 'donkeykong', paletteIndex: 0, inputType: layout, inputDevice: { kind: 'keyboard', layout }, bindingProfileId: profile } as PlayerSlot,
  });
  const padChoices = [0, 1, 2, 3].map((i): DeviceChoice => {
    const pad = pads.find((p) => p.index === i);
    return {
      label: `Gamepad ${i + 1}`, detail: pad ? pad.id.replace(/\s*\(.*$/, '').slice(0, 32) : 'Not connected',
      player: pad ? { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'gamepad', inputDevice: { kind: 'gamepad', gamepadIndex: i } } as PlayerSlot : null,
    };
  });
  return [keyboard(1, 'keyboard_p1', 'keyboard-wasd', 'Keyboard · WASD side'), keyboard(2, 'keyboard_p2', 'keyboard-arrows', 'Keyboard · Arrows side'), ...padChoices];
}

export function controlsScreen(app: App): Screen {
  app.backdrop({ stage: 'wind' });
  const profiles = new InputProfileStore();
  const status = el('p.status', { role: 'status' });
  const list = el('nav.device-list', { 'aria-label': 'Devices' });
  const panel = el('section.controls-panel.panel', { 'aria-live': 'polite' });
  let choices: DeviceChoice[] = [];
  let rows: HTMLElement[] = [];
  const focus = new FocusList(() => rows);
  let editor: PlayerControlsInput | null = null;
  const held = new Set<number>();

  function renderDevices(): void {
    choices = deviceChoices(app.input.pads());
    rows = choices.map((c, i) => el(`button.device-row${c.player ? '' : '.off'}`, {
      type: 'button', onmouseenter: () => focus.set(i), onclick: () => open(i),
    }, el('b', {}, c.label), el('span', {}, c.detail)));
    list.replaceChildren(...rows);
    focus.set(Math.min(focus.index, rows.length - 1));
  }

  function open(i: number): void {
    const choice = choices[i];
    if (!choice?.player) { status.textContent = 'Connect that controller first, then press any button on it.'; return; }
    try {
      editor = new PlayerControlsInput(new PlayerControlsSession(profiles, choice.player), () => []);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not open these controls.';
      return;
    }
    status.textContent = '';
    app.input.suspended = true;
    held.clear();
    renderEditor();
  }

  function close(): void {
    editor = null;
    app.input.suspended = false;
    panel.replaceChildren(el('p.note', {}, 'Choose a device to edit its controls. Saved profiles are offered to each player in character select.'));
  }

  function renderEditor(): void {
    if (!editor) return;
    const e = editor, session = e.session;
    const draft = session.bindings.get(session.index).bindings;
    const capturePrompt = session.device.kind === 'keyboard' ? 'Press a key… (Esc cancels)' : 'Press a button or push a stick… (Start cancels)';
    panel.replaceChildren(
      el('div.controls-head', {}, el('b', {}, session.device.kind === 'keyboard' ? 'Keyboard' : `Gamepad ${session.device.gamepadIndex + 1}`)),
      el('div.controls-rows', {}, ...PLAYER_CONTROLS_ROWS.map((row, i) => {
        const focused = i === e.focusedRow;
        const node = (label: string, value: string, extra = '') => el(`button.controls-row${focused ? '.is-focused' : ''}${extra}`, {
        type: 'button', onclick: () => { e.activate(i); e.releaseKeyboard(held); renderEditor(); },
        }, el('span.label', {}, label), el('span.value', {}, value));
        switch (row.kind) {
          case 'profile': return node('Profile', `‹ ${session.profileName} ›`);
          case 'binding': return node(formatActionLabel(row.action), e.capture === row.action ? capturePrompt : formatBindingList(draft[row.action] ?? []), e.capture === row.action ? '.capturing' : '');
          case 'reset': return node('Reset', 'Back to this profile’s defaults', '.action');
          case 'copy': return node('Save as new', 'Keep the original, save a copy', '.action');
          case 'done': return node('Save', 'Save and close', '.action.primary');
          default: return node('Cancel', 'Close without saving', '.action');
        }
      })),
      el('p.status', {}, e.feedback));
    if (e.closed) {
      status.textContent = e.closed === 'saved' ? e.feedback : 'Closed without saving.';
      close();
    }
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!editor) return;
    held.add(ev.keyCode);
    ev.preventDefault();
    editor.keyDown(ev);
    renderEditor();
  };
  const onKeyUp = (ev: KeyboardEvent) => { held.delete(ev.keyCode); };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);

  renderDevices();
  close();
  return {
    root: el('section.screen.controls', {},
      header('Settings', 'Controls', 'Remap any device. A built-in profile is never overwritten: saving it creates your own copy.'),
      el('div.controls-body', {}, list, panel),
      el('div', {}, status, hints([['↑', '↓'], 'choose'], [['Space', '(A)'], 'edit'], [['Esc', '(B)'], 'back']))),
    onAction({ action }) {
      if (editor) return;
      status.textContent = '';
      if (focus.move(action === 'left' ? 'up' : action === 'right' ? 'down' : action)) return;
      if (action === 'confirm' || action === 'start') open(focus.index);
      else if (action === 'back') app.go('title');
    },
    onFrame(now) {
      if (!editor) {
        if (app.input.pads().length !== choices.filter((c) => c.detail !== 'Keyboard' && c.player).length) renderDevices();
        return;
      }
      const e = editor;
      const before = `${e.focusedRow}|${e.capture}|${e.feedback}|${e.session.profileId}|${e.closed}`;
      e.releaseKeyboard(held);
      for (const pad of app.input.pads()) e.pollPad({ index: pad.index, buttons: pad.buttons, axes: pad.axes }, now);
      if (`${e.focusedRow}|${e.capture}|${e.feedback}|${e.session.profileId}|${e.closed}` !== before) renderEditor();
    },
    leave() {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      app.input.suspended = false;
    },
  };
}
