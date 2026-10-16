// Compare actual replay frames in the frozen Phaser host and the Three host.
// Stage art/HUD intentionally differ; retain both screenshots and exact sim hashes.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const out = path.join(root, 'docs/review/2026-10-15/takeover/visual-parity');
const baseline = path.join(root, 'docs/review/2026-10-15/takeover/golden-baseline');
const hosts = { phaser: 'http://127.0.0.1:4300/platform-fighter/', three: process.env.PF_GAME_URL ?? 'http://127.0.0.1:4173/platform-fighter/' };
const frames = [120, 400, 900];
const report = { hosts, frames, checks: [], errors: [] };
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const scenario of ['link-dk', 'link-pikachu-items', 'ffa-items']) {
    const golden = JSON.parse(fs.readFileSync(path.join(baseline, `${scenario}.json`), 'utf8'));
    const wanted = new Map(golden.hashes);
    for (const [host, url] of Object.entries(hosts)) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.on('pageerror', error => report.errors.push({ host, scenario, error: String(error) }));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForFunction(() => window.__sim?.startMatch || window.__game?.scene?.getScenes?.(true).length, null, { timeout: 180000 });
      await page.evaluate(async ({ host, config, inputs }) => {
        let sim;
        if (host === 'three') {
          window.__sim.startMatch(config);
          window.__sim.manual(true);
          await window.__sim.ready;
          sim = window.__sim.match;
        } else {
          const game = window.__game;
          for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
          game.scene.start('MatchScene', { matchConfig: config });
          sim = game.scene.getScene('MatchScene');
          sim.physicsEngine.pause();
          // Frozen-baseline reader adapter: remove only embedded display handles
          // and encode intentionally unbounded item speed caps, as in the goldens.
          const encode = (value, key) => {
            if (value === Infinity && (key === 'maxSpeedX' || key === 'maxSpeedY')) return { $unbounded: key };
            if (Array.isArray(value)) return value.map(row => encode(row, key));
            if (value && Object.getPrototypeOf(value) === Object.prototype)
              return Object.fromEntries(Object.entries(value).map(([k, row]) => [k, encode(row, k)]));
            return value;
          };
          for (const slot of sim.playerSlots) {
            const evidence = slot.character.getMatchHistoryEvidence.bind(slot.character);
            slot.character.getMatchHistoryEvidence = () => encode(evidence(), 'actor');
          }
          const digest = sim.getSimDigest.bind(sim);
          sim.getSimDigest = () => {
            const flight = sim.thrownItems;
            sim.thrownItems = flight.map(({ container, ...row }) => row);
            try { return digest(); } finally { sim.thrownItems = flight; }
          };
        }
        sim.setRecordedInputs(inputs);
        window.__parity = { sim, host };
      }, { host, config: golden.config, inputs: golden.inputs });
      for (const frame of frames) {
        const snapshot = await page.evaluate(target => {
          const { sim, host } = window.__parity;
          while (sim.physicsEngine.getFrame() < target) {
            if (host === 'three') window.__sim.step();
            else { sim.physicsEngine.resume(); sim.update(0, sim.physicsEngine.fixedTimestepMs); sim.physicsEngine.pause(); }
          }
          if (host === 'three') window.__sim.draw();
          return { frame: sim.physicsEngine.getFrame(), hash: sim.getSimDigest().hash,
            fighters: sim.playerSlots.map(({ character }) => ({ id: character.id, position: character.getPosition(), damage: character.getDamagePercent() })) };
        }, frame);
        // Allow the GPU to present the explicitly drawn frame, with simulation paused.
        await page.waitForTimeout(100);
        const file = `${scenario}-${frame}-${host}.png`;
        await page.screenshot({ path: path.join(out, file) });
        report.checks.push({ scenario, host, ...snapshot, expected: wanted.get(frame), equal: snapshot.hash === wanted.get(frame), file });
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const rows = report.checks.filter(row => row.host === 'phaser').map(row => `<tr><th>${row.scenario}, frame ${row.frame}</th><td><img src="${row.file}"></td><td><img src="${row.scenario}-${row.frame}-three.png"></td></tr>`).join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Replay view comparison</title><style>body{font:16px system-ui;background:#171924;color:#fff}table{width:100%;table-layout:fixed}th{width:10%}img{width:100%}td{width:45%}</style><h1>Replay view comparison</h1><p>Frozen Phaser and Three.js at identical recorded frames. Stage art and HUD differ by design. See report.json for simulation equality.</p><table><thead><tr><th>Frame</th><th>Phaser</th><th>Three.js</th></tr></thead><tbody>${rows}</tbody></table>`);
console.log(JSON.stringify({ checks: report.checks.length, failures: report.checks.filter(row => !row.equal), errors: report.errors, out }, null, 2));
if (report.errors.length || report.checks.some(row => !row.equal)) process.exitCode = 1;
