import { BUILT_IN_STAGE_ENTRIES, cycleStageCursor } from '../../../../src/scenes/stageSelect';
import type { MatchConfig } from '../../../../src/types';
import { el, header, hints } from '../shell/dom';
import type { App, FlowData, Screen } from '../shell/app';
import { lineupAppearances } from '../../fighters/lineup';
import { AppearanceCollection } from '../../fighters/appearance';

/** Arena names for the stages that have their own look (PLAN.md step 1). */
const ARENA: Readonly<Record<string, string>> = {
  flat: 'Sky Ruins', lava: 'Magma Caldera', wind: 'Wind Canyon', crumbling: 'Crumbling Temple', 'moving-platform': 'Sky Ferry', inferno: 'The Inferno',
};

/**
 * Stage select (StageSelectScene): the highlighted stage runs live behind the
 * list, with the chosen fighters standing on it. Custom builder stages return
 * with the Stage Forge (PLAN.md step 8).
 */
export function stagesScreen(app: App, data: FlowData = {}): Screen {
  const entries = BUILT_IN_STAGE_ENTRIES;
  const appearances = new AppearanceCollection();
  let cursor = Math.max(0, entries.findIndex((e) => e.id === data.pending?.stageId));
  const players = data.pending?.players ?? [];
  const caption = el('div.stage-caption.panel', {}, el('h3'), el('p'));
  const rows = entries.map((entry, i) => el('button.stage-row', {
    type: 'button', onmouseenter: () => show(i), onclick: () => { show(i); confirm(); },
  }, el('span.name', {}, entry.displayName), el('span.kind', {}, ARENA[entry.id] ?? ''), el('span.what', {}, entry.subtitle)));

  function show(i: number): void {
    cursor = i;
    const entry = entries[i]!;
    rows.forEach((r, k) => r.classList.toggle('is-focused', k === i));
    caption.querySelector('h3')!.textContent = ARENA[entry.id] ?? entry.displayName;
    caption.querySelector('p')!.textContent = entry.subtitle;
    app.backdrop({
      stage: entry.id, light: true,
      appearances: (runtime) => lineupAppearances(appearances, players, runtime),
    });
  }

  function confirm(): void {
    const base = data.pending;
    const matchConfig = Object.freeze({
      ...base,
      mode: base?.mode ?? 'stocks',
      stockCount: base?.stockCount ?? 3,
      ...(base?.mode === 'time' ? { timeLimitSeconds: base.timeLimitSeconds ?? 180 } : {}),
      stageId: entries[cursor]!.id,
      players,
      rngSeed: base?.rngSeed ?? 0,
    }) as MatchConfig;
    app.go('match', { ...data, pending: matchConfig });
  }

  show(cursor);
  return {
    root: el('section.screen.stages', {},
      header('Versus · Arena', 'Choose an arena'),
      el('nav.stage-list', { 'aria-label': 'Stages' }, ...rows),
      caption,
      hints([['↑', '↓'], 'arena'], [['Space', '(A)'], 'fight here'], [['Esc', '(B)'], 'fighters'])),
    leave() { appearances.dispose(); },
    onAction({ action }) {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        show(cycleStageCursor(cursor, action === 'up' || action === 'left' ? -1 : 1, entries.length));
      } else if (action === 'confirm' || action === 'start') confirm();
      else if (action === 'back') app.go('fighters', data);
    },
  };
}
