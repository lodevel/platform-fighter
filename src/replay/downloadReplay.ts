/**
 * Browser-side save-to-file helper — AC 30004 Sub-AC 4.
 *
 * What this module is
 * ===================
 *
 * The DOM-only half of the save-to-file flow. Given a {@link ReplayFile}
 * (produced by `RecordingController.buildReplayFile()` or
 * `serializeReplay`), this helper:
 *
 *   1. Stringifies it to JSON via {@link serializeReplayToString} so the
 *      file format is owned by ONE serialiser (no risk of two paths
 *      drifting).
 *   2. Wraps the string in a `Blob` with a JSON MIME type so a
 *      double-clicked file in a browser opens as text rather than as
 *      a plain download.
 *   3. Synthesises an anchor (`<a>`) with `download=` attribute and a
 *      blob URL `href`, then programmatically clicks it to trigger the
 *      browser's download dialog.
 *   4. Revokes the blob URL on the next animation frame so the browser
 *      can release the associated memory.
 *
 * Why a separate module (instead of a method on RecordingController)
 * ------------------------------------------------------------------
 *
 *   • **Testability.** The controller stays Phaser- and DOM-free; this
 *     module is the single place we touch `document` / `Blob` /
 *     `URL.createObjectURL`. Vitest's `happy-dom` / `jsdom` environments
 *     can exercise it; pure-Node tests skip it.
 *
 *   • **Reuse.** The (later-AC) replay browser screen will also need
 *     to download — replays the player loaded into RAM from the
 *     filesystem, then re-saved with new notes. Same helper.
 *
 *   • **Override hook for tests.** Each side-effecting dependency
 *     (`createObjectURL`, `revokeObjectURL`, `document`) is injectable
 *     via {@link DownloadReplayOptions} so tests can assert "we built a
 *     blob with this content, attached this filename" without standing
 *     up a real browser DOM.
 *
 * Determinism
 * -----------
 *
 * The download flow has zero feedback into the gameplay simulation, so
 * its non-determinism (timing, browser dialogs) doesn't affect replay
 * reproducibility. The data going *into* the download is deterministic
 * because the `ReplayFile` is.
 */

import {
  REPLAY_FILE_EXTENSION,
  serializeReplayToString,
  type ReplayFile,
} from './ReplayFile';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** MIME type of the saved replay artifact. */
export const REPLAY_MIME_TYPE = 'application/json' as const;

/**
 * Result of a successful download. Returned so the caller (e.g. a HUD
 * "saved!" toast or a unit test assertion) can read what the user got.
 */
export interface DownloadReplayResult {
  /** File name proposed to the browser via the anchor's `download=` attr. */
  readonly fileName: string;
  /** Number of bytes the JSON payload occupies (UTF-8). */
  readonly byteLength: number;
  /** The blob URL created for the download (already revoked on return). */
  readonly objectUrl: string;
}

/** Optional injection points so tests can stub the DOM side effects. */
export interface DownloadReplayOptions {
  /**
   * File name to suggest to the browser. Required — callers typically
   * read it from `RecordingController.suggestFileName()`. Always
   * normalised to end with {@link REPLAY_FILE_EXTENSION}.
   */
  readonly fileName: string;
  /**
   * Whether to pretty-print the JSON. Default `false` — replays are
   * machine-read, so compact JSON minimises file size on disk.
   */
  readonly pretty?: boolean;
  /**
   * Override for `URL.createObjectURL`. Defaults to the global. Tests
   * pass a stub that records the supplied blob.
   */
  readonly createObjectUrl?: (blob: Blob) => string;
  /** Override for `URL.revokeObjectURL`. Defaults to the global. */
  readonly revokeObjectUrl?: (url: string) => void;
  /**
   * Override for `document` (must expose `createElement`). Defaults to
   * the global `document`. Tests pass a stub.
   */
  readonly documentRef?: {
    readonly body: { appendChild(node: unknown): void; removeChild(node: unknown): void };
    createElement(tag: 'a'): {
      href: string;
      download: string;
      style: { display: string };
      click(): void;
      rel: string;
    };
  };
  /**
   * Override for `setTimeout` used to revoke the blob URL on a
   * follow-up tick. Defaults to the global. Tests pass a synchronous
   * stub so the assertion can run without timers.
   */
  readonly scheduleRevoke?: (cb: () => void) => void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the caller tried to download from an environment without
 * a DOM (e.g. plain Node) and didn't supply the override hooks. Distinct
 * subclass so callers can present a "saving requires a browser" message
 * rather than a generic crash.
 */
export class DownloadReplayUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadReplayUnsupportedError';
  }
}

// ---------------------------------------------------------------------------
// downloadReplayFile
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the supplied replay. Returns a
 * {@link DownloadReplayResult} describing what was saved. Throws
 * {@link DownloadReplayUnsupportedError} when running outside a DOM
 * without injected hooks.
 */
export function downloadReplayFile(
  replay: ReplayFile,
  options: DownloadReplayOptions,
): DownloadReplayResult {
  if (replay === null || replay === undefined || typeof replay !== 'object') {
    throw new Error(`downloadReplayFile: replay must be a ReplayFile object`);
  }
  if (typeof options.fileName !== 'string' || options.fileName.length === 0) {
    throw new Error(`downloadReplayFile: options.fileName is required`);
  }

  const fileName = ensureExtension(options.fileName);
  const json = serializeReplayToString(
    {
      // The replay is already a frozen `ReplayFile`. The serialiser
      // accepts `SerializeReplayOptions`, not `ReplayFile`, so we pass
      // the file's match config + frame entries straight through. This
      // keeps the JSON formatting owned by ONE function.
      matchConfig: replay.matchConfig,
      capturedFrames: replay.inputTimeline.entries.map((e) => ({
        frame: e.frame,
        inputs: e.inputs,
      })),
      recordedAt: new Date(replay.metadata.recordedAt),
      engineVersion: replay.metadata.engineVersion,
      notes: replay.metadata.notes,
      fixedTimestepMs: replay.metadata.fixedTimestepMs,
    },
    options.pretty === true,
  );

  const createObjectUrl = options.createObjectUrl ?? defaultCreateObjectUrl();
  const revokeObjectUrl = options.revokeObjectUrl ?? defaultRevokeObjectUrl();
  const documentRef = options.documentRef ?? defaultDocumentRef();
  const scheduleRevoke = options.scheduleRevoke ?? defaultScheduleRevoke();

  const blob = new Blob([json], { type: REPLAY_MIME_TYPE });
  const objectUrl = createObjectUrl(blob);

  const anchor = documentRef.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    documentRef.body.removeChild(anchor);
  }
  // Defer revoke so Chrome / Firefox have a chance to start the download
  // before the URL is dropped (some browsers serialise the click-then-
  // download work asynchronously).
  scheduleRevoke(() => {
    try {
      revokeObjectUrl(objectUrl);
    } catch {
      // Browsers occasionally throw on double-revoke during fast
      // re-renders; swallow rather than crash the gameplay scene.
    }
  });

  // Compute UTF-8 byte length without pulling in `Buffer` (we'd lose
  // browser portability). `TextEncoder` is available in every modern
  // browser and Node 18+.
  const byteLength = utf8Length(json);

  return Object.freeze({
    fileName,
    byteLength,
    objectUrl,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureExtension(name: string): string {
  return name.endsWith(REPLAY_FILE_EXTENSION)
    ? name
    : `${name}${REPLAY_FILE_EXTENSION}`;
}

function utf8Length(s: string): number {
  // TextEncoder is universally available in supported browsers + Node.
  // Falling back to `s.length` would under-count multibyte chars (notes
  // could legitimately contain non-ASCII).
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  // Last-resort approximation — every char as 1 byte. Notes are clamped
  // to 1024 chars so the worst-case under-count is bounded.
  return s.length;
}

function defaultCreateObjectUrl(): (blob: Blob) => string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new DownloadReplayUnsupportedError(
      `downloadReplayFile: URL.createObjectURL is unavailable in this ` +
        `environment — pass options.createObjectUrl to override`,
    );
  }
  return (blob) => URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(): (url: string) => void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    // No revoke is a leak, not a crash. Return a no-op so the rest of
    // the flow still completes — the `Unsupported` error path is the
    // create-side, where we have no fallback.
    return () => {};
  }
  return (url) => URL.revokeObjectURL(url);
}

function defaultDocumentRef(): NonNullable<DownloadReplayOptions['documentRef']> {
  if (typeof document === 'undefined') {
    throw new DownloadReplayUnsupportedError(
      `downloadReplayFile: \`document\` is unavailable in this environment ` +
        `— pass options.documentRef to override`,
    );
  }
  return document as unknown as NonNullable<DownloadReplayOptions['documentRef']>;
}

function defaultScheduleRevoke(): (cb: () => void) => void {
  if (typeof setTimeout !== 'function') {
    return (cb) => cb();
  }
  return (cb) => {
    setTimeout(cb, 0);
  };
}
