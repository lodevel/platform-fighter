// Gate merge (PLAN.md "MERGE AT THE GATE"): moves port/src/pending/* to their
// src/ homes (*.check.ts tests become *.test.ts), rewrites relative imports in
// the moved files and in every port file that imported them, then applies the
// anchored edits below (the Inferno joins STAGES with a 'gaze' hazard, the port
// reads the game's registries).
//
//   node scripts/gate-merge.mjs            dry run: checks every move and anchor, writes nothing
//   node scripts/gate-merge.mjs --apply    performs it (only once the other agent is done)
//
// All changes are computed in memory first; nothing is written unless every
// anchor matched exactly once. Line endings of edited files are preserved.
// Follow-ups that need judgment are in docs/review/2026-10-13/threejs-port/GATE-RUNBOOK.md.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PENDING = path.join(ROOT, 'port/src/pending');
const apply = process.argv.includes('--apply');

/** pending path → src path. */
const MOVES = {
  'scenes/matchRules.ts': 'src/scenes/matchRules.ts',
  'scenes/matchRules.check.ts': 'src/scenes/matchRules.test.ts',
  'entities/GazeHazard.ts': 'src/entities/GazeHazard.ts',
  'entities/GazeHazard.check.ts': 'src/entities/GazeHazard.test.ts',
  'physics/PhysicsWorld.ts': 'src/physics/PhysicsWorld.ts',
  'physics/matterPhysicsWorld.ts': 'src/physics/matterPhysicsWorld.ts',
  'physics/matterPhysicsWorld.check.ts': 'src/physics/matterPhysicsWorld.test.ts',
  'camera/cameraFraming.ts': 'src/camera/cameraFraming.ts',
  'camera/cameraFraming.check.ts': 'src/camera/cameraFraming.test.ts',
  'sim/hudView.ts': 'src/sim/hudView.ts',
  'sim/view.ts': 'src/sim/view.ts',
  'characters/paletteArtKeys.ts': 'src/characters/paletteArtKeys.ts',
  'characters/artFrameSelector.ts': 'src/characters/artFrameSelector.ts',
  'characters/artFrameSelector.check.ts': 'src/characters/artFrameSelector.test.ts',
};
/** Pending folders that move whole (vendored code, copied verbatim). */
const MOVE_DIRS = { 'physics/matter': 'src/physics/matter' };
/** Pending files with no src twin: their content is folded in by EDITS. */
const DISSOLVED = ['stages/infernoStage.ts', 'stages/index.ts'];

// ---------------------------------------------------------------------------
// Virtual file set: path → { text, eol }; null marks a deletion.
// ---------------------------------------------------------------------------
const files = new Map();
const rel = (p) => path.relative(ROOT, p);
function read(p) {
  if (files.has(p)) return files.get(p);
  const raw = fs.readFileSync(p, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const entry = { text, orig: text, eol: raw.includes('\r\n') ? '\r\n' : '\n' };
  files.set(p, entry);
  return entry;
}
const log = [];

// --- 1. Moves, with import rewriting -----------------------------------------
const old2new = new Map(Object.entries(MOVES).map(([from, to]) => [path.join(PENDING, from), path.join(ROOT, to)]));
const allFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const [from, to] of Object.entries(MOVE_DIRS)) {
  for (const f of allFiles(path.join(PENDING, from))) old2new.set(f, path.join(ROOT, to, path.relative(path.join(PENDING, from), f)));
}
const VERBATIM = new Set(Object.keys(MOVE_DIRS).flatMap((d) => allFiles(path.join(PENDING, d))));
const SPEC = /(from\s+|import\s*\(\s*|import\s+)(['"])(\.[^'"]+)\2/g;
function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.ts', '.d.ts', '/index.ts']) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { file: base + ext, ext };
  return null;
}
function relSpec(fromFile, targetFile, ext) {
  let target = targetFile;
  if (ext === '.ts') target = target.slice(0, -3);
  else if (ext === '.d.ts') target = target.slice(0, -5);
  else if (ext === '/index.ts') target = path.dirname(target);
  const r = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
  return r.startsWith('.') ? r : `./${r}`;
}
/** Imports of `text` rewritten as if the file moved from `oldFile` to `newFile` and MOVES happened. */
function rewriteImports(text, oldFile, newFile) {
  const changes = [];
  const out = text.replace(SPEC, (m, kw, q, spec) => {
    const hit = resolveSpec(oldFile, spec);
    if (!hit) return m;
    const next = relSpec(newFile, old2new.get(hit.file) ?? hit.file, hit.ext);
    if (next !== spec) changes.push(`${spec} → ${next}`);
    return `${kw}${q}${next}${q}`;
  });
  return { out, changes };
}

for (const [oldFile, newFile] of old2new) {
  if (!fs.existsSync(oldFile)) throw new Error(`missing ${rel(oldFile)}`);
  if (fs.existsSync(newFile)) throw new Error(`refusing to overwrite ${rel(newFile)}`);
  const src = read(oldFile);
  const { out, changes } = VERBATIM.has(oldFile) ? { out: src.text, changes: [] } : rewriteImports(src.text, oldFile, newFile);
  files.set(newFile, { text: out, orig: null, eol: src.eol });
  files.set(oldFile, null);
  log.push(`MOVE ${rel(oldFile)} -> ${rel(newFile)}${changes.length ? `\n       imports: ${changes.join('; ')}` : ''}`);
}
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []);
for (const file of walk(path.join(ROOT, 'port/src'))) {
  if (file.startsWith(PENDING)) continue;
  const entry = read(file);
  const { out, changes } = rewriteImports(entry.text, file, file);
  if (changes.length) { entry.text = out; log.push(`IMPORTS ${rel(file)}: ${changes.join('; ')}`); }
}

// --- 2. Anchored edits ---------------------------------------------------------
/** Replace `find` (must occur exactly once) in `file`, relative to ROOT. */
function edit(file, find, replace) {
  const entry = read(path.join(ROOT, file));
  if (!entry) throw new Error(`${file} is deleted`);
  const n = entry.text.split(find).length - 1;
  if (n !== 1) throw new Error(`anchor in ${file} matched ${n} times:\n${find.slice(0, 200)}`);
  entry.text = entry.text.replace(find, () => replace);
  log.push(`EDIT ${file}: ${find.split('\n').find((l) => l.trim())?.trim().slice(0, 70)}`);
}

// 2a. HazardType gains 'gaze'; StageHazard gains its timeline.
edit('src/types/index.ts',
  "export type HazardType = 'lava' | 'wind' | 'crusher' | 'spikes' | 'moving_platform';",
  "export type HazardType = 'lava' | 'wind' | 'crusher' | 'spikes' | 'moving_platform' | 'gaze';");
edit('src/types/index.ts',
  "   * (per touch). Default per-renderer (lava: 8%/tick).\n   */\n  readonly damagePerTick?: number;\n",
  "   * (per touch). Default per-renderer (lava: 8%/tick).\n   */\n  readonly damagePerTick?: number;\n" +
  "  /** For gaze (the Inferno head): its timeline. Default `GAZE_DEFAULTS`. */\n" +
  "  readonly gaze?: import('../entities/GazeHazard').GazeTimeline;\n");

// 2b. GazeHazard is built from its stage record, like lava and wind.
edit('src/entities/GazeHazard.ts',
  " * MERGE AT THE GATE (PLAN.md): moves to `src/entities/GazeHazard.ts` with\n * `'gaze'` added to `HazardType`; MatchScene / MatchSim calls\n * `fightersHitByFlash` once per fixed step and KOs the indices it returns.\n",
  " * A stage declares it as a `{ type: 'gaze' }` StageHazard; MatchScene /\n * MatchSim calls `fightersHitByFlash` once per fixed step and KOs the indices\n * it returns through the lava-KO path.\n");
{
  const entry = read(path.join(ROOT, 'src/entities/GazeHazard.ts'));
  entry.text = `import type { StageHazard } from '../types';\n\n${entry.text.trimEnd()}\n
/** Build the runtime entity from a stage's \`{ type: 'gaze' }\` hazard record. */
export function createGazeHazardFromStageHazard(hazard: StageHazard): GazeHazard {
  if (hazard.type !== 'gaze') throw new Error(\`createGazeHazardFromStageHazard: hazard.type must be 'gaze', got '\${hazard.type}'.\`);
  return new GazeHazard(hazard.id ?? 'gaze', hazard.gaze ?? GAZE_DEFAULTS);
}
`;
  log.push('EDIT src/entities/GazeHazard.ts: + createGazeHazardFromStageHazard');
}

// 2b'. Gate notes in the moved files become their post-gate wording.
edit('src/camera/cameraFraming.ts',
  " * MERGE AT THE GATE: the math is lifted from src/camera/CameraController.ts\n * (computeTargetEnvelope, frameRateIndependentLerp, clampCenterToBounds,\n * update/snap/setBounds/setZoomRange), unchanged. At the gate it moves to\n * `src/camera/cameraFraming.ts`, CameraController becomes a thin Phaser\n * adapter over it (its private copies deleted), and the adapter goes with\n * Phaser in step 9.",
  " * The math was lifted unchanged from CameraController (computeTargetEnvelope,\n * frameRateIndependentLerp, clampCenterToBounds, update/snap/setBounds/\n * setZoomRange); CameraController is now a thin Phaser adapter over it and\n * goes with Phaser in step 9.");
edit('src/physics/PhysicsWorld.ts',
  " * MERGE AT THE GATE: moves to `src/physics/PhysicsWorld.ts`; `HitboxScene`\n * and `CreatureScene` are deleted in favour of `PhysicsHost`.",
  " * Sub-step 5.2 retypes `HitboxScene` and `CreatureScene` to `PhysicsHost`.");
edit('src/physics/matterPhysicsWorld.ts',
  " * MERGE AT THE GATE: moves to `src/physics/matterPhysicsWorld.ts`, the only\n * importer of the Matter fork; verified there by the golden replays.",
  " * The only importer of the Matter fork; verified by the golden replays.");
edit('src/scenes/matchRules.ts',
  " * MERGE AT THE GATE (PLAN.md step 4): this is the rule logic that\n * `src/scenes/ModeSelectScene.ts` keeps inside the Phaser scene. It lives\n * here only because src/ is off limits while another agent edits it; it\n * moves into `src/scenes/modeSelect.ts` and the Phaser scene's copy is\n * deleted with the scene.",
  " * Shared by the 3D menus' Rules screen and the Phaser ModeSelectScene\n * (until Phaser goes in step 9).");
edit('src/sim/view.ts', " *\n * MERGE AT THE GATE: moves to `src/sim/view.ts`, filled by MatchSim.view().\n", " *\n * Filled by MatchSim.view() (step 6).\n");
edit('src/characters/paletteArtKeys.ts',
  " * MERGE AT THE GATE: moves to `src/characters/paletteArtKeys.ts`; replaces the\n * exact-match key of `paletteSwapShader.ts`, which the soft-shaded art never\n * matched (the match only ever used the whole-sprite setTint fallback).\n",
  " * Replaces the exact-match key of the Phaser `paletteSwapShader.ts`, which the\n * soft-shaded art never matched; the Phaser modules go in step 9.\n");
edit('src/characters/artFrameSelector.ts',
  " * MERGE AT THE GATE: moves to `src/characters/artFrameSelector.ts`;\n * `createSimulationSpriteAnimationDriver` keeps only its sprite calls over\n * `createArtFrameSelector`, and `registerCharacterSpriteAnimations` loops over\n * `characterAnimationSheets` (their inline copies are deleted).\n",
  " * `createSimulationSpriteAnimationDriver` applies `createArtFrameSelector` to\n * its sprite and `registerCharacterSpriteAnimations` loops over\n * `characterAnimationSheets` (GATE-RUNBOOK §3).\n");
edit('src/sim/hudView.ts', " *\n * MERGE AT THE GATE: moves to `src/sim/view.ts` with the rest of `SimView`.\n", "");

// 2c. The Inferno joins the built-in stages (stageDefinitions holds them all).
{
  const inferno = read(path.join(PENDING, 'stages/infernoStage.ts')).text;
  const start = inferno.indexOf('/**\n * AUTHORED (user, 2026-10-13');
  if (start < 0) throw new Error('infernoStage.ts: AUTHORED marker moved');
  const stageBlock = "export const INFERNO_STAGE: StageLayout = Object.freeze({\n  ...raiseFloatingPlatforms(createFlatStage({ id: 'inferno' }), INFERNO_PLATFORM_RAISE),\n  backgroundTheme: 'inferno',\n});\n\nexport const INFERNO_GAZE: GazeTimeline = GAZE_DEFAULTS;";
  let body = inferno.slice(start).trimEnd();
  if (!body.endsWith(stageBlock)) throw new Error('infernoStage.ts: INFERNO_STAGE block changed');
  body = body.slice(0, -stageBlock.length) +
    "export const INFERNO_STAGE: StageLayout = Object.freeze({\n" +
    "  ...raiseFloatingPlatforms(createFlatStage({ id: 'inferno' }), INFERNO_PLATFORM_RAISE),\n" +
    "  backgroundTheme: 'inferno',\n" +
    "  // The head fills the screen: its flash reaches every fighter.\n" +
    "  hazards: [{ type: 'gaze' as const, id: 'inferno-gaze', x: STAGE_DESIGN_WIDTH / 2, y: STAGE_DESIGN_HEIGHT / 2, width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT }],\n" +
    "});";
  edit('src/stages/stageDefinitions.ts',
    'export const STAGES: Readonly<Record<string, StageLayout>> = Object.freeze({',
    "// ---------------------------------------------------------------------------\n" +
    "// The Inferno (user request 2026-10-13): Battlefield-style layout over a lava\n" +
    "// sea; its only hazard is the giant head (`GazeHazard`, timing AUTHORED).\n" +
    "// ---------------------------------------------------------------------------\n\n" +
    `${body}\n\nexport const STAGES: Readonly<Record<string, StageLayout>> = Object.freeze({`);
}
edit('src/stages/stageDefinitions.ts',
  '  [MOVING_PLATFORM_STAGE.id]: MOVING_PLATFORM_STAGE,\n});',
  '  [MOVING_PLATFORM_STAGE.id]: MOVING_PLATFORM_STAGE,\n  [INFERNO_STAGE.id]: INFERNO_STAGE,\n});');
edit('src/stages/index.ts', '  MOVING_PLATFORM_STAGE_DEFAULTS,\n  STAGES,', '  MOVING_PLATFORM_STAGE_DEFAULTS,\n  INFERNO_STAGE,\n  INFERNO_PLATFORM_RAISE,\n  STAGES,');
edit('src/scenes/stageSelect.ts', '  FLAT_STAGE,\n  LAVA_STAGE,', '  FLAT_STAGE,\n  INFERNO_STAGE,\n  LAVA_STAGE,');
edit('src/scenes/stageSelect.ts', '→ moving platform)', '→ moving platform → inferno)');
edit('src/scenes/stageSelect.ts',
  "      displayName: 'MOVING PLATFORM',\n      subtitle: 'Ferries across a wide pit.',\n    }),\n  ]);",
  "      displayName: 'MOVING PLATFORM',\n      subtitle: 'Ferries across a wide pit.',\n    }),\n" +
  "    Object.freeze({\n      kind: 'built-in' as const,\n      id: INFERNO_STAGE.id,\n      displayName: 'INFERNO',\n      subtitle: 'The head rises every minute. Crouch when it flashes.',\n    }),\n  ]);");

// The Phaser renderer (until step 9 removes it) draws the Inferno with the
// lava cave's backdrop; the 3D view has its own 'inferno' theme.
edit('src/stages/backgroundThemes.ts', "  | 'sky-ferry'\n  | 'midnight';", "  | 'sky-ferry'\n  | 'midnight'\n  | 'inferno';");
edit('src/stages/backgroundThemes.ts', '  midnight: MIDNIGHT_THEME,\n});',
  "  midnight: MIDNIGHT_THEME,\n" +
  "  // The lava cave's layers under a darker, redder sky (themes must differ).\n" +
  "  inferno: Object.freeze({ ...LAVA_CAVERN_THEME, id: 'inferno' as const, gradientTop: 0x0e0306, gradientBottom: 0x5c1608 }),\n});");
edit('src/stages/backgroundThemes.test.ts', "  it('registers exactly the five built-in themes', () => {", "  it('registers exactly the six built-in themes', () => {");
edit('src/stages/backgroundThemes.test.ts', "        'sky-ferry',\n        'midnight',\n      ]),", "        'sky-ferry',\n        'midnight',\n        'inferno',\n      ]),");
// Tests that pin the built-in stage list.
edit('src/scenes/stageSelect.test.ts', '  MOVING_PLATFORM_STAGE,\n} from \'../stages\';', '  MOVING_PLATFORM_STAGE,\n  INFERNO_STAGE,\n} from \'../stages\';');
edit('src/stages/stageDefinitions.test.ts', '  MOVING_PLATFORM_STAGE,\n  MOVING_PLATFORM_STAGE_DEFAULTS,', '  MOVING_PLATFORM_STAGE,\n  MOVING_PLATFORM_STAGE_DEFAULTS,\n  INFERNO_STAGE,');
edit('src/scenes/stageSelect.test.ts', "  it('exposes the canonical five built-in stage ids in stable order', () => {",
  "  it('exposes the canonical six built-in stage ids in stable order', () => {");
edit('src/scenes/stageSelect.test.ts', '      MOVING_PLATFORM_STAGE.id,\n    ]);', '      MOVING_PLATFORM_STAGE.id,\n      INFERNO_STAGE.id,\n    ]);');
edit('src/stages/stageDefinitions.test.ts',
  '    // Five entries total: flat + four hazard stages.\n    expect(Object.keys(STAGES).length).toBe(5);',
  '    expect(STAGES[INFERNO_STAGE.id]).toBe(INFERNO_STAGE);\n    // Six entries total: flat + four hazard stages + the Inferno.\n    expect(Object.keys(STAGES).length).toBe(6);');

// 2d. The port reads the game's registries instead of pending/stages.
edit('port/src/arena/hazards/index.ts',
  "import { GazeHazard } from '../../../../src/entities/GazeHazard';\nimport type { PortStage } from '../../pending/stages';",
  "import { createGazeHazardFromStageHazard, type GazeHazard } from '../../../../src/entities/GazeHazard';\nimport type { StageLayout } from '../../../../src/types';");
edit('port/src/arena/hazards/index.ts',
  'export function createStageHazards({ layout, gaze: gazeTimeline }: PortStage): StageHazards {',
  'export function createStageHazards(layout: StageLayout): StageHazards {');
edit('port/src/arena/hazards/index.ts',
  '  const gaze = gazeTimeline ? new GazeHazard(`${layout.id}-gaze`, gazeTimeline) : null;',
  "  const gazeRecord = layout.hazards.find((h) => h.type === 'gaze');\n  const gaze = gazeRecord ? createGazeHazardFromStageHazard(gazeRecord) : null;");
edit('port/src/arena/runtime.ts', "import { getPortStage } from '../pending/stages';\n", "import { getStage } from '../../../src/stages/stageDefinitions';\n");
edit('port/src/arena/runtime.ts',
  '  const stage = getPortStage(stageId);\n  const { layout } = stage;\n  const hazards = createStageHazards(stage);',
  '  const layout = getStage(stageId);\n  const hazards = createStageHazards(layout);');
edit('port/src/ui/screens/stages.ts',
  "import { cycleStageCursor } from '../../../../src/scenes/stageSelect';\nimport { PORT_STAGE_ENTRIES } from '../../pending/stages';",
  "import { BUILT_IN_STAGE_ENTRIES, cycleStageCursor } from '../../../../src/scenes/stageSelect';");
edit('port/src/ui/screens/stages.ts', '  const entries = PORT_STAGE_ENTRIES;', '  const entries = BUILT_IN_STAGE_ENTRIES;');
edit('port/src/entries/viewer.ts', "import { PORT_STAGES } from '../pending/stages';", "import { STAGES } from '../../../src/stages/stageDefinitions';");
edit('port/src/entries/viewer.ts', "Object.keys(PORT_STAGES)", 'Object.keys(STAGES)');
edit('port/src/arena/contract.ts', '(see pending/entities/GazeHazard)', '(see src/entities/GazeHazard)');

// 2e. The pending layer is gone.
edit('port/scripts/check-layers.mjs', 'const RANK = { pending: -1, engine: 0,', 'const RANK = { engine: 0,');
edit('port/ARCHITECTURE.md', '| Renderer, design-space camera, Phaser-equivalent sprite layer, textures | `pending` |', '| Renderer, design-space camera, Phaser-equivalent sprite layer, textures | nothing in `port/` |');
edit('port/ARCHITECTURE.md', "| -1 | `pending/` | Game code waiting for the merge gate, laid out like `src/` (stages, entities, scene logic) | nothing in `port/` |\n", '');
edit('port/ARCHITECTURE.md', 'drawn from `pending/sim/hudView.ts`.', 'drawn from `src/sim/hudView.ts`.');
{
  const entry = read(path.join(ROOT, 'port/ARCHITECTURE.md'));
  const line = entry.text.split('\n').find((l) => l.startsWith('- `pending/` mirrors `src/` paths'));
  if (!line) throw new Error('ARCHITECTURE.md: pending note moved');
  edit('port/ARCHITECTURE.md', `${line}\n`, '');
}
for (const d of DISSOLVED) { read(path.join(PENDING, d)); files.set(path.join(PENDING, d), null); log.push(`DELETE port/src/pending/${d} (folded in)`); }

for (const [, to] of Object.entries(MOVES)) {
  if (/MERGE AT THE GATE/.test(files.get(path.join(ROOT, to)).text)) throw new Error(`${to} still carries a MERGE AT THE GATE note`);
}

// --- 3. Nothing may still point at pending/ ------------------------------------
const IMPORTS_PENDING = /^\s*(import|export)\b[^\n]*from ['"][^'"]*\/pending\//m;
for (const file of [...walk(path.join(ROOT, 'port/src')), ...walk(path.join(ROOT, 'src'))]) {
  const entry = files.has(file) ? files.get(file) : null;
  if (files.has(file) && !entry) continue;
  if (IMPORTS_PENDING.test(entry ? entry.text : fs.readFileSync(file, 'utf8'))) throw new Error(`${rel(file)} still imports pending/`);
}

console.log(log.join('\n'));
const changed = [...files].filter(([, e]) => e && e.text !== e.orig);
const deleted = [...files].filter(([, e]) => !e).map(([p]) => p);
const writes = changed.length, deletes = deleted.length;
if (!apply) {
  console.log(`\nDry run OK: every anchor matched. ${writes} files would be written, ${deletes} deleted. Re-run with --apply at the gate.`);
} else {
  for (const [p, entry] of changed) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, entry.eol === '\n' ? entry.text : entry.text.replace(/\n/g, entry.eol));
  }
  for (const p of deleted) fs.rmSync(p);
  for (const d of fs.readdirSync(PENDING)) if (fs.readdirSync(path.join(PENDING, d)).length === 0) fs.rmdirSync(path.join(PENDING, d));
  if (fs.readdirSync(PENDING).length === 0) fs.rmdirSync(PENDING);
  console.log(`\nApplied: ${writes} files written, ${deletes} deleted.`);
}
