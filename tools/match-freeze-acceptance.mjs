// Real browser recovery and disconnect ownership. No shared build mutations.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {openMatchHost} from './browser-match-host.mjs';
const value=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const out=value('out','docs/review/2026-10-15/user-bugs/freezes/recovery');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}}),report={rows:[],errors:[],expectedNetworkFailures:[]};
page.on('pageerror',error=>report.errors.push(error.stack));
const config={mode:'stocks',stockCount:9,stageId:'flat',rngSeed:223016,itemFrequency:'high',linkIntroPolicy:'none',
 finalSmashRules:{schemaVersion:1,meterEnabled:true,smashBallEnabled:true},players:[
  {index:1,characterId:'pikachu',paletteIndex:0,inputType:'gamepad',inputDevice:{kind:'gamepad',gamepadIndex:0}},
  {index:2,characterId:'pikachu',paletteIndex:1,inputType:'ai',aiDifficulty:'hard'}]};
try{
 await page.addInitScript(()=>{window.__testPads=[{index:0,id:'Freeze regression controller',connected:true,buttons:[],axes:[0,0,0,0],mapping:'standard',timestamp:0}];
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__testPads});
  window.__padEvent=(type,index)=>{const pad={index,id:'Freeze regression controller',connected:type==='gamepadconnected',buttons:[],axes:[0,0,0,0],mapping:'standard',timestamp:performance.now()};
   window.__testPads=[];if(pad.connected)window.__testPads[index]=pad;const event=new Event(type);Object.defineProperty(event,'gamepad',{value:pad});dispatchEvent(event);};});
 report.script=await openMatchHost(page,value('url','http://127.0.0.1:4214/'));
 let aborted=false;
 await page.route('**/characters/pikachu/animations/run.png',async route=>{
  if(!aborted){aborted=true;report.expectedNetworkFailures.push({url:route.request().url(),reason:'one-shot regression injection'});await route.abort('failed');}
  else await route.continue();
 });
 await page.evaluate(config=>window.__sim.startMatch(config),config);
 await page.waitForFunction(()=>window.__sim.fault!==null);
 assert.ok(aborted,'the regression aborted a real match PNG request');
 assert.match(await page.evaluate(()=>window.__sim.fault.message),/Could not prepare match:.*Failed to fetch/);
 assert.ok(await page.getByRole('alertdialog',{name:'Match stopped'}).isVisible());
 report.rows.push({case:'one-shot-image-fetch-failure',fault:await page.evaluate(()=>window.__sim.fault)});
 await page.getByRole('button',{name:'Restart match',exact:true}).click();
 await page.evaluate(()=>window.__sim.ready);await page.waitForFunction(()=>window.__sim.frame>10);
 report.rows.push({case:'image-fetch-retry-without-page-reload',frame:await page.evaluate(()=>window.__sim.frame),
  diagnostics:await page.evaluate(()=>window.__sim.renderDiagnostics())});
 await page.waitForFunction(()=>window.__sim.frame>10);
 const disconnect=await page.evaluate(()=>{window.__padEvent('gamepaddisconnected',0);return{paused:window.__sim.paused,frame:window.__sim.frame};});
 assert.ok(disconnect.paused,'disconnect pauses');
 await page.evaluate(()=>window.__padEvent('gamepadconnected',2));
 await page.waitForFunction(frame=>!window.__sim.paused&&window.__sim.frame>frame,disconnect.frame);
 report.rows.push({case:'reconnect-new-index',disconnect,after:await page.evaluate(()=>({frame:window.__sim.frame,device:window.__sim.config.players[0].inputDevice}))});
 await page.evaluate(()=>window.__sim.pause());await page.evaluate(()=>window.__padEvent('gamepaddisconnected',2));
 await page.evaluate(()=>window.__padEvent('gamepadconnected',1));
 assert.ok(await page.evaluate(()=>window.__sim.paused),'reconnect retains manual pause');
 report.rows.push({case:'manual-pause-retained',pass:true});await page.evaluate(()=>window.__sim.resume());
 await page.evaluate(()=>{const s=window.__sim.match,view=s.view.bind(s);let once=true;s.view=()=>{if(once){once=false;throw new Error('controlled one-off view failure');}return view();};});
 await page.waitForFunction(()=>window.__sim.fault!==null);
 assert.ok(await page.getByRole('alertdialog',{name:'Match stopped'}).isVisible());
 report.rows.push({case:'one-off-frame-error',fault:await page.evaluate(()=>window.__sim.fault)});
 await page.getByRole('button',{name:'Restart match',exact:true}).click();
 await page.evaluate(()=>window.__sim.ready);await page.waitForFunction(()=>window.__sim.frame>10);
 report.rows.push({case:'restart-without-page-reload',frame:await page.evaluate(()=>window.__sim.frame)});
 const supported=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2');window.__loseContext=gl?.getExtension('WEBGL_lose_context');
  window.__restored=false;canvas.addEventListener('webglcontextrestored',()=>{window.__restored=true;},{once:true});window.__loseContext?.loseContext();return Boolean(window.__loseContext);});
 assert.ok(supported,'WEBGL_lose_context must be available for the actual context-recovery regression');
 if(supported){
  await page.waitForFunction(()=>window.__sim.fault?.phase==='renderer');
  assert.ok(await page.getByRole('alertdialog',{name:'Match stopped'}).isVisible());
  await page.waitForTimeout(200);await page.evaluate(()=>window.__loseContext.restoreContext());
  await page.waitForFunction(()=>window.__restored);
  await page.getByRole('button',{name:'Restart match',exact:true}).click();await page.evaluate(()=>window.__sim.ready);
  await page.waitForFunction(()=>window.__sim.frame>10);report.rows.push({case:'real-webgl-context-loss-and-restore',pass:true});
 }
 report.buildIdentity=await page.evaluate(()=>window.__sim.match.buildIdentity);
 await page.evaluate(()=>{const sim=window.__sim.match,dispose=sim.dispose.bind(sim);sim.dispose=()=>{dispose();throw new Error('controlled screen cleanup failure');};window.__menu.go('title');});
 assert.ok(await page.getByRole('alertdialog').isVisible());
 await page.getByRole('button',{name:'Return to menu',exact:true}).click();
 await page.waitForFunction(()=>window.__menu.screen==='title');
 await page.waitForFunction(()=>{const screen=document.querySelector('.title-screen');return screen&&Number(getComputedStyle(screen).opacity)>.99;});
 assert.ok(await page.getByRole('heading',{name:/Platform\s*Fighter/}).isVisible());
 report.rows.push({case:'screen-cleanup-error-retains-menu-navigation',pass:true});
 report.faults=await page.evaluate(()=>window.__menu.faults);
 await page.screenshot({path:out+'/recovered.png'});assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(error){report.result='FAIL';report.failure=String(error.stack??error);throw error;}
finally{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
