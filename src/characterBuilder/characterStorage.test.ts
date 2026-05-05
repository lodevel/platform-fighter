import { beforeEach, describe, expect, it } from 'vitest';

import {
  type CharacterRecord,
  type StorageBackend,
  characterStorageKey,
  deleteCharacter,
  indexStorageKey,
  listCharacters,
  loadCharacter,
  saveCharacter,
} from './characterStorage';
import type { CharacterDataSpec } from '../characters/characterSerializer';

const sampleSpec = (): CharacterDataSpec => ({
  id: 'wolf',
  displayName: 'Wolf',
  role: 'bruiser',
  body: { width: 45, height: 66, chamfer: 8 },
  movement: {
    maxRunSpeed: 7.5,
    groundAccel: 0.65,
    airAccel: 0.3,
    groundDamping: 0.78,
    airDamping: 0.95,
    jumpImpulse: 12.5,
    maxJumps: 2,
    mass: 16,
  },
});

class MemoryStore implements StorageBackend {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  raw(): Map<string, string> {
    return this.map;
  }
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

describe('characterStorage — save / load round-trip', () => {
  it('saves a record under the namespaced key and persists savedAtMs', () => {
    const rec = saveCharacter('slot1', sampleSpec(), 12345, store);
    expect(rec.slotId).toBe('slot1');
    expect(rec.savedAtMs).toBe(12345);
    expect(rec.spec.id).toBe('wolf');
    expect(store.raw().has(characterStorageKey('slot1'))).toBe(true);
  });

  it('round-trips through saveCharacter → loadCharacter', () => {
    saveCharacter('slot1', sampleSpec(), 7, store);
    const loaded = loadCharacter('slot1', store);
    expect(loaded).not.toBeNull();
    expect(loaded?.spec.id).toBe('wolf');
    expect(loaded?.savedAtMs).toBe(7);
  });

  it('returns null for missing slot', () => {
    expect(loadCharacter('nope', store)).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    store.setItem(characterStorageKey('bad'), '{not json');
    expect(loadCharacter('bad', store)).toBeNull();
  });

  it('returns null when the persisted spec fails validation', () => {
    store.setItem(
      characterStorageKey('bad'),
      JSON.stringify({
        schemaVersion: 1,
        slotId: 'bad',
        savedAtMs: 1,
        spec: { id: 'dragon' /* unknown id, missing fields */ },
      }),
    );
    expect(loadCharacter('bad', store)).toBeNull();
  });
});

describe('characterStorage — index', () => {
  it('listCharacters returns the saved slot ids in insertion order (latest first)', () => {
    saveCharacter('a', sampleSpec(), 1, store);
    saveCharacter('b', sampleSpec(), 2, store);
    saveCharacter('c', sampleSpec(), 3, store);
    expect([...listCharacters(store)]).toEqual(['c', 'b', 'a']);
  });

  it('does not duplicate the slot id in the index when re-saving', () => {
    saveCharacter('a', sampleSpec(), 1, store);
    saveCharacter('a', sampleSpec(), 2, store);
    expect([...listCharacters(store)]).toEqual(['a']);
  });

  it('deleteCharacter removes both the slot and the index entry', () => {
    saveCharacter('a', sampleSpec(), 1, store);
    saveCharacter('b', sampleSpec(), 2, store);
    deleteCharacter('a', store);
    expect(loadCharacter('a', store)).toBeNull();
    expect([...listCharacters(store)]).toEqual(['b']);
  });

  it('listCharacters tolerates a corrupt index (returns empty)', () => {
    store.setItem(indexStorageKey(), 'not valid json');
    expect([...listCharacters(store)]).toEqual([]);
  });
});

describe('characterStorage — empty / null backends', () => {
  it('saveCharacter throws when no backend is available', () => {
    expect(() => saveCharacter('a', sampleSpec(), 1, null)).toThrow();
  });

  it('loadCharacter returns null when no backend is available', () => {
    expect(loadCharacter('a', null)).toBeNull();
  });

  it('listCharacters returns empty when no backend is available', () => {
    expect([...listCharacters(null)]).toEqual([]);
  });

  it('deleteCharacter is a no-op when no backend is available', () => {
    expect(() => deleteCharacter('a', null)).not.toThrow();
  });
});

describe('characterStorage — slot id validation', () => {
  it('rejects empty slot id', () => {
    expect(() => saveCharacter('', sampleSpec(), 1, store)).toThrow(/slotId/);
  });
});

describe('characterStorage — record shape', () => {
  it('persists the schema version', () => {
    saveCharacter('a', sampleSpec(), 1, store);
    const raw = store.getItem(characterStorageKey('a'));
    expect(raw).toContain('"schemaVersion":1');
  });

  it('record retains the spec verbatim through save/load', () => {
    const original = sampleSpec();
    saveCharacter('a', original, 1, store);
    const loaded = loadCharacter('a', store);
    expect(loaded).not.toBeNull();
    const rec: CharacterRecord = loaded!;
    expect(rec.spec).toEqual(original);
  });
});
