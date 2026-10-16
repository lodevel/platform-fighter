import {describe,expect,it} from 'vitest';
import {DONKEYKONG_JAB} from './DonkeyKong';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
import {buildCharacterEditorFields} from '../characterBuilder/characterEditorFields';
import {CharacterEditState} from '../characterBuilder/characterEditState';
import {stepCharacterEditorField} from '../characterBuilder/characterEditorFields';
import {donkeyKongJabCanAdvance} from './donkeykongJabContinuability';
const jab={...DONKEYKONG_JAB,startupFrames:2,activeFrames:1,recoveryFrames:2,
 jabChain:{nextId:'donkeykong.jab2',advanceWindowStart:7,continuationWindowEndFrame:28}};
const spec=()=>parseCharacterDataFile({...serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong')),moves:{jab}});
describe('Lab source continuation fields survive shorter phases and persisted edits',()=>{
 it('roundtrips source end28 beyond custom gameplay total5 without truncation',()=>{
  const loaded=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec()))));
  expect(loaded.moves!.jab!.jabChain).toEqual(jab.jabChain);
  expect(donkeyKongJabCanAdvance(loaded.moves!.jab!,3)).toBe(false);expect(donkeyKongJabCanAdvance(loaded.moves!.jab!,4)).toBe(true);
 });
 it('source labels and whole-age Lab edit survive saving without changing phase clocks',()=>{
  const state=new CharacterEditState(spec()),fields=buildCharacterEditorFields(state.getSpec(),'move','jab');
  const end=fields.find(f=>f.id==='jabChain.continuationWindowEndFrame')!,start=fields.find(f=>f.id==='jabChain.advanceWindowStart')!;
  expect(end.label.startsWith('Source age / ')).toBe(true);expect(start.label.startsWith('Source age / ')).toBe(true);expect(end.step).toBe(1);
  state.setMoveNumericField('jab',end.path,stepCharacterEditorField(end,1));
  const saved=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(state.getSpec()))));
  expect(saved.moves!.jab!.jabChain!.continuationWindowEndFrame).toBe(29);expect(saved.moves!.jab!.startupFrames).toBe(2);
 });
 it.each([0,7,6,-1,27.5])('rejects invalid source end %s',end=>{
  expect(()=>parseCharacterDataFile({...serializeCharacterDataSpec(spec()),moves:{jab:{...jab,jabChain:{...jab.jabChain,continuationWindowEndFrame:end}}}})).toThrow();
 });
 it('preserves absent generic/PK continuation fields and their original Lab labels',()=>{
  const pk=getAuthorableCharacterSpec('pikachu'),loaded=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(pk))));
  expect(loaded.moves!.jab!.jabChain?.continuationWindowEndFrame).toBeUndefined();
  expect(buildCharacterEditorFields(loaded,'move','jab').filter(f=>f.path[0]==='jabChain').every(f=>!f.label.startsWith('Source age'))).toBe(true);
 });
});
