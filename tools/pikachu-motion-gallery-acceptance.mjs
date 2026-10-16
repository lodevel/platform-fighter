import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),base=path.join(root,'docs/review/2026-10-06/pikachu-character');
const build=JSON.parse(readFileSync(path.join(base,'motion-gallery-build.json')));
const out=path.join(base,'motion-gallery');mkdirSync(out,{recursive:true});
const url='http://127.0.0.1:4195/pikachu-motion-preview.html';
const report={url,scope:'Gallery navigation and unchanged reviewed move snapshots; existing individual move evidence remains separate',cases:[],errors:[]};
const assert=(v,m)=>{if(!v)throw new Error(m);};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
try{
  report.servedFiles={};
  for(const [file,expected] of Object.entries(build.files)){
    const response=await fetch(new URL(file,url));assert(response.ok,`Missing gallery file ${file}`);
    const hash=createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
    assert(hash===expected,`Changed gallery file ${file}`);report.servedFiles[file]=hash;
  }
  await page.goto(url,{waitUntil:'networkidle'});
  assert(await page.locator('[data-page]').count()===9,'Nine reviewed preview choices required');
  for(const [entry,api] of [
    ['pikachu-jab-packed-preview.html','__pikachuJabPreview'],
    ['pikachu-back-air-packed-preview.html','__pikachuBackAirPreview'],
    ['pikachu-neutral-air-packed-preview.html','__pikachuNeutralAirPreview'],
    ['pikachu-down-air-packed-preview.html','__pikachuDownAirPreview'],
    ['pikachu-dash-attack-packed-preview.html','__pikachuDashAttackPreview'],
    ['pikachu-up-air-packed-preview.html','__pikachuUpAirPreview'],
    ['pikachu-vertical-tilt-packed-preview.html','__pikachuVerticalTiltPreview'],
    ['pikachu-fair-posed-preview.html','__pikachuFairPreview'],
    ['pikachu-forward-tilt-preview.html','__pikachuMotionPreview'],
  ]){
    await page.locator(`[data-page="${entry}"]`).click();
    const frame=await(await page.locator('#motion').elementHandle()).contentFrame();
    await frame.waitForFunction(key=>window[key]?.ready,api);
    assert(await page.locator(`[data-page="${entry}"]`).getAttribute('aria-pressed')==='true','Selected move button mismatch');
    assert((await page.locator('#open-preview').getAttribute('href'))===entry,'Standalone link mismatch');
    await frame.locator('#attack').click();
    const before=await frame.evaluate(key=>window[key].state(),api);
    await frame.locator('#step').click();
    const after=await frame.evaluate(key=>window[key].state(),api);
    assert(before.elapsed===0&&after.elapsed===1,`Frame controls failed for ${entry}`);
    assert(await frame.locator('#game canvas').count()===1,`Missing animation canvas ${entry}`);
    await page.screenshot({path:path.join(out,entry.replace('.html','.png')),fullPage:true});
    report.cases.push({entry,passed:true,moveId:after.moveId,pose:after.pose});
  }
  assert(report.errors.length===0,'Gallery browser errors');report.status='passed';
}catch(e){report.status='failed';report.failure=String(e);throw e;}
finally{writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({status:report.status,cases:report.cases,servedFiles:Object.keys(report.servedFiles).length,errors:report.errors}));
