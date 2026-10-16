import metadata from '../../../assets/characters/pikachu/final-visual-frames.json';

interface DisplayClip {
  readonly nativeEnd: number;
  readonly loopDuration: number | null;
  readonly root: readonly number[];
  readonly scaleToWorld: number;
  readonly bodyCentreFromRootY: number;
  readonly frames: readonly { readonly nativeSample: number; readonly page: string; readonly frame: number }[];
}
interface DisplayBank {
  readonly clips: Readonly<Record<string, DisplayClip>>;
  readonly pages: Readonly<Record<string, { readonly frameWidth: number; readonly frameHeight: number }>>;
}
const bank: DisplayBank = metadata;

/** Independent display sampling: never used by receiving, attacks or sockets.
 * The semantic motion clock comes from the simulation; reading it does not
 * advance it. Repeated ticks, hitlag, seeks and restored snapshots are exact. */
export function pikachuFinalVisualPose(sheet: string, age: number) {
  const clip = bank.clips[sheet];
  if (!clip || !Number.isFinite(age)) return null;
  const time = Math.max(0, age);
  const sample = Math.floor(clip.loopDuration ? time % clip.loopDuration : Math.min(time, clip.nativeEnd));
  const selected = clip.frames[sample];
  if (!selected) throw new Error(`Missing Pikachu Final display sample: ${sheet}/${sample}`);
  const page = bank.pages[selected.page];
  if (!page) throw new Error(`Missing Pikachu Final display page: ${selected.page}`);
  return { key: `char.pikachu.${selected.page}`, frame: selected.frame, nativeSample: selected.nativeSample,
    originX: clip.root[0]! / page.frameWidth, originY: clip.root[1]! / page.frameHeight,
    scale: clip.scaleToWorld, bodyCentreFromRootY: clip.bodyCentreFromRootY,
    frameWidth: page.frameWidth, frameHeight: page.frameHeight };
}

/** Old owner pages remain addressable for explicit legacy tools, but ordinary
 * match preparation decodes only the replacement display bank. Victim pages
 * have separate identities and are never removed by this predicate. */
export function replacedPikachuFinalOwnerPage(key: string): boolean {
  return key.startsWith('char.pikachu.') && Object.hasOwn(bank.clips, key.slice('char.pikachu.'.length));
}
const startupPages = new Set(['final', 'final_air'].flatMap(sheet => bank.clips[sheet]!.frames.map(frame => `char.pikachu.${frame.page}`)));
export function pikachuFinalStartupPage(key: string): boolean { return startupPages.has(key); }
