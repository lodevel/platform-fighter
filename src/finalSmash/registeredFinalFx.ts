import donkey from '../../assets/characters/donkeykong/frames.json';
import pikachu from '../../assets/characters/pikachu/frames.json';
import source from './finalFxCueFacts.json';
import {parseFinalFxCueFacts,parseFinalFxProfiles,type FinalFxProfiles} from './finalFxProfiles';
interface FxBank {readonly animations:Readonly<Record<string,{frameWidth:number;frameHeight:number;frameCount:number}>>;
  readonly runtimeFinalFxProfiles?:unknown;}
const banks={donkeykong:donkey,pikachu} as unknown as Readonly<Record<string,FxBank>>;
export const FINAL_FX_CUES=parseFinalFxCueFacts(source);
const profiles=new Map<string,FinalFxProfiles>();
export function registeredFinalFxProfiles(fighter:string):FinalFxProfiles{
  const bank=banks[fighter];if(!bank)return new Map();let selected=profiles.get(fighter);
  if(!selected){selected=parseFinalFxProfiles(bank.runtimeFinalFxProfiles,fighter,bank.animations,FINAL_FX_CUES);profiles.set(fighter,selected);}
  return selected;
}
