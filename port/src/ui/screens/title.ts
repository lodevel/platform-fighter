import { el, FocusList, hints } from '../shell/dom';
import type { App, Screen, ScreenName } from '../shell/app';

/**
 * Title screen: the mode cards of MainMenuScene. Character Lab and Stage Forge
 * were dropped (user, 2026-10-13).
 */
const MODES: ReadonlyArray<{ num: string; name: string; what: string; go: ScreenName }> = [
  { num: '01', name: 'Versus', what: 'Local battle · 1–4 players', go: 'rules' },
  { num: '02', name: 'Controls', what: 'Keyboard and gamepad bindings', go: 'controls' },
  { num: '03', name: 'Options', what: 'Game settings', go: 'options' },
];

export function titleScreen(app: App): Screen {
  app.backdrop({ stage: 'flat', mood: 'sunset' });
  const cards = MODES.map((m, i) => el('button.mode', {
    type: 'button', onmouseenter: () => focus.set(i), onclick: () => app.go(m.go),
  }, el('span.num', {}, m.num), el('span', {}, el('span.name', {}, m.name), el('br'), el('span.what', {}, m.what))));
  const focus = new FocusList(() => cards, 1);
  focus.set(0);

  return {
    root: el('section.screen.title-screen', {},
      el('div.logo', {}, el('h1', {}, 'Platform', el('span', {}, 'Fighter')), el('p', {}, 'Precision combat · Local multiplayer')),
      el('nav.modes', { 'aria-label': 'Modes' }, ...cards),
      hints([['←', '→'], 'choose'], [['Space', '(A)'], 'confirm'])),
    onAction({ action }) {
      if (focus.move(action === 'up' ? 'left' : action === 'down' ? 'right' : action)) return;
      if (action === 'confirm' || action === 'start') app.go(MODES[focus.index]!.go);
    },
  };
}
