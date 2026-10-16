/** Per-target confirmations share a logical strike identity across physical
 * sensor replacement. The caller supplies an explicit monotonic gameplay clock;
 * this helper does not select Ultimate's still-unverified hit-stop clock policy. */
export class AttackContactLedger {
  private history = new WeakMap<object, Map<number, { frame: number | null; repeatable: boolean }>>();

  canConfirm(identity: object, target: number, rehitFrames = 0, frame: number | null = null): boolean {
    this.validate(rehitFrames, frame);
    const previous = this.history.get(identity)?.get(target);
    if (!previous) return true;
    if (!previous.repeatable || rehitFrames === 0) return false;
    if (frame! < previous.frame!) throw new Error('Attack contact gameplay clock moved backward without reset');
    return frame! - previous.frame! >= rehitFrames;
  }

  /** Call only after damage resolution confirms the contact. Rejected overlap
   * must leave both a first contact and an eligible repeat available. */
  confirm(identity: object, target: number, rehitFrames = 0, frame: number | null = null): void {
    if (!this.canConfirm(identity, target, rehitFrames, frame)) throw new Error('Attack contact confirmed before eligibility');
    let targets = this.history.get(identity);
    if (!targets) { targets = new Map(); this.history.set(identity, targets); }
    targets.set(target, { frame, repeatable: rehitFrames > 0 });
  }

  /** Read-only evidence for a live logical strike; never rearms contacts. */
  snapshotFor(identity:object):readonly {target:number;frame:number|null;repeatable:boolean}[]{
    return [...(this.history.get(identity)??[])].map(([target,row])=>({target,...row})).sort((a,b)=>a.target-b.target);
  }
  forget(identity: object): void { this.history.delete(identity); }
  reset(): void { this.history = new WeakMap(); }

  private validate(rehitFrames: number, frame: number | null): void {
    if (!Number.isInteger(rehitFrames) || rehitFrames < 0) throw new Error('Attack re-hit interval must be a non-negative integer');
    if (rehitFrames > 0 && (frame === null || !Number.isInteger(frame) || frame < 0)) {
      throw new Error('Repeating attack contact requires an explicit non-negative gameplay clock');
    }
  }
}
