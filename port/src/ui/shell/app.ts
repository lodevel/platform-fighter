import type { HandCursorState } from '../../../../src/scenes/handCursorState';
import type { MatchConfig } from '../../../../src/types';
import type { StageRuntime } from '../../arena/runtime';
import type { StagePresenter } from '../../arena/presenter';
import type { MatchResultPayload } from '../../../../src/match';
import type { AppearanceSubmission } from '../../fighters/appearance';
import type { MenuEvent, MenuInput, SelectionOwner } from './input';
import type { FrameFault } from './frameLoop';
import type { ReplayFile } from '../../../../src/replay/ReplayFile';

/**
 * Contracts between the shell and the screens. Screens depend on these
 * types only; the shell (entries/game.ts) provides the implementation.
 */

/** One menu screen: a DOM root plus optional input and per-frame hooks. */
export interface Screen {
  readonly root: HTMLElement;
  onAction?(event: MenuEvent): void;
  /** Called every animation frame with the frame timestamp (ms). */
  onFrame?(now: number): void;
  /** Stop a failed screen safely while keeping navigation and RAF alive. */
  onFault?(fault: FrameFault): void;
  leave?(): void;
}

/** What screens hand each other: the match being assembled. */
export interface FlowData {
  readonly pending?: Partial<MatchConfig>;
  /** Character-select state, kept so "back" from stage select restores the players. */
  readonly hand?: HandCursorState;
  /** Physical selection hands survive stage select, matches and results. */
  readonly selectionOwners?: readonly SelectionOwner[];
  readonly result?: MatchResultPayload;
  /** Frozen recording retained after the live simulation is disposed. */
  readonly replay?: { readonly file: ReplayFile; readonly fileName: string };
  readonly replayError?: string;
}

export type ScreenName = 'gate' | 'title' | 'controls' | 'rules' | 'fighters' | 'stages' | 'match' | 'results';

export interface BackdropOptions {
  readonly stage: string;
  readonly mood?: string;
  /** Lighter vignette, so the arena itself is the subject (stage select). */
  readonly light?: boolean;
  readonly appearances?: (runtime: StageRuntime) => readonly AppearanceSubmission[];
}

export interface App {
  readonly input: MenuInput;
  readonly presenter: StagePresenter;
  go(name: ScreenName, data?: FlowData): void;
  reportFault(fault: FrameFault): void;
  backdrop(options: BackdropOptions): StageRuntime;
}
