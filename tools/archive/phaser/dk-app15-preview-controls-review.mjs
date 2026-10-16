/** Preview controls exercise UI adapters; physical inputs are qualified by Match tools. */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=b=>createHash('sha256').update(b).digest('hex');
const out=process.env.PF_APP15_PREVIEW_OUT;assert.ok(out);await mkdir(out,{recursive:false});
const expectedHTML=process.env.PF_EXPECT_PREVIEW_HTML_SHA,bundleSHA=process.env.PF_EXPECT_BUNDLE_SHA,metaSHA=process.env.PF_EXPECT_DK_METADATA_SHA;
for(const pin of [expectedHTML,bundleSHA,metaSHA])assert.match(pin??'',/^[a-f0-9]{64}$/);
const url='http://127.0.0.1:4196/dk-motion-preview.html',report={scope:'Actual preview UI opponent/grab target/actions/pull-hold floor/depth controls. Preview input adapter, separate physical Match gates; no native attachment parity.',checks:[],cases:[],errors:[],failedResponses:[]};
const check=(label,pass,actual,expected)=>report.checks.push({label,pass,actual,expected});let browser,page,frame;
const read=async()=>JSON.parse(await page.locator('#action-state').textContent());
const solve=async()=>frame.evaluate(()=>{const s=window.__game.scene.getScene('MatchScene');const f=s.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid');return{floor:f.bounds.min.y,captorDepth:s.playerSlots[0].sprite.depth,recipientDepth:s.playerSlots[1].sprite.depth,captor:s.p1.getCaptureAttachmentDiagnostic(),recipient:s.p2.getCaptureAttachmentDiagnostic(),body:s.p2.body.position,receiving:s.p2.getActiveHurtboxes(),bindingCurrent:s.p1.isCaptureAttachmentResultCurrent?.(s.p1.getCaptureAttachmentDiagnostic())};});
async function select(label){const options=await page.locator('#move option').evaluateAll(a=>a.map(n=>({value:n.value,label:n.textContent})));const p=options.find(p=>p.label===label);assert.ok(p,'Actual existing option '+label);await page.selectOption('#move',p.value);}
async function step(n=1){for(let i=0;i<n;i++)await page.locator('#step').click();return read();}
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1440,height:1500}});page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.failedResponses.push({url:r.url(),status:r.status()});});
 const html=await(await page.request.get(url)).body();assert.equal(hash(html),expectedHTML);await writeFile(out+'/served-before.html',html);
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#viewer-status')?.textContent.includes('paused'),null,{timeout:90000});frame=page.frames().find(f=>f.url().includes('/platform-fighter/'));assert.ok(frame);
 const bundle=await frame.evaluate(()=>[...document.scripts].find(s=>/assets\/index-/.test(s.src))?.src);assert.equal(hash(await(await page.request.get(bundle)).body()),bundleSHA);report.bundle={url:bundle,sha256:bundleSHA};assert.equal(hash(await readFile('assets/characters/donkeykong/frames.json')),metaSHA);report.metadataSha256=metaSHA;
 check('actual current action drawing/static collision counts10/10 and completion3/226',await page.locator('#action-drawings').textContent()==='10 / 10'&&await page.locator('#action-collision').textContent()==='10 / 10'&&await page.locator('#completion').textContent()==='3 / 226 actions fully qualified',{drawings:await page.locator('#action-drawings').textContent(),collision:await page.locator('#action-collision').textContent(),completion:await page.locator('#completion').textContent()});
 const defs=[{label:'Standing grab',age:7,key:'.grab'},{label:'Dash grab',age:10,key:'.review_pilot_dash_grab_contact'},{label:'Pivot grab',age:11,key:'.review_pilot_pivot_grab_contact'}];let face=1;
 for(const opponent of ['donkeykong','pikachu'])for(const facing of [1,-1]){
  await page.selectOption('#opponent',opponent);if(face!==facing){await page.locator('#face').click();face=facing;}
  for(const d of defs)for(const target of ['out','in']){
   const name=`${opponent}-${d.label.replaceAll(' ','-')}-${target}-${facing}`;await page.selectOption('#grab-target',target);await select(d.label);await page.locator('#start').click();let o=await read();const samples=[o];
   for(let n=0;n<d.age;n++){o=await step();samples.push(o);}
   if(target==='out')check(name+' whiff owns exact paired drawing',o.grab.name==='whiffActive'&&o.texture.endsWith(d.key)&&!o.opponent.captured,{o,sourceAge:d.age});
   else check(name+' in-range normal capture uses own recipient dimensions',o.opponent.captured&&o.opponent.id===opponent&&o.opponent.dimensions.height===(opponent==='pikachu'?50:84),o);
   if(target==='in'&&opponent==='pikachu'&&d.label==='Standing grab'){
    const entry=await solve();samples.push({attachmentEntry:entry});check(name+' actual paired pull owned floor/depth',entry.captor?.status==='paired'&&entry.bindingCurrent===true&&entry.recipientDepth<entry.captorDepth&&entry.body.y+35.73333333333333<=entry.floor+.55+1e-6,entry);
    o=await step(22);const held=await solve();samples.push({held,observation:o});check(name+' paired hold owned floor/depth',held.captor?.status==='paired'&&held.bindingCurrent===true&&held.recipientDepth<held.captorDepth&&held.body.y+35.73333333333333<=held.floor+.55+1e-6,held);
   }
   report.cases.push({name,opponent,facing,target,definition:d,samples});await page.screenshot({path:out+'/'+name+'.png'});
  }
 }
 for(const facing of [1,-1]){if(face!==facing){await page.locator('#face').click();face=facing;}await page.selectOption('#opponent','donkeykong');for(const action of [{label:'Jab 1',id:'donkeykong.jab'},{label:'Jab 2',id:'donkeykong.jab2'},{label:'Down tilt',id:'donkeykong.dtilt'}]){await select(action.label);await page.locator('#start').click();const o=await read();check(action.label+' accepted action control face'+facing,o.active===action.id,o);}}
 const after=await(await page.request.get(url)).body();await writeFile(out+'/served-after.html',after);check('exact served preview HTML stays unchanged',hash(after)===expectedHTML,{before:hash(html),after:hash(after)});report.htmlSha256=hash(html);check('no page/HTTP errors',report.errors.length===0&&report.failedResponses.length===0,{errors:report.errors,failedResponses:report.failedResponses});report.status=report.checks.every(c=>c.pass)?'PASS_PREVIEW_CONTROL_ADAPTERS':'FAIL';if(report.status==='FAIL')process.exitCode=1;
}catch(e){report.status='ERROR';report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{await browser?.close();report.checkCount=report.checks.length;report.passedChecks=report.checks.filter(c=>c.pass).length;await writeFile(out+'/observations.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({out,status:report.status,cases:report.cases.length,checks:report.checkCount,passed:report.passedChecks,error:report.error}));
