import { chromium } from 'playwright';
const URL = process.env.GAME_URL ?? 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.scene?.isActive?.('MainMenuScene'), null, { timeout: 20000 });
await page.evaluate(() => {
  const cfg = { mode:'stocks', stockCount:99, stageId:'flat', rngSeed:12648430,
    players:[{index:1,characterId:'wolf',paletteIndex:0,inputType:'keyboard_p1'},
             {index:2,characterId:'cat',paletteIndex:0,inputType:'keyboard_p2'}] };
  window.__game.scene.keys['MainMenuScene'].scene.start('MatchScene', { matchConfig: cfg });
});
await page.waitForFunction(() => window.__game?.scene?.isActive?.('MatchScene'), null, { timeout: 20000 });
await page.waitForTimeout(800);

const result = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const s = window.__game.scene.keys['MatchScene'];
  const dummy = s.p2;
  // Ground the dummy: find flat ground top, place feet on it.
  const ground = s.baseStage.rendered.platformBodies.find(b => b.label==='platform.solid');
  const groundTop = ground.bounds.min.y;            // ~930
  const halfH = dummy.getTuning().height/2;
  const standY = groundTop - halfH - 1;
  const MOVES = {
    'wolf.smash':{x:4.0,y:-1.5,scaling:0.4,baseMagnitude:1.2,damageGrowth:0.5},
    'blaze.punch':{x:4.4,y:-1.5,scaling:0.35,baseMagnitude:2,damageGrowth:0.5},
    'wolf.tilt':{x:2.0,y:-0.5,scaling:0.13},
  };
  async function koPct(kb, facing=1) {
    for (let pct=0; pct<=220; pct+=10) {
      const before = s.stockTracker.getStocks(1);
      dummy.setPosition(960, standY); dummy.setVelocity?.(0,0);
      dummy.setDamagePercent?.(pct);
      await wait(64);                       // settle, become grounded
      dummy.setPosition(960, standY); dummy.setVelocity?.(0,0);
      await wait(32);
      const grounded = dummy.isGrounded?.();
      dummy.applyHit({ damage:0, knockback:kb, facing });
      let koed=false, maxDx=0, maxUp=0, maxDown=0, fellPit=false;
      for (let i=0;i<160 && !koed;i++){
        await wait(16);
        const p = dummy.getPosition();
        maxDx=Math.max(maxDx,Math.abs(p.x-960));
        maxUp=Math.max(maxUp, standY-p.y);
        maxDown=Math.max(maxDown, p.y-standY);
        if (s.stockTracker.getStocks(1) < before){ koed=true; if(p.y>1200)fellPit=true; }
      }
      if (koed){ await wait(220); return {koPct:pct, grounded, maxDx:Math.round(maxDx), maxUp:Math.round(maxUp), maxDown:Math.round(maxDown), fellPit}; }
    }
    return {koPct:'>220'};
  }
  const out={};
  for (const [id,kb] of Object.entries(MOVES)) out[id]=await koPct(kb,1);
  out._blast = { groundTop, standY, sideBlastFromCenter: 1920/2+700, botBlastY: 1080+500 };
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
