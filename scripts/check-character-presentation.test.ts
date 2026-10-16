import { expect, it } from 'vitest';
import path from 'node:path';
// @ts-expect-error The checker is a Node ESM script, used by typecheck as well.
import { presentationBoundaryErrors, checkCharacterPresentation } from './check-character-presentation.mjs';

it('rejects renderer, game, legacy and browser dependencies including re-exports and dynamic imports', () => {
  const file = path.resolve('src/characterPresentation/example.ts');
  for (const source of [
    "import type { Mesh } from 'three';", "export { Character } from '../characters/Character';",
    "const bridge = import('./legacy/bridge');", "const roster = require('../characters/registry');",
    'const canvas = document.createElement("canvas");', 'window.location.href;',
    'import(nextModule);',
  ]) expect(presentationBoundaryErrors(source, file).length, source).toBeGreaterThan(0);
  expect(presentationBoundaryErrors("import type { AppearanceRequest } from './contracts';", file)).toEqual([]);
  expect(checkCharacterPresentation()).toBeGreaterThanOrEqual(2);
});
