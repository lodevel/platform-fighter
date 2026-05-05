import { describe, it, expect } from 'vitest';
import type { MatchConfig, PlayerSlot } from '../types';
import { RecordingController } from './RecordingController';
import {
  REPLAY_MIME_TYPE,
  DownloadReplayUnsupportedError,
  downloadReplayFile,
  type DownloadReplayOptions,
} from './downloadReplay';
import {
  REPLAY_FILE_EXTENSION,
  deserializeReplayFromString,
} from './ReplayFile';

/**
 * AC 30004 Sub-AC 4 — browser save-to-file helper.
 *
 * Coverage map:
 *
 *   • Constants — REPLAY_MIME_TYPE is JSON.
 *   • downloadReplayFile — happy path with injected DOM stubs:
 *       creates a Blob with the right MIME, attaches the right
 *       filename, clicks the anchor, revokes the blob URL.
 *   • Error paths — refuses missing fileName / replay; surfaces
 *       DownloadReplayUnsupportedError when the DOM is absent and no
 *       hooks are supplied.
 *   • Round-trip — the downloaded JSON deserialises back to an equal
 *       replay file (the writer feeds the deserialiser).
 *   • Filename normalisation — auto-appends the canonical extension.
 *   • Pretty-print — toggles JSON formatting for human-readable saves.
 */

// ---------------------------------------------------------------------------
// DOM stub harness
// ---------------------------------------------------------------------------

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
  clicked: boolean;
}

interface DomHarness {
  options: DownloadReplayOptions;
  capturedBlob?: Blob;
  capturedUrl?: string;
  anchor?: FakeAnchor;
  appended: number;
  removed: number;
  revoked: boolean;
  scheduledRevokes: number;
}

function makeDomHarness(fileName: string, pretty = false): DomHarness {
  const harness: DomHarness = {
    appended: 0,
    removed: 0,
    revoked: false,
    scheduledRevokes: 0,
  } as DomHarness;
  let nextUrlId = 0;
  const fakeBody = {
    appendChild: (_: unknown) => {
      harness.appended += 1;
    },
    removeChild: (_: unknown) => {
      harness.removed += 1;
    },
  };
  const fakeDocument = {
    body: fakeBody,
    createElement: (_tag: 'a'): FakeAnchor => {
      const anchor: FakeAnchor = {
        href: '',
        download: '',
        rel: '',
        style: { display: '' },
        clicked: false,
        click: () => {
          anchor.clicked = true;
        },
      };
      harness.anchor = anchor;
      return anchor;
    },
  };
  harness.options = {
    fileName,
    pretty,
    createObjectUrl: (blob: Blob) => {
      harness.capturedBlob = blob;
      const url = `blob:fake#${nextUrlId++}`;
      harness.capturedUrl = url;
      return url;
    },
    revokeObjectUrl: (_: string) => {
      harness.revoked = true;
    },
    documentRef: fakeDocument as unknown as DownloadReplayOptions['documentRef'],
    scheduleRevoke: (cb: () => void) => {
      harness.scheduledRevokes += 1;
      // Run synchronously so the assertion can read `revoked` immediately.
      cb();
    },
  };
  return harness;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlayerSlots(count: number): PlayerSlot[] {
  const ids = ['wolf', 'cat', 'owl', 'bear'] as const;
  return Array.from({ length: count }, (_, i) => ({
    index: (i + 1) as PlayerSlot['index'],
    characterId: ids[i]!,
    paletteIndex: i,
    inputType: i === 0 ? 'keyboard_p1' : i === 1 ? 'keyboard_p2' : 'ai',
    ...(i >= 2 ? { aiDifficulty: 'easy' as const } : {}),
  }));
}

function makeMatchConfig(): MatchConfig {
  return {
    mode: 'stocks',
    stockCount: 3,
    stageId: 'flat',
    players: makePlayerSlots(2),
    rngSeed: 0xc0ffee,
  };
}

function buildReplay() {
  const c = new RecordingController({
    engineVersion: '1.0.0',
    nowFactory: () => new Date('2026-04-30T12:00:00.000Z'),
  });
  c.start({ matchConfig: makeMatchConfig() });
  c.captureFrame(0, [
    { moveX: 1, jump: false, attack: false, dropThrough: false },
    { moveX: -1, jump: false, attack: false, dropThrough: false },
  ]);
  c.captureFrame(1, [
    { moveX: 0, jump: true, attack: false, dropThrough: false },
    { moveX: 0, jump: false, attack: true, dropThrough: false },
  ]);
  c.stop();
  return { controller: c, replay: c.buildReplayFile() };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('downloadReplay constants', () => {
  it('exposes the JSON MIME type', () => {
    expect(REPLAY_MIME_TYPE).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('downloadReplayFile — happy path', () => {
  it('creates a JSON blob, attaches the filename, clicks and revokes', () => {
    const { replay } = buildReplay();
    const harness = makeDomHarness('my-match.replay.json');
    const result = downloadReplayFile(replay, harness.options);

    // Blob shape — application/json with the serialised replay.
    expect(harness.capturedBlob).toBeDefined();
    expect(harness.capturedBlob!.type).toBe('application/json');
    expect(harness.capturedBlob!.size).toBeGreaterThan(0);

    // Anchor wiring — the right href + download + click + DOM dance.
    expect(harness.anchor).toBeDefined();
    expect(harness.anchor!.href).toBe(harness.capturedUrl);
    expect(harness.anchor!.download).toBe('my-match.replay.json');
    expect(harness.anchor!.clicked).toBe(true);
    expect(harness.anchor!.style.display).toBe('none');
    expect(harness.appended).toBe(1);
    expect(harness.removed).toBe(1);

    // Revoke fired (synchronously by our fake scheduler).
    expect(harness.scheduledRevokes).toBe(1);
    expect(harness.revoked).toBe(true);

    // Result mirrors what was actually saved.
    expect(result.fileName).toBe('my-match.replay.json');
    expect(result.byteLength).toBe(harness.capturedBlob!.size);
    expect(result.objectUrl).toBe(harness.capturedUrl);
  });

  it('appends the canonical extension when omitted', () => {
    const { replay } = buildReplay();
    const harness = makeDomHarness('clip-1');
    const result = downloadReplayFile(replay, harness.options);
    expect(result.fileName).toBe(`clip-1${REPLAY_FILE_EXTENSION}`);
    expect(harness.anchor!.download).toBe(`clip-1${REPLAY_FILE_EXTENSION}`);
  });

  it('downloaded JSON deserialises back to the original', async () => {
    const { replay } = buildReplay();
    const harness = makeDomHarness('roundtrip.replay.json');
    downloadReplayFile(replay, harness.options);
    const text = await harness.capturedBlob!.text();
    const round = deserializeReplayFromString(text);
    expect(round.metadata.engineVersion).toBe('1.0.0');
    expect(round.metadata.recordedAt).toBe('2026-04-30T12:00:00.000Z');
    expect(round.inputTimeline.entries.length).toBe(2);
    expect(round.matchConfig.players.length).toBe(2);
    expect(round.rngSeed).toBe(0xc0ffee);
  });

  it('pretty-prints the JSON when requested', async () => {
    const { replay } = buildReplay();
    const harnessCompact = makeDomHarness('compact', false);
    downloadReplayFile(replay, harnessCompact.options);
    const compactSize = harnessCompact.capturedBlob!.size;

    const harnessPretty = makeDomHarness('pretty', true);
    downloadReplayFile(replay, harnessPretty.options);
    const prettySize = harnessPretty.capturedBlob!.size;

    expect(prettySize).toBeGreaterThan(compactSize);
    const text = await harnessPretty.capturedBlob!.text();
    expect(text).toContain('\n');
    expect(text).toContain('  ');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('downloadReplayFile — errors', () => {
  it('rejects missing replay', () => {
    const harness = makeDomHarness('x.replay.json');
    expect(() =>
      // @ts-expect-error — forced wrong type to validate the runtime guard
      downloadReplayFile(null, harness.options),
    ).toThrow(/replay must be a ReplayFile/);
  });

  it('rejects empty fileName', () => {
    const { replay } = buildReplay();
    const harness = makeDomHarness('');
    expect(() => downloadReplayFile(replay, harness.options)).toThrow(
      /fileName is required/,
    );
  });

  it('throws DownloadReplayUnsupportedError without DOM hooks in headless env', () => {
    const { replay } = buildReplay();
    // No documentRef / createObjectUrl override → the helper falls back
    // to the global `document` / `URL.createObjectURL`, which are
    // typically absent in the vitest Node default environment.
    if (typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
      // Skip — the runtime DOES expose these (e.g. happy-dom). Test
      // is environment-dependent on purpose: it only asserts the
      // headless branch.
      return;
    }
    expect(() =>
      downloadReplayFile(replay, { fileName: 'test.replay.json' }),
    ).toThrow(DownloadReplayUnsupportedError);
  });

  it('survives a revoke that throws (non-fatal)', () => {
    const { replay } = buildReplay();
    const harness = makeDomHarness('revoke-throws.replay.json');
    harness.options = {
      ...harness.options,
      revokeObjectUrl: () => {
        throw new Error('release failed');
      },
    };
    expect(() => downloadReplayFile(replay, harness.options)).not.toThrow();
  });
});
