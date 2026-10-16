import { chromium } from 'playwright';
import fs from 'node:fs';
import { STAR_ROD_STAR } from '../src/items/StarRod';
import { FIRE_FLOWER_FLAME } from '../src/items/FireFlower';

const url = process.env.PF_GAME_URL ?? 'http://127.0.0.1:4173/platform-fighter/';
const out = process.argv[2] ?? 'docs/review/2026-10-15/user-bugs/visuals';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [], checks: unknown[] = [], failedRequests: unknown[] = [];
page.on('pageerror', e => errors.push(String(e.stack ?? e)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('requestfailed', request => failedRequests.push({url:request.url(),error:request.failure()}));
const config = (stageId: string) => ({mode: 'stocks', stockCount: 3, stageId,
  linkIntroPolicy: 'none', itemFrequency: 'off', rngSeed: 20261015,
  players: [{index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1'},
    {index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p2'}]});
let failure: string | null = null;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => Boolean((window as any).__sim?.startMatch), null, { timeout: 300000 });
  async function start(stage: string) {
    await page.evaluate(async config => {
      const probe = (window as any).__sim;
      probe.startMatch(config); (window as any).__sim.manual(true);
      await (window as any).__sim.ready;
      for (let i=0;i<100;i++) (window as any).__sim.step();
    }, config(stage));
  }
  await start('inferno');
  const inferno = await page.evaluate(() => {
    const p = (window as any).__sim;
    p.draw();
    return { identity: p.match.buildIdentity, meterRule: p.config.finalSmashRules,
      visibleMeters: [...document.querySelectorAll<HTMLElement>('.hud-meter')].filter(n => !n.hidden).length,
      corners: [p.project(0,0),p.project(1920,1080)], frame: p.frame };
  });
  if(inferno.visibleMeters!==2)throw new Error('Fresh match meters are hidden');
  if(inferno.corners[0].x < -2 || inferno.corners[0].y < -2 || inferno.corners[1].x > 1922 || inferno.corners[1].y > 1082)
    throw new Error('Inferno scenery cropped');
  checks.push({name:'Inferno full composition and fresh default meters',...inferno});
  await page.screenshot({path:`${out}/inferno-full.png`});
  await page.waitForTimeout(1100);
  await page.screenshot({path:`${out}/inferno-animated.png`});
  await start('flat');
  const shots = await page.evaluate(({star,flame}) => {
    const p = (window as any).__sim, sim=p.match;
    const centre = sim.playerSlots[0].character.getPosition();
    // Controlled projectile admission, with the exact production item packets.
    // Collision, visual recipe, frame selection and draw are real host paths.
    const rows=[{shot:star,x:centre.x+100,y:centre.y-75,facing:1},
      {shot:flame,x:centre.x+160,y:centre.y-75,facing:1},
      {shot:flame,x:centre.x+220,y:centre.y-75,facing:-1}];
    rows.forEach(row=>sim.spawnItemShot(0,row));
    p.draw();
    return { shots:p.view().projectiles, centre:p.project(centre.x+160,centre.y-75) };
  },{star:STAR_ROD_STAR,flame:FIRE_FLOWER_FLAME});
  if(shots.shots.filter((p:any)=>p.visualRecipe?.kind==='item-shot').length!==3)throw new Error('Item shots absent');
  checks.push({name:'Actual Star Rod and Fire Flower recipes in both directions',...shots});
  await page.screenshot({path:`${out}/item-shots.png`});
  const clip={x:Math.max(0,Math.min(1520,shots.centre.x-200)),y:Math.max(0,Math.min(880,shots.centre.y-100)),width:400,height:200};
  await page.screenshot({path:`${out}/item-shots-close.png`,clip});
  await page.evaluate(() => { const p=(window as any).__sim;for(let i=0;i<8;i++)p.step();p.draw(); });
  await page.screenshot({path:`${out}/item-shots-moving.png`});
} catch(error) { failure=String(error instanceof Error ? error.stack : error); }
finally {
  fs.writeFileSync(`${out}/report.json`,JSON.stringify({url,checks,errors,failure,failedRequests,qualification:'Production match host; exact production packets admitted as controlled setup, actual draw and default rules observed'},null,2)+'\n');
  await browser.close();
}
if(failure || errors.length) { console.error(JSON.stringify({failure,errors})); process.exitCode=1; }
else console.log(JSON.stringify({checks:checks.length,errors:0,out}));
