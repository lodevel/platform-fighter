import { describe, expect, it } from 'vitest';
import { DeviceInputDispatcher } from './DeviceInputDispatcher';
import { InputBindingsStore } from './InputBindingsStore';
import { InputResolver, buildCharacterInputFromResolver } from './InputResolver';
import { fillMissingSmash } from './smashBindingDefaults';
import { parseCharacterDataFile, serializeCharacterDataSpec } from '../characters/characterSerializer';
import { getAuthorableCharacterSpec } from '../characters/authorableCharacterRegistry';
import { InputCaptureBuffer } from '../replay/InputCaptureBuffer';
import { deserializeReplay, serializeReplay } from '../replay/ReplayFile';
import { REPLAY_FORMAT_VERSION } from '../replay/replayTypes';
const specs={up:{cancelAfterFrames:49,presentationFrames:78},side:{cancelAfterFrames:49,presentationFrames:71},down:{cancelAfterFrames:49,presentationFrames:75}};
describe('distinct taunt control and persistence',()=>{
 it('samples real binding dispatcher separately from persisted Dodge and accepts rebind',()=>{
  const keys=new Set<number>();const bindings=new InputBindingsStore();
  const dispatcher=new DeviceInputDispatcher({bindings,keyboard:{isDown:c=>keys.has(c)},gamepad:{isConnected:()=>false,getButton:()=>({pressed:false,value:0}),getAxis:()=>0}});
  const resolver=new InputResolver({dispatcher,slots:[1,2]});resolver.update();
  keys.add(66);resolver.update();expect(buildCharacterInputFromResolver(resolver,1)).toMatchObject({appeal:true,dodge:false});
  keys.clear();keys.add(82);resolver.update();expect(buildCharacterInputFromResolver(resolver,1)).toMatchObject({appeal:false,dodge:true});
  bindings.setAction(1,'appeal',[{kind:'keyboard',keyCode:67}]);keys.clear();keys.add(66);resolver.update();expect(buildCharacterInputFromResolver(resolver,1).appeal).toBe(false);
  keys.add(67);resolver.update();expect(buildCharacterInputFromResolver(resolver,1).appeal).toBe(true);
  keys.clear();keys.add(103);resolver.update();expect(buildCharacterInputFromResolver(resolver,2).appeal).toBe(true);
 });
 it('routes simulated pad Select through resolver without firing the legacy Dodge button',()=>{
  const buttons=new Set<number>();const dispatcher=new DeviceInputDispatcher({bindings:new InputBindingsStore(),keyboard:{isDown:()=>false},gamepad:{isConnected:()=>true,getAxis:()=>0,getButton:(_pad,index)=>({pressed:buttons.has(index),value:buttons.has(index)?1:0})}});
  const resolver=new InputResolver({dispatcher,slots:[3]});resolver.update();buttons.add(8);resolver.update();
  expect(buildCharacterInputFromResolver(resolver,3)).toMatchObject({appeal:true,dodge:false});
  buttons.clear();buttons.add(1);resolver.update();expect(buildCharacterInputFromResolver(resolver,3)).toMatchObject({appeal:false,dodge:true});
 });
 it('fills older bindings without stealing a bound input or undoing deliberate unbind',()=>{
  expect(fillMissingSmash({left:[{kind:'keyboard',keyCode:65}],taunt:[{kind:'keyboard',keyCode:82}]}).appeal).toEqual([{kind:'keyboard',keyCode:66}]);
  expect(fillMissingSmash({left:[{kind:'keyboard',keyCode:66}]}).appeal).toEqual([]);
  expect(fillMissingSmash({left:[{kind:'keyboard',keyCode:65}]},{reservedKeyCodes:new Set([66])}).appeal).toEqual([]);
  expect(fillMissingSmash({left:[{kind:'keyboard',keyCode:65}],appeal:[]}).appeal).toEqual([]);
 });
 it('serializes exact opt-in taunt data and rejects malformed source clocks',()=>{
  const raw=JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'))));raw.moves={taunts:specs};
  const saved=serializeCharacterDataSpec(parseCharacterDataFile(raw));expect(parseCharacterDataFile(JSON.parse(JSON.stringify(saved))).moves?.taunts).toEqual(specs);
  raw.moves.taunts.up.cancelAfterFrames=0;expect(()=>parseCharacterDataFile(raw)).toThrow();
 });
 it('records new appeal channel and migrates v6 to released without altering Dodge',()=>{
  const buffer=new InputCaptureBuffer({playerCount:1});buffer.captureFrame(0,[{moveX:0,jump:false,appeal:true,dodge:true}]);
  const file=serializeReplay({matchConfig:{mode:'stocks',stockCount:3,stageId:'flat',rngSeed:1,players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'}]},capturedFrames:buffer.getEntries()});
  expect(deserializeReplay(file).inputTimeline.entries[0]?.inputs[0]).toMatchObject({appeal:true,dodge:true});
  const old=JSON.parse(JSON.stringify(file));old.version=6;delete old.inputTimeline.entries[0].inputs[0].appeal;
  const migrated=deserializeReplay(old);expect(migrated.version).toBe(REPLAY_FORMAT_VERSION);expect(migrated.inputTimeline.entries[0]?.inputs[0]).toMatchObject({appeal:false,dodge:true});
  expect(old.inputTimeline.entries[0].inputs[0]).not.toHaveProperty('appeal');
 });
});
