import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {PIKACHU_LEDGE_ATTACK_ROOT_MOTION,PIKACHU_LEDGE_ATTACK_ROOT_PROVENANCE} from './pikachuLedgeRootMotion';
import {PIKACHU_LEDGE_ATTACK,PIKACHU_GETUP_ATTACK,PIKACHU_TRIP_ATTACK} from './pikachuRecoveryAttacks';
import {getAuthorableCharacterSpec} from './authorableCharacterRegistry';
import {parseCharacterDataFile,serializeCharacterDataSpec} from './characterSerializer';
it('binds only ledge attack to all55 exact absolute native Trans samples and retains the corner anchor through save',()=>{
 const bytes=readFileSync(new URL('../../docs/review/2026-10-06/pikachu-character/sources/ledge-attack-exact-root-trajectory.json',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(PIKACHU_LEDGE_ATTACK_ROOT_PROVENANCE.sha256);
 const acquired=JSON.parse(bytes.toString('utf8'));
 const playable=acquired.frames.filter((row:{nativeSample:number})=>row.nativeSample<55);
 expect(playable.map((row:{nativeSample:number})=>row.nativeSample)).toEqual(Array.from({length:55},(_,i)=>i));
 const points=playable.map((row:{sourceProjectedTrans:{x:number;y:number}})=>row.sourceProjectedTrans);
 expect(points).toHaveLength(55);
 expect(PIKACHU_LEDGE_ATTACK_ROOT_MOTION).toEqual(points);
 expect(PIKACHU_LEDGE_ATTACK.ledgeRootMotion).toBe(PIKACHU_LEDGE_ATTACK_ROOT_MOTION);
 expect(PIKACHU_LEDGE_ATTACK_ROOT_MOTION[0]).toEqual({x:-8.999999761581421,y:51.26049995422363});
 expect(PIKACHU_LEDGE_ATTACK_ROOT_MOTION).toHaveLength(PIKACHU_LEDGE_ATTACK.startupFrames+PIKACHU_LEDGE_ATTACK.activeFrames+PIKACHU_LEDGE_ATTACK.recoveryFrames);
 expect(PIKACHU_GETUP_ATTACK.ledgeRootMotion).toBeUndefined();expect(PIKACHU_TRIP_ATTACK.ledgeRootMotion).toBeUndefined();
 const saved=parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('pikachu')))));
 if (!saved.moves) throw new Error('Saved Pikachu has no moves');
 // JSON's signed-zero normalization is explicitly mathematical parity, not raw byte identity.
 expect(JSON.stringify(saved.moves.ledgeAttack)).toContain('ledgeRootMotion');
 expect(JSON.parse(JSON.stringify(saved.moves.ledgeAttack))).toMatchObject({ledgeRootMotion:JSON.parse(JSON.stringify(points))});
});
