import { describe, expect, it, vi } from 'vitest';
import { ASSET_KEYS } from '../assets/manifest';
import {
  RUN_INPUT_DEAD_ZONE,
  RUN_VELOCITY_DEAD_ZONE,
  SPRITE_ANIM_SPECS,
  SPRITE_ANIMATION_STATES,
  classifySpriteAnimationState,
  collapseStateToSheet,
  createSpriteAnimationStateMachine,
  getCharacterSpritesheetKey,
  getSpriteAnimationKey,
  registerAllCharacterSpriteAnimations,
  registerCharacterSpriteAnimations,
  type PlayableSprite,
  type SceneAnimSurface,
  type SpriteAnimationSnapshot,
  type SpriteAnimationSnapshotProvider,
  type SpriteAnimationState,
} from './spriteAnimationDriver';

// ---------------------------------------------------------------------------
// Snapshot factory used across the classifier suite.
// ---------------------------------------------------------------------------

const baseSnapshot = (overrides: Partial<SpriteAnimationSnapshot> = {}): SpriteAnimationSnapshot => ({
  characterId: 'wolf',
  isAttacking: false,
  hitstunRemaining: 0,
  grounded: true,
  velocityX: 0,
  velocityY: 0,
  destroyed: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fake Phaser anim manager — minimal surface for the registry tests.
// ---------------------------------------------------------------------------

interface RecordedAnim {
  readonly key: string;
  readonly textureKey: string;
  readonly frameRate: number;
  readonly repeat: number;
  readonly hideOnComplete: boolean;
  readonly showOnStart: boolean;
}

function makeFakeScene(loadedTextures: ReadonlyArray<string>): {
  scene: SceneAnimSurface;
  recorded: RecordedAnim[];
} {
  const recorded: RecordedAnim[] = [];
  const animSet = new Set<string>();
  const textureSet = new Set<string>(loadedTextures);
  const scene: SceneAnimSurface = {
    anims: {
      exists: (key) => animSet.has(key),
      create: (config) => {
        animSet.add(config.key as string);
        // Attempt to peek the underlying texture key from
        // generateFrameNumbers' first call (recorded below). We stash
        // it on the recorded entry separately because the config
        // doesn't include the source texture directly when frames is
        // an already-resolved array.
        recorded.push({
          key: config.key as string,
          textureKey: (config as unknown as { __sourceTextureKey?: string })
            .__sourceTextureKey ?? '',
          frameRate: config.frameRate ?? -1,
          repeat: config.repeat ?? -1,
          hideOnComplete: config.hideOnComplete ?? false,
          showOnStart: config.showOnStart ?? false,
        });
        return {} as Phaser.Animations.Animation;
      },
      generateFrameNumbers: (key) => {
        // Stash the source key on a sentinel so create() can record
        // which texture each animation was generated from.
        (scene.anims as unknown as { __pendingTexture?: string }).__pendingTexture = key;
        // Return a non-empty list so a (future) frame-count assertion
        // in the consumer can verify presence.
        return [{ key, frame: 0 }, { key, frame: 1 }];
      },
    },
    textures: {
      exists: (k) => textureSet.has(k),
    },
  };
  // Wrap the recorder to capture the pending texture into each create.
  const origCreate = scene.anims.create;
  const origGenerate = scene.anims.generateFrameNumbers;
  let pendingTexture = '';
  scene.anims.generateFrameNumbers = (key, cfg) => {
    pendingTexture = key;
    return origGenerate(key, cfg);
  };
  scene.anims.create = (config) => {
    const result = origCreate({
      ...config,
      // Pass the pending texture through the sentinel field so the
      // recorded entry can capture it without intruding on the public
      // shape.
      ...({ __sourceTextureKey: pendingTexture } as unknown as Record<string, never>),
    });
    return result;
  };
  return { scene, recorded };
}

// ---------------------------------------------------------------------------
// Recorder fake for the PlayableSprite contract.
// ---------------------------------------------------------------------------

function makeRecorderSprite(): {
  sprite: PlayableSprite;
  calls: string[];
} {
  const calls: string[] = [];
  const sprite: PlayableSprite = {
    play: vi.fn((key: string, _ignoreIfPlaying?: boolean) => {
      calls.push(key);
      return undefined;
    }),
  };
  return { sprite, calls };
}

// ===========================================================================
// Sprite-state taxonomy
// ===========================================================================

describe('SPRITE_ANIMATION_STATES', () => {
  it('lists every supported state in canonical order', () => {
    expect(SPRITE_ANIMATION_STATES).toEqual([
      'idle',
      'run',
      'jump',
      'fall',
      'attack',
      'hurt',
    ]);
  });
});

// ===========================================================================
// Texture-key lookup
// ===========================================================================

describe('getCharacterSpritesheetKey', () => {
  it('maps cat sheets to the manifest constants', () => {
    expect(getCharacterSpritesheetKey('cat', 'idle')).toBe(ASSET_KEYS.charCatIdle);
    expect(getCharacterSpritesheetKey('cat', 'run')).toBe(ASSET_KEYS.charCatRun);
    expect(getCharacterSpritesheetKey('cat', 'jump')).toBe(ASSET_KEYS.charCatJump);
    expect(getCharacterSpritesheetKey('cat', 'attack')).toBe(ASSET_KEYS.charCatAttack);
  });
  it('maps wolf sheets to the manifest constants', () => {
    expect(getCharacterSpritesheetKey('wolf', 'idle')).toBe(ASSET_KEYS.charWolfIdle);
    expect(getCharacterSpritesheetKey('wolf', 'run')).toBe(ASSET_KEYS.charWolfRun);
    expect(getCharacterSpritesheetKey('wolf', 'jump')).toBe(ASSET_KEYS.charWolfJump);
    expect(getCharacterSpritesheetKey('wolf', 'attack')).toBe(ASSET_KEYS.charWolfAttack);
  });
  it('maps owl/bear M2 sheets to their manifest keys', () => {
    expect(getCharacterSpritesheetKey('owl', 'idle')).toBe(ASSET_KEYS.charOwlIdle);
    expect(getCharacterSpritesheetKey('owl', 'run')).toBe(ASSET_KEYS.charOwlRun);
    expect(getCharacterSpritesheetKey('owl', 'jump')).toBe(ASSET_KEYS.charOwlJump);
    expect(getCharacterSpritesheetKey('owl', 'attack')).toBe(ASSET_KEYS.charOwlAttack);
    expect(getCharacterSpritesheetKey('bear', 'idle')).toBe(ASSET_KEYS.charBearIdle);
    expect(getCharacterSpritesheetKey('bear', 'run')).toBe(ASSET_KEYS.charBearRun);
    expect(getCharacterSpritesheetKey('bear', 'jump')).toBe(ASSET_KEYS.charBearJump);
    expect(getCharacterSpritesheetKey('bear', 'attack')).toBe(ASSET_KEYS.charBearAttack);
  });
});

// ===========================================================================
// State → sheet collapse
// ===========================================================================

describe('collapseStateToSheet', () => {
  it('keeps idle/run/jump/attack on their canonical sheet', () => {
    expect(collapseStateToSheet('idle')).toBe('idle');
    expect(collapseStateToSheet('run')).toBe('run');
    expect(collapseStateToSheet('jump')).toBe('jump');
    expect(collapseStateToSheet('attack')).toBe('attack');
  });
  it('collapses fall onto the jump sheet (M1 art only ships jump)', () => {
    expect(collapseStateToSheet('fall')).toBe('jump');
  });
  it('collapses hurt onto the idle sheet (M1 art has no hurt sheet)', () => {
    expect(collapseStateToSheet('hurt')).toBe('idle');
  });
});

// ===========================================================================
// Animation-key composition
// ===========================================================================

describe('getSpriteAnimationKey', () => {
  it('produces the canonical `<character>.<sheet>.anim` shape for cat & wolf', () => {
    expect(getSpriteAnimationKey('cat', 'idle')).toBe('cat.idle.anim');
    expect(getSpriteAnimationKey('cat', 'run')).toBe('cat.run.anim');
    expect(getSpriteAnimationKey('cat', 'jump')).toBe('cat.jump.anim');
    expect(getSpriteAnimationKey('cat', 'attack')).toBe('cat.attack.anim');
    expect(getSpriteAnimationKey('wolf', 'idle')).toBe('wolf.idle.anim');
    expect(getSpriteAnimationKey('wolf', 'run')).toBe('wolf.run.anim');
    expect(getSpriteAnimationKey('wolf', 'jump')).toBe('wolf.jump.anim');
    expect(getSpriteAnimationKey('wolf', 'attack')).toBe('wolf.attack.anim');
  });
  it('routes fall to the jump animation key', () => {
    expect(getSpriteAnimationKey('cat', 'fall')).toBe('cat.jump.anim');
    expect(getSpriteAnimationKey('wolf', 'fall')).toBe('wolf.jump.anim');
  });
  it('routes hurt to the idle animation key', () => {
    expect(getSpriteAnimationKey('cat', 'hurt')).toBe('cat.idle.anim');
    expect(getSpriteAnimationKey('wolf', 'hurt')).toBe('wolf.idle.anim');
  });
  it('produces the canonical `<character>.<sheet>.anim` shape for owl & bear (M2)', () => {
    expect(getSpriteAnimationKey('owl', 'idle')).toBe('owl.idle.anim');
    expect(getSpriteAnimationKey('owl', 'run')).toBe('owl.run.anim');
    expect(getSpriteAnimationKey('owl', 'jump')).toBe('owl.jump.anim');
    expect(getSpriteAnimationKey('owl', 'attack')).toBe('owl.attack.anim');
    expect(getSpriteAnimationKey('owl', 'fall')).toBe('owl.jump.anim');
    expect(getSpriteAnimationKey('owl', 'hurt')).toBe('owl.idle.anim');
    expect(getSpriteAnimationKey('bear', 'idle')).toBe('bear.idle.anim');
    expect(getSpriteAnimationKey('bear', 'run')).toBe('bear.run.anim');
    expect(getSpriteAnimationKey('bear', 'jump')).toBe('bear.jump.anim');
    expect(getSpriteAnimationKey('bear', 'attack')).toBe('bear.attack.anim');
  });
});

// ===========================================================================
// Classifier — exhaustive precedence rules
// ===========================================================================

describe('classifySpriteAnimationState', () => {
  it('returns idle when grounded, still, no attack, no hurt', () => {
    expect(classifySpriteAnimationState(baseSnapshot())).toBe('idle');
  });

  it('returns run when grounded with horizontal velocity past the dead-zone', () => {
    const movingRight = baseSnapshot({ velocityX: RUN_VELOCITY_DEAD_ZONE + 0.1 });
    expect(classifySpriteAnimationState(movingRight)).toBe('run');
    const movingLeft = baseSnapshot({ velocityX: -(RUN_VELOCITY_DEAD_ZONE + 0.1) });
    expect(classifySpriteAnimationState(movingLeft)).toBe('run');
  });

  it('treats sub-dead-zone velocity as idle', () => {
    expect(
      classifySpriteAnimationState(baseSnapshot({ velocityX: RUN_VELOCITY_DEAD_ZONE - 0.01 })),
    ).toBe('idle');
  });

  it('promotes idle to run when player holds a direction even before velocity builds', () => {
    expect(
      classifySpriteAnimationState(
        baseSnapshot({ velocityX: 0, moveInputX: RUN_INPUT_DEAD_ZONE + 0.05 }),
      ),
    ).toBe('run');
  });

  it('returns jump when airborne and rising (vy < 0)', () => {
    expect(
      classifySpriteAnimationState(baseSnapshot({ grounded: false, velocityY: -4 })),
    ).toBe('jump');
  });

  it('returns fall when airborne and at apex / descending (vy >= 0)', () => {
    expect(
      classifySpriteAnimationState(baseSnapshot({ grounded: false, velocityY: 0 })),
    ).toBe('fall');
    expect(
      classifySpriteAnimationState(baseSnapshot({ grounded: false, velocityY: 5 })),
    ).toBe('fall');
  });

  it('attack overrides movement — even airborne fighters render the attack pose', () => {
    expect(
      classifySpriteAnimationState(
        baseSnapshot({ grounded: false, velocityY: -4, isAttacking: true }),
      ),
    ).toBe('attack');
    expect(
      classifySpriteAnimationState(
        baseSnapshot({ velocityX: 5, isAttacking: true }),
      ),
    ).toBe('attack');
  });

  it('hurt overrides attack and movement — hitstun pose wins', () => {
    expect(
      classifySpriteAnimationState(
        baseSnapshot({ hitstunRemaining: 12, isAttacking: true, velocityX: 5 }),
      ),
    ).toBe('hurt');
  });

  it('destroyed fighters always read as idle (defensive fallback)', () => {
    expect(
      classifySpriteAnimationState(
        baseSnapshot({ destroyed: true, hitstunRemaining: 50, isAttacking: true }),
      ),
    ).toBe('idle');
  });

  it('is deterministic — identical snapshots produce identical results', () => {
    const snap = baseSnapshot({ velocityX: 3, grounded: true });
    const a = classifySpriteAnimationState(snap);
    const b = classifySpriteAnimationState(snap);
    const c = classifySpriteAnimationState({ ...snap });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ===========================================================================
// Phaser anim registry
// ===========================================================================

describe('registerCharacterSpriteAnimations', () => {
  it('creates one animation per loaded sheet for cat', () => {
    const { scene, recorded } = makeFakeScene([
      ASSET_KEYS.charCatIdle,
      ASSET_KEYS.charCatRun,
      ASSET_KEYS.charCatJump,
      ASSET_KEYS.charCatAttack,
    ]);
    const keys = registerCharacterSpriteAnimations(scene, 'cat');
    expect(keys).toEqual([
      'cat.idle.anim',
      'cat.run.anim',
      'cat.jump.anim',
      'cat.attack.anim',
    ]);
    expect(recorded.map((r) => r.key)).toEqual([
      'cat.idle.anim',
      'cat.run.anim',
      'cat.jump.anim',
      'cat.attack.anim',
    ]);
  });

  it('uses the per-spec frame rate / repeat / hold flags', () => {
    const { scene, recorded } = makeFakeScene([
      ASSET_KEYS.charWolfIdle,
      ASSET_KEYS.charWolfRun,
      ASSET_KEYS.charWolfJump,
      ASSET_KEYS.charWolfAttack,
    ]);
    registerCharacterSpriteAnimations(scene, 'wolf');
    // Find each entry by anim key and verify it tracks the spec.
    const byKey = new Map(recorded.map((r) => [r.key, r] as const));
    for (const spec of SPRITE_ANIM_SPECS) {
      const entry = byKey.get(`wolf.${spec.sheet}.anim`);
      expect(entry).toBeDefined();
      expect(entry?.frameRate).toBe(spec.frameRate);
      expect(entry?.repeat).toBe(spec.repeat);
      // Spec.hold maps onto !hideOnComplete (we leave the sprite visible on the last frame).
      expect(entry?.hideOnComplete).toBe(false);
    }
  });

  it('skips sheets whose texture is not loaded — partial-asset friendly', () => {
    // Only cat's idle is loaded; the other three sheets should be skipped.
    const { scene, recorded } = makeFakeScene([ASSET_KEYS.charCatIdle]);
    const keys = registerCharacterSpriteAnimations(scene, 'cat');
    expect(keys).toEqual(['cat.idle.anim']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.key).toBe('cat.idle.anim');
  });

  it('returns an empty list for owl / bear (no sheet keys)', () => {
    const { scene, recorded } = makeFakeScene([]);
    expect(registerCharacterSpriteAnimations(scene, 'owl')).toEqual([]);
    expect(registerCharacterSpriteAnimations(scene, 'bear')).toEqual([]);
    expect(recorded).toHaveLength(0);
  });

  it('is idempotent — re-entry on a registered scene does not double-create', () => {
    const { scene, recorded } = makeFakeScene([
      ASSET_KEYS.charCatIdle,
      ASSET_KEYS.charCatRun,
      ASSET_KEYS.charCatJump,
      ASSET_KEYS.charCatAttack,
    ]);
    registerCharacterSpriteAnimations(scene, 'cat');
    const recordedAfterFirst = recorded.length;
    registerCharacterSpriteAnimations(scene, 'cat');
    // Second call returns the same key list but creates nothing new.
    expect(recorded.length).toBe(recordedAfterFirst);
  });
});

describe('registerAllCharacterSpriteAnimations', () => {
  it('registers cat + wolf when both are fully loaded', () => {
    const { scene } = makeFakeScene([
      ASSET_KEYS.charCatIdle,
      ASSET_KEYS.charCatRun,
      ASSET_KEYS.charCatJump,
      ASSET_KEYS.charCatAttack,
      ASSET_KEYS.charWolfIdle,
      ASSET_KEYS.charWolfRun,
      ASSET_KEYS.charWolfJump,
      ASSET_KEYS.charWolfAttack,
    ]);
    const keys = registerAllCharacterSpriteAnimations(scene);
    // Order: cat sheets, then wolf sheets.
    expect(keys).toEqual([
      'cat.idle.anim',
      'cat.run.anim',
      'cat.jump.anim',
      'cat.attack.anim',
      'wolf.idle.anim',
      'wolf.run.anim',
      'wolf.jump.anim',
      'wolf.attack.anim',
    ]);
  });
  it('honours a custom character allow-list', () => {
    const { scene } = makeFakeScene([
      ASSET_KEYS.charCatIdle,
      ASSET_KEYS.charCatRun,
      ASSET_KEYS.charCatJump,
      ASSET_KEYS.charCatAttack,
    ]);
    const keys = registerAllCharacterSpriteAnimations(scene, ['cat']);
    expect(keys.every((k) => k.startsWith('cat.'))).toBe(true);
    expect(keys).toEqual([
      'cat.idle.anim',
      'cat.run.anim',
      'cat.jump.anim',
      'cat.attack.anim',
    ]);
  });
});

// ===========================================================================
// State machine binding
// ===========================================================================

describe('createSpriteAnimationStateMachine', () => {
  function makeProvider(initial: SpriteAnimationSnapshot): {
    provider: SpriteAnimationSnapshotProvider;
    set: (next: SpriteAnimationSnapshot) => void;
  } {
    let cur = initial;
    return {
      provider: { getSpriteAnimationSnapshot: () => cur },
      set: (n) => {
        cur = n;
      },
    };
  }

  it('fires play() on the first tick to prime the sprite', () => {
    const { provider } = makeProvider(baseSnapshot({ characterId: 'wolf' }));
    const { sprite, calls } = makeRecorderSprite();
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    expect(sm.current()).toBeNull();
    const state = sm.tick();
    expect(state).toBe('idle');
    expect(calls).toEqual(['wolf.idle.anim']);
    expect(sm.current()).toBe('idle');
  });

  it('does not re-fire play() on same-state ticks', () => {
    const { provider } = makeProvider(baseSnapshot({ characterId: 'cat' }));
    const { sprite, calls } = makeRecorderSprite();
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    sm.tick();
    sm.tick();
    sm.tick();
    expect(calls).toEqual(['cat.idle.anim']);
  });

  it('fires play() on every state transition', () => {
    const { provider, set } = makeProvider(baseSnapshot({ characterId: 'cat' }));
    const { sprite, calls } = makeRecorderSprite();
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    sm.tick(); // idle
    set(baseSnapshot({ characterId: 'cat', velocityX: 5 }));
    sm.tick(); // run
    set(baseSnapshot({ characterId: 'cat', grounded: false, velocityY: -3 }));
    sm.tick(); // jump
    set(baseSnapshot({ characterId: 'cat', grounded: false, velocityY: 4 }));
    sm.tick(); // fall
    set(baseSnapshot({ characterId: 'cat', isAttacking: true }));
    sm.tick(); // attack
    set(baseSnapshot({ characterId: 'cat', hitstunRemaining: 10 }));
    sm.tick(); // hurt → collapses to idle anim
    expect(calls).toEqual([
      'cat.idle.anim',
      'cat.run.anim',
      'cat.jump.anim',
      'cat.jump.anim', // fall reuses jump
      'cat.attack.anim',
      'cat.idle.anim', // hurt reuses idle
    ]);
  });

  it('passes ignoreIfPlaying = true to play() so same-key restarts are no-ops', () => {
    const { provider } = makeProvider(baseSnapshot());
    const playSpy = vi.fn();
    const sprite: PlayableSprite = { play: playSpy };
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    sm.tick();
    expect(playSpy).toHaveBeenCalledWith('wolf.idle.anim', true);
  });

  it('detach() makes subsequent ticks no-op for play() while still updating state', () => {
    const { provider, set } = makeProvider(baseSnapshot({ characterId: 'wolf' }));
    const { sprite, calls } = makeRecorderSprite();
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    sm.tick(); // primes — fires once
    sm.detach();
    set(baseSnapshot({ characterId: 'wolf', velocityX: 5 }));
    const state = sm.tick();
    expect(state).toBe('run');
    expect(sm.current()).toBe('run');
    // No additional play() call after detach.
    expect(calls).toEqual(['wolf.idle.anim']);
  });

  it('records state and plays the matching anim for owl (M2 sheets shipped)', () => {
    const { provider } = makeProvider(baseSnapshot({ characterId: 'owl' }));
    const { sprite, calls } = makeRecorderSprite();
    const sm = createSpriteAnimationStateMachine(provider, sprite);
    const state = sm.tick();
    expect(state).toBe('idle');
    expect(sm.current()).toBe('idle');
    expect(calls).toEqual(['owl.idle.anim']);
  });
});

// ===========================================================================
// Cancel-rule sanity — symbolic key ↔ sprite key never disagree on layer.
// ===========================================================================

describe('precedence cohesion with fighterAnimationState composer', () => {
  // Hurt > Attack > Movement is the same precedence
  // `fighterAnimationState.ts` enforces. Re-verify here so a refactor
  // of one composer can't quietly drift from the other.
  it('hurt always wins over attack', () => {
    const r = classifySpriteAnimationState(
      baseSnapshot({ hitstunRemaining: 5, isAttacking: true }),
    );
    expect(r).toBe('hurt');
  });
  it('attack wins over movement', () => {
    const r = classifySpriteAnimationState(
      baseSnapshot({ isAttacking: true, velocityX: 5, grounded: true }),
    );
    expect(r).toBe('attack');
  });
});

// Compile-time exhaustiveness — if a future state lands and we forget
// to update collapseStateToSheet, this test will break.
describe('state-taxonomy exhaustiveness', () => {
  it('every state has a defined collapse target', () => {
    const seen: SpriteAnimationState[] = [];
    for (const s of SPRITE_ANIMATION_STATES) {
      const sheet = collapseStateToSheet(s);
      expect(['idle', 'run', 'jump', 'attack']).toContain(sheet);
      seen.push(s);
    }
    expect(seen.length).toBe(SPRITE_ANIMATION_STATES.length);
  });
});
