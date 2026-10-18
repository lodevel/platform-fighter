import { loadGameSettings, saveGameSettings, type FighterDisplay, type GameSettings, type TextureQuality } from '../../../../src/config/gameSettings';
import { applyFighterDisplay } from '../../fighters/appearance';
import { cycleChoice, type OptionChoice } from '../../../../src/scenes/optionsMenu';
import { el, header, hints } from '../shell/dom';
import type { App, Screen } from '../shell/app';

const TEXTURE_CHOICES: readonly OptionChoice<TextureQuality>[] = [
  { value: 'full', label: 'Full quality' },
  { value: 'compressed', label: 'Compressed' },
];

const FIGHTER_DISPLAY_CHOICES: readonly OptionChoice<FighterDisplay>[] = [
  { value: 'legacy', label: 'Classic' },
  { value: 'packages', label: 'Compact (new)' },
];

/** One settings row: a stepper over `choices`, plus a short explanation line. */
interface SettingRow {
  readonly label: string;
  readonly choices: readonly OptionChoice<string>[];
  readonly get: (settings: GameSettings) => string;
  readonly apply: (value: string) => GameSettings;
  readonly detail: (value: string) => string;
}

/** Game options: add a setting by adding a row. */
export function optionsScreen(app: App): Screen {
  app.backdrop({ stage: 'flat', mood: 'day' });
  let settings = loadGameSettings();
  const textures = app.presenter.sprites.textures;
  const support = textures.compressedSupport();
  const compressedDetail = support?.native === false
    ? 'This device has no supported compressed format, so this saves no memory.'
    : `Fighter sprites use about 4× less memory. Outlines may differ by a pixel in alternative costumes.${support?.formats.length ? ` Detected: ${support.formats.join(', ')}.` : ''}`;
  const save = (next: GameSettings) => { saveGameSettings(next); return next; };
  const ROWS: readonly SettingRow[] = [{
    label: 'Texture quality',
    choices: TEXTURE_CHOICES,
    get: (s) => s.textureQuality,
    apply: (value) => {
      const next = save({ ...settings, textureQuality: value as TextureQuality });
      textures.setTextureQuality(next.textureQuality);
      return next;
    },
    detail: (value) => (value === 'compressed' ? compressedDetail : 'Original sprites. Applies to the next match.'),
  }, {
    label: 'Fighter art',
    choices: FIGHTER_DISPLAY_CHOICES,
    get: (s) => s.fighterDisplay,
    apply: (value) => {
      const next = save({ ...settings, fighterDisplay: value as FighterDisplay });
      applyFighterDisplay(next.fighterDisplay);
      return next;
    },
    detail: (value) => (value === 'packages'
      ? 'Fighters drawn from their new compact art, loaded when picked. Texture quality does not apply to it.'
      : 'Fighters drawn from their original sprite sheets.'),
  }];

  let row = 0;
  const values = ROWS.map(() => el('span.value'));
  const details = ROWS.map(() => el('span.detail'));
  const change = (i: number, d: number) => {
    const r = ROWS[i]!;
    settings = r.apply(cycleChoice(r.choices, r.get(settings), d));
    render();
  };
  const rows = ROWS.map((r, i) => {
    const arrow = (label: string, d: number, glyph: string) => el('button.arrow', {
      type: 'button', 'aria-label': label, onclick: (e: Event) => { e.stopPropagation(); change(i, d); },
    }, glyph);
    return el('div.rule', { onmouseenter: () => { row = i; render(); }, onclick: () => change(i, 1) },
      el('span.label', {}, r.label),
      el('div', {}, el('div.stepper', {}, arrow('Previous', -1, '‹'), values[i]!, arrow('Next', 1, '›')), details[i]!));
  });
  function render(): void {
    ROWS.forEach((r, i) => {
      const value = r.get(settings);
      values[i]!.textContent = r.choices.find((c) => c.value === value)?.label ?? value;
      details[i]!.textContent = r.detail(value);
      rows[i]!.classList.toggle('is-focused', i === row);
    });
  }
  const back = () => app.go('title');

  render();
  return {
    root: el('section.screen', {},
      header('Options', 'Game options', 'Changes apply right away and are saved on this device.'),
      el('div.body', {}, el('div.rules.panel', {}, ...rows, el('div.rule', {}, el('span'), el('div.nav-row', {}, el('button.btn', { type: 'button', onclick: back }, 'Back'))))),
      hints([['↑', '↓'], 'setting'], [['←', '→'], 'change'], [['Esc', '(B)'], 'back'])),
    onAction({ action }) {
      if (action === 'up' || action === 'down') { row = (row + (action === 'up' ? -1 : 1) + ROWS.length) % ROWS.length; render(); }
      else if (action === 'left' || action === 'right') change(row, action === 'left' ? -1 : 1);
      else if (action === 'confirm') change(row, 1);
      else if (action === 'back') back();
    },
  };
}
