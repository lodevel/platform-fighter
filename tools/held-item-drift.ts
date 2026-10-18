#!/usr/bin/env node
/**
 * Held items on package-drawn fighters: how far the package grip (the `item` socket of the drawing the package
 * shows, held with it) is from the gameplay grip the legacy renderer draws at. Headless seeded CPU matches with
 * held weapons only; each frame every held sprite item is placed by the game's view (legacy) and at the grip its
 * holder's package backend shows (packages, as MatchView draws it). Distances in design px, angles in degrees.
 * Run: npx tsx tools/held-item-drift.ts --out report.json [--frames 10800] [--seeds 1,2,3] [--players donkeykong,link,pikachu,pikachu]
 *   [--items homeRunBat,beamSword]   (default: every held weapon; the player list rotates with the seed)
 * With the unheld exports of `npm run character:package` in .tmp/shipping-packages, it also compares every tick of
 * every action with an item socket, shipped (held) against unheld (= the gameplay grip, as the exporter verifies).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluate, scheduleLength } from '../character/evaluator/evaluate';
import { MatchSim } from '../src/sim/MatchSim';
import type { MatchConfig } from '../src/types';
import type { CharacterPackage } from '../character/package/types';
import { createLegacyAppearanceBridge } from '../src/characterPresentation/legacy/bridge';
import { PackageSpriteAppearance } from '../port/src/fighters/backends/packageSprite';
import type { LoadedPackage, PackageLibrary } from '../port/src/fighters/packageLibrary';
import { placeHeldItem } from '../port/src/match/heldItems';
import type { ItemView } from '../src/sim/view';
import { resolveSimulationAction } from '../src/characters/simulationSpriteAnimation';

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]!; };
const FRAMES = Number(arg('frames', '10800')), SEEDS = arg('seeds', '20261019,20261020,20261021').split(',').map(Number), OUT = arg('out', '');
const FIGHTERS = ['donkeykong', 'link', 'pikachu'] as const;
const HELD = arg('items', 'homeRunBat,beamSword,starRod,rayGun,superScope,fireFlower').split(',');
const PLAYERS = arg('players', 'donkeykong,link,pikachu,pikachu').split(',');
const index = JSON.parse(readFileSync('assets/characters/packages.json', 'utf8')) as { packages: Record<string, { revision: string }> };
const packages = Object.fromEntries(FIGHTERS.map(id => [id, JSON.parse(readFileSync(`assets/characters/${id}/package/character.json`, 'utf8')) as CharacterPackage]));
/** Every package resident, without pages: the backend only needs the package to pick drawings and sockets. */
const library = { acquire: (id: string) => ({ id, ready: new Promise(() => {}), release() {} }),
  resident: (id: string) => packages[id] && { pkg: packages[id] } as LoadedPackage } as unknown as PackageLibrary;

interface Row { frames: number; packageGrip: number; drifting: number; sumDistance: number; maxDistance: number; sumAngle: number; maxAngle: number;
  sumTip: number; maxTip: number; perItem: Record<string, number>; worst: Record<string, unknown> | null }
const rows: Record<string, Row> = Object.fromEntries(FIGHTERS.map(id => [id, { frames: 0, packageGrip: 0, drifting: 0, sumDistance: 0, maxDistance: 0,
  sumAngle: 0, maxAngle: 0, sumTip: 0, maxTip: 0, perItem: {}, worst: null }]));
/** Worst frame per fighter, for the screenshot check: with a bat or sword when one drifts, else with any item. */
const shots: Record<string, Record<string, unknown>> = {};
const faults: { seed: number; frame: number; error: string }[] = [];
const swung = (detail: Record<string, unknown>) => detail.item === 'homeRunBat' || detail.item === 'beamSword';
const tip = (item: ItemView) => ({ x: 2 * item.position.x - item.rootPosition!.x, y: 2 * item.position.y - item.rootPosition!.y });
const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) * 180 / Math.PI % 360; return d > 180 ? 360 - d : d; };

for (const seed of SEEDS) {
  const players = PLAYERS.map((_, i) => PLAYERS[(i + seed) % PLAYERS.length]!).map((characterId, i) => ({ index: i + 1, characterId, paletteIndex: i % 2, inputType: 'ai', aiDifficulty: 'hard' }));
  const config = { mode: 'time', timeLimitSeconds: Math.ceil(FRAMES / 60) + 10, stockCount: 3, stageId: 'flat', rngSeed: seed, itemFrequency: 'high', linkIntroPolicy: 'none',
    itemSwitch: Object.fromEntries(['homeRunBat', 'beamSword', 'hammer', 'rayGun', 'bobOmb', 'crate', 'starRod', 'superScope', 'fireFlower', 'bananaPeel',
      'goldenHammer', 'food', 'heartContainer', 'maximTomato', 'barrel', 'capsule', 'smashBall'].map(type => [type, HELD.includes(type)])),
    players } as unknown as MatchConfig;
  const sim = new MatchSim({ matchConfig: config }), bridge = createLegacyAppearanceBridge(), appearances = new Map<number, PackageSpriteAppearance>();
  try {
    for (let n = 0; n < FRAMES && !sim.matchEndDetector.isMatchOver(); n++) {
      sim.step();
      const view = sim.view();
      for (const fighter of view.fighters) {
        const request = bridge.match(fighter, { profile: { id: `package.${fighter.characterId}`, revision: index.packages[fighter.characterId]!.revision } });
        if (!appearances.has(fighter.playerIndex)) appearances.set(fighter.playerIndex, new PackageSpriteAppearance(library));
        appearances.get(fighter.playerIndex)!.update(request);
      }
      for (const item of view.items) {
        if (!item.held?.turns || !item.spriteKey || item.generatedKind || item.visible === false) continue;
        const fighter = view.fighters.find(f => f.playerIndex === item.held!.playerIndex)!, row = rows[fighter.characterId]!;
        const placed = placeHeldItem(item, appearances.get(fighter.playerIndex)!.heldItemGrip(item.held.socketAxis));
        row.frames++;
        if (placed === item) continue;
        row.packageGrip++;
        const distance = Math.hypot(placed.rootPosition!.x - item.rootPosition!.x, placed.rootPosition!.y - item.rootPosition!.y);
        const angle = angleGap(placed.angle, item.angle), a = tip(item), b = tip(placed), tipDistance = Math.hypot(a.x - b.x, a.y - b.y);
        row.sumDistance += distance; row.sumAngle += angle; row.sumTip += tipDistance;
        if (distance > .5 || angle > 1) { row.drifting++; row.perItem[item.type] = (row.perItem[item.type] ?? 0) + 1; }
        const detail = { seed, frame: view.frame, playerIndex: fighter.playerIndex, item: item.type, distance: +distance.toFixed(2), angle: +angle.toFixed(2),
          tip: +tipDistance.toFixed(2), state: resolveSimulationAction(fighter.animation).state, legacyRoot: item.rootPosition, packageRoot: placed.rootPosition, centre: fighter.position, config };
        if (tipDistance > row.maxTip) { row.maxTip = tipDistance; row.worst = { ...detail, config: undefined }; }
        const shot = shots[fighter.characterId];
        row.maxDistance = Math.max(row.maxDistance, distance); row.maxAngle = Math.max(row.maxAngle, angle);
        if (tipDistance > .5 && (!shot || swung(detail) && !swung(shot) || swung(detail) === swung(shot) && tipDistance > (shot.tip as number)))
          shots[fighter.characterId] = detail;
      }
    }
  } catch (error) {
    // A gameplay fault ends this seed's match; the frames before it still count.
    faults.push({ seed, frame: sim.physicsEngine.getFrame(), error: (error as Error).message });
  } finally { sim.dispose(); appearances.forEach(appearance => appearance.dispose()); }
}

/** Per fighter, over every tick of every action with an item socket: ticks whose shipped socket differs from the unheld one. */
const actions = Object.fromEntries(FIGHTERS.flatMap(id => {
  const unheldFile = `.tmp/shipping-packages/${id}/character.json`;
  if (!existsSync(unheldFile)) return [];
  const unheld = JSON.parse(readFileSync(unheldFile, 'utf8')) as CharacterPackage, shipped = packages[id]!;
  let ticks = 0, differing = 0, maxDistance = 0, maxAngle = 0, worst = '';
  const perAction: Record<string, number> = {};
  for (const [name, action] of Object.entries(shipped.actions)) {
    if (!action.sockets?.item) continue;
    for (let tick = 0; tick < scheduleLength(action.drawings); tick++) {
      const a = evaluate(shipped, { action: name, tick, facing: 1 }).sockets.item, b = evaluate(unheld, { action: name, tick, facing: 1 }).sockets.item;
      if (!a || !b) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y), angle = Math.abs((a.angle ?? 0) - (b.angle ?? 0));
      ticks++;
      if (distance > .5 || angle > 1) { differing++; perAction[name] = (perAction[name] ?? 0) + 1; }
      if (distance > maxDistance) { maxDistance = distance; worst = `${name}@${tick}`; }
      maxAngle = Math.max(maxAngle, angle);
    }
  }
  return [[id, { ticks, differing, actions: Object.keys(perAction).length, maxDistance: +maxDistance.toFixed(2), maxAngle: +maxAngle.toFixed(2), worst, perAction }]];
}));

const summary = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, {
  heldFrames: r.frames, packageGripFrames: r.packageGrip, driftingFrames: r.drifting, driftingItems: r.perItem,
  meanDistance: +(r.sumDistance / Math.max(1, r.packageGrip)).toFixed(2), maxDistance: +r.maxDistance.toFixed(2),
  meanAngle: +(r.sumAngle / Math.max(1, r.packageGrip)).toFixed(2), maxAngle: +r.maxAngle.toFixed(2),
  meanTip: +(r.sumTip / Math.max(1, r.packageGrip)).toFixed(2), maxTip: +r.maxTip.toFixed(2), worst: r.worst }]));
const report = { frames: FRAMES, seeds: SEEDS, items: HELD, players: PLAYERS, summary, faults, actions, shots };
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ summary, faults, actions, shots: Object.fromEntries(Object.entries(shots).map(([id, s]) => [id, { ...s, config: undefined }])) }, null, 1));
