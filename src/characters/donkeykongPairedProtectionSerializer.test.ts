import {describe,expect,it} from 'vitest';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import {DONKEYKONG_DTILT} from './DonkeyKong';
import {buildCharacterEditorFields} from '../characterBuilder/characterEditorFields';
import {resolveDonkeyKongProtectionClock} from './donkeykongPairedProtectionClock';
const data=()=>serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'));
describe('saved paired protection source coordinates, including shorter gameplay timelines',()=>{
 it('retains source4..7 after edited total5 through JSON save/reload without migration',()=>{
  const move={...DONKEYKONG_DTILT,startupFrames:2,activeFrames:1,recoveryFrames:2};
  const loaded=parseCharacterDataFile({...data(),moves:{downLight:move}});
  const reloaded=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(loaded))));
  expect(reloaded.moves!.downLight!.protectionWindows).toEqual(DONKEYKONG_DTILT.protectionWindows);
  const saved=reloaded.moves!.downLight!;
  expect(resolveDonkeyKongProtectionClock(saved,1.6).age).toBe(4);
  expect(resolveDonkeyKongProtectionClock(saved,3).age).toBe(7);
 });
 it('preserves authored source-window edits beyond gameplay total and rejects beyond source extent',()=>{
  const edited={...DONKEYKONG_DTILT,startupFrames:2,activeFrames:1,recoveryFrames:2,
   protectionWindows:[{startFrame:3,endFrame:8,regions:['arml']}]};
  const reloaded=parseCharacterDataFile(JSON.parse(JSON.stringify({...data(),moves:{downLight:edited}})));
  expect(reloaded.moves!.downLight!.protectionWindows).toEqual(edited.protectionWindows);
  expect(()=>parseCharacterDataFile({...data(),moves:{downLight:{...edited,protectionWindows:[{startFrame:3,endFrame:25,regions:['arml']}]}}})).toThrow(/paired source-animation/);
 });
 it('leaves nonpaired DK and Pikachu action extent validation unchanged',()=>{
  const unpaired={...DONKEYKONG_DTILT,id:'donkeykong.forward-tilt',startupFrames:2,activeFrames:1,recoveryFrames:2};
  expect(()=>parseCharacterDataFile({...data(),moves:{downLight:unpaired}})).toThrow(/action timeline/);
  const p=serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu'));
  const other={...p.moves!.jab!,startupFrames:2,activeFrames:1,recoveryFrames:2,protectionWindows:[{startFrame:4,endFrame:7,regions:['arml']}]};
  expect(()=>parseCharacterDataFile({...p,moves:{jab:other}})).toThrow(/action timeline/);
 });
 it('labels editable protection values as source ages and limits them to source24, preserving other fields',()=>{
  const fields=buildCharacterEditorFields(getAuthorableCharacterSpec('donkeykong'),'move','downLight');
  const sourceFields=fields.filter(f=>f.path[0]==='protectionWindows');expect(sourceFields).toHaveLength(2);
  expect(sourceFields.every(f=>f.label.startsWith('Source age / ')&&f.max===24&&f.integer)).toBe(true);
  expect(fields.find(f=>f.id==='startupFrames')!.label.startsWith('Source age')).toBe(false);
  const other=buildCharacterEditorFields(getAuthorableCharacterSpec('pikachu'),'move','jab');
  expect(other.some(f=>f.label.startsWith('Source age / '))).toBe(false);
 });
});
