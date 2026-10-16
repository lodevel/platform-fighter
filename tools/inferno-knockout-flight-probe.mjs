// Actual accepted Inferno flash, three native roster drawings, eliminated bodies.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost,launchMatch} from './browser-match-host.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/inferno-knockout');await mkdir(out,{recursive:true});
const stockCount=Number(value('stocks','1'));
assert.ok(Number.isSafeInteger(stockCount)&&stockCount>=1);
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[]};
page.on('pageerror',error=>report.errors.push(error.stack));
try{
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4173/platform-fighter/'));
 await launchMatch(page,{mode:'stocks',stockCount,stageId:'inferno',rngSeed:223017,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:false},
  players:['donkeykong','pikachu','link','donkeykong'].map((characterId,index)=>({index:index+1,characterId,paletteIndex:0,inputType:'ai',aiDifficulty:'hard'}))});
 report.buildIdentity=await page.evaluate(()=>window.__sim.match.buildIdentity);
 await page.evaluate(()=>{window.__gazeInputs=[0,0,0,1].map(moveY=>({moveX:0,moveY,jump:false}));
  for(let n=0;n<1889;n++)window.__sim.step(window.__gazeInputs);window.__sim.draw();});
 report.before=await page.evaluate(()=>({frame:window.__sim.frame,stocks:window.__sim.view().hud.players.map(p=>p.stocks),
  roots:window.__sim.match.playerSlots.map(slot=>slot.character.getSourceRootPosition())}));
 assert.deepEqual(report.before.stocks,[stockCount,stockCount,stockCount,stockCount]);
 await page.evaluate(()=>window.__sim.step(window.__gazeInputs));
 for(const age of [0,10,30,60,90,99]){
  const row=await page.evaluate(age=>{
   while(window.__sim.frame<1890+age)window.__sim.step(window.__gazeInputs);
   const view=window.__sim.draw();
   return{frame:view.frame,age,stocks:view.hud.players.map(p=>p.stocks),flights:view.knockoutFlights,
    fighters:view.fighters.map(f=>({playerIndex:f.playerIndex,eliminated:f.eliminated})),
    actual:[0,1,2].map(i=>window.__sim.presentation(i))};
  },age);
  assert.deepEqual(row.stocks,[stockCount-1,stockCount-1,stockCount-1,stockCount]);assert.equal(row.flights.length,3);
  for(let i=0;i<3;i++){
   const flight=row.flights.find(f=>f.playerIndex===i),draw=row.actual[i];
   assert.equal(flight.age,age);assert.equal(row.fighters[i].eliminated,stockCount===1);
   assert.ok(draw?.textureResident&&draw.submitted&&draw.visible,`roster ${i}, age ${age}: native tumble must be submitted despite elimination`);
   assert.equal(draw.flight.playerIndex,i);assert.equal(draw.rotation,flight.rotation);assert.equal(draw.alpha,flight.alpha);
   assert.ok(draw.key.startsWith('char.'+flight.characterId+'.'));
  }
  report.rows.push(row);
  if([10,30,60].includes(age))await page.screenshot({path:`${out}/flight-${age}.png`});
 }
 report.after=await page.evaluate(()=>{window.__sim.step(window.__gazeInputs);const view=window.__sim.draw();
  return{frame:view.frame,stocks:view.hud.players.map(p=>p.stocks),flights:view.knockoutFlights,
   actual:[0,1,2].map(i=>window.__sim.presentation(i)),diagnostics:window.__sim.renderDiagnostics()};});
 assert.equal(report.after.frame,1990);assert.deepEqual(report.after.flights,[]);
 if(stockCount===1)assert.deepEqual(report.after.actual,[null,null,null]);
 assert.deepEqual(report.after.stocks,[stockCount-1,stockCount-1,stockCount-1,stockCount]);assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
