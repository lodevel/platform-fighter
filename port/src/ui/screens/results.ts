import { RESULTS_BUTTONS } from '../../../../src/scenes/resultsButtons';
import { downloadReplayFile } from '../../../../src/replay/downloadReplay';
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
  // A completed recording belongs to this results screen only. Keep player
  // selection, but release the large artifact when beginning the next flow.
  const { replay, replayError, result: _completedResult, ...nextMatchData } = data;
  const unavailable = replayError ? `Replay unavailable: ${replayError}` : 'Replay unavailable for this match.';
  const replayStatus = el('p.sub', { id: 'results-replay-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    replay ? 'Save a replay to share this match for debugging.' : unavailable);
  const saveReplay = el('button.btn', {
    type: 'button', 'aria-describedby': 'results-replay-status', onclick: () => {
      if (!replay) { replayStatus.textContent = unavailable; return; }
      try {
        const download = downloadReplayFile(replay.file, { fileName: replay.fileName });
        replayStatus.textContent = `Replay download started: ${download.fileName}.`;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        replayStatus.textContent = `Could not download the replay${reason ? `: ${reason}` : '.'} Try Save Replay again.`;
      }
    },
  }, 'Save Replay');
  const navigation = RESULTS_BUTTONS.map((b) => el(`button.btn${b.id === 'rematch' ? '.primary' : ''}`, {
    type: 'button', onclick: () => (b.id === 'rematch' ? app.go('match', nextMatchData) : app.go('fighters', nextMatchData)),
  }, b.label));
  const buttons = [navigation[0]!, saveReplay, ...navigation.slice(1)];
  const focus = new FocusList(() => buttons);
  buttons.forEach((button, index) => { button.onfocus = () => focus.set(index); });
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
        el('div.nav-row', {}, ...buttons), replayStatus)),
      hints([['←', '→'], 'choose'], [['Space', '(A)'], 'select'], [['Esc', '(B)'], 'fighters'])),
    leave() { appearances.dispose(); },
    onAction({ action }) {
      if (focus.move(action)) { focus.current?.focus({ preventScroll: true }); return; }
      if (action === 'confirm' || action === 'start') focus.current?.click();
      else if (action === 'back') app.go('fighters', nextMatchData);
    },
  };
}
