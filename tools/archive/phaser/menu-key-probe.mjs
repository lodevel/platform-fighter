import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
try {
  for (const scenario of ['fast', 'per-key-snapshot', 'held-80ms']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/');
    await page.waitForFunction(() => window.__game?.scene.isActive('PasswordGateScene'), null, { timeout: 60000 });
    await page.evaluate(() => {
      const game = window.__game;
      for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
      game.scene.start('MainMenuScene');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('MainMenuScene'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.scene.isActive('ModeSelectScene'));
    await page.evaluate(() => {
      const mode = window.__game.scene.getScene('ModeSelectScene');
      window.__menuTrace = [];
      const snapshot = () => ({ state: { ...mode.state }, focus: mode.ruleFocus, items: mode.itemFrequency });
      window.__menuSnapshot = snapshot;
      window.addEventListener('keydown', event => window.__menuTrace.push({ kind: 'DOM', key: event.code, repeat: event.repeat, timestamp: event.timeStamp }));
      mode.input.keyboard.on('keydown', event => window.__menuTrace.push({ kind: 'Phaser', key: event.code, repeat: event.repeat, timestamp: event.timeStamp, ...snapshot() }));
      for (const method of ['moveRuleFocus', 'changeFocusedRule', 'handleModeCycle', 'handleQuantityCycle']) {
        const original = mode[method];
        mode[method] = function (...args) {
          window.__menuTrace.push({ kind: method, args, ...snapshot() });
          return original.apply(this, args);
        };
      }
    });
    const checkpoints = [await page.evaluate(() => window.__menuSnapshot())];
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowRight']) {
      await page.keyboard.press(key, scenario === 'held-80ms' ? { delay: 80 } : {});
      if (scenario === 'per-key-snapshot') checkpoints.push(await page.evaluate(() => window.__menuSnapshot()));
      if (scenario === 'held-80ms') await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
    const result = await page.evaluate(() => ({ final: window.__menuSnapshot(), trace: window.__menuTrace }));
    report.push({ scenario, checkpoints, ...result });
    console.log(JSON.stringify(report.at(-1)));
    await page.close();
  }
  await mkdir('docs/review/2026-09-09/implemented', { recursive: true });
  await writeFile('docs/review/2026-09-09/implemented/menu-key-probe.json', JSON.stringify(report, null, 2));
} finally { await browser.close(); }
