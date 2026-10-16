// Golden-replay scenarios (STEP5-DESIGN §5.1 list, adapted). Hard CPUs only.
//
// Smash Ball and the Final meter are off except in 'final-ball'. The Link and
// Final scenarios were added and recorded 2026-10-15. The frozen takeover
// baselines prove extraction parity; intentional Final repairs get a separate
// current-build recording. 'final-ball' relies on the recorded-input contract (CPU
// slots always sampled, recorded input overrides), so the CPU's Smash Ball goals
// in the Final snapshot replay exactly.
const FINAL_OFF = { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false };
const FINAL_BALL = { schemaVersion: 1, meterEnabled: true, smashBallEnabled: true };
const cpu = (index, characterId, paletteIndex = 0) => ({ index, characterId, paletteIndex, inputType: 'ai', aiDifficulty: 'hard' });
const base = (stageId, players, extra = {}) => ({
  mode: 'stocks', stockCount: 3, stageId, rngSeed: 20261013, itemFrequency: 'off',
  itemSwitch: { SmashBall: false }, finalSmashRules: FINAL_OFF, linkIntroPolicy: 'none', players, ...extra,
});

export const SCENARIOS = {
  'flat-items': {
    about: 'DK vs Pikachu on the flat stage, items high (every item but the Smash Ball)',
    config: base('flat', [cpu(1, 'donkeykong'), cpu(2, 'pikachu')], { itemFrequency: 'high' }),
    frames: 1800,
  },
  lava: {
    about: 'Pikachu vs DK on the lava stage (pool cycle, lava KOs)',
    config: base('lava', [cpu(1, 'pikachu'), cpu(2, 'donkeykong')]),
    frames: 1800,
  },
  moving: {
    about: 'DK vs Pikachu on the moving-platform stage (riders on moving bodies)',
    config: base('moving-platform', [cpu(1, 'donkeykong'), cpu(2, 'pikachu')]),
    frames: 1800,
  },
  wind: {
    about: 'Pikachu vs DK on the wind stage (zone forces)',
    config: base('wind', [cpu(1, 'pikachu'), cpu(2, 'donkeykong')]),
    frames: 1800,
  },
  crumbling: {
    about: 'Three players on the crumbling stage',
    config: base('crumbling', [cpu(1, 'donkeykong'), cpu(2, 'pikachu'), cpu(3, 'donkeykong', 1)]),
    frames: 1800,
  },
  'ffa-items': {
    about: 'Four-player free-for-all, items high, 2 stocks',
    config: base('flat', [cpu(1, 'donkeykong'), cpu(2, 'pikachu'), cpu(3, 'donkeykong', 1), cpu(4, 'pikachu', 1)], { itemFrequency: 'high', stockCount: 2 }),
    frames: 2400,
  },
  'link-dk': {
    about: 'Link vs DK on the flat stage, no items (Link moveset, articles, sword beam)',
    config: base('flat', [cpu(1, 'link'), cpu(2, 'donkeykong')]),
    frames: 1800,
  },
  'link-pikachu-items': {
    about: 'Link vs Pikachu on the flat stage, items high (Link with held and thrown items, bombs)',
    config: base('flat', [cpu(1, 'link'), cpu(2, 'pikachu')], { itemFrequency: 'high' }),
    frames: 1800,
  },
  'final-ball': {
    about: 'Link vs DK vs Pikachu, items high with the Smash Ball and the Final meter on (Final Smash runtime, ball, Ancient Arrow)',
    config: base('flat', [cpu(1, 'link'), cpu(2, 'donkeykong'), cpu(3, 'pikachu')], {
      itemFrequency: 'high', itemSwitch: { SmashBall: true }, finalSmashRules: FINAL_BALL,
    }),
    frames: 3600,
  },
};
