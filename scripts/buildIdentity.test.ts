import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeBuildIdentity, readBuildIdentity } from './buildIdentity';

const SOURCES = [
  { path: 'src/characters/Character.ts', contents: 'move(1);\n' },
  { path: 'src/characters/data/link.json', contents: '{"speed":7}' },
  { path: 'package-lock.json', contents: '{"phaser":"3.80.1"}' },
];

describe('simulation build identity', () => {
  it('is stable across traversal order and Windows/WSL text paths', () => {
    const windows = [...SOURCES].reverse().map(source => ({
      path: source.path.replace(/\//g, '\\'), contents: source.contents.replace(/\n/g, '\r\n'),
    }));
    expect(computeBuildIdentity(windows)).toBe(computeBuildIdentity(SOURCES));
  });

  it.each([0, 1, 2])('changes when code, fighter content or dependencies change (%i)', (index) => {
    const changed = SOURCES.map((source, i) => i === index ? { ...source, contents: `${source.contents} changed` } : source);
    expect(computeBuildIdentity(changed)).not.toBe(computeBuildIdentity(SOURCES));
  });

  it('includes source identity as well as content', () => {
    const moved = SOURCES.map(source => ({ ...source, path: `other/${source.path}` }));
    expect(computeBuildIdentity(moved)).not.toBe(computeBuildIdentity(SOURCES));
  });

  it('reads fighter data, vendored physics and host source, while excluding tests', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fighter-build-identity-'));
    const write = (relative: string, contents: string) => {
      const file = path.join(directory, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, contents);
    };
    try {
      for (const source of SOURCES) write(source.path, source.contents);
      write('assets/characters/pikachu.json', '{"frames":4}');
      for (const relative of ['package.json', 'tsconfig.json', 'vite.config.ts', 'scripts/buildIdentity.ts']) write(relative, '{}');
      const original = readBuildIdentity(directory);
      write('src/unrelated.test.ts', 'expect(true).toBe(true);');
      expect(readBuildIdentity(directory)).toBe(original);
      write('port/src/unrelated.check.ts', 'expect(true).toBe(true);');
      expect(readBuildIdentity(directory)).toBe(original);
      write('src/physics/matter/matter.js', 'Matter.update = step;');
      const physics = readBuildIdentity(directory);
      expect(physics).not.toBe(original);
      write('src/physics/matter/matter.js', 'Matter.update = changedStep;');
      expect(readBuildIdentity(directory)).not.toBe(physics);
      const beforeHost = readBuildIdentity(directory);
      write('port/src/ui/gameplayInput.ts', 'sampleInput();');
      expect(readBuildIdentity(directory)).not.toBe(beforeHost);
      const beforeAssets = readBuildIdentity(directory);
      write('assets/characters/pikachu.json', '{"frames":8}');
      expect(readBuildIdentity(directory)).not.toBe(beforeAssets);
    } finally {
      // `directory` is the unique test-owned folder returned by mkdtempSync.
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
