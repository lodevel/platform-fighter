import { chromium } from 'playwright';
const URL = process.env.GAME_URL ?? 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>!!window.__game?.scene?.isActive?.('MainMenuScene'),null,{timeout:20000});
// wolf (mid-heavy 16) vs cat (light 8) so we can measure both as victim by swapping.
await page.evaluate(()=>{const cfg={mode:'stocks',stockCount:99,stageId:'flat',rngSeed:1,players:[
  {index:1,characterId:'bear',paletteIndex:0,inputType:'keyboard_p1'},
  {index:2,characterId:'cat',paletteIndex:0,inputType:'keyboard_p2'}]};
  window.__game.scene.keys['MainMenuScene'].scene.start('MatchScene',{matchConfig:cfg});});
await page.waitForFunction(()=>window.__game?.scene?.isActive?.('MatchScene'),null,{timeout:20000});
await page.waitForTimeout(800);
const res = await page.evaluate(async ()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const s=window.__game.scene.keys['MatchScene'];
  const g=s.baseStage.rendered.platformBodies.find(b=>b.label==='platform.solid');
  const groundTop=g.bounds.min.y;
  // victims: p1=bear(heavy16), p2=cat(light8). Test both.
  const SMASH={x:4.0,y:-1.5,scaling:0.4,baseMagnitude:1.2,damageGrowth:0.5};
  const PUNCH={x:4.4,y:-1.5,scaling:0.35,baseMagnitude:2,damageGrowth:0.5};
  async function ko(victim, vIdx, kb, temper){
    globalThis.__kbTemper=temper;
    const standY=groundTop - victim.getTuning().height/2 - 1;
    for(let pct=0;pct<=180;pct+=10){
      const before=s.stockTracker.getStocks(vIdx);
      victim.setPosition(960,standY); victim.setVelocity?.(0,0); victim.setDamagePercent?.(pct);
      await wait(60); victim.setPosition(960,standY); victim.setVelocity?.(0,0); await wait(24);
      victim.applyHit({damage:0,knockback:kb,facing:1});
      let koed=false;
      for(let i=0;i<150&&!koed;i++){ await wait(16); if(s.stockTracker.getStocks(vIdx)<before)koed=true; }
      if(koed){ await wait(160); return pct; }
    }
    return '>180';
  }
  const out={};
  for(const T of [0.05,0.06,0.07,0.08]){
    out['T'+T]={
      smash_vs_cat8: await ko(s.p2,1,SMASH,T),
      smash_vs_bear16: await ko(s.p1,0,SMASH,T),
      punch_vs_cat8: await ko(s.p2,1,PUNCH,T),
      punch_vs_bear16: await ko(s.p1,0,PUNCH,T),
    };
  }
  globalThis.__kbTemper=undefined;
  return out;
});
console.log(JSON.stringify(res,null,1));
await browser.close();
