/** Check current gallery availability and controls against its embedded app.
 * This preview-input check does not upgrade character completion or fidelity. */
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.PF_SPECIALS_GALLERY_OUTPUT ?? 'docs/review/2026-10-06/pikachu-character/integration/specials-gallery';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const report = { scope: 'Gallery uses the exact current application bundle in a same-origin frame; controls route logical directional specials through the normal match resolver. This is simulated preview input, not a hardware claim. Four Thunder ground/air/facing scenarios plus other available special starts, playback/pause/reset, smashes and existing menu qualification.', errors: [], failedResponses: [], thunder: [], otherSpecials: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => { if (r.status() >= 400)
    report.failedResponses.push({ url: r.url(), status: r.status() }); });
try {
    await page.goto(process.env.PF_SPECIALS_GALLERY_URL ?? 'http://localhost:4195/pikachu-motion-preview.html');
    assert.equal(await page.locator('[data-page]').count(), 14);
    await page.locator('[data-page="pikachu-special-preview.html?action=thunder"]').click();
    await page.locator('#motion').scrollIntoViewIfNeeded();
    const frame = await (await page.locator('#motion').elementHandle()).contentFrame();
    await frame.waitForFunction(() => window.__pikachuSpecialPreview?.ready, null, { timeout: 45000 });
    const step = async (n) => frame.evaluate(n => { for (let i = 0; i < n; i++)
        window.__pikachuSpecialPreview.step(); return window.__pikachuSpecialPreview.state(); }, n);
    for (const airborne of [false, true])
        for (const facing of [1, -1]) {
            await frame.locator('#action').selectOption('thunder');
            await frame.locator('#context').selectOption(airborne ? 'air' : 'ground');
            const current = await frame.evaluate(() => window.__pikachuSpecialPreview.state());
            if (current.facing !== facing)
                await frame.locator('#mirror').click();
            else
                await frame.locator('#reset').click();
            const ready = await frame.evaluate(() => window.__pikachuSpecialPreview.state());
            assert.equal(ready.elapsed, 0);
            assert.equal(ready.started, false);
            await frame.locator('#attack').click();
            const rows = [];
            const trace = [];
            let age = 1;
            for (const target of [1, 12, 24, 36, 52, 70]) {
                let state = await frame.evaluate(() => window.__pikachuSpecialPreview.state());
                for (let i = age; i < target; i++) {
                    state = await step(1);
                    trace.push(state);
                }
                age = target;
                const screenshot = [12, 24, airborne ? 52 : 36].includes(target) ? `thunder-${airborne ? 'air' : 'ground'}-${facing}-${target}.png` : null;
                if (screenshot)
                    await (await (await frame.locator('#game').elementHandle()).contentFrame()).locator('canvas').screenshot({ path: `${output}/${screenshot}` });
                rows.push({ screenshot, ...state });
            }
            report.currentScenario = { airborne, facing, rows, trace };
            assert.equal(rows[0].special.kind, 'thunder');
            assert.equal(rows[0].special.bornGrounded, !airborne);
            assert.deepEqual(rows[0].origin, [.5, 416 / 512]);
            assert.equal(rows[0].receiving.length, 12);
            assert.ok(rows.some(r => r.objects.some(o => o.kind === 'cloud')));
            assert.ok(rows.some(r => r.objects.some(o => o.kind === 'bolt')));
            assert.ok(trace.some(r => r.objects.some(o => o.kind === 'burst')));
            assert.ok(trace.some(r => r.special?.branchFrame != null));
            if (!airborne)
                assert.ok(rows.some(r => r.damage > 0));
            assert.ok(rows.some(r => r.objects.some(o => o.kind === 'cloud' && o.y > r.camera.worldView.y && o.y < r.camera.worldView.y + r.camera.worldView.height)));
            report.thunder.push({ airborne, facing, ready, rows, trace });
        }
    await frame.locator('#reset').click();
    await frame.locator('#overlay').check();
    await frame.locator('#play').click();
    await frame.waitForFunction(() => window.__pikachuSpecialPreview.state().elapsed >= 8, null, { timeout: 15000 });
    await frame.locator('#play').click();
    const pause = await frame.evaluate(() => window.__pikachuSpecialPreview.state());
    await page.waitForTimeout(180);
    assert.equal((await frame.evaluate(() => window.__pikachuSpecialPreview.state())).elapsed, pause.elapsed);
    report.pause = pause;
    const game = await (await frame.locator('#game').elementHandle()).contentFrame();
    await game.evaluate(() => { window.__game.__galleryReuseProbe = 'loaded-once'; });
    for (const selected of ['jolt', 'skull', 'quick']) {
        await page.locator(`[data-page="pikachu-special-preview.html?action=${selected}"]`).click();
        assert.equal(await game.evaluate(() => window.__game.__galleryReuseProbe), 'loaded-once');
        assert.equal(await frame.locator('#action').inputValue(), selected);
        await frame.locator('#context').selectOption('ground');
        await frame.locator('#attack').click();
        const entry = await frame.evaluate(() => window.__pikachuSpecialPreview.state());
        assert.equal(entry.special.kind, { jolt: 'thunderJolt', skull: 'skullBash', quick: 'quickAttack' }[selected]);
        const trace = [entry];
        for (let i = 0; i < 60; i++)
            trace.push(await step(1));
        report.otherSpecials.push({ selected, entry, trace });
        if (selected === 'jolt')
            assert.ok(trace.some(r => r.objects.some(o => o.kind.startsWith('jolt'))));
    }
    await frame.locator('#action').selectOption('thunder');
    await frame.locator('#reset').click();
    await frame.press('body', 'f');
    assert.equal((await frame.evaluate(() => window.__pikachuSpecialPreview.state())).elapsed, 1);
    await frame.press('body', 'n');
    assert.equal((await frame.evaluate(() => window.__pikachuSpecialPreview.state())).elapsed, 2);
    await page.locator('[data-page="pikachu-smash-packed-preview.html"]').click();
    const smash = await (await page.locator('#motion').elementHandle()).contentFrame();
    await smash.waitForFunction(() => window.__pikachuSmashPreview?.ready);
    for (const action of ['forward-smash', 'up-smash', 'down-smash']) {
        await smash.locator('#action').selectOption(action);
        await smash.locator('#attack').click();
        await smash.locator('#step').click();
    }
    await page.locator('[data-page="pikachu-jab-packed-preview.html"]').click();
    const jab = await (await page.locator('#motion').elementHandle()).contentFrame();
    await jab.waitForFunction(() => window.__pikachuJabPreview?.ready);
    const idle = await jab.evaluate(() => window.__pikachuJabPreview.state());
    assert.equal(idle.spriteOrigin.y, 416 / 512);
    report.jabIdle = idle;
    delete report.currentScenario;
    report.build = await (await page.request.get(new URL('/launch-scope.json', page.url()).href)).json();
    const embedded = await page.request.get(new URL(`/platform-fighter/assets/${report.build.gameBuild.bundle}`, page.url()).href);
    assert.equal(createHash('sha256').update(await embedded.body()).digest('hex'), report.build.gameBuild.bundleSha256);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.failedResponses, []);
    report.result = 'PASS';
    console.log(JSON.stringify({ result: report.result, thunder: report.thunder.length, otherSpecials: report.otherSpecials.length, errors: report.errors }));
}
catch (e) {
    report.result = 'FAIL';
    report.failure = e.stack;
    throw e;
}
finally {
    await writeFile(`${output}/observations.json`, JSON.stringify(report, null, 2) + '\n');
    await browser.close();
}
