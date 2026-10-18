import { PACKAGE_SCHEMA, type CharacterPackage } from '../package/types';

const SHA = 'a'.repeat(64);

/** A small valid package shared by the character module tests. */
export const SAMPLE: CharacterPackage = {
  schema: PACKAGE_SCHEMA, id: 'sample', revision: '',
  pages: { p0: { file: 'pages/p0.png', width: 64, height: 32, sha256: SHA } },
  drawings: {
    'idle/0': { page: 'p0', rect: [0, 0, 32, 32], anchor: [16, 30], scale: 0.5 },
    'idle/1': { page: 'p0', rect: [32, 0, 32, 32], anchor: [16, 30], scale: 0.5 },
  },
  actions: {
    idle: {
      bodyCentreFromRootY: -20,
      drawings: { after: 'loop', windows: [{ start: 0, end: 5, drawing: 'idle/0', sample: 1 }, { start: 5, end: 12, drawing: 'idle/1', sample: 6 }] },
      sockets: { item: { space: 'body-centre', schedule: { after: 'loop', windows: [{ start: 0, end: 12, x: 10, y: -4, angle: 90, length: 1 }] } } },
      source: { game: 'ultimate', move: 'Wait1' },
    },
  },
  costumes: {
    regions: [{ slot: 'fur', color: '#704023', tolerance: [0.03, 0.35, 0.3] }],
    list: [{ name: 'Brown', slots: { fur: '#6b4a2b' } }, { name: 'Blue', slots: { fur: '#2b62d9' } }],
  },
  provenance: { sources: { 'frames.json': SHA } },
};
