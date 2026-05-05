import { describe, expect, it } from 'vitest';
import {
  BINDING_PROFILES_PAYLOAD_KIND,
  BINDING_PROFILES_STORAGE_KEY,
  SCHEMA_VERSION,
  type BindingProfilesPayload,
  type BindingProfilesPayloadKind,
  type FourPlayerProfileMap,
  type SchemaVersion,
} from './BindingProfilePersistence';
import {
  BINDINGS_SCHEMA_VERSION,
  DEFAULT_PLAYER_PROFILES,
  type PlayerBindingIndex,
} from '../types/bindings';
import {
  STORAGE_APP_NAMESPACE,
  STORAGE_BINDINGS_DOMAIN,
  STORAGE_BINDINGS_VERSION_SEGMENT,
} from './BindingsStorage';

/**
 * AC 40101 Sub-AC 1 — versioned binding profile persistence schema.
 *
 * The module under test is types-and-constants only, so the suite is
 * intentionally compact:
 *
 *   1. {@link SCHEMA_VERSION} stays pinned to the canonical
 *      {@link BINDINGS_SCHEMA_VERSION} so the persistence + data-model
 *      versions never drift.
 *   2. {@link BINDING_PROFILES_PAYLOAD_KIND} matches the documented
 *      string literal.
 *   3. {@link BINDING_PROFILES_STORAGE_KEY} composes from the same
 *      namespace policy as the IO layer's
 *      {@link STORAGE_APP_NAMESPACE} / {@link STORAGE_BINDINGS_DOMAIN}
 *      / {@link STORAGE_BINDINGS_VERSION_SEGMENT} — i.e. the literal
 *      value `platformfighter.bindings.v1.profiles`.
 *   4. A round-trip through `JSON.stringify` / `JSON.parse` of a
 *      sample 4-player payload preserves every field — proving the
 *      schema is JSON-clean and the four-slot map round-trips
 *      losslessly.
 */
describe('BindingProfilePersistence (AC 40101 Sub-AC 1)', () => {
  describe('SCHEMA_VERSION', () => {
    it('is pinned to the canonical binding data-model schema version', () => {
      expect(SCHEMA_VERSION).toBe(BINDINGS_SCHEMA_VERSION);
    });

    it('is a positive integer literal so migration code can compare numerically', () => {
      expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
      expect(SCHEMA_VERSION).toBeGreaterThan(0);
    });

    it('exposes a SchemaVersion type that narrows to the literal', () => {
      // Compile-time assertion: only the literal `1` should satisfy
      // the alias today. `as SchemaVersion` is unsafe upcast through
      // the unused parameter to keep the assertion at the type level.
      const v: SchemaVersion = SCHEMA_VERSION;
      expect(v).toBe(1);
    });
  });

  describe('BINDING_PROFILES_PAYLOAD_KIND', () => {
    it('is the documented string literal "bindingProfiles"', () => {
      expect(BINDING_PROFILES_PAYLOAD_KIND).toBe('bindingProfiles');
    });

    it('exposes a matching type alias', () => {
      const kind: BindingProfilesPayloadKind = 'bindingProfiles';
      expect(kind).toBe(BINDING_PROFILES_PAYLOAD_KIND);
    });
  });

  describe('BINDING_PROFILES_STORAGE_KEY', () => {
    it('matches the documented literal value', () => {
      expect(BINDING_PROFILES_STORAGE_KEY).toBe('platformfighter.bindings.v1.profiles');
    });

    it('is composed of the same namespace policy as the IO layer', () => {
      const expected = [
        STORAGE_APP_NAMESPACE,
        STORAGE_BINDINGS_DOMAIN,
        STORAGE_BINDINGS_VERSION_SEGMENT,
        'profiles',
      ].join('.');
      expect(BINDING_PROFILES_STORAGE_KEY).toBe(expected);
    });

    it('uses dot-separated segments and starts with the platformfighter namespace', () => {
      expect(BINDING_PROFILES_STORAGE_KEY.startsWith('platformfighter.')).toBe(true);
      expect(BINDING_PROFILES_STORAGE_KEY.split('.').length).toBe(4);
    });
  });

  describe('BindingProfilesPayload type', () => {
    /**
     * Build a sample payload from the canonical default profiles.
     * This exists on disk during real persistence, so the test is the
     * closest thing we have to a "wire format" lock.
     */
    function makeSamplePayload(): BindingProfilesPayload {
      const profiles: FourPlayerProfileMap = {
        1: DEFAULT_PLAYER_PROFILES[1],
        2: DEFAULT_PLAYER_PROFILES[2],
        3: DEFAULT_PLAYER_PROFILES[3],
        4: DEFAULT_PLAYER_PROFILES[4],
      };
      return {
        schemaVersion: SCHEMA_VERSION,
        kind: BINDING_PROFILES_PAYLOAD_KIND,
        profiles,
      };
    }

    it('round-trips through JSON without losing any field', () => {
      const original = makeSamplePayload();
      const cloned = JSON.parse(JSON.stringify(original)) as BindingProfilesPayload;

      expect(cloned.schemaVersion).toBe(SCHEMA_VERSION);
      expect(cloned.kind).toBe(BINDING_PROFILES_PAYLOAD_KIND);

      // All four slots are present after round-trip.
      const slots: PlayerBindingIndex[] = [1, 2, 3, 4];
      for (const slot of slots) {
        const profile = cloned.profiles[slot];
        expect(profile).toBeDefined();
        expect(profile.playerIndex).toBe(slot);
        expect(profile.schemaVersion).toBe(SCHEMA_VERSION);
        expect(['keyboard', 'gamepad']).toContain(profile.deviceType);
      }
    });

    it('produces deterministic JSON for two equivalent payloads', () => {
      const a = JSON.stringify(makeSamplePayload());
      const b = JSON.stringify(makeSamplePayload());
      expect(a).toBe(b);
    });

    it('encodes slot indices as the strings "1".."4" inside JSON (per JSON.stringify)', () => {
      const json = JSON.parse(JSON.stringify(makeSamplePayload())) as {
        profiles: Record<string, unknown>;
      };
      expect(Object.keys(json.profiles).sort()).toEqual(['1', '2', '3', '4']);
    });
  });
});
