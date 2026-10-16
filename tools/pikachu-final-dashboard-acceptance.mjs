import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output='docs/review/2026-10-06/pikachu-character/integration/completion-final-dashboard-qualified';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage({viewport:{width:1280,height:1100}});
const report={errors:[],failedResponses:[],scope:'Final canonical144-action beta dashboard, menu navigation, unchanged packed jab frame controls, current prose and exact published application bytes.'};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
try{
 await page.goto('http://127.0.0.1:4195/pikachu-motion-preview.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#completion-count')?.textContent==='144 / 144 · 100%');
 report.progress=await(await page.request.get('http://127.0.0.1:4195/pikachu-progress.json')).json();
 assert.equal(report.progress.complete,144);
 assert.deepEqual(report.progress.counts,{implemented:144,accepted:144,verified:144});
 assert.equal(await page.locator('[data-page]').count(),15);
 assert.equal(await page.locator('#open-match').getAttribute('href'),'http://localhost:4195/platform-fighter/');
 await page.locator('[data-page="pikachu-jab-packed-preview.html"]').click();
 const frame=await(await page.locator('#motion').elementHandle()).contentFrame();
 await frame.waitForFunction(()=>window.__pikachuJabPreview?.ready);
 assert.ok(!(await frame.locator('body').innerText()).includes('Full-fighter integration remains incomplete'));
 await page.screenshot({path:output+'/dashboard-144.png',fullPage:true});
 await frame.locator('#attack').click();report.before=await frame.evaluate(()=>window.__pikachuJabPreview.state());
 await frame.locator('#step').click();report.after=await frame.evaluate(()=>window.__pikachuJabPreview.state());
 assert.equal(report.before.elapsed,0);assert.equal(report.after.elapsed,1);
 await page.screenshot({path:output+'/dashboard-jab-step.png',fullPage:true});
 const build=JSON.parse(await readFile('.tmp/pikachu-final-recovery-throws-production-assets-staged.json','utf8'));
 report.bundleSha256=createHash('sha256').update(await(await page.request.get('http://127.0.0.1:4195/platform-fighter/assets/'+build.bundle)).body()).digest('hex');
 assert.equal(report.bundleSha256,build.bundleSha256);assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedResponses,[]);
 report.result='PASS';console.log(JSON.stringify({result:report.result,coverage:'144/144',menuButtons:15,errors:report.errors}));
}catch(e){report.result='FAIL';report.failure=e.stack;throw e;}
finally{await writeFile(output+'/observations.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
