import { LOGICAL_ACTIONS, type LogicalAction } from '../types/inputBindings';

export type PlayerControlsRow =
  | { readonly kind: 'binding'; readonly action: LogicalAction }
  | { readonly kind: 'profile' | 'reset' | 'copy' | 'done' | 'cancel'; readonly action?: never };

/** Shared row order for the presentational panel and its input controller. */
export const PLAYER_CONTROLS_ROWS: ReadonlyArray<PlayerControlsRow> = Object.freeze([
  { kind: 'profile' as const },
  ...LOGICAL_ACTIONS.map(action => ({ kind: 'binding' as const, action })),
  { kind: 'reset' as const },
  { kind: 'copy' as const },
  { kind: 'done' as const },
  { kind: 'cancel' as const },
]);
