/** Shared maintained probe adapter for the real Three.js/MatchSim browser host. */
export const MATCH_URL = process.env.PF_GAME_URL ?? process.env.PF_REWORK_URL ?? 'http://127.0.0.1:4173/platform-fighter/';

export async function openMatchHost(page, url = MATCH_URL) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.__sim?.startMatch, null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__launchProbeMatch = async (config) => {
      window.__sim.startMatch(config);
      window.__sim.manual(true);
      await window.__sim.ready;
      const sim = window.__sim.match;
      // Compatibility names for maintained gameplay probes: every operation
      // delegates to the real browser resolver, fixed clock and simulation.
      sim.inputResolver = window.__sim.inputResolver;
      sim.update = (_now, deltaMs) => window.__sim.advance(deltaMs);
      sim.stage = { scale: sim.baseStage.transform.viewportScale };
      return sim;
    };
  });
  return page.evaluate(() => [...document.scripts].find(script => /assets\/(?:index|game)-/.test(script.src))?.src);
}

export async function launchMatch(page, config) {
  await page.evaluate(async config => {
    await window.__launchProbeMatch(config);
  }, config);
}
