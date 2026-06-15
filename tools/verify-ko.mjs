import { chromium } from 'playwright';
const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const b = await chromium.launch(); const page = await b.newPage();
page.on('pageerror', e=>console.log('ERR',e.message));
await page.goto(URL,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>!!window.__game?.scene?.isActive?.('MainMenuScene'),null,{timeout:20000});
await page.evaluate(()=>{const cfg={mode:'stocks',stockCount:99,stageId:'flat',rngSeed:1,players:[
 {index:1,characterId:'bear',paletteIndex:0,inputType:'keyboard_p1'},
 {index:2,characterId:'cat',paletteIndex:0,inputType:'keyboard_p2'}]};
 window.__game.scene.keys['MainMenuScene'].scene.start('MatchScene',{matchConfig:cfg});});
await page.waitForFunction(()=>window.__game?.scene?.isActive?.('MatchScene'),null,{timeout:20000});
await page.waitForTimeout(700);
const r = await page.evaluate(async ()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const s=window.__game.scene.keys['MatchScene'];
 const g=s.baseStage.rendered.platformBodies.find(b=>b.label==='platform.solid');
 const top=g.bounds.min.y;
 async function ko(v,vi,kb){const sy=top-v.getTuning().height/2-1;
  for(let p=0;p<=180;p+=15){const before=s.stockTracker.getStocks(vi);
   v.setPosition(960,sy);v.setVelocity?.(0,0);v.setDamagePercent?.(p);
   await wait(50);v.setPosition(960,sy);v.setVelocity?.(0,0);await wait(20);
   v.applyHit({damage:0,knockback:kb,facing:1});
   let k=false;for(let i=0;i<140&&!k;i++){await wait(16);if(s.stockTracker.getStocks(vi)<before)k=true;}
   if(k){await wait(150);return p;}}
  return '>180';}
 const SMASH={x:4.0,y:-1.5,scaling:0.4,baseMagnitude:1.2,damageGrowth:0.5};
 const PUNCH={x:4.4,y:-1.5,scaling:0.35,baseMagnitude:2,damageGrowth:0.5};
 return { smash_vs_cat8: await ko(s.p2,1,SMASH), smash_vs_bear16: await ko(s.p1,0,SMASH),
          punch_vs_cat8: await ko(s.p2,1,PUNCH), punch_vs_bear16: await ko(s.p1,0,PUNCH) };
});
console.log(JSON.stringify(r));
await b.close();
