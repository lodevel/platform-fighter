import type { App, FlowData, Screen, ScreenName } from '../shell/app';
import { controlsScreen } from './controls';
import { fightersScreen } from './fighters';
import { gateScreen } from './gate';
import { matchScreen } from './match';
import { optionsScreen } from './options';
import { resultsScreen } from './results';
import { rulesScreen } from './rules';
import { stagesScreen } from './stages';
import { titleScreen } from './title';

/** Screen registry: the shell routes by name, screens never import each other. */
export const SCREENS: Readonly<Record<ScreenName, (app: App, data?: FlowData) => Screen>> = {
  gate: gateScreen, title: titleScreen, controls: controlsScreen, options: optionsScreen, rules: rulesScreen, fighters: fightersScreen,
  stages: stagesScreen, match: matchScreen, results: resultsScreen,
};
