import { RESULTS_BUTTONS } from '../../../../src/scenes/resultsButtons';
import { computeResultsHeadline } from '../../../../src/scenes/resultsHeadline';
import { formatDamageDealt, formatSurvivalTime } from '../../../../src/scenes/resultsStats';
import { linkResultsMotion, selectLinkVictoryVariant } from '../../../../src/scenes/linkResultsPresentation';
import type { MatchConfig } from '../../../../src/types';
import { lineupAppearances } from '../../fighters/lineup';
import { AppearanceCollection } from '../../fighters/appearance';
import type { App, FlowData, Screen } from '../shell/app';
import { el, FocusList, header, hints } from '../shell/dom';
import { playerColour } from '../shell/players';

/** Results screen (ResultsScene). */
export function resultsScreen(app: App, data: FlowData = {}): Screen {
  const config = data.pending as MatchConfig;
  const result = data.result;
  if (!result) throw new Error('Results require a completed match');
  const appearances = new AppearanceCollection();
  let firstFrame: number | undefined;
  app.backdrop({ stage: config.stageId, light: true, appearances: (runtime) => {
    firstFrame ??= runtime.frame;
    return lineupAppearances(appearances, config.players, runtime, (index) => {
      const player = config.players[index]!;
      if (player.characterId !== 'link') return null;
      const motion = linkResultsMotion({ winner: result.winnerIndex === index,
        variant: selectLinkVictoryVariant(config.rngSeed ?? 0, result.endFrame, player.index),
        elapsedFrames: runtime.frame - firstFrame! });
      // Packed drawing selectors take action age0 as native frame1;
      // result clips own a raw native-sample clock beginning at0.
      return { action: motion.motion, age: Math.max(0, motion.rawAge - 1) };
    });
  } });
  const buttons = RESULTS_BUTTONS.map((b) => el(`button.btn${b.id === 'rematch' ? '.primary' : ''}`, {
    type: 'button', onclick: () => (b.id === 'rematch' ? app.go('match', data) : app.go('fighters', data)),
  }, b.label));
  const focus = new FocusList(() => buttons);
  focus.set(0);
  const rows = config.players.map((p, i) => {
    const s = result.playerStats?.[i];
    return el('tr', { style: { '--pc': playerColour(p) } },
      el('td', {}, `P${p.index} ${result.playerNames[i]}`), el('td', {}, String(s?.kos ?? 0)), el('td', {}, String(s?.deaths ?? 0)),
      el('td', {}, formatDamageDealt(s?.damageDealt ?? 0)), el('td', {}, formatSurvivalTime(s?.survivalFrames ?? result.endFrame)));
  });
  return {
    root: el('section.screen', {}, header('Versus · Results', 'Results'),
      el('div.body', {}, el('div.center-card.panel', {},
        el('div.winner', {}, el('h2', {}, computeResultsHeadline(result))),
        el('table.stats', {},
          el('thead', {}, el('tr', {}, ...['Player', 'KOs', 'Falls', 'Damage', 'Survived'].map((h) => el('th', {}, h)))),
          el('tbody', {}, ...rows)),
        el('div.nav-row', {}, ...buttons))),
      hints([['←', '→'], 'choose'], [['Space', '(A)'], 'select'], [['Esc', '(B)'], 'fighters'])),
    leave() { appearances.dispose(); },
    onAction({ action }) {
      if (focus.move(action)) return;
      if (action === 'confirm' || action === 'start') focus.current?.click();
      else if (action === 'back') app.go('fighters', data);
    },
  };
}
