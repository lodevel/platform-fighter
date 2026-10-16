import { getPauseMenuOptions, moveSelection, DEFAULT_PAUSE_MENU_STATE, type PauseAction } from '../../../../src/scenes/pauseMenu';
import type { MenuEvent } from '../shell/input';
import { el, FocusList, header, hints } from '../shell/dom';

export interface PauseOverlay {
  readonly node: HTMLElement;
  onAction(event: MenuEvent): void;
}

/**
 * The pause menu (PauseMenuScene) as an overlay over the running screen,
 * driven by `pauseMenu.ts`. The owner decides what each action does.
 */
export function createPauseOverlay(choose: (action: PauseAction) => void): PauseOverlay {
  const options = getPauseMenuOptions();
  let state = DEFAULT_PAUSE_MENU_STATE;
  const rows = options.map((o) => el('button.pause-opt', { type: 'button', onclick: () => choose(o.action) },
    el('b', {}, o.label), el('span', {}, o.shortcutHint)));
  const list = new FocusList(() => rows);
  list.set(state.selectedIndex);
  const node = el('section.screen.overlay', {},
    header('Paused', 'Pause'),
    el('div.body', {}, el('div.center-card.panel', { style: { width: 'min(460px, 100%)' } }, el('div.pause-list', {}, ...rows))),
    hints([['↑', '↓'], 'choose'], [['Space', '(A)'], 'select'], [['Esc', '(B)'], 'resume']));
  return {
    node,
    onAction({ action }) {
      if (action === 'up' || action === 'down') {
        state = moveSelection(state, action === 'up' ? -1 : 1);
        list.set(state.selectedIndex);
      } else if (action === 'confirm') choose(options[state.selectedIndex]!.action);
      else if (action === 'back' || action === 'start') choose('resume');
    },
  };
}
