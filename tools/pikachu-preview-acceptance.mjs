import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'docs/review/2026-10-06/pikachu-character/preview');
mkdirSync(output, { recursive: true });
const build = JSON.parse(readFileSync(path.join(root, 'docs/review/2026-10-06/pikachu-character/preview-build.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cases = [];
try {
  await page.goto('http://127.0.0.1:4178/pikachu-preview.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__pikachuPreview?.ready === true);
  for (const facing of [1, -1]) for (const [distance, expectedDamage, expectedRegion] of [[36, 1.4, 0], [65, 1, 2], [83, 0, null]]) {
    await page.evaluate(({ facing, distance }) => { window.__pikachuPreview.setFacing(facing); window.__pikachuPreview.setProbe(distance); }, { facing, distance });
    // Normal keyboard route; the only action is sourced jab, explicitly simulated.
    await page.keyboard.press('j');
    const startup = await page.evaluate(() => window.__pikachuPreview.state());
    if (startup.elapsed !== 0 || startup.damage !== 0) throw new Error('Jab startup boundary mismatch');
    await page.keyboard.press('n');
    const contact = await page.evaluate(() => window.__pikachuPreview.state());
    if (contact.build !== build.buildIdentity) throw new Error('Preview build identity mismatch');
    if (contact.elapsed !== 1 || contact.damage !== expectedDamage || (contact.contacts[0]?.region ?? null) !== expectedRegion) {
      throw new Error(`Unexpected contact ${JSON.stringify(contact)}`);
    }
    if (distance === 36) await page.screenshot({ path: path.join(output, `jab-${facing === 1 ? 'right' : 'left'}.png`), fullPage: true });
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    const cleared = await page.evaluate(() => window.__pikachuPreview.state());
    if (cleared.elapsed !== 3 || cleared.regions.length !== 0 || cleared.damage !== expectedDamage) throw new Error('Jab clear/dedup boundary mismatch');
    cases.push({ facing, distance, expectedDamage, expectedRegion, startup, contact, cleared });
  }
  await page.evaluate(() => { window.__pikachuPreview.setFacing(1); window.__pikachuPreview.setProbe(36); });
  await page.keyboard.press('j');
  for (let i = 0; i < 5; i++) await page.keyboard.press('n');
  await page.keyboard.press('j');
  const restart = await page.evaluate(() => window.__pikachuPreview.state());
  await page.keyboard.press('n');
  const repeatContact = await page.evaluate(() => window.__pikachuPreview.state());
  if (restart.elapsed !== 0 || repeatContact.contacts.length !== 2 || repeatContact.damage !== 2.8) throw new Error('Same jab restart mismatch');
  if (errors.length) throw new Error(`Browser errors: ${errors.join(', ')}`);
  writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ scope: 'jab-only preview; no full fighter/animation acceptance',
    build: build.buildIdentity, input: 'simulated browser keyboard J/N', cases, restart, repeatContact, errors }, null, 2) + '\n');
  console.log(`Pikachu preview passed ${cases.length} hit/miss cases, startup/clear/dedup boundaries and same-jab restart; both-facings screenshots captured.`);
} finally { await browser.close(); }
