import type { MatchConfig, PlayerSlot, PlayerBindingsIndex } from '../../../../src/types';
import type { CharacterInput } from '../../../../src/characters/Character';
import { InputBindingsStore } from '../../../../src/input/InputBindingsStore';
import { InputProfileStore } from '../../../../src/input/InputProfileStore';
import { DeviceInputDispatcher, createBrowserGamepadSource } from '../../../../src/input/DeviceInputDispatcher';
import { InputResolver, buildCharacterInputFromResolver } from '../../../../src/input/InputResolver';
import { buildMatchParticipants, createMatchBindingsStore } from '../../../../src/match/matchParticipants';

/** DOM hardware adapter feeding the match's shared rebindable resolver. */
export class GameplayInput {
  readonly bindings: InputBindingsStore;
  readonly resolver: InputResolver;
  private readonly held = new Set<number>();
  private readonly bound = new Set<number>();
  private players: readonly PlayerSlot[];
  private readonly keyDown = (event: KeyboardEvent) => {
    if (!this.bound.has(event.keyCode)) return;
    event.preventDefault();
    this.held.add(event.keyCode);
  };
  private readonly keyUp = (event: KeyboardEvent) => { this.held.delete(event.keyCode); };
  private readonly blur = () => this.clear();

  constructor(config: MatchConfig) {
    this.players = config.players;
    this.bindings = this.resolveBindings();
    this.resolver = new InputResolver({ dispatcher: new DeviceInputDispatcher({
      bindings: this.bindings, keyboard: { isDown: (code) => this.held.has(code) }, gamepad: createBrowserGamepadSource(),
    }), slots: config.players.map((_, index) => (index + 1) as PlayerBindingsIndex) });
    this.collectKeys();
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    addEventListener('blur', this.blur);
  }

  sample(frame: number): (CharacterInput | undefined)[] {
    this.resolver.update(frame);
    return this.players.map((player, index) => player.inputType === 'ai' ? undefined
      : buildCharacterInputFromResolver(this.resolver, (index + 1) as PlayerBindingsIndex));
  }

  /** Re-read saved profile edits while keeping the match-local store identity. */
  refresh(players: readonly PlayerSlot[]): void {
    this.players = players;
    const next = this.resolveBindings();
    for (const index of [1, 2, 3, 4] as const) this.bindings.set(index, next.get(index));
    this.collectKeys();
    this.clear();
  }

  clear(): void { this.held.clear(); }

  dispose(): void {
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    removeEventListener('blur', this.blur);
    this.clear();
  }

  private resolveBindings(): InputBindingsStore {
    const legacy = new InputBindingsStore();
    return createMatchBindingsStore(buildMatchParticipants(this.players, legacy, new InputProfileStore(legacy)));
  }

  private collectKeys(): void {
    this.bound.clear();
    for (const index of [1, 2, 3, 4] as const)
      for (const list of Object.values(this.bindings.get(index).bindings))
        for (const binding of list) if (binding.kind === 'keyboard') this.bound.add(binding.keyCode);
  }
}
