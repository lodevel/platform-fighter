/** Scene-owned action lease. Source phase protection/kinetics are separate
 * fields: capturing a victim does not grant the owner's Final invulnerability. */
export interface FinalSmashActorControl {
  readonly runId: number;
  readonly role: 'owner' | 'captured';
  readonly phase: string;
  readonly age: number;
  readonly sheet: string | null;
  readonly facing: 1 | -1;
  /** Source-guided Pika status-entry ROOT rotation after the LR mirror. */
  readonly rotationDegrees?:number;
  readonly intangible: boolean;
  readonly noDead: boolean;
  readonly terrainBypass: boolean;
  readonly jostle: boolean;
  readonly gravityDisabled: boolean;
  /** Final miss STOP energy owns X while ordinary air gravity retains Y. */
  readonly inheritVerticalVelocity?:boolean;
  readonly velocity: Readonly<{ x: number; y: number }> | null;
}
