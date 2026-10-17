/** Pure helpers for the Options screen: a setting is a label over a fixed list of choices. */
export interface OptionChoice<T extends string> { readonly value: T; readonly label: string }

/** Choice after `current` moved by `delta`, wrapping; an unknown `current` starts from the first. */
export function cycleChoice<T extends string>(choices: readonly OptionChoice<T>[], current: T, delta: number): T {
  const at = Math.max(0, choices.findIndex((c) => c.value === current));
  return choices[(at + delta + choices.length) % choices.length]!.value;
}
