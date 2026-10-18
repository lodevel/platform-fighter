import '@fontsource/chakra-petch/600.css';
import { getCharacterPalettes } from '../../../src/characters/palettes';
import type { CharacterId } from '../../../src/types';
import { StagePresenter } from '../arena/presenter';
import { AppearanceCollection, applyFighterDisplay } from '../fighters/appearance';

/** Every kept fighter in its 8 costumes, idling, for judging the recolours. */
const ROWS: ReadonlyArray<{ id: CharacterId; y: number; zoom: number }> = [
  { id: 'donkeykong', y: 400, zoom: 0.75 },
  { id: 'pikachu', y: 650, zoom: 1 },
  { id: 'link', y: 960, zoom: 0.85 },
];
const COLUMN = (i: number) => 150 + i * 231;

const presenter = new StagePresenter(document.getElementById('view')!);
applyFighterDisplay();
const appearances = new AppearanceCollection();
addEventListener('pagehide', () => appearances.dispose(), { once: true });
presenter.setStage('flat');
let frame = 0;
presenter.appearanceSource = (runtime) => {
  frame += 1;
  const tint = runtime.view.theme.spriteTint.getHex();
  return ROWS.flatMap((row) => getCharacterPalettes(row.id).map((_, i) =>
    appearances.pose(`costumes:${row.id}:${i}`, { characterId: row.id, paletteIndex: i, x: COLUMN(i), y: row.y, facing: 1, zoom: row.zoom, depth: i }, 'idle', frame, tint)));
};

const labels = document.getElementById('labels')!;
function placeLabels(): void {
  labels.replaceChildren(...ROWS.flatMap((row) => getCharacterPalettes(row.id).map((p, i) => {
    const at = presenter.project(COLUMN(i), row.y);
    const el = document.createElement('span');
    el.textContent = `${i} ${p.displayName}`;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y + 6}px`;
    return el;
  })));
}
function loop(now: number): void {
  presenter.frame(now);
  placeLabels();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
Object.assign(window, { __port: { get stage() { return 'flat'; }, get frame() { return frame; }, project: (x: number, y: number) => presenter.project(x, y) } });
