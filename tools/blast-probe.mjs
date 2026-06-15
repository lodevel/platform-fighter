import { chromium } from 'playwright';
const URL = process.env.GAME_URL ?? 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil:'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.scene?.isActive?.('MainMenuScene'), null, {timeout:20000});
await page.evaluate(() => {
  const cfg={mode:'stocks',stockCount:99,stageId:'flat',rngSeed:1,players:[
    {index:1,characterId:'wolf',paletteIndex:0,inputType:'keyboard_p1'},
    {index:2,characterId:'cat',paletteIndex:0,inputType:'keyboard_p2'}]};
  window.__game.scene.keys['MainMenuScene'].scene.start('MatchScene',{matchConfig:cfg});
});
await page.waitForFunction(() => window.__game?.scene?.isActive?.('MatchScene'), null, {timeout:20000});
await page.waitForTimeout(800);
const info = await page.evaluate(async () => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const s=window.__game.scene.keys['MatchScene'];
  // Dump blast zone bodies / sensor bounds.
  const world = s.matter.world.localWorld;
  const blasts = world.bodies.filter(b=>/blast/i.test(b.label||'')).map(b=>({label:b.label,
    minx:Math.round(b.bounds.min.x),maxx:Math.round(b.bounds.max.x),miny:Math.round(b.bounds.min.y),maxy:Math.round(b.bounds.max.y)}));
  const d=s.p2;
  const g=s.baseStage.rendered.platformBodies.find(b=>b.label==='platform.solid');
  const standY=g.bounds.min.y - d.getTuning().height/2 - 1;
  // single hit at 30% and log positions until KO
  const before=s.stockTracker.getStocks(1);
  d.setPosition(960,standY); d.setVelocity?.(0,0); d.setDamagePercent?.(30);
  await wait(80); d.setPosition(960,standY); d.setVelocity?.(0,0); await wait(32);
  d.applyHit({damage:0,knockback:{x:4.0,y:-1.5,scaling:0.4,baseMagnitude:1.2,damageGrowth:0.5},facing:1});
  let koPos=null; const trail=[];
  for(let i=0;i<200;i++){ await wait(16); const p=d.getPosition();
    if(i%6===0) trail.push([Math.round(p.x),Math.round(p.y)]);
    if(s.stockTracker.getStocks(1)<before){ koPos=[Math.round(p.x),Math.round(p.y)]; break; } }
  return { blasts, standY, koPos, trail };
});
console.log(JSON.stringify(info,null,1));
await browser.close();
