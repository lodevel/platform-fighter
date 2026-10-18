import source from './finalFxCueFacts.json';
import {legacySheets,LEGACY_FINAL_FX_BANKS} from '../assets/legacyFighterSheets';
import {parseFinalFxCueFacts,parseFinalFxProfiles,type FinalFxProfiles} from './finalFxProfiles';
export const FINAL_FX_CUES=parseFinalFxCueFacts(source);
const profiles=new Map<string,FinalFxProfiles>();
export function registeredFinalFxProfiles(fighter:string):FinalFxProfiles{
  if(fighter!=='donkeykong'&&fighter!=='pikachu')return new Map();let selected=profiles.get(fighter);
  if(!selected){selected=parseFinalFxProfiles(LEGACY_FINAL_FX_BANKS[fighter],fighter,legacySheets(fighter),FINAL_FX_CUES);profiles.set(fighter,selected);}
  return selected;
}
