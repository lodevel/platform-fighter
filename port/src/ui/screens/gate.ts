import { checkPassword, recordUnlock } from '../../../../src/config/accessGate';
import { el } from '../shell/dom';
import type { App, Screen } from '../shell/app';

/** Soft password wall (same check and remembered unlock as PasswordGateScene). */
export function gateScreen(app: App): Screen {
  app.backdrop({ stage: 'flat', mood: 'night' });
  const input = el<'input'>('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Password', maxlength: '32' });
  const status = el('p.status', { role: 'alert' });
  const card = el('form.gate-card.panel', {},
    el('p.eyebrow', {}, 'Private build'),
    el('h1.title', {}, 'Password'),
    el('p.sub', {}, 'Enter the password to continue.'),
    input, status,
    el('button.btn.primary', { type: 'submit' }, 'Enter'));
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    if (checkPassword(input.value)) {
      recordUnlock();
      app.go('title');
      return;
    }
    input.value = '';
    status.textContent = 'Incorrect password';
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  });
  input.addEventListener('focus', () => { app.input.suspended = true; });
  input.addEventListener('blur', () => { app.input.suspended = false; });
  queueMicrotask(() => input.focus());
  return { root: el('section.screen.gate', {}, card), leave: () => { app.input.suspended = false; } };
}
